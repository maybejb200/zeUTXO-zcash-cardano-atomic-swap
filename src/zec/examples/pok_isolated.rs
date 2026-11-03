//! step6: imports moved to pasta05 / rand_core06 (same crate versions as step 5); test logic unchanged.
//! step5: ported from review2 (T-POK) into the suite. review2 T-POK: isolated tests that the DLEQ verifier ENFORCES the two proofs of knowledge (step-4 memo says no
//! isolated test existed). Uses step-4 dleq.rs unchanged (#[path]); fresh random secrets only.
#[path = "../src/dleq.rs"]
mod dleq;
use pasta05::group::ff::{Field, PrimeField};
use pasta05::pallas::Scalar as Ps;
use bls12_381::Scalar as Bs;
use rand_core06::OsRng;

const NB: usize = dleq::NBITS * dleq::BITLEN;
fn add_one_ps(b: &mut [u8]) { let s = Ps::from_repr(b[..32].try_into().unwrap()).unwrap() + Ps::ONE; b[..32].copy_from_slice(&s.to_repr()); }
fn add_one_bs(b: &mut [u8]) { let s = Bs::from_bytes(b[..32].try_into().unwrap()).unwrap() + Bs::one(); b[..32].copy_from_slice(&s.to_bytes()); }
fn show(name: &str, expect: &str, r: Result<(), &'static str>, results: &mut Vec<(String, bool)>) {
    let got = match r { Ok(()) => "ACCEPT".to_string(), Err(e) => e.to_string() };
    let ok = got == expect; println!("[{}] {name}: expected {expect:?}, got {got:?}", if ok { "ok" } else { "FAIL" }); results.push((name.into(), ok));
}
fn main() {
    let g = dleq::gens(); let mut res = vec![];
    let ctx1 = b"review2/ctx-1".to_vec(); let ctx2 = b"review2/ctx-2".to_vec();
    let x = dleq::rand_x(); let (p, q) = dleq::statement(&g, &x);
    let (pb, qb) = (p.to_bytes().to_vec(), dleq::encb(&q).to_vec());
    let honest = dleq::prove_raw(&g, &ctx1, &p, &q, &dleq::honest_cheat(&x)).to_bytes();
    show("P1 control: honest proof", "ACCEPT", dleq::verify(&g, &ctx1, &pb, &qb, &honest), &mut res);
    // PoK layout at the end: rp(32) sp(32) rb(48) sb(32)
    let mut t = honest.clone(); add_one_ps(&mut t[NB + 32..NB + 64]);
    show("P2 Pallas PoK response s_p + 1 (rings untouched)", "PoK dlog(P) fails", dleq::verify(&g, &ctx1, &pb, &qb, &t), &mut res);
    let mut t = honest.clone(); add_one_bs(&mut t[NB + 112..NB + 144]);
    show("P3 BLS PoK response s_b + 1 (rings untouched)", "PoK dlog(Q) fails", dleq::verify(&g, &ctx1, &pb, &qb, &t), &mut res);
    let other = dleq::prove_raw(&g, &ctx2, &p, &q, &dleq::honest_cheat(&x)).to_bytes();
    let mut t = honest.clone(); t[NB..].copy_from_slice(&other[NB..]);
    show("P4 PoK transplanted from a valid proof of the same statement under another ctx", "PoK dlog(P) fails", dleq::verify(&g, &ctx1, &pb, &qb, &t), &mut res);
    // P5: F7 shifted cheater, both groups: P' = xG + rho_p H_p, Q' = xG + rho_b H_b. Rings and sums are valid.
    let ch = dleq::Cheat { bits_p: dleq::bits_of(&x, dleq::NBITS), bits_b: dleq::bits_of(&x, dleq::NBITS), zero_sum: false, self_claim: true, gb_override: None, blinders: None };
    let pr = dleq::prove_raw(&g, &ctx1, &p, &q, &ch);
    let (mut sp, mut sb) = (pasta05::pallas::Point::identity(), bls12_381::G1Projective::identity());
    use pasta05::group::{Group, GroupEncoding};
    for i in (0..dleq::NBITS).rev() { sp = sp.double() + dleq::decp(&pr.bits[i].c).unwrap(); sb = sb.double() + dleq::decb(&pr.bits[i].d).unwrap(); }
    let (spb, sbb) = (sp.to_bytes().to_vec(), dleq::encb(&sb).to_vec()); let prb = pr.to_bytes();
    show("P5 F7 shifted statement (both groups), full verifier", "PoK dlog(P) fails", dleq::verify(&g, &ctx1, &spb, &sbb, &prb), &mut res);
    show("P5n same proof, NAIVE verifier without PoK (shows the PoK is load-bearing)", "ACCEPT", dleq::verify_opt(&g, &ctx1, &spb, &sbb, &prb, false), &mut res);
    // P6: shifted ONLY on BLS (Pallas blinders cancel): only the Q PoK can catch it.
    let n = dleq::NBITS;
    let mut rp: Vec<Ps> = (0..n).map(|_| Ps::random(OsRng)).collect();
    let mut s = Ps::ZERO; for i in 0..n - 1 { s += dleq::pow2p(i) * rp[i]; } rp[n - 1] = -s * dleq::pow2p(n - 1).invert().unwrap();
    let rb: Vec<Bs> = (0..n).map(|_| Bs::random(OsRng)).collect();
    let ch = dleq::Cheat { bits_p: dleq::bits_of(&x, n), bits_b: dleq::bits_of(&x, n), zero_sum: false, self_claim: true, gb_override: None, blinders: Some((rp, rb)) };
    let pr = dleq::prove_raw(&g, &ctx1, &p, &q, &ch);
    let (mut sp, mut sb) = (pasta05::pallas::Point::identity(), bls12_381::G1Projective::identity());
    for i in (0..n).rev() { sp = sp.double() + dleq::decp(&pr.bits[i].c).unwrap(); sb = sb.double() + dleq::decb(&pr.bits[i].d).unwrap(); }
    let (spb, sbb) = (sp.to_bytes().to_vec(), dleq::encb(&sb).to_vec()); let prb = pr.to_bytes();
    show("P6a BLS-only shift: Pallas statement is the honest P", "ACCEPT", if spb == pb { Ok(()) } else { Err("P differs") }, &mut res);
    show("P6 BLS-only shifted statement, full verifier (only PoK(Q) can catch it)", "PoK dlog(Q) fails", dleq::verify(&g, &ctx1, &spb, &sbb, &prb), &mut res);
    show("P6n same, NAIVE verifier", "ACCEPT", dleq::verify_opt(&g, &ctx1, &spb, &sbb, &prb, false), &mut res);
    // P7: PoK nonce point replaced by identity encoding (degenerate R) must not pass
    let mut t = honest.clone(); for b in &mut t[NB..NB + 32] { *b = 0; }
    show("P7 Pallas PoK R = identity", "PoK dlog(P) fails", dleq::verify(&g, &ctx1, &pb, &qb, &t), &mut res);
    let fails = res.iter().filter(|r| !r.1).count();
    println!("{{\"total\": {}, \"failed\": {}}}", res.len(), fails);
    if fails > 0 { std::process::exit(1) }
}
