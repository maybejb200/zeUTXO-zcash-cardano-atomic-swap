//! zeUTXO path-1 step 6: Zcash side of the simulated swap, ported to the IRONWOOD pool (NU6.3, ZIP 258).
//! RESEARCH / SIMULATOR ONLY. Every key, nonce and note is generated fresh in-run; nothing touches a network.
//! REAL: orchard 0.16.0 (Ironwood bundles, PostNu6_3 circuit/VK, V3 notes), zcash_primitives 0.31.0 (v6 tx format,
//!       ZIP 244/229 txid + sighash), zcash_protocol 0.11.0 (branch ids). SIMULATED: the chain (a JSON file), block
//!       production/times, and the consensus rules listed in check_tx (re-implemented from ZIP 258/2006/229/259/203/218).
//! SPEC-IMPLEMENTED (no published crate, no official vectors found): ZIP 2005 use_qsk key derivation (joint_keys()).
//! Subcommands (args are key=value):
//!   keygen dir party [cheat=..]   prove dir party   reveal dir party   setup dir party [seen=] [params=]
//!   genesis dir [nu7_height=] [start_height=]      status dir [window=n]
//!   fund dir amount [pay=] [cheat=none|orchard_cross|orchard_turnstile|orchard_inflow|wrong_vk|wrong_branch|nu62_v5|allow_turnstile] out
//!   submit dir tx   check dir tx   mine dir n [spacing=s]   reorg dir n   selfspend dir
//!   watch dir party amount min_depth   sweep dir party mode=solo|joint|adaptor [other_share=hex] [cheat=...] out
//!   selftest dir   v4probe dir out
mod dleq;
mod tree;

use ff::{Field, FromUniformBytes, PrimeField};
use group::{Group, GroupEncoding};
use orchard::builder::{Builder, BundleType};
use orchard::bundle::{Authorized as OAuthorized, BatchValidator, BundleVersion, EffectsOnly as OEffects, Flags};
use orchard::circuit::{OrchardCircuitVersion, ProvingKey, VerifyingKey};
use orchard::keys::{FullViewingKey, PreparedIncomingViewingKey, Scope, SpendAuthorizingKey, SpendingKey};
use orchard::note::{ExtractedNoteCommitment, Nullifier, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodDomain, OrchardDomain};
use orchard::primitives::redpallas;
use orchard::tree::MerkleHashOrchard;
use orchard::value::NoteValue;
use orchard::{Address, Note, NoteVersion};
use pasta_curves::arithmetic::CurveExt;
use pasta_curves::pallas;
use rand_core06::RngCore;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Instant;
use zcash_primitives::transaction::sighash::{PrecomputedSighashData, SignableInput};
use zcash_primitives::transaction::{Authorization, Transaction, TransactionData, TxVersion};
use zcash_protocol::consensus::{BlockHeight, BranchId};
use zcash_protocol::value::ZatBalance;

// One circuit / one verifying key for both Orchard-protocol pools from NU6.3 (ZIP 2006).
const CIRCUIT: OrchardCircuitVersion = OrchardCircuitVersion::PostNu6_3;
const GENESIS_ZATS: u64 = 100_000_000;       // Bob's Ironwood note (1 ZEC)
const GENESIS_ORCHARD_ZATS: u64 = 50_000_000; // Bob's legacy Orchard note (0.5 ZEC), for the NU6.3 rule tests
const NO_NU7: u64 = 1_000_000_000;
fn zip317_fee(actions: usize) -> u64 { 5_000 * actions.max(2) as u64 }
fn rng() -> rand::rngs::ThreadRng { rand::rng() }

// ---------------- small helpers ----------------
type Args = HashMap<String, String>;
fn args() -> Args { std::env::args().skip(2).filter_map(|a| a.split_once('=').map(|(k, v)| (k.to_string(), v.to_string()))).collect() }
fn rj(p: &PathBuf) -> Value { serde_json::from_str(&std::fs::read_to_string(p).unwrap_or_else(|e| die(&format!("read {}: {e}", p.display())))).unwrap() }
fn wj(p: &PathBuf, v: &Value) { if let Some(d) = p.parent() { std::fs::create_dir_all(d).unwrap(); } std::fs::write(p, serde_json::to_string_pretty(v).unwrap()).unwrap(); }
fn die(m: &str) -> ! { println!("{}", json!({"ok": false, "reason": m})); std::process::exit(2) }
fn hx(b: &[u8]) -> String { hex::encode(b) }
fn uh(s: &Value) -> Vec<u8> { hex::decode(s.as_str().unwrap()).unwrap() }
fn uh32(s: &Value) -> [u8; 32] { uh(s).try_into().unwrap() }
fn gp() -> pallas::Point { pallas::Point::hash_to_curve("z.cash:Orchard")(b"G") }
fn decp(b: &[u8]) -> Option<pallas::Point> { let a: [u8; 32] = b.try_into().ok()?; Option::from(pallas::Point::from_bytes(&a)) }
fn rbytes() -> [u8; 32] { let mut r = [0u8; 32]; rand_core06::OsRng.fill_bytes(&mut r); r }
fn b2b(len: usize, pers: &[u8; 16], parts: &[&[u8]]) -> Vec<u8> {
    let mut st = blake2b_simd::Params::new().hash_length(len).personal(pers).to_state();
    for p in parts { st.update(p); }
    st.finalize().as_bytes().to_vec()
}
fn commit(b: &[u8]) -> [u8; 32] { b2b(32, b"zeUTXO_p1_nonce_", &[b]).try_into().unwrap() }
fn hstar(parts: &[&[u8]]) -> pallas::Scalar {
    pallas::Scalar::from_uniform_bytes(&b2b(64, b"Zcash_RedPallasH", parts).try_into().unwrap())
}
fn sc(x: &[u8; 32]) -> pallas::Scalar { Option::from(pallas::Scalar::from_repr(*x)).unwrap_or_else(|| die("non-canonical scalar")) }
fn osig(b: [u8; 64]) -> redpallas::Signature<redpallas::SpendAuth> { b.into() }
fn peer(p: &str) -> &'static str { if p == "alice" { "bob" } else { "alice" } }

// ---------------- ZIP 2005 use_qsk derivation (spec-implemented) ----------------
/// PRF^expand_k(t) = BLAKE2b-512("Zcash_ExpandSeed", k || t)
fn prf_expand(k: &[u8], t: &[&[u8]]) -> [u8; 64] {
    let mut parts: Vec<&[u8]> = vec![k]; parts.extend_from_slice(t);
    b2b(64, b"Zcash_ExpandSeed", &parts).try_into().unwrap()
}
/// Joint Ironwood viewing material for the 2-of-2 key, ZIP 2005 § use_qsk = true:
///   sk  = per-swap, from BOTH parties' committed contributions (and the swap id): either party alone cannot choose it
///   nk  = ToBase(PRF^expand_sk([0x07]))
///   qsk = truncate_32(PRF^expand_sk([0x0C]))
///   qk  = BLAKE3.derive_key("Zcash ZIP 2005 qk-derivation v1", qsk)
///   rivk_ext = ToScalar(PRF^expand_qk([0x0D] || I2LEOSP256(ak) || I2LEOSP256(nk)))
///   ak  = Extract_P(sigma*(A_p + B_p)) with sigma chosen so that the y-sign bit of repr_P(ak^P) is 0 (no ask exists).
fn joint_keys(ca: &[u8], cb: &[u8], sid: &[u8; 32], ak: &[u8; 32]) -> ([u8; 96], Value) {
    let sk: [u8; 32] = b2b(32, b"zeUTXO_p1_jsk_v6", &[b"sk", sid, ca, cb]).try_into().unwrap();
    let nk = pallas::Base::from_uniform_bytes(&prf_expand(&sk, &[&[0x07]]));
    let qsk: [u8; 32] = prf_expand(&sk, &[&[0x0C]])[..32].try_into().unwrap();
    let qk: [u8; 32] = blake3::derive_key("Zcash ZIP 2005 qk-derivation v1", &qsk);
    let rivk = pallas::Scalar::from_uniform_bytes(&prf_expand(&qk, &[&[0x0D], ak, &nk.to_repr()]));
    let mut fb = [0u8; 96]; fb[..32].copy_from_slice(ak); fb[32..64].copy_from_slice(&nk.to_repr()); fb[64..].copy_from_slice(&rivk.to_repr());
    (fb, json!({"use_qsk": true, "qk": hx(&qk)}))
}

// ---- per-swap setup transcript (step 4 L-1; step 6: v4 binds the Zcash pool, key path and consensus era) ----
// step 7: v5 also binds T3 (the two-step escrow's escape time).
// swap_id = SHA-256( "zeUTXO/path1/swap_id/v5" ‖ ada_network_id(1) ‖ len(zec_network)(1) ‖ zec_network ‖ script_hash(28)
//   ‖ lovelace ‖ zats ‖ T0 ‖ T1 ‖ T2 ‖ T3 ‖ k_depth ‖ z_depth (8 BE each) ‖ zec_branch(4 BE) ‖ "ironwood/use_qsk" ‖ alice_pkh(28)
//   ‖ bob_pkh(28) ‖ alice_go_vk(32) ‖ for alice then bob: P(32) ‖ Q(48) ‖ contrib_commit(32) ‖ nonce(32) )
const SID_DOM: &[u8] = b"zeUTXO/path1/swap_id/v5";
const CTX_DOM: &[u8] = b"zeUTXO/path1/setup-proof/v5";
const POOL_TAG: &[u8] = b"ironwood/use_qsk";
fn role_byte(r: &str) -> u8 { match r { "alice" => 1, "bob" => 2, _ => die("bad role") } }
fn fixed(v: &Value, k: &str, n: usize) -> Vec<u8> {
    let b = hex::decode(v[k].as_str().unwrap_or_else(|| die(&format!("ABORT: params/pub field {k} missing")))).unwrap_or_else(|_| die(&format!("ABORT: field {k} not hex")));
    if b.len() != n { die(&format!("ABORT: field {k} must be {n} bytes, got {}", b.len())); } b }
