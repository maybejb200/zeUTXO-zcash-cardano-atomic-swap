//! Test (a): Orchard 2-of-2 split spend-authorization key with RedPallas (reddsa, orchard SpendAuth).
//! RESEARCH ONLY. Every key, nonce and note is freshly random and thrown away; nothing is broadcast.
//! Checks, per trial:
//!  * additive shares a, b (< 2^252, the DLEQ range) -> joint ak = sigma*(a+b)*G with Orchard's ỹ-sign rule
//!  * joint FVK (ak, nk, rivk) accepted by the orchard crate; a real Orchard note to its address;
//!    both parties compute the same nullifier (both can watch the note, neither can spend alone)
//!  * a real Orchard PCZT spend action (orchard 0.15.5 builder) chooses alpha; rk = ak + alpha*G matches
//!  * (i) cooperative 2-party signature, (ii) sole-sweeper signature after learning the other share,
//!    (iii) adaptor pre-signature + completion + extraction of the adaptor secret;
//!    all accepted by reddsa's standard verifier AND by orchard's PCZT `apply_signature` (verifies under rk)
//!  * negative cases all rejected
use incrementalmerkletree::{Hashable, Level};
use orchard::builder::{Builder, BundleType};
use orchard::bundle::{BundleVersion, Flags};
use orchard::keys::{FullViewingKey, Scope, SpendValidatingKey, SpendingKey};
use orchard::note::{ExtractedNoteCommitment, RandomSeed, Rho};
use orchard::tree::{MerkleHashOrchard, MerklePath};
use orchard::value::NoteValue;
use orchard::{Note, NoteVersion};
use pasta_curves::arithmetic::CurveExt;
use pasta_curves::group::ff::{Field, FromUniformBytes, PrimeField};
use pasta_curves::group::GroupEncoding;
use pasta_curves::pallas;
use rand_core::{OsRng, RngCore};
use reddsa::{orchard::SpendAuth, Signature, SigningKey, VerificationKey};

fn g() -> pallas::Point { pallas::Point::hash_to_curve("z.cash:Orchard")(b"G") }
fn hstar(parts: &[&[u8]]) -> pallas::Scalar {
    let mut st = blake2b_simd::Params::new().hash_length(64).personal(b"Zcash_RedPallasH").to_state();
    for p in parts { st.update(p); }
    pallas::Scalar::from_uniform_bytes(st.finalize().as_array())
}
fn h64(tag: &[u8], parts: &[&[u8]]) -> [u8; 64] {
    let mut st = blake2b_simd::Params::new().hash_length(64).personal(b"zeUTXO_p1_keys__").to_state();
    st.update(tag); for p in parts { st.update(p); }
    *st.finalize().as_array()
}
fn commit(b: &[u8]) -> [u8; 32] {
    let h = blake2b_simd::Params::new().hash_length(32).personal(b"zeUTXO_p1_nonce_").hash(b);
    h.as_bytes().try_into().unwrap()
}
fn share() -> pallas::Scalar { // uniform in [1, 2^252)
    loop { let mut x = [0u8; 32]; OsRng.fill_bytes(&mut x); x[31] &= 0x0f;
           let s = pallas::Scalar::from_repr(x).unwrap(); if !bool::from(s.is_zero()) { return s; } }
}
fn sig_bytes(r: &pallas::Point, s: &pallas::Scalar) -> Signature<SpendAuth> {
    let mut b = [0u8; 64]; b[..32].copy_from_slice(&r.to_bytes()); b[32..].copy_from_slice(&s.to_repr()); Signature::from(b)
}
fn osig(s: &Signature<SpendAuth>) -> orchard::primitives::redpallas::Signature<orchard::primitives::redpallas::SpendAuth> {
    <[u8; 64]>::from(*s).into()
}
fn vk_ok(rk: &[u8; 32], m: &[u8], sig: &Signature<SpendAuth>) -> bool {
    VerificationKey::<SpendAuth>::try_from(*rk).map(|vk| vk.verify(m, sig).is_ok()).unwrap_or(false)
}