fn u64f(v: &Value, k: &str) -> u64 { v[k].as_u64().unwrap_or_else(|| die(&format!("ABORT: params field {k} missing"))) }
fn swap_id(params: &Value, slots: (&Value, &Value)) -> [u8; 32] {
    use sha2::Digest;
    let zn = params["zec_network"].as_str().unwrap_or_else(|| die("ABORT: params field zec_network missing")).as_bytes();
    if zn.is_empty() || zn.len() > 64 { die("ABORT: zec_network length"); }
    let net = u64f(params, "ada_network_id"); if net > 255 { die("ABORT: ada_network_id range"); }
    let br = u64f(params, "zec_branch");
    if br != u32::from(BranchId::Nu6_3) as u64 && br != u32::from(BranchId::Nu7) as u64 { die("ABORT: zec_branch must be NU6.3 (0x37a5165b) or NU7 (0x77190ad9)"); }
    let mut b = SID_DOM.to_vec(); b.push(net as u8); b.push(zn.len() as u8); b.extend_from_slice(zn);
    b.extend(fixed(params, "script_hash", 28));
    for k in ["lovelace", "zats", "t0", "t1", "t2", "t3", "k_depth", "z_depth"] { b.extend_from_slice(&u64f(params, k).to_be_bytes()); }
    b.extend_from_slice(&(br as u32).to_be_bytes()); b.extend_from_slice(POOL_TAG);
    b.extend(fixed(params, "alice_pkh", 28)); b.extend(fixed(params, "bob_pkh", 28)); b.extend(fixed(params, "alice_go_vk", 32));
    for pj in [slots.0, slots.1] { b.extend(fixed(pj, "P", 32)); b.extend(fixed(pj, "Q", 48)); b.extend(fixed(pj, "commit", 32)); b.extend(fixed(pj, "nonce", 32)); }
    sha2::Sha256::digest(&b).into()
}
fn proof_ctx(role: &str, sid: &[u8; 32]) -> Vec<u8> { let mut c = CTX_DOM.to_vec(); c.push(role_byte(role)); c.extend_from_slice(sid); c }
fn params_of(dir: &PathBuf, a: &Args) -> Value { rj(&a.get("params").map(PathBuf::from).unwrap_or_else(|| dir.join("params.json"))) }
fn fresh_seed() -> [u8; 32] { loop { let s = rbytes(); if SpendingKey::from_bytes(s).is_some().into() { return s; } } }
fn wallet_sk(seed: &[u8; 32]) -> SpendingKey { SpendingKey::from_bytes(*seed).unwrap() }
fn wallet_addr(seed: &[u8; 32]) -> Address { FullViewingKey::from(&wallet_sk(seed)).address_at(0u32, Scope::External) }

fn nver(s: &str) -> NoteVersion { if s == "v2" { NoteVersion::V2 } else { NoteVersion::V3 } }
fn rand_note(addr: Address, v: u64, ver: NoteVersion) -> Note {
    let rho = loop { let mut r = rbytes(); r[31] &= 0x3f; if let Some(x) = Option::from(Rho::from_bytes(&r)) { break x; } };
    loop { let rs = rbytes();
        if let Some(rseed) = Option::from(RandomSeed::from_bytes(rs, &rho)) {
            if let Some(n) = Option::<Note>::from(Note::from_parts(addr, NoteValue::from_raw(v), rho, rseed, ver)) { return n; } } }
}
fn note_json(n: &Note) -> Value { json!({"addr": hx(&n.recipient().to_raw_address_bytes()), "value": n.value().inner(), "rho": hx(&n.rho().to_bytes()),
    "rseed": hx(n.rseed().as_bytes()), "ver": if n.version() == NoteVersion::V2 { "v2" } else { "v3" }}) }
fn note_from(v: &Value) -> Note {
    let addr = Address::from_raw_address_bytes(&uh(&v["addr"]).try_into().unwrap()).unwrap();
    let rho = Rho::from_bytes(&uh32(&v["rho"])).unwrap();
    let rseed = RandomSeed::from_bytes(uh32(&v["rseed"]), &rho).unwrap();
    Note::from_parts(addr, NoteValue::from_raw(v["value"].as_u64().unwrap()), rho, rseed, nver(v["ver"].as_str().unwrap_or("v3"))).unwrap()
}
fn cmx_of(n: &Note) -> [u8; 32] { ExtractedNoteCommitment::from(n.commitment()).to_bytes() }

// ---------------- chain state (simulated) ----------------
fn chain_p(dir: &PathBuf) -> PathBuf { dir.join("chain.json") }
fn leaves(ch: &Value, pool: &str) -> Vec<MerkleHashOrchard> {
    ch["pools"][pool]["leaves"].as_array().unwrap().iter().map(|l| MerkleHashOrchard::from_bytes(&uh32(l)).unwrap()).collect()
}
fn nu7_height(ch: &Value) -> u64 { ch["nu7_height"].as_u64().unwrap_or(NO_NU7) }
/// Consensus branch in force at height h (the sim chain starts after NU6.3 activation).
fn branch_at(ch: &Value, h: u64) -> BranchId { if h >= nu7_height(ch) { BranchId::Nu7 } else { BranchId::Nu6_3 } }
fn nominal_spacing(ch: &Value, h: u64) -> u64 { if h >= nu7_height(ch) { 25 } else { 75 } }
fn tip(ch: &Value) -> u64 { ch["height"].as_u64().unwrap() }
/// Wallet expiry convention (ZIP 203 + ZIP 218): target = tip+1; expiry = target + 40 before NU7, target + 120 from NU7;
/// a transaction built for the pre-NU7 branch is capped at nu7_height-1 (it can never be mined at or after activation,
/// because its signatures commit to the NU6.3 branch id).
fn default_expiry(ch: &Value) -> (u32, bool) {
    let target = tip(ch) + 1; let n7 = nu7_height(ch);
    let delta = if target >= n7 { 120 } else { 40 };
    let mut e = target + delta; let mut capped = false;
    if target < n7 && e >= n7 { e = n7 - 1; capped = true; }
    (e as u32, capped)
}
fn expiry_for(ch: &Value, a: &Args) -> u32 { if let Some(e) = a.get("expiry") { return e.parse().unwrap(); } default_expiry(ch).0 }

// ---------------- transaction authorization markers ----------------
struct SigAuth;
impl Authorization for SigAuth { type TransparentAuth = transparent::bundle::EffectsOnly; type SaplingAuth = sapling::bundle::Authorized; type OrchardAuth = OEffects; }
struct VerAuth;
impl Authorization for VerAuth { type TransparentAuth = transparent::bundle::EffectsOnly; type SaplingAuth = sapling::bundle::Authorized; type OrchardAuth = OAuthorized; }
fn txdata<A: Authorization>(v: TxVersion, br: BranchId, expiry: u32, o: Option<orchard::Bundle<A::OrchardAuth, ZatBalance>>, i: Option<orchard::Bundle<A::OrchardAuth, ZatBalance>>) -> TransactionData<A> {
    match v {
        TxVersion::V5 => { if i.is_some() { die("a v5 transaction cannot carry an Ironwood bundle"); }
            TransactionData::from_parts(TxVersion::V5, br, 0, BlockHeight::from_u32(expiry), None, None, None, o) }
        _ => TransactionData::from_parts_v6(br, 0, BlockHeight::from_u32(expiry), None, None, o, i),
    }
}
fn sighash_of<A: Authorization<TransparentAuth = transparent::bundle::EffectsOnly>>(td: TransactionData<A>) -> [u8; 32] {
    let p = PrecomputedSighashData::new_zip244(td).unwrap_or_else(|_| die("not a ZIP 244 transaction"));
    *p.signature_hash(&SignableInput::Shielded).as_ref()
}

type Signer<'a> = dyn FnMut(usize, &pallas::Scalar, [u8; 32], [u8; 32]) -> [u8; 64] + 'a;

#[derive(Clone, Copy, PartialEq)]
enum Pool { Orchard, Ironwood }
impl Pool { fn name(&self) -> &'static str { match self { Pool::Orchard => "orchard", Pool::Ironwood => "ironwood" } } }
struct BSpec { pool: Pool, version: BundleVersion, flags: Flags, prove_with: OrchardCircuitVersion,
    spends: Vec<(FullViewingKey, Note, usize)>, outs: Vec<(Address, u64)>, change: Vec<(FullViewingKey, Address, u64)> }
impl BSpec {
    fn ironwood() -> Self { let v = BundleVersion::ironwood_v3(); BSpec { pool: Pool::Ironwood, version: v, flags: v.default_flags(), prove_with: CIRCUIT, spends: vec![], outs: vec![], change: vec![] } }
    fn orchard() -> Self { let v = BundleVersion::orchard_v3(); BSpec { pool: Pool::Orchard, version: v, flags: v.default_flags(), prove_with: CIRCUIT, spends: vec![], outs: vec![], change: vec![] } }
}
struct TxSpec { txv: TxVersion, branch: BranchId, expiry: u32, bundles: Vec<BSpec> }

/// Builds, proves, signs and serializes one real v6 (or v5) transaction with the real orchard/zcash_primitives code.
/// `manual`: assemble bundles WITHOUT the library's signature checks (cheating txs, so the node has to catch them).
fn build_tx(spec: TxSpec, ch: &Value, signer: &mut Signer, manual: bool, tamper_proof: bool) -> (Vec<u8>, Value) {
    let mut pzs = vec![]; let mut anchors = vec![];
    for bs in &spec.bundles {
        let lv = leaves(ch, bs.pool.name());
        let anchor = tree::root(&lv);
        let mut b = Builder::new(BundleType::Transactional { bundle_required: false, pad_to_minimum: None }, bs.version, bs.flags, anchor)
            .unwrap_or_else(|e| die(&format!("builder refused flags/version: {e:?}")));
        for (fvk, n, pos) in &bs.spends {
            let path = tree::path(&lv, *pos);
            assert_eq!(path.root(ExtractedNoteCommitment::from(n.commitment())), anchor, "witness/anchor mismatch");
            b.add_spend(fvk.clone(), *n, path).unwrap_or_else(|e| die(&format!("add_spend: {e:?}")));
        }
        for (a, v) in &bs.outs { b.add_output(None, *a, NoteValue::from_raw(*v), [0u8; 512]).unwrap_or_else(|e| die(&format!("LIBRARY REFUSED output: {e:?}"))); }
        for (fvk, a, v) in &bs.change { b.add_change_output(fvk.clone(), None, *a, NoteValue::from_raw(*v), [0u8; 512]).unwrap_or_else(|e| die(&format!("add_change_output: {e:?}"))); }
        let (pz, meta) = b.build_for_pczt(rng()).unwrap_or_else(|e| die(&format!("build_for_pczt: {e:?}")));
        anchors.push(hx(&anchor.to_bytes()));
        pzs.push((pz, meta));
    }
    let effs: Vec<orchard::Bundle<OEffects, ZatBalance>> = pzs.iter().map(|(pz, _)| pz.extract_effects().unwrap().unwrap()).collect();
    let slot = |p: Pool| spec.bundles.iter().position(|b| b.pool == p);
    let pick = |p: Pool| slot(p).map(|i| effs[i].clone());
    let sighash = sighash_of(txdata::<SigAuth>(spec.txv, spec.branch, spec.expiry, pick(Pool::Orchard), pick(Pool::Ironwood)));
    let mut pk_cache: HashMap<u8, ProvingKey> = HashMap::new();
    let (mut prove_ms, mut pk_ms) = (0u128, 0u128);
    let mut finals: Vec<orchard::Bundle<OAuthorized, ZatBalance>> = vec![];
    let mut lib_refused = vec![]; let mut gidx = 0usize;
    for (k, (pz, meta)) in pzs.iter_mut().enumerate() {
        let bs = &spec.bundles[k];
        pz.finalize_io(sighash, rng()).unwrap_or_else(|e| die(&format!("finalize_io: {e:?}")));
        let key = bs.prove_with as u8;
        let t = Instant::now();
        let pk = pk_cache.entry(key).or_insert_with(|| ProvingKey::build(bs.prove_with));
        pk_ms += t.elapsed().as_millis();
        let t = Instant::now();
        pz.create_proof(pk, rng()).unwrap_or_else(|e| die(&format!("LIBRARY REFUSED proof: {e:?}")));
        prove_ms += t.elapsed().as_millis();
        let mut sigs: Vec<Option<[u8; 64]>> = vec![None; pz.actions().len()];
        for i in 0..bs.spends.len() {
            let idx = meta.spend_action_index(i).unwrap();
            let alpha = pz.actions()[idx].spend().alpha().unwrap();
            let rk: [u8; 32] = pz.actions()[idx].spend().rk().into();
            let s = signer(gidx, &alpha, rk, sighash); gidx += 1;
            sigs[idx] = Some(s);
            if let Err(e) = pz.actions_mut()[idx].apply_signature(sighash, osig(s)) { lib_refused.push(format!("{e:?}")); }
        }
        // Cross-address-disabled (Orchard, withdraw-only) bundles pair each wallet-controlled change output with a
        // fabricated zero-value spend from the change address; that spend must be signed by the same wallet key.
        for j in 0..bs.change.len() {
            let idx = meta.output_action_index(bs.outs.len() + j).unwrap();
            if sigs[idx].is_some() { continue; }
            let alpha = pz.actions()[idx].spend().alpha().unwrap();
            let rk: [u8; 32] = pz.actions()[idx].spend().rk().into();
            let s = signer(usize::MAX, &alpha, rk, sighash);
            sigs[idx] = Some(s);
            if let Err(e) = pz.actions_mut()[idx].apply_signature(sighash, osig(s)) { lib_refused.push(format!("change-spend {e:?}")); }
        }
        let bundle = if !manual {
            if !lib_refused.is_empty() { die(&format!("orchard signer refused signature: {lib_refused:?}")); }
            pz.extract::<ZatBalance>().unwrap().unwrap().apply_binding_signature(sighash, rng()).unwrap_or_else(|| die("binding/apply failed"))
        } else {
            let mut proof = pz.zkproof().clone().unwrap();
            if tamper_proof { let mut pb = proof.as_ref().to_vec(); let m = pb.len() / 2; pb[m] ^= 1; proof = orchard::Proof::new(pb); }
            let bsig = pz.bsk().clone().unwrap().sign(rng(), &sighash);
            let all: Vec<[u8; 64]> = pz.actions().iter().enumerate().map(|(i, a)| sigs[i].unwrap_or_else(|| <[u8; 64]>::from(a.spend().spend_auth_sig().as_ref().unwrap()))).collect();
            let mut j = 0usize;
            effs[k].clone().map_authorization(&mut j, |j, _, ()| { let s = osig(all[*j]); *j += 1; s }, |_, _| OAuthorized::from_parts(proof, bsig))
        };
        finals.push(bundle);
    }
    let fpick = |p: Pool| slot(p).map(|i| finals[i].clone());
    let tx = txdata::<zcash_primitives::transaction::Authorized>(spec.txv, spec.branch, spec.expiry, fpick(Pool::Orchard), fpick(Pool::Ironwood)).freeze()
        .unwrap_or_else(|e| die(&format!("LIBRARY REFUSED to serialize: {e}")));
    let mut bytes = vec![]; tx.write(&mut bytes).unwrap();
    let vb = |b: Option<&orchard::Bundle<OAuthorized, ZatBalance>>| b.map(|b| i64::from(*b.value_balance()));
    let info = json!({"txid": tx.txid().to_string(), "bytes": bytes.len(), "tx_version": format!("{:?}", tx.version()), "branch": format!("{:?}", tx.consensus_branch_id()),
        "actions_orchard": tx.orchard_bundle().map(|b| b.actions().len()), "actions_ironwood": tx.ironwood_bundle().map(|b| b.actions().len()),
        "value_balance_orchard": vb(tx.orchard_bundle()), "value_balance_ironwood": vb(tx.ironwood_bundle()),
        "fee_zats": vb(tx.orchard_bundle()).unwrap_or(0) + vb(tx.ironwood_bundle()).unwrap_or(0),
        "actions": tx.orchard_bundle().map(|b| b.actions().len()).unwrap_or(0) + tx.ironwood_bundle().map(|b| b.actions().len()).unwrap_or(0),
        "prove_ms": prove_ms, "pk_build_ms": pk_ms, "sighash": hx(&sighash), "anchors": anchors, "library_signer_refused": lib_refused, "expiry_height": spec.expiry});
    (bytes, info)
}
fn plain_signer<'a>(ask: SpendAuthorizingKey) -> Box<Signer<'a>> {
    Box::new(move |_, alpha, _, sh| <[u8; 64]>::from(&ask.randomize(alpha).sign(rng(), &sh)))
}
fn sign_scalar(k: pallas::Scalar, alpha: &pallas::Scalar, m: &[u8]) -> [u8; 64] {
    let sk = redpallas::SigningKey::<redpallas::SpendAuth>::try_from(k.to_repr()).unwrap_or_else(|_| die("bad signing scalar"));
    <[u8; 64]>::from(&sk.randomize(alpha).sign(rng(), m))
}

// ---------------- setup subcommands (DLEQ unchanged; transcript v4) ----------------
fn keygen(dir: &PathBuf, a: &Args) {
    use pasta05::group::ff::{Field as F5, PrimeField as P5};
    use pasta05::group::GroupEncoding as GE5;
    let party = &a["party"]; let cheat = a.get("cheat").map(|s| s.as_str()).unwrap_or("none");
    let g = dleq::gens();
    let x = match a.get("reuse_x") { Some(f) => uh32(&rj(&PathBuf::from(f))["x"]), None => dleq::rand_x() }; // reuse_x: ATTACK TEST ONLY
    let (p, q) = dleq::statement(&g, &x);
    let n = dleq::NBITS;
    let (mut rp, mut rb) = (vec![], vec![]);
    let (pub_p, pub_q) = match cheat {
        "shifted" => {
            rp = (0..n).map(|_| <pasta05::pallas::Scalar as F5>::random(rand_core06::OsRng)).collect(); rb = (0..n).map(|_| bls12_381::Scalar::random(rand_core06::OsRng)).collect();
            let (mut sp, mut sb) = (pasta05::pallas::Scalar::ZERO, bls12_381::Scalar::zero());
            for i in 0..n { sp += dleq::pow2p(i) * rp[i]; sb += dleq::pow2b(i) * rb[i]; }
            (p + g.hp * sp, q + g.hb * sb)
        }
        "mismatch" => (p, q + g.gb),
        _ => (p, q),
    };
    let contrib = rbytes();
    let nonce: [u8; 32] = match a.get("reuse_nonce") { Some(h) => hex::decode(h).unwrap().try_into().unwrap(), None => rbytes() };
    let seed = fresh_seed();
    let pd = dir.join(party);
    wj(&pd.join("secret.json"), &json!({"x": hx(&x), "contrib": hx(&contrib), "wallet_seed": hx(&seed), "cheat": cheat,
        "blinders_p": rp.iter().map(|s| hx(&P5::to_repr(s))).collect::<Vec<_>>(), "blinders_b": rb.iter().map(|s| hx(&s.to_bytes())).collect::<Vec<_>>()}));
    let pubj = json!({"role": party, "P": hx(&GE5::to_bytes(&pub_p)), "Q": hx(&dleq::encb(&pub_q)), "dleq_file": format!("{party}/dleq.bin"),
        "commit": hx(&commit(&contrib)), "nonce": hx(&nonce), "cheat": cheat});
    wj(&pd.join("pub.json"), &pubj);
    println!("{}", json!({"ok": true, "P": pubj["P"], "Q": pubj["Q"], "nonce": pubj["nonce"]}));
}
fn prove(dir: &PathBuf, a: &Args) {
    let party = a["party"].as_str();
    let g = dleq::gens();
    let sec = rj(&dir.join(party).join("secret.json"));
    let cheat = sec["cheat"].as_str().unwrap_or("none").to_string();
    let x = uh32(&sec["x"]);
    let params = params_of(dir, a);
    let (pa, pb) = (rj(&dir.join("alice").join("pub.json")), rj(&dir.join("bob").join("pub.json")));
    let (role, slots) = match cheat.as_str() { "wrongctx" => (peer(party), (&pa, &pb)), "swapslots" => (party, (&pb, &pa)), _ => (party, (&pa, &pb)) };
    let sid = swap_id(&params, slots);
    let ctx = proof_ctx(role, &sid);
    let me = rj(&dir.join(party).join("pub.json"));
    let (cp, cq) = (dleq::decp(&uh(&me["P"])).unwrap(), dleq::decb(&uh(&me["Q"])).unwrap());
    let t = Instant::now();
    let pr = match cheat.as_str() {
        "shifted" => {
            let bp: Vec<pasta05::pallas::Scalar> = sec["blinders_p"].as_array().unwrap().iter().map(|v| dleq::int_to_ps(&uh32(v)).unwrap()).collect();
            let bb: Vec<bls12_381::Scalar> = sec["blinders_b"].as_array().unwrap().iter().map(|v| dleq::int_to_bs(&uh32(v)).unwrap()).collect();
            let ch = dleq::Cheat { bits_p: dleq::bits_of(&x, dleq::NBITS), bits_b: dleq::bits_of(&x, dleq::NBITS), zero_sum: false, self_claim: true, gb_override: None, blinders: Some((bp, bb)) };
            dleq::prove_raw(&g, &ctx, &cp, &cq, &ch)
        }
        _ => dleq::prove_raw(&g, &ctx, &cp, &cq, &dleq::honest_cheat(&x)),
    };
    let mut pbytes = pr.to_bytes(); if cheat == "tamper" { pbytes[100] ^= 1; }
    std::fs::write(dir.join(party).join("dleq.bin"), &pbytes).unwrap();
    println!("{}", json!({"ok": true, "swap_id": hx(&sid), "dleq_bytes": pbytes.len(), "dleq_prove_ms": t.elapsed().as_millis()}));
}
fn reveal(dir: &PathBuf, party: &str) {
    let s = rj(&dir.join(party).join("secret.json"));
    wj(&dir.join(party).join("reveal.json"), &json!({"contrib": s["contrib"]}));
    println!("{}", json!({"ok": true}));
}
fn setup(dir: &PathBuf, a: &Args) {
    let party = a["party"].as_str();
    let g = dleq::gens();
    let other = peer(party);
    let mut pubs = HashMap::new();
    let t = Instant::now();
    let params = params_of(dir, a);
    for who in ["alice", "bob"] { pubs.insert(who.to_string(), rj(&dir.join(who).join("pub.json"))); }
    for who in ["alice", "bob"] {
        let pj = pubs.get_mut(who).unwrap();
        let p = fixed(pj, "P", 32); let q = fixed(pj, "Q", 48);
        let pp = decp(&p).unwrap_or_else(|| die(&format!("ABORT: {who}'s P is not a valid Pallas point encoding")));
        if pp.to_bytes().to_vec() != p { die(&format!("ABORT: {who}'s P is a non-canonical encoding")); }
        if bool::from(pp.is_identity()) { die(&format!("ABORT: {who}'s P is the identity")); }
        let qq = dleq::decb(&q).unwrap_or_else(|| die(&format!("ABORT: {who}'s Q is not a valid BLS12-381 G1 subgroup point")));
        if dleq::encb(&qq).to_vec() != q { die(&format!("ABORT: {who}'s Q is a non-canonical encoding")); }
        if bool::from(qq.is_identity()) { die(&format!("ABORT: {who}'s Q is the identity")); }
        let n = fixed(pj, "nonce", 32); let c = fixed(pj, "commit", 32);
        pj["P"] = json!(hx(&p)); pj["Q"] = json!(hx(&q)); pj["nonce"] = json!(hx(&n)); pj["commit"] = json!(hx(&c));
    }
    for who in ["alice", "bob"] { if pubs[who]["role"].as_str() != Some(who) { die(&format!("ABORT: {who}'s round-1 message carries role {:?}", pubs[who]["role"])); } }
    if pubs["alice"]["P"] == pubs["bob"]["P"] || pubs["alice"]["Q"] == pubs["bob"]["Q"] { die("ABORT: duplicate share point (A == B)"); }
    if pubs["alice"]["nonce"] == pubs["bob"]["nonce"] { die("ABORT: duplicate setup nonce (both parties sent the same nonce)"); }
    // step6: use_qsk keys MUST NOT be generated before NU6.3 (ZIP 326); this tool only speaks the NU6.3/NU7 eras.
    let sid = swap_id(&params, (&pubs["alice"], &pubs["bob"]));
    let seen_p = a.get("seen").map(PathBuf::from);
    let mut seen = match &seen_p { Some(f) if f.exists() => rj(f), _ => json!({}) };
    for who in [party, other] {
        for (k, what) in [("P", "share point P"), ("Q", "share point Q"), ("nonce", "setup nonce")] {
            let key = format!("{k}:{}", pubs[who][k].as_str().unwrap());
            if let Some(prev) = seen.get(&key) { if prev.as_str() != Some(&hx(&sid)) {
                die(&format!("ABORT: {who}'s {what} already seen in an earlier swap (reuse is fatal: refuse)")); } }
        }
    }
    for who in [party, other] {
        let pj = &pubs[who];
        let proof = std::fs::read(dir.join(pj["dleq_file"].as_str().unwrap())).unwrap_or_else(|_| die(&format!("ABORT: {who}'s DLEQ proof missing")));
        if let Err(e) = dleq::verify(&g, &proof_ctx(who, &sid), &uh(&pj["P"]), &uh(&pj["Q"]), &proof) { die(&format!("ABORT: {who}'s DLEQ proof invalid ({e})")); }
    }
    let verify_ms = t.elapsed().as_millis();
    let rv = rj(&dir.join(other).join("reveal.json"));
    if hx(&commit(&uh(&rv["contrib"]))) != pubs[other]["commit"].as_str().unwrap() { die(&format!("ABORT: {other}'s key-contribution reveal does not match commitment")); }
    let own = rj(&dir.join(party).join("secret.json"));
    let contrib = |w: &str| if w == party { uh(&own["contrib"]) } else { uh(&rv["contrib"]) };
    let ap = decp(&uh(&pubs["alice"]["P"])).unwrap(); let bp = decp(&uh(&pubs["bob"]["P"])).unwrap();
    let sum = ap + bp;
    if bool::from(sum.is_identity()) { die("ABORT: A + B is the identity (rogue-key cancellation)"); }
    let neg = sum.to_bytes()[31] >> 7 == 1;                     // y-sign bit of repr_P(ak^P)
    let ak = (if neg { -sum } else { sum }).to_bytes();          // ZIP 2005: ak^P must have ỹ = 0
    let (fb, kinfo) = joint_keys(&contrib("alice"), &contrib("bob"), &sid, &ak);
    let fvk = FullViewingKey::from_bytes(&fb).unwrap_or_else(|| die("ABORT: joint FVK invalid"));
    let addr = fvk.address_at(0u32, Scope::External);
    let v = json!({"sigma": if neg { -1 } else { 1 }, "ak": hx(&ak), "fvk": hx(&fb), "addr_j": hx(&addr.to_raw_address_bytes()), "keys": kinfo,
        "A_p": pubs["alice"]["P"], "B_p": pubs["bob"]["P"], "A_c": pubs["alice"]["Q"], "B_c": pubs["bob"]["Q"], "dleq_verify_ms_both": verify_ms, "swap_id": hx(&sid),
        "zec_branch": params["zec_branch"]});
    wj(&dir.join(party).join("view.json"), &v);
    if let Some(f) = &seen_p {
        for who in ["alice", "bob"] { for k in ["P", "Q", "nonce"] { seen[format!("{k}:{}", pubs[who][k].as_str().unwrap())] = json!(hx(&sid)); } }
        wj(f, &seen);
    }
    println!("{}", json!({"ok": true, "addr_j": v["addr_j"], "sigma": v["sigma"], "dleq_verify_ms_both": verify_ms, "swap_id": hx(&sid)}));
}

// ---------------- simulated chain ----------------
fn genesis(dir: &PathBuf, a: &Args) {
    let bs = rj(&dir.join("bob").join("secret.json"));
    let addr = wallet_addr(&uh32(&bs["wallet_seed"]));
    let note = rand_note(addr, GENESIS_ZATS, NoteVersion::V3);
    let onote = rand_note(addr, GENESIS_ORCHARD_ZATS, NoteVersion::V2);
    let (mut lvi, mut lvo) = (vec![], vec![]);
    for i in 0..7 { // unrelated filler notes so the trees are not trivial
        if i == 3 { lvi.push(hx(&cmx_of(&note))); } else { lvi.push(hx(&cmx_of(&rand_note(wallet_addr(&fresh_seed()), 1_000 + i as u64, NoteVersion::V3)))); }
        if i == 2 { lvo.push(hx(&cmx_of(&onote))); } else { lvo.push(hx(&cmx_of(&rand_note(wallet_addr(&fresh_seed()), 2_000 + i as u64, NoteVersion::V2)))); }
    }
    let root = |lv: &Vec<String>| { let l: Vec<MerkleHashOrchard> = lv.iter().map(|x| MerkleHashOrchard::from_bytes(&hex::decode(x).unwrap().try_into().unwrap()).unwrap()).collect(); hx(&tree::root(&l).to_bytes()) };
    let start: u64 = a.get("start_height").map(|s| s.parse().unwrap()).unwrap_or(1);
    let nu7: u64 = a.get("nu7_height").map(|s| s.parse().unwrap()).unwrap_or(NO_NU7);
    wj(&chain_p(dir), &json!({"height": start, "nu7_height": nu7, "times": [0], "pools": {"ironwood": {"leaves": lvi.clone(), "anchors": [root(&lvi)]}, "orchard": {"leaves": lvo.clone(), "anchors": [root(&lvo)]}},
        "nullifiers": [], "txs": [], "rejected": []}));
    wj(&dir.join("bob").join("wallet.json"), &json!({"notes": [{"pool": "ironwood", "note": note_json(&note), "pos": 3}, {"pool": "orchard", "note": note_json(&onote), "pos": 2}]}));
    println!("{}", json!({"ok": true, "bob_note_zats": GENESIS_ZATS, "bob_orchard_zats": GENESIS_ORCHARD_ZATS, "height": start, "nu7_height": nu7}));
}
fn bob_note(dir: &PathBuf, pool: &str) -> (Note, usize) {
    let w = rj(&dir.join("bob").join("wallet.json"));
    let e = w["notes"].as_array().unwrap().iter().find(|n| n["pool"] == pool).unwrap().clone();
    (note_from(&e["note"]), e["pos"].as_u64().unwrap() as usize)
}
fn fund(dir: &PathBuf, a: &Args) {
    let amount: u64 = a["amount"].parse().unwrap();
    let cheat = a.get("cheat").map(|s| s.as_str()).unwrap_or("none");
    let bs = rj(&dir.join("bob").join("secret.json"));
    let view = rj(&dir.join("bob").join("view.json"));
    let seed = uh32(&bs["wallet_seed"]); let sk = wallet_sk(&seed); let fvk = FullViewingKey::from(&sk); let me = wallet_addr(&seed);
    let pay = a.get("pay").map(|p| p.parse::<u64>().unwrap()).unwrap_or(amount);
    let addr_j = Address::from_raw_address_bytes(&uh(&view["addr_j"]).try_into().unwrap()).unwrap();
    let ch = rj(&chain_p(dir));
    let target = tip(&ch) + 1;
    let mut branch = branch_at(&ch, target);
    let expiry = expiry_for(&ch, a);
    let (inote, ipos) = bob_note(dir, "ironwood"); let (onote, opos) = bob_note(dir, "orchard");
    let mut txv = TxVersion::V6;
    let mut bundles = vec![];
    match cheat {
        "none" | "wrong_vk" | "wrong_branch" => { // the protocol path: Ironwood -> joint Ironwood address (cross-address, allowed in Ironwood)
            let mut b = BSpec::ironwood(); b.spends.push((fvk.clone(), inote, ipos));
            b.outs.push((addr_j, pay)); b.outs.push((me, inote.value().inner() - pay - zip317_fee(2)));
            if cheat == "wrong_vk" { b.prove_with = OrchardCircuitVersion::FixedPostNu6_2; }   // proven under the pre-NU6.3 circuit
            if cheat == "wrong_branch" { branch = if branch == BranchId::Nu7 { BranchId::Nu6_3 } else { BranchId::Nu7 }; }
            bundles.push(b);
        }
        "nu62_v5" => { // an old (pre-NU6.3) wallet: v5, NU6.2 branch, Orchard cross-address send to the joint address
            txv = TxVersion::V5; branch = BranchId::Nu6_2;
            let v = BundleVersion::orchard_v2();
            bundles.push(BSpec { pool: Pool::Orchard, version: v, flags: v.default_flags(), prove_with: OrchardCircuitVersion::FixedPostNu6_2,
                spends: vec![(fvk.clone(), onote, opos)], outs: vec![(addr_j, pay), (me, onote.value().inner() - pay - zip317_fee(2))], change: vec![] });
        }
        "orchard_cross" => { // attacker: an Orchard cross-address transfer, proven WITH the PostNu6_3 key but with enableCrossAddress=1,
            // put in a v5 tx under the NU6.3 branch (the v5 wire format has no bit for it: a node reads enableCrossAddress=0)
            txv = TxVersion::V5;
            let v = BundleVersion::orchard_v2();
            bundles.push(BSpec { pool: Pool::Orchard, version: v, flags: v.default_flags(), prove_with: CIRCUIT,
                spends: vec![(fvk.clone(), onote, opos)], outs: vec![(addr_j, pay), (me, onote.value().inner() - pay - zip317_fee(2))], change: vec![] });
        }
        "orchard_v6_cross" => { // same, but asks the library to write cross-address Orchard flags into a v6 tx
            let mut b = BSpec::orchard(); b.flags = Flags::ENABLED; b.spends.push((fvk.clone(), onote, opos)); b.outs.push((addr_j, pay));
            bundles.push(b);
        }
        "orchard_turnstile" | "allow_turnstile" => { // Orchard spend (withdraw-only, change to self) + Ironwood output to the joint address
            if cheat == "orchard_turnstile" { die("REFUSE (wallet policy): funding straight from Orchard crosses the turnstile with a PUBLIC amount equal to the swap amount; migrate to Ironwood first (ZIP 318), then fund Ironwood->Ironwood"); }
            let fee = zip317_fee(4);
            let mut o = BSpec::orchard(); o.spends.push((fvk.clone(), onote, opos)); o.change.push((fvk.clone(), me, onote.value().inner() - pay - fee));
            let mut i = BSpec::ironwood(); i.outs.push((addr_j, pay));
            bundles.push(o); bundles.push(i);
        }
        "orchard_inflow" => { // value INTO the Orchard pool: Ironwood spend -> Orchard (internal) change output; forbidden by ZIP 258
            let fee = zip317_fee(4);
            let mut i = BSpec::ironwood(); i.spends.push((fvk.clone(), inote, ipos)); i.outs.push((addr_j, pay));
            let mut o = BSpec::orchard(); o.change.push((fvk.clone(), me, inote.value().inner() - pay - fee));
            bundles.push(i); bundles.push(o);
        }
        _ => die("unknown fund cheat"),
    }
    let mut s = plain_signer(SpendAuthorizingKey::from(&sk));
    let (bytes, info) = build_tx(TxSpec { txv, branch, expiry, bundles }, &ch, &mut *s, false, false);
    let out = PathBuf::from(&a["out"]); std::fs::write(&out, &bytes).unwrap();
    println!("{}", json!({"ok": true, "tx": out, "info": info}));
}
fn selfspend(dir: &PathBuf) {
    let bs = rj(&dir.join("bob").join("secret.json"));
    let (n, pos) = bob_note(dir, "ironwood");
    let seed = uh32(&bs["wallet_seed"]); let sk = wallet_sk(&seed);
    let ch = rj(&chain_p(dir));
    let mut s = plain_signer(SpendAuthorizingKey::from(&sk));
    let mut b = BSpec::ironwood(); b.spends.push((FullViewingKey::from(&sk), n, pos)); b.outs.push((wallet_addr(&seed), n.value().inner() - zip317_fee(2)));
    let (bytes, info) = build_tx(TxSpec { txv: TxVersion::V6, branch: branch_at(&ch, tip(&ch) + 1), expiry: default_expiry(&ch).0, bundles: vec![b] }, &ch, &mut *s, false, false);
    let out = dir.join("bob_selfspend.tx"); std::fs::write(&out, &bytes).unwrap();
    println!("{}", json!({"ok": true, "tx": out, "info": info}));
}
fn submit(dir: &PathBuf, txp: &str) {
    let bytes = std::fs::read(txp).unwrap();
    let mut ch = rj(&chain_p(dir));
    let res = check_tx(&ch, &bytes);
    let mut rec = json!({"tx": txp, "height_attempted": tip(&ch) + 1});
    if ch["txs"].as_array().unwrap().iter().any(|t| t["file"].as_str() == Some(txp)) { die("AlreadyInChain: tx file already mined"); }
    match res {
        Err(reason) => { rec["reason"] = json!(reason); ch["rejected"].as_array_mut().unwrap().push(rec.clone()); wj(&chain_p(dir), &ch);
                         println!("{}", json!({"ok": false, "accepted": false, "reason": reason})); std::process::exit(3) }
        Ok((tx, verify_ms)) => {
            let h = tip(&ch) + 1;
            let mut first = json!({}); let mut na = json!({}); let mut nnf = 0;
            for (pool, b) in [("orchard", tx.orchard_bundle()), ("ironwood", tx.ironwood_bundle())] {
                first[pool] = json!(ch["pools"][pool]["leaves"].as_array().unwrap().len());
                na[pool] = json!(b.map(|b| b.actions().len()).unwrap_or(0));
                if let Some(b) = b { for act in b.actions() {
                    ch["pools"][pool]["leaves"].as_array_mut().unwrap().push(json!(hx(&act.cmx().to_bytes())));
                    ch["nullifiers"].as_array_mut().unwrap().push(json!(hx(&act.nullifier().to_bytes()))); nnf += 1; } }
                let root = hx(&tree::root(&leaves(&ch, pool)).to_bytes());
                ch["pools"][pool]["anchors"].as_array_mut().unwrap().push(json!(root));
            }
            ch["height"] = json!(h);
            let last = ch["times"].as_array().unwrap().last().unwrap().clone(); let sp = nominal_spacing(&ch, h);
            ch["times"].as_array_mut().unwrap().push(json!(last.as_u64().unwrap() + sp));
            ch["txs"].as_array_mut().unwrap().push(json!({"height": h, "txid": tx.txid().to_string(), "file": txp, "first_leaf": first, "n_actions": na, "n_nf": nnf}));
            wj(&chain_p(dir), &ch);
            println!("{}", json!({"ok": true, "accepted": true, "height": h, "txid": tx.txid().to_string(), "bytes": bytes.len(), "verify_ms": verify_ms, "branch": format!("{:?}", tx.consensus_branch_id())}));
        }
    }
}
/// The simulated Zcash full node's consensus checks (NU6.3 + NU7 rules; shielded-only transactions).
fn check_tx(ch: &Value, bytes: &[u8]) -> Result<(Transaction, u128), String> {
    let next = tip(ch) + 1;
    let want = branch_at(ch, next);
    if bytes.len() < 12 { return Err("truncated".into()); }
    let header = u32::from_le_bytes(bytes[0..4].try_into().unwrap()); let ver = header & 0x7fff_ffff;
    if ver == 4 && want == BranchId::Nu7 { return Err("v4 transactions are invalid from NU7 activation (ZIP 2003 / ZIP 259)".into()); }
    if ver < 5 { return Err(format!("unsupported tx version {ver} (this sim node only models v5/v6)")); }
    let hdr_branch = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
    if hdr_branch != u32::from(want) { return Err(format!("wrong consensus branch id 0x{hdr_branch:08x}: next block {next} requires 0x{:08x} ({want:?})", u32::from(want))); }
    let tx = Transaction::read(bytes, want).map_err(|e| format!("parse: {e}"))?;
    let mut re = vec![]; tx.write(&mut re).unwrap();
    if re != bytes { return Err("non-canonical encoding".into()); }
    if tx.consensus_branch_id() != want { return Err("wrong version/branch".into()); }
    if !matches!(tx.version(), TxVersion::V5 | TxVersion::V6) { return Err("unsupported tx version".into()); }
    if tx.lock_time() != 0 { return Err("lock_time must be 0 in this sim".into()); }
    if tx.transparent_bundle().is_some() || tx.sapling_bundle().is_some() || tx.sprout_bundle().is_some() { return Err("unexpected non-Orchard-protocol parts".into()); }
    let ob = tx.orchard_bundle(); let ib = tx.ironwood_bundle();
    if ob.is_none() && ib.is_none() { return Err("no shielded bundle".into()); }
    let mut spent: HashSet<String> = ch["nullifiers"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_string()).collect();
    let mut fee = 0i64; let mut nact = 0usize;
    for (pool, b) in [("orchard", ob), ("ironwood", ib)] {
        let Some(b) = b else { continue };
        if pool == "orchard" {
            // ZIP 258: from NU6.3 the Orchard pool is withdraw-only.
            if b.flags().cross_address_enabled() { return Err("Orchard bundle with enableCrossAddress=1 (ZIP 258/2006)".into()); }
            if i64::from(*b.value_balance()) < 0 { return Err(format!("Orchard inflow: valueBalanceOrchard = {} < 0 is forbidden from NU6.3 (ZIP 258)", i64::from(*b.value_balance()))); }
        }
        let anchors: HashSet<String> = ch["pools"][pool]["anchors"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_string()).collect();
        if !anchors.contains(&hx(&b.anchor().to_bytes())) { return Err(format!("unknown {pool} anchor")); }
        for act in b.actions() { if !spent.insert(hx(&act.nullifier().to_bytes())) { return Err("nullifier already spent (double spend)".into()); } }
        fee += i64::from(*b.value_balance()); nact += b.actions().len();
    }
    if fee < zip317_fee(nact) as i64 { return Err(format!("fee {fee} below ZIP-317 {}", zip317_fee(nact))); }
    let exp = u32::from(tx.expiry_height()) as u64;
    if exp == 0 { return Err("ExpiryZero: wallet-default txs set expiry_height = target + 40 (pre-NU7) / + 120 (NU7)".into()); }
    if exp > 499_999_999 { return Err("expiry_height above 499999999 (ZIP 203)".into()); }
    if next > exp { return Err(format!("TxExpired: next block height {next} > expiry_height {exp}")); }
    let sighash = sighash_of(txdata::<VerAuth>(tx.version(), tx.consensus_branch_id(), exp as u32, ob.cloned(), ib.cloned()));
    let vk = VerifyingKey::build(CIRCUIT);
    let t = Instant::now();
    let mut bv = BatchValidator::new(&vk);
    for b in [ob, ib].into_iter().flatten() { bv.add_bundle(b, sighash).map_err(|e| format!("batch add: {e:?}"))?; }
    let ok = bv.validate(rng());
    let verify_ms = t.elapsed().as_millis();
    if !ok {
        let mut diag = vec![];
        for (pool, b) in [("orchard", ob), ("ironwood", ib)] { let Some(b) = b else { continue };
            let proof_ok = b.verify_proof(&vk).is_ok();
            let bad_sigs: Vec<usize> = b.actions().iter().enumerate().filter(|(_, a)| a.rk().verify(&sighash, a.authorization()).is_err()).map(|(i, _)| i).collect();
            let bind_ok = b.binding_validating_key().verify(&sighash, b.authorization().binding_signature()).is_ok();
            diag.push(format!("{pool}: proof_ok={proof_ok} (PostNu6_3 VK), bad spend-auth sigs at actions {bad_sigs:?}, binding_ok={bind_ok}"));
        }
        return Err(format!("Orchard-protocol verification failed ({})", diag.join("; ")));
    }
    Ok((tx, verify_ms))
}
fn reorg(dir: &PathBuf, n: u64) {
    let mut ch = rj(&chain_p(dir));
    let h = tip(&ch); let nh = h.saturating_sub(n).max(1);
    let txs = ch["txs"].as_array().unwrap().clone();
    let (keep, gone): (Vec<Value>, Vec<Value>) = txs.into_iter().partition(|t| t["height"].as_u64().unwrap() <= nh);
    if let Some(first) = gone.first() {
        for pool in ["orchard", "ironwood"] {
            let fl = first["first_leaf"][pool].as_u64().unwrap() as usize;
            ch["pools"][pool]["leaves"].as_array_mut().unwrap().truncate(fl);
            ch["pools"][pool]["anchors"].as_array_mut().unwrap().truncate(1 + keep.len());
        }
        let nfs: usize = keep.iter().map(|t| t["n_nf"].as_u64().unwrap() as usize).sum();
        ch["nullifiers"].as_array_mut().unwrap().truncate(nfs);
    }
    let start = ch["times"].as_array().unwrap().len() as u64 - (h - 0).min(ch["times"].as_array().unwrap().len() as u64 - 1) ; let _ = start;
    let keep_times = ch["times"].as_array().unwrap().len().saturating_sub(n as usize).max(1);
    ch["times"].as_array_mut().unwrap().truncate(keep_times);
    ch["txs"] = json!(keep); ch["height"] = json!(nh);
    ch["reorgs"] = json!([ch.get("reorgs").cloned().unwrap_or(json!([])).as_array().unwrap().clone(), vec![json!({"from": h, "to": nh, "orphaned": gone.iter().map(|t| t["file"].clone()).collect::<Vec<_>>()})]].concat());
    wj(&chain_p(dir), &ch);
    println!("{}", json!({"ok": true, "height": nh, "orphaned": gone.iter().map(|t| t["file"].clone()).collect::<Vec<_>>()}));
}
fn mine(dir: &PathBuf, a: &Args) {
    let n: u64 = a["n"].parse().unwrap();
    let mut ch = rj(&chain_p(dir));
    for _ in 0..n {
        let h = tip(&ch) + 1;
        let sp: u64 = a.get("spacing").map(|s| s.parse().unwrap()).unwrap_or_else(|| nominal_spacing(&ch, h));
        let last = ch["times"].as_array().unwrap().last().unwrap().as_u64().unwrap();
        ch["times"].as_array_mut().unwrap().push(json!(last + sp)); ch["height"] = json!(h);
    }
    wj(&chain_p(dir), &ch); println!("{}", json!({"ok": true, "height": tip(&ch), "branch_next": format!("{:?}", branch_at(&ch, tip(&ch) + 1))}));
}
fn status(dir: &PathBuf, a: &Args) {
    let ch = rj(&chain_p(dir));
    let w: usize = a.get("window").map(|s| s.parse().unwrap()).unwrap_or(12);
    let t = ch["times"].as_array().unwrap(); let k = w.min(t.len() - 1);
    let mean = if k == 0 { 0.0 } else { (t[t.len() - 1].as_u64().unwrap() - t[t.len() - 1 - k].as_u64().unwrap()) as f64 / k as f64 };
    let h = tip(&ch); let (exp, capped) = default_expiry(&ch);
    println!("{}", json!({"ok": true, "tip": h, "nu7_height": nu7_height(&ch), "branch_next": format!("{:?}", branch_at(&ch, h + 1)), "branch_next_id": u32::from(branch_at(&ch, h + 1)),
        "nominal_spacing_s": nominal_spacing(&ch, h + 1), "measured_mean_spacing_s": mean, "window": k, "blocks_to_nu7": nu7_height(&ch) as i64 - h as i64,
        "default_expiry": exp, "expiry_capped_at_nu7": capped}));
}
fn scan(ch: &Value, fvk: &FullViewingKey, addr: &Address) -> Vec<Value> {
    let ivk = PreparedIncomingViewingKey::new(&fvk.to_ivk(Scope::External));
    let spent: HashSet<String> = ch["nullifiers"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_string()).collect();
    let height = tip(ch); let mut found = vec![];
    for t in ch["txs"].as_array().unwrap() {
        let bytes = std::fs::read(t["file"].as_str().unwrap()).unwrap();
        let tx = Transaction::read(&bytes[..], branch_at(ch, t["height"].as_u64().unwrap())).unwrap();
        for (pool, b) in [("orchard", tx.orchard_bundle()), ("ironwood", tx.ironwood_bundle())] {
            let Some(b) = b else { continue };
            for (i, act) in b.actions().iter().enumerate() {
                // lead byte enforced by the library's per-pool domain: Ironwood notes must be V3 (0x03), Orchard V2 (0x02)
                let dec = if pool == "ironwood" { zcash_note_encryption::try_note_decryption(&IronwoodDomain::for_action(act), &ivk, act) }
                          else { zcash_note_encryption::try_note_decryption(&OrchardDomain::for_action(act), &ivk, act) };
                if let Some((note, to, _)) = dec {
                    if to != *addr || note.value().inner() == 0 { continue; }
                    let nf: Nullifier = note.nullifier(fvk);
                    found.push(json!({"pool": pool, "note": note_json(&note), "pos": t["first_leaf"][pool].as_u64().unwrap() as usize + i, "value": note.value().inner(),
                        "depth": height - t["height"].as_u64().unwrap() + 1, "nf": hx(&nf.to_bytes()), "spent": spent.contains(&hx(&nf.to_bytes())), "txid": t["txid"]}));
                }
            }
        }
    }
    found
}
fn watch(dir: &PathBuf, a: &Args) {
    let party = &a["party"];
    let view = rj(&dir.join(party).join("view.json"));
    let fvk = FullViewingKey::from_bytes(&uh(&view["fvk"]).try_into().unwrap()).unwrap();
    let addr_j = fvk.address_at(0u32, Scope::External);
    let ch = rj(&chain_p(dir));
    let found = scan(&ch, &fvk, &addr_j);
    let want: u64 = a["amount"].parse().unwrap(); let min_depth: u64 = a["min_depth"].parse().unwrap();
    let good = found.iter().find(|f| f["pool"] == "ironwood" && f["value"].as_u64() == Some(want) && f["depth"].as_u64().unwrap() >= min_depth && !f["spent"].as_bool().unwrap()).cloned();
    let jp = dir.join(party.as_str()).join("joint_note.json");
    if let Some(g) = &good { wj(&jp, g); } else if jp.exists() { std::fs::remove_file(&jp).unwrap(); }
    let status = if good.is_some() { "funded_ok" } else if found.iter().any(|f| f["spent"].as_bool().unwrap()) { "joint_note_spent" }
        else if found.iter().any(|f| f["pool"] != "ironwood") { "wrong_pool" }
        else if found.iter().any(|f| f["value"].as_u64() != Some(want)) { "wrong_amount" } else if !found.is_empty() { "too_shallow" } else { "not_found" };
    println!("{}", json!({"ok": good.is_some(), "status": status, "found": found, "tip": tip(&ch)}));
    if good.is_none() { std::process::exit(4) }
}
fn sweep(dir: &PathBuf, a: &Args) {
    let party = a["party"].as_str(); let mode = a.get("mode").map(|s| s.as_str()).unwrap_or("solo");
    let cheat = a.get("cheat").map(|s| s.as_str()).unwrap_or("none");
    let view = rj(&dir.join(party).join("view.json"));
    let own = rj(&dir.join(party).join("secret.json"));
    let jn = rj(&dir.join(party).join("joint_note.json"));
    let fvk = FullViewingKey::from_bytes(&uh(&view["fvk"]).try_into().unwrap()).unwrap();
    let sigma = if view["sigma"].as_i64() == Some(-1) { -pallas::Scalar::ONE } else { pallas::Scalar::ONE };
    let x = sc(&uh32(&own["x"]));
    let peer_p = decp(&uh(&view[if party == "alice" { "B_p" } else { "A_p" }])).unwrap();
    let g = gp();
    let note = note_from(&jn["note"]); let pos = jn["pos"].as_u64().unwrap() as usize;
    let to = wallet_addr(&uh32(&own["wallet_seed"]));
    let fee = zip317_fee(2);
    let ak_pt = decp(&uh(&view["ak"])).unwrap();
    let ch = rj(&chain_p(dir));
    let target = tip(&ch) + 1;
    let mut branch = branch_at(&ch, target);
    // A sweep is signed for the branch of the block it is meant for. It never survives NU7 activation (branch in sighash).
    if cheat == "stale_branch" { branch = BranchId::Nu6_3; }
    let other: Option<pallas::Scalar> = a.get("other_share").map(|h| sc(&hex::decode(h).unwrap().try_into().unwrap()));
    if mode == "solo" && cheat == "none" {
        let s = other.unwrap_or_else(|| die("solo sweep needs other_share"));
        if g * s != peer_p { die("REFUSE: revealed share does not match counterparty's public share"); }
        if (g * (sigma * (x + s))) != ak_pt { die("REFUSE: reconstructed key does not match joint ak"); }
    }
    let manual = !matches!(cheat, "none" | "stale_branch");
    let peer_secret = if mode != "solo" { Some(sc(&uh32(&rj(&dir.join(peer(party)).join("secret.json"))["x"]))) } else { None };
    let mut signer: Box<Signer> = Box::new(|_, alpha: &pallas::Scalar, rk: [u8; 32], sh: [u8; 32]| {
        match (mode, cheat) {
            ("solo", "none") | ("solo", "stale_branch") => sign_scalar(sigma * (x + other.unwrap()), alpha, &sh),
            ("solo", "one_share") => sign_scalar(sigma * x, alpha, &sh),
            ("solo", "wrong_share") => sign_scalar(sigma * (x + other.unwrap_or(pallas::Scalar::ZERO) + pallas::Scalar::ONE), alpha, &sh),
            ("solo", "no_negation") => sign_scalar(-sigma * (x + other.unwrap()), alpha, &sh),
            ("solo", "wrong_sighash") => { let mut m = sh; m[0] ^= 1; sign_scalar(sigma * (x + other.unwrap()), alpha, &m) }
            ("solo", "tamper_proof") => sign_scalar(sigma * (x + other.unwrap()), alpha, &sh),
            ("joint", _) => { // cooperative 2-party Schnorr with commit-then-reveal nonces (both halves simulated here)
                let y = peer_secret.unwrap();
                let (ra, rb) = (pallas::Scalar::random(&mut rng()), pallas::Scalar::random(&mut rng()));
                let (rap, rbp) = (g * ra, g * rb);
                let (ca, cb) = (commit(&rap.to_bytes()), commit(&rbp.to_bytes()));
                assert!(commit(&rap.to_bytes()) == ca && commit(&rbp.to_bytes()) == cb);
                let r = rap + rbp; let c = hstar(&[&r.to_bytes(), &rk, &sh]);
                let z = (ra + c * (sigma * x + alpha)) + (rb + c * (sigma * y));
                let mut out = [0u8; 64]; out[..32].copy_from_slice(&r.to_bytes()); out[32..].copy_from_slice(&z.to_repr()); out
            }
            ("adaptor", _) => { // adaptor pre-signature under T = t*G, completed with t
                let y = peer_secret.unwrap();
                let t = pallas::Scalar::random(&mut rng()); let tp = g * t;
                let (qa, qb) = (pallas::Scalar::random(&mut rng()), pallas::Scalar::random(&mut rng()));
                let rr = g * qa + g * qb + tp; let c = hstar(&[&rr.to_bytes(), &rk, &sh]);
                let zpre = (qa + c * (sigma * x + alpha)) + (qb + c * (sigma * y));
                let rk_pt = decp(&rk).unwrap();
                assert!(g * zpre == rr - tp + rk_pt * c, "pre-signature check");
                let z = zpre + t;
                let mut out = [0u8; 64]; out[..32].copy_from_slice(&rr.to_bytes()); out[32..].copy_from_slice(&z.to_repr()); out
            }
            _ => die("unknown mode/cheat"),
        }
    });
    // The sweep output goes to the sweeper's OWN address with ovk = None: the joint FVK (which the counterparty also
    // holds, ZIP 2005 shared sk) is never used as the ovk, so the counterparty cannot decrypt where the coins went.
    let mut b = BSpec::ironwood(); b.spends.push((fvk, note, pos)); b.outs.push((to, note.value().inner() - fee));
    let (bytes, info) = build_tx(TxSpec { txv: TxVersion::V6, branch, expiry: expiry_for(&ch, a), bundles: vec![b] }, &ch, &mut *signer, manual, cheat == "tamper_proof");
    let out = PathBuf::from(&a["out"]); std::fs::write(&out, &bytes).unwrap();
    println!("{}", json!({"ok": true, "tx": out, "info": info, "meta": {"mode": mode, "cheat": cheat}}));
}
/// Unit-level checks of the Ironwood key path (no chain needed).
fn selftest() {
    let mut res = vec![];
    let mut rec = |name: &str, ok: bool, detail: Value| { res.push(json!({"test": name, "ok": ok, "detail": detail})); };
    // 1. y-sign normalisation: orchard rejects an FVK whose ak has ỹ = 1; accepts the negated point.
    let mut tries = 0; let (mut rej_odd, mut acc_even) = (false, false);
    while tries < 64 { tries += 1;
        let p = gp() * pallas::Scalar::random(&mut rng()); let e = p.to_bytes();
        if e[31] >> 7 == 1 {
            let (fb_odd, _) = joint_keys(&rbytes(), &rbytes(), &rbytes(), &e);
            rej_odd = FullViewingKey::from_bytes(&fb_odd).is_none();
            let ne = (-p).to_bytes(); let (fb_even, _) = joint_keys(&rbytes(), &rbytes(), &rbytes(), &ne);
            acc_even = FullViewingKey::from_bytes(&fb_even).is_some() && ne[31] >> 7 == 0;
            break;
        }
    }
    rec("orchard 0.16 rejects a joint ak with ỹ=1 (must normalise: sigma)", rej_odd, json!({})); rec("negated ak (ỹ=0) accepted", acc_even, json!({}));
    // 2. both parties derive the same FVK/address from the same transcript; a different contribution gives an unlinkable one
    let ak = loop { let p = gp() * pallas::Scalar::random(&mut rng()); let e = p.to_bytes(); if e[31] >> 7 == 0 { break e; } };
    let (ca, cb, sid) = (rbytes(), rbytes(), rbytes());
    let (f1, _) = joint_keys(&ca, &cb, &sid, &ak); let (f2, _) = joint_keys(&ca, &cb, &sid, &ak); let (f3, _) = joint_keys(&ca, &rbytes(), &sid, &ak);
    let addr = |f: &[u8; 96]| FullViewingKey::from_bytes(f).unwrap().address_at(0u32, Scope::External).to_raw_address_bytes();
    rec("same transcript -> identical joint FVK and address (both parties)", f1 == f2 && addr(&f1) == addr(&f2), json!({}));
    rec("different sk contribution -> different nk, rivk_ext and address", f1[32..] != f3[32..] && addr(&f1) != addr(&f3), json!({}));
    // 3. rivk_ext binds ak: the same sk with a different ak yields a different rivk_ext (ZIP 2005 key binding)
    let ak2 = loop { let p = gp() * pallas::Scalar::random(&mut rng()); let e = p.to_bytes(); if e[31] >> 7 == 0 { break e; } };
    let (f4, _) = joint_keys(&ca, &cb, &sid, &ak2);
    rec("rivk_ext = H_qk(ak, nk) changes with ak (nk unchanged)", f1[32..64] == f4[32..64] && f1[64..] != f4[64..], json!({}));
    // 4. the use_qsk rivk_ext differs from the legacy H^rivk(sk) a legacy wallet would derive
    let sk_j: [u8; 32] = b2b(32, b"zeUTXO_p1_jsk_v6", &[b"sk", &sid, &ca, &cb]).try_into().unwrap();
    let legacy_rivk = pallas::Scalar::from_uniform_bytes(&prf_expand(&sk_j, &[&[0x08]])).to_repr();
    rec("use_qsk rivk_ext != legacy rivk = ToScalar(PRF^expand_sk([0x08])) for the same sk", f1[64..] != legacy_rivk[..], json!({}));
    // 5. Ironwood note lead byte: an Ironwood (V3) note and an Orchard (V2) note have different commitments for identical fields
    let a0 = wallet_addr(&fresh_seed());
    let n3 = rand_note(a0, 12345, NoteVersion::V3);
    let n2 = Note::from_parts(a0, NoteValue::from_raw(12345), n3.rho(), *n3.rseed(), NoteVersion::V2).unwrap();
    rec("V3 (0x03) and V2 (0x02) notes with equal fields commit differently (rcm/psi domain-separated)", cmx_of(&n3) != cmx_of(&n2), json!({}));
    let all = res.iter().all(|r| r["ok"].as_bool().unwrap());
    println!("{}", json!({"ok": all, "tests": res}));
    if !all { std::process::exit(5) }
}
/// Writes a minimal v4-headed (Sapling-format) byte string for the "v4 after NU7" node check.
fn v4probe(a: &Args) {
    let mut b = vec![]; b.extend_from_slice(&(0x8000_0004u32).to_le_bytes()); b.extend_from_slice(&0x892f_2085u32.to_le_bytes());
    b.extend_from_slice(&[0u8; 40]);
    std::fs::write(&a["out"], &b).unwrap(); println!("{}", json!({"ok": true, "tx": a["out"]}));
}

fn main() {
    let cmd = std::env::args().nth(1).unwrap_or_default();
    let a = args();
    let dir = PathBuf::from(a.get("dir").cloned().unwrap_or_else(|| ".".into()));
    match cmd.as_str() {
        "keygen" => keygen(&dir, &a),
        "reveal" => reveal(&dir, &a["party"]),
        "setup" => setup(&dir, &a),
        "prove" => prove(&dir, &a),
        "genesis" => genesis(&dir, &a),
        "fund" => fund(&dir, &a),
        "submit" => submit(&dir, &a["tx"]),
        "check" => {
            let ch = rj(&chain_p(&dir));
            match check_tx(&ch, &std::fs::read(&a["tx"]).unwrap()) {
                Ok((_, ms)) => println!("{}", json!({"ok": true, "valid": true, "verify_ms": ms})),
                Err(r) => { println!("{}", json!({"ok": false, "valid": false, "reason": r})); std::process::exit(3) }
            }
        }
        "balance" => {
            let party = a["party"].as_str();
            let seed = uh32(&rj(&dir.join(party).join("secret.json"))["wallet_seed"]);
            let fvk = FullViewingKey::from(&wallet_sk(&seed)); let me = fvk.address_at(0u32, Scope::External);
            let ch = rj(&chain_p(&dir));
            let found = scan(&ch, &fvk, &me);
            let total: u64 = found.iter().filter(|f| !f["spent"].as_bool().unwrap()).map(|f| f["value"].as_u64().unwrap()).sum();
            let iw: u64 = found.iter().filter(|f| !f["spent"].as_bool().unwrap() && f["pool"] == "ironwood").map(|f| f["value"].as_u64().unwrap()).sum();
            println!("{}", json!({"ok": true, "unspent_zats": total, "unspent_ironwood_zats": iw, "notes": found.iter().map(|f| json!({"pool": f["pool"], "value": f["value"], "spent": f["spent"], "txid": f["txid"]})).collect::<Vec<_>>()}));
        }
        "mine" => mine(&dir, &a),
        "reorg" => reorg(&dir, a["n"].parse().unwrap()),
        "selfspend" => selfspend(&dir),
        "watch" => watch(&dir, &a),
        "sweep" => sweep(&dir, &a),
        "status" => status(&dir, &a),
        "selftest" => selftest(),
        "v4probe" => v4probe(&a),
        "share-point" => {
            let s = sc(&hex::decode(&a["share"]).unwrap().try_into().unwrap());
            let p = decp(&hex::decode(&a["P"]).unwrap()).unwrap();
            println!("{}", json!({"ok": gp() * s == p}));
        }
        _ => die("unknown command"),
    }
}