#[derive(Default)]
struct Tally { pass: usize, fail: Vec<String>, sigma_neg: usize, sigma_pos: usize }
impl Tally { fn check(&mut self, name: &str, ok: bool) { if ok { self.pass += 1 } else { self.fail.push(name.to_string()) } } }

fn trial(t: &mut Tally, verbose: bool) {
    let gp = g();
    // ---- key generation (each party locally) ----
    let (a, b) = (share(), share());                   // Alice's and Bob's spend-auth shares
    let (pa, pb) = (gp * a, gp * b);                    // exchanged (with PoK/DLEQ, test b) before anything is funded
    let sum = pa + pb;
    let neg = sum.to_bytes()[31] >> 7 == 1;             // Orchard: ak must have ỹ = 0, else negate ask
    let sigma = if neg { -pallas::Scalar::ONE } else { pallas::Scalar::ONE };
    if neg { t.sigma_neg += 1 } else { t.sigma_pos += 1 }
    let ak_pt = sum * sigma;                            // computable by BOTH from public points alone
    let ak: [u8; 32] = ak_pt.to_bytes();
    t.check("ak sign bit cleared", ak[31] & 0x80 == 0);
    t.check("orchard SpendValidatingKey accepts joint ak", SpendValidatingKey::from_bytes(&ak).is_some());
    if neg { t.check("NEG un-normalized ak (A+B) rejected by orchard", SpendValidatingKey::from_bytes(&sum.to_bytes()).is_none()); }
    // joint nk / rivk: commit-reveal contributions, hashed together (neither party chooses them alone)
    let (mut na, mut nb) = ([0u8; 32], [0u8; 32]); OsRng.fill_bytes(&mut na); OsRng.fill_bytes(&mut nb);
    let nk = pallas::Base::from_uniform_bytes(&h64(b"nk", &[&na, &nb]));
    let rivk = pallas::Scalar::from_uniform_bytes(&h64(b"rivk", &[&na, &nb]));
    let mut fvk_b = [0u8; 96]; fvk_b[..32].copy_from_slice(&ak); fvk_b[32..64].copy_from_slice(&nk.to_repr()); fvk_b[64..].copy_from_slice(&rivk.to_repr());
    let fvk = FullViewingKey::from_bytes(&fvk_b);
    t.check("orchard FullViewingKey::from_bytes(ak||nk||rivk) accepted", fvk.is_some());
    let fvk = match fvk { Some(f) => f, None => return };
    let fvk_alice = FullViewingKey::from_bytes(&fvk_b).unwrap(); // Alice's independent copy
    // ---- Bob funds an ordinary Orchard note to the joint address ----
    let addr = fvk.address_at(0u32, Scope::External);
    let rho = loop { let mut r = [0u8; 32]; OsRng.fill_bytes(&mut r); r[31] &= 0x3f; if let Some(x) = Option::from(Rho::from_bytes(&r)) { break x; } };
    let note = loop { let mut rs = [0u8; 32]; OsRng.fill_bytes(&mut rs);
        if let Some(rseed) = Option::from(RandomSeed::from_bytes(rs, &rho)) {
            if let Some(n) = Option::<Note>::from(Note::from_parts(addr, NoteValue::from_raw(100_000_000), rho, rseed, NoteVersion::V2)) { break n; } } };
    t.check("both parties derive the same nullifier", note.nullifier(&fvk) == note.nullifier(&fvk_alice));
    t.check("joint FVK recognises the funded address", fvk_alice.scope_for_address(&note.recipient()) == Some(Scope::External));
    let cmx = ExtractedNoteCommitment::from(note.commitment());
    let path = MerklePath::from_parts(0, core::array::from_fn(|i| MerkleHashOrchard::empty_root(Level::from(i as u8))));
    let anchor = path.root(cmx);
    // ---- the eventual sweeper builds a real Orchard spend (PCZT, no proof) to a fresh address of his own ----
    let mut seed = [0u8; 32]; OsRng.fill_bytes(&mut seed);
    let own = FullViewingKey::from(&SpendingKey::from_bytes(seed).unwrap()).address_at(0u32, Scope::External);
    let mut bld = Builder::new(BundleType::Transactional { bundle_required: false, pad_to_minimum: None },
                               BundleVersion::orchard_v2(), Flags::ENABLED, anchor).expect("builder");
    bld.add_spend(fvk.clone(), note, path).expect("add_spend");
    bld.add_output(None, own, NoteValue::from_raw(100_000_000 - 15_000), [0u8; 512]).expect("add_output");
    let (mut pczt, meta) = bld.build_for_pczt(OsRng).expect("build_for_pczt");
    let idx = meta.spend_action_index(0).expect("spend index");
    let alpha = *pczt.actions_mut()[idx].spend().alpha().as_ref().expect("alpha");
    let rk: [u8; 32] = pczt.actions_mut()[idx].spend().rk().into();
    let rk_manual = (ak_pt + gp * alpha).to_bytes();
    let rk_reddsa: [u8; 32] = VerificationKey::<SpendAuth>::try_from(ak).unwrap().randomize(&alpha).into();
    t.check("rk(PCZT) == ak + alpha*G", rk == rk_manual);
    t.check("rk(PCZT) == reddsa randomize(ak, alpha)", rk == rk_reddsa);
    let mut sighash = [0u8; 32]; OsRng.fill_bytes(&mut sighash); // stand-in for the ZIP 244 sighash
    let rk_pt = Option::<pallas::Point>::from(pallas::Point::from_bytes(&rk)).unwrap();

    // ---- (i) cooperative 2-of-2 Schnorr (commit-then-reveal nonces) ----
    let (ra, rb) = (pallas::Scalar::random(OsRng), pallas::Scalar::random(OsRng));
    let (ra_p, rb_p) = (gp * ra, gp * rb);
    let (ca, cb) = (commit(&ra_p.to_bytes()), commit(&rb_p.to_bytes()));
    t.check("nonce commitments open", commit(&ra_p.to_bytes()) == ca && commit(&rb_p.to_bytes()) == cb);
    let r = ra_p + rb_p;
    let c = hstar(&[&r.to_bytes(), &rk, &sighash]);
    let za = ra + c * (sigma * a + alpha); // alpha counted once (by the action builder's party)
    let zb = rb + c * (sigma * b);
    let joint = sig_bytes(&r, &(za + zb));
    t.check("(i) joint sig verifies (reddsa)", vk_ok(&rk, &sighash, &joint));
    // ---- (ii) sole sweeper (e.g. Alice after Bob's Redeem revealed b) signs alone ----
    let rsk = SigningKey::<SpendAuth>::try_from((sigma * (a + b)).to_repr()).unwrap().randomize(&alpha);
    let solo = rsk.sign(OsRng, &sighash);
    t.check("(ii) sole-sweeper sig verifies (reddsa)", vk_ok(&rk, &sighash, &solo));
    t.check("(ii) sole sweeper rsk derives rk", <[u8; 32]>::from(VerificationKey::from(&rsk)) == rk);
    // ---- (iii) adaptor pre-signature with adaptor point T = t*G ----
    let tsec = pallas::Scalar::random(OsRng); let tp = gp * tsec;
    let (qa, qb) = (pallas::Scalar::random(OsRng), pallas::Scalar::random(OsRng));
    let rr = gp * qa + gp * qb + tp;
    let c2 = hstar(&[&rr.to_bytes(), &rk, &sighash]);
    let zpre = (qa + c2 * (sigma * a + alpha)) + (qb + c2 * (sigma * b));
    t.check("(iii) pre-signature verifies: z'G = R - T + c*rk", gp * zpre == rr - tp + rk_pt * c2);
    t.check("NEG (iii) pre-signature alone rejected", !vk_ok(&rk, &sighash, &sig_bytes(&rr, &zpre)));
    let fin = zpre + tsec;
    let adapt = sig_bytes(&rr, &fin);
    t.check("(iii) completed adaptor sig verifies (reddsa)", vk_ok(&rk, &sighash, &adapt));
    let extracted = fin - zpre;
    t.check("(iii) extracted secret = t and t*G = T", extracted == tsec && gp * extracted == tp);
    t.check("NEG (iii) wrong completion t+1 rejected", !vk_ok(&rk, &sighash, &sig_bytes(&rr, &(zpre + tsec + pallas::Scalar::ONE))));
    // ---- the orchard crate's own signer path accepts external signatures (verifies under the action's rk) ----
    t.check("orchard PCZT apply_signature accepts joint sig", pczt.actions_mut()[idx].apply_signature(sighash, osig(&joint)).is_ok());
    t.check("orchard PCZT apply_signature accepts solo sig", pczt.actions_mut()[idx].apply_signature(sighash, osig(&solo)).is_ok());
    t.check("orchard PCZT apply_signature accepts adaptor-completed sig", pczt.actions_mut()[idx].apply_signature(sighash, osig(&adapt)).is_ok());
    // ---- negatives ----
    let one_share = SigningKey::<SpendAuth>::try_from((sigma * a).to_repr()).unwrap().randomize(&alpha).sign(OsRng, &sighash);
    t.check("NEG one share only (Alice without b) rejected", !vk_ok(&rk, &sighash, &one_share));
    let bob_t = sig_bytes(&rr, &(qb + c2 * (sigma * b) + tsec));
    t.check("NEG Bob alone with b and t rejected", !vk_ok(&rk, &sighash, &bob_t));
    let mut other = sighash; other[0] ^= 1;
    t.check("NEG signature on other sighash rejected", !vk_ok(&rk, &other, &solo));
    let wrong_alpha = SigningKey::<SpendAuth>::try_from((sigma * (a + b)).to_repr()).unwrap().randomize(&pallas::Scalar::random(OsRng)).sign(OsRng, &sighash);
    t.check("NEG wrong alpha rejected", !vk_ok(&rk, &sighash, &wrong_alpha));
    let no_alpha = SigningKey::<SpendAuth>::try_from((sigma * (a + b)).to_repr()).unwrap().sign(OsRng, &sighash);
    t.check("NEG unrandomized ask (no alpha) rejected under rk", !vk_ok(&rk, &sighash, &no_alpha));
    t.check("NEG orchard PCZT rejects one-share sig", pczt.actions_mut()[idx].apply_signature(sighash, osig(&one_share)).is_err());
    if neg {
        let unnorm = SigningKey::<SpendAuth>::try_from((a + b).to_repr()).unwrap().randomize(&alpha).sign(OsRng, &sighash);
        t.check("NEG signing without ỹ-negation rejected", !vk_ok(&rk, &sighash, &unnorm));
    }
    if verbose { println!("sample: sigma={} ak={} rk={} nf={}", if neg { -1 } else { 1 }, hex::encode(ak), hex::encode(rk), hex::encode(note.nullifier(&fvk).to_bytes())); }
}

fn main() {
    let n: usize = std::env::args().nth(1).map(|s| s.parse().unwrap()).unwrap_or(64);
    let mut t = Tally::default();
    for i in 0..n { trial(&mut t, i == 0); }
    println!("trials={n} checks_passed={} checks_failed={} sigma=+1 trials={} sigma=-1 trials={}", t.pass, t.fail.len(), t.sigma_pos, t.sigma_neg);
    for f in &t.fail { println!("FAILED: {f}"); }
    let both = t.sigma_pos > 0 && t.sigma_neg > 0;
    println!("both ỹ-normalization branches exercised: {both}");
    println!("OVERALL {}", if t.fail.is_empty() && both { "PASS" } else { "FAIL" });
}
