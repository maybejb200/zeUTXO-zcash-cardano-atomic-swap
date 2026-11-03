//! Cross-group DLEQ (Pallas <-> BLS12-381 G1) by bit decomposition, MRL-0010 / Farcaster style.
//! Statement: P = x*G_p (Pallas, G_p = Orchard SpendAuth basepoint) and Q = x*G_b (BLS12-381 G1 generator)
//! for the SAME integer x, 0 < x < 2^252. Proof: per bit i, Pedersen commitments C_i = b_i*G_p + r_i*H_p and
//! D_i = b_i*G_b + s_i*H_b, blinders weighted-summing to 0 in each group (so sum 2^i C_i = P, sum 2^i D_i = Q),
//! and a 2-member AOS ring signature per bit proving "(C_i, D_i) both open to 0 OR both open to 1", with ONE
//! challenge (< 2^248, valid in both scalar fields) shared across the two groups.
//! RESEARCH ONLY: fresh random throwaway scalars, not constant time, not reviewed.
use bls12_381::{G1Affine, G1Projective, Scalar as Bs};
use pasta_curves::arithmetic::CurveExt;
use pasta_curves::group::ff::{Field, PrimeField};
use pasta_curves::group::{Group, GroupEncoding};
use pasta_curves::pallas::{Point as Pp, Scalar as Ps};
use rand_core::{OsRng, RngCore};
use std::time::Instant;

const NBITS: usize = 252;
const DOM: &[u8] = b"zeUTXO-path1/xDLEQ/pallas-bls12_381g1/v1";

struct Gens { gp: Pp, hp: Pp, gb: G1Projective, hb: G1Projective }
fn gens() -> Gens {
    use bls12_381::hash_to_curve::{ExpandMsgXmd, HashToCurve};
    let hb = <G1Projective as HashToCurve<ExpandMsgXmd<sha2::Sha256>>>::hash_to_curve(b"H", b"zeUTXO-path1-xDLEQ-H_b-v1");
    Gens {
        gp: Pp::hash_to_curve("z.cash:Orchard")(b"G"), // Orchard SpendAuthSig basepoint (same as reddsa)
        hp: Pp::hash_to_curve("zeUTXO-path1-xDLEQ")(b"H_p"),
        gb: G1Projective::generator(),
        hb,
    }
}
fn encb(p: &G1Projective) -> [u8; 48] { G1Affine::from(p).to_compressed() }
fn decb(b: &[u8]) -> Option<G1Projective> {
    let a: [u8; 48] = b.try_into().ok()?;
    Option::<G1Affine>::from(G1Affine::from_compressed(&a)).map(G1Projective::from) // checks on-curve + subgroup
}
fn decp(b: &[u8]) -> Option<Pp> { let a: [u8; 32] = b.try_into().ok()?; Option::from(Pp::from_bytes(&a)) }
fn int_to_ps(x: &[u8; 32]) -> Option<Ps> { Option::from(Ps::from_repr(*x)) }
fn int_to_bs(x: &[u8; 32]) -> Option<Bs> { Option::from(Bs::from_bytes(x)) }
fn h(parts: &[&[u8]]) -> [u8; 64] {
    let mut st = blake2b_simd::Params::new().hash_length(64).personal(b"zeUTXO_xDLEQ_v1_").to_state();
    for p in parts { st.update(&(p.len() as u32).to_le_bytes()); st.update(p); }
    *st.finalize().as_array()
}
/// challenge: 248-bit integer (31 bytes), valid & identical in both scalar fields
fn chal(t0: &[u8; 64], i: usize, j: u8, rp: &Pp, rb: &G1Projective) -> [u8; 32] {
    let d = h(&[t0, &(i as u32).to_le_bytes(), &[j], &rp.to_bytes(), &encb(rb)]);
    let mut c = [0u8; 32]; c[..31].copy_from_slice(&d[..31]); c
}
fn pok_chal(t0: &[u8; 64], rp: &Pp, rb: &G1Projective) -> (Ps, Bs) {
    use pasta_curves::group::ff::FromUniformBytes;
    let d = h(&[t0, b"pok", &rp.to_bytes(), &encb(rb)]);
    (Ps::from_uniform_bytes(&d), Bs::from_bytes_wide(&d))
}
fn pow2p(i: usize) -> Ps { let mut x = Ps::ONE; for _ in 0..i { x = x.double(); } x }
fn pow2b(i: usize) -> Bs { let mut x = Bs::one(); for _ in 0..i { x = x.double(); } x }

#[derive(Clone)]
struct BitProof { c: [u8; 32], d: [u8; 48], e0: [u8; 32], s0p: [u8; 32], s0b: [u8; 32], s1p: [u8; 32], s1b: [u8; 32] }
#[derive(Clone)]
struct Proof { bits: Vec<BitProof>, pok_rp: [u8; 32], pok_sp: [u8; 32], pok_rb: [u8; 48], pok_sb: [u8; 32] }
const BITLEN: usize = 32 + 48 + 32 * 5;
const POKLEN: usize = 32 + 32 + 48 + 32;
impl Proof {
    fn to_bytes(&self) -> Vec<u8> {
        let mut v = vec![];
        for b in &self.bits { for f in [&b.c[..], &b.d[..], &b.e0[..], &b.s0p[..], &b.s0b[..], &b.s1p[..], &b.s1b[..]] { v.extend_from_slice(f); } }
        for f in [&self.pok_rp[..], &self.pok_sp[..], &self.pok_rb[..], &self.pok_sb[..]] { v.extend_from_slice(f); }
        v
    }
    fn from_bytes(v: &[u8]) -> Option<Proof> {
        if v.len() != NBITS * BITLEN + POKLEN { return None; } // exact length: truncation / extra bits rejected
        let (body, pk) = v.split_at(NBITS * BITLEN);
        let mut bits = vec![];
        for ch in body.chunks(BITLEN) {
            let g = |o: usize, n: usize| ch[o..o + n].to_vec();
            bits.push(BitProof { c: g(0, 32).try_into().ok()?, d: g(32, 48).try_into().ok()?, e0: g(80, 32).try_into().ok()?,
                s0p: g(112, 32).try_into().ok()?, s0b: g(144, 32).try_into().ok()?, s1p: g(176, 32).try_into().ok()?, s1b: g(208, 32).try_into().ok()? });
        }
        Some(Proof { bits, pok_rp: pk[0..32].try_into().ok()?, pok_sp: pk[32..64].try_into().ok()?, pok_rb: pk[64..112].try_into().ok()?, pok_sb: pk[112..144].try_into().ok()? })
    }
}
fn transcript(g: &Gens, ctx: &[u8], p: &Pp, q: &G1Projective, cs: &[[u8; 32]], ds: &[[u8; 48]]) -> [u8; 64] {
    let mut all = vec![];
    for c in cs { all.extend_from_slice(c); }
    for d in ds { all.extend_from_slice(d); }
    h(&[DOM, ctx, &(NBITS as u32).to_le_bytes(), &g.gp.to_bytes(), &g.hp.to_bytes(), &encb(&g.gb), &encb(&g.hb), &p.to_bytes(), &encb(q), &all])
}

/// Prover. `bits_p` / `bits_b` are the bit vectors used on each side (equal for an honest prover; cheating
/// provers pass different ones or non-binary values). `claim_p` / `claim_q` are the statement points.
/// `zero_sum` = false reproduces self-review bug F7 (blinders not cancelling).
struct Cheat { bits_p: Vec<u64>, bits_b: Vec<u64>, zero_sum: bool, self_claim: bool, gb_override: Option<G1Projective> }
/// The PoK secrets are the prover's best guess of dlog(P), dlog(Q): the integer it actually knows.
fn pok_secret(bits: &[u64]) -> [u8; 32] { let mut x = [0u8; 32]; let mut acc: Vec<u64> = bits.to_vec(); let mut carry = 0u64; for i in 0..256 { let v = if i < acc.len() { acc[i] } else { 0 } + carry; if v & 1 == 1 { x[i / 8] |= 1 << (i % 8); } carry = v >> 1; } acc.clear(); x }
fn prove_raw(g: &Gens, ctx: &[u8], claim_p: &Pp, claim_q: &G1Projective, ch: &Cheat) -> Proof {
    let n = ch.bits_p.len();
    let gb = ch.gb_override.unwrap_or(g.gb);
    let mut rp: Vec<Ps> = (0..n).map(|_| Ps::random(OsRng)).collect();
    let mut rb: Vec<Bs> = (0..n).map(|_| Bs::random(OsRng)).collect();
    if ch.zero_sum {
        let (mut sp, mut sb) = (Ps::ZERO, Bs::zero());
        for i in 0..n - 1 { sp += pow2p(i) * rp[i]; sb += pow2b(i) * rb[i]; }
        rp[n - 1] = -sp * pow2p(n - 1).invert().unwrap();
        rb[n - 1] = -sb * pow2b(n - 1).invert().unwrap();
    }
    let cpts: Vec<Pp> = (0..n).map(|i| g.gp * Ps::from(ch.bits_p[i]) + g.hp * rp[i]).collect();
    let dpts: Vec<G1Projective> = (0..n).map(|i| gb * Bs::from(ch.bits_b[i]) + g.hb * rb[i]).collect();
    let cs: Vec<[u8; 32]> = cpts.iter().map(|c| c.to_bytes()).collect();
    let ds: Vec<[u8; 48]> = dpts.iter().map(encb).collect();
    // self_claim (F7 attacker): the published statement is whatever the weighted commitment sums are.
    let (mut swp, mut swb) = (Pp::identity(), G1Projective::identity());
    for i in (0..n).rev() { swp = swp.double() + cpts[i]; swb = swb.double() + dpts[i]; }
    let (claim_p, claim_q) = if ch.self_claim { (&swp, &swb) } else { (claim_p, claim_q) };
    let t0 = transcript(g, ctx, claim_p, claim_q, &cs, &ds);
    let mut bits = vec![];
    for i in 0..n {
        // ring members: j=0 -> (C, D) ; j=1 -> (C - G_p, D - G_b). Prover "knows" member jt (its claimed bit).
        let jt = if ch.bits_p[i] == 1 { 1usize } else { 0 };
        let pubp = [cpts[i], cpts[i] - g.gp];
        let pubb = [dpts[i], dpts[i] - g.gb];
        let (kp, kb) = (Ps::random(OsRng), Bs::random(OsRng));
        let mut e = [[0u8; 32]; 2];
        let mut sp = [Ps::ZERO; 2];
        let mut sb = [Bs::zero(); 2];
        let jo = 1 - jt;
        e[jo] = chal(&t0, i, jo as u8, &(g.hp * kp), &(g.hb * kb));
        sp[jo] = Ps::random(OsRng); sb[jo] = Bs::random(OsRng);
        let (ep, eb) = (int_to_ps(&e[jo]).unwrap(), int_to_bs(&e[jo]).unwrap());
        let rpo = g.hp * sp[jo] + pubp[jo] * ep;
        let rbo = g.hb * sb[jo] + pubb[jo] * eb;
        e[jt] = chal(&t0, i, jt as u8, &rpo, &rbo);
        let (ep, eb) = (int_to_ps(&e[jt]).unwrap(), int_to_bs(&e[jt]).unwrap());
        sp[jt] = kp - ep * rp[i];
        sb[jt] = kb - eb * rb[i];
        bits.push(BitProof { c: cs[i], d: ds[i], e0: e[0], s0p: sp[0].to_repr(), s0b: sb[0].to_bytes(), s1p: sp[1].to_repr(), s1b: sb[1].to_bytes() });
    }
    // Schnorr proofs of knowledge of dlog_Gp(P) and dlog_Gb(Q), bound to the transcript (Farcaster pok_0/pok_1).
    let xp = pok_secret(&ch.bits_p); let xb = pok_secret(&ch.bits_b);
    let xps = int_to_ps(&xp).unwrap_or(Ps::ZERO); let xbs = int_to_bs(&xb).unwrap_or(Bs::zero());
    let (kp, kb) = (Ps::random(OsRng), Bs::random(OsRng));
    let (rp_, rb_) = (g.gp * kp, gb * kb);
    let (ep, eb) = pok_chal(&t0, &rp_, &rb_);
    Proof { bits, pok_rp: rp_.to_bytes(), pok_sp: (kp + ep * xps).to_repr(), pok_rb: encb(&rb_), pok_sb: (kb + eb * xbs).to_bytes() }
}
fn bits_of(x: &[u8; 32], n: usize) -> Vec<u64> { (0..n).map(|i| ((x[i / 8] >> (i % 8)) & 1) as u64).collect() }
fn honest_cheat(x: &[u8; 32]) -> Cheat { Cheat { bits_p: bits_of(x, NBITS), bits_b: bits_of(x, NBITS), zero_sum: true, self_claim: false, gb_override: None } }
fn statement(g: &Gens, x: &[u8; 32]) -> (Pp, G1Projective) {
    (g.gp * int_to_ps(x).unwrap(), g.gb * int_to_bs(x).unwrap())
}

/// Verifier. Takes the statement as bytes, exactly as a counterparty receives it.
fn verify(g: &Gens, ctx: &[u8], p_b: &[u8], q_b: &[u8], proof_bytes: &[u8]) -> Result<(), &'static str> { verify_opt(g, ctx, p_b, q_b, proof_bytes, true) }
/// `with_pok = false` is the NAIVE variant (bit commitments + rings + weighted sums only), kept to show its gap.
fn verify_opt(g: &Gens, ctx: &[u8], p_b: &[u8], q_b: &[u8], proof_bytes: &[u8], with_pok: bool) -> Result<(), &'static str> {
    let p = decp(p_b).ok_or("P decode")?;
    let q = decb(q_b).ok_or("Q decode/subgroup")?;
    if bool::from(p.is_identity()) || bool::from(q.is_identity()) { return Err("identity statement"); }
    let pr = Proof::from_bytes(proof_bytes).ok_or("length")?;
    let mut cpts = vec![]; let mut dpts = vec![];
    for b in &pr.bits { cpts.push(decp(&b.c).ok_or("C decode")?); dpts.push(decb(&b.d).ok_or("D decode/subgroup")?); }
    // weighted sums must reproduce the statement in both groups (catches F7 and range/truncation games)
    let (mut sp, mut sb) = (Pp::identity(), G1Projective::identity());
    for i in (0..NBITS).rev() { sp = sp.double() + cpts[i]; sb = sb.double() + dpts[i]; }
    if sp != p { return Err("sum C != P"); }
    if sb != q { return Err("sum D != Q"); }
    let cs: Vec<[u8; 32]> = pr.bits.iter().map(|b| b.c).collect();
    let ds: Vec<[u8; 48]> = pr.bits.iter().map(|b| b.d).collect();
    let t0 = transcript(g, ctx, &p, &q, &cs, &ds);
    for (i, b) in pr.bits.iter().enumerate() {
        if b.e0[31] != 0 { return Err("challenge out of range"); }
        let pubp = [cpts[i], cpts[i] - g.gp];
        let pubb = [dpts[i], dpts[i] - g.gb];
        let sps = [int_to_ps(&b.s0p).ok_or("s non-canonical")?, int_to_ps(&b.s1p).ok_or("s non-canonical")?];
        let sbs = [int_to_bs(&b.s0b).ok_or("s non-canonical")?, int_to_bs(&b.s1b).ok_or("s non-canonical")?];
        let mut e = b.e0;
        for j in 0..2 {
            let (ep, eb) = (int_to_ps(&e).unwrap(), int_to_bs(&e).unwrap());
            let rp = g.hp * sps[j] + pubp[j] * ep;
            let rb = g.hb * sbs[j] + pubb[j] * eb;
            e = chal(&t0, i, ((j + 1) % 2) as u8, &rp, &rb);
        }
        if e != b.e0 { return Err("ring"); }
    }
    if with_pok {
        let rp = decp(&pr.pok_rp).ok_or("pok R decode")?; let rb = decb(&pr.pok_rb).ok_or("pok R decode")?;
        let sp = int_to_ps(&pr.pok_sp).ok_or("pok s non-canonical")?; let sb = int_to_bs(&pr.pok_sb).ok_or("pok s non-canonical")?;
        let (ep, eb) = pok_chal(&t0, &rp, &rb);
        if g.gp * sp != rp + p * ep { return Err("PoK dlog(P) fails"); }
        if g.gb * sb != rb + q * eb { return Err("PoK dlog(Q) fails"); }
    }
    Ok(())
}

fn rand_x() -> [u8; 32] {
    loop {
        let mut x = [0u8; 32]; OsRng.fill_bytes(&mut x); x[31] &= 0x0f; // < 2^252
        if x != [0u8; 32] { return x; }
    }
}

fn main() {
    let g = gens();
    let n_honest: usize = std::env::args().nth(1).map(|s| s.parse().unwrap()).unwrap_or(200);
    let mut results: Vec<(String, bool, String)> = vec![];
    macro_rules! rec { ($name:expr, $exp:expr, $r:expr) => {{ let r: Result<(), &'static str> = $r; let pass = r.is_ok() == $exp;
        results.push(($name.to_string(), pass, match r { Ok(()) => "accepted".to_string(), Err(e) => format!("rejected: {e}") })); }}; }
    let ctx = b"swap-id:test-0001|alice:A_c|bob:B_c";
    let x = rand_x();
    let (p, q) = statement(&g, &x);
    let (pb, qb) = (p.to_bytes(), encb(&q));
    let t = Instant::now();
    let good = prove_raw(&g, ctx, &p, &q, &honest_cheat(&x));
    let prove_ms = t.elapsed().as_millis();
    let gb_bytes = good.to_bytes();
    let t = Instant::now();
    rec!("G1 good proof accepted", true, verify(&g, ctx, &pb, &qb, &gb_bytes));
    let verify_ms = t.elapsed().as_millis();

    // ---- malformed / malicious proofs: all must be rejected ----
    // N1 flip one bit commitment (C_5 += G_p, D_5 += G_b): a "bit" that opens to 2 / sum broken
    { let mut pr = good.clone(); let c = decp(&pr.bits[5].c).unwrap() + g.gp; let d = decb(&pr.bits[5].d).unwrap() + g.gb;
      pr.bits[5].c = c.to_bytes(); pr.bits[5].d = encb(&d); rec!("N1 tampered bit commitment (C5,D5 += G)", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    // N2 non-binary bit with sum preserved: digit 2 at position i, 0 at i+1 (cheating prover)
    { let mut i = 0; let bx = bits_of(&x, NBITS); while !(bx[i] == 0 && bx[i + 1] == 1) { i += 1; }
      let mut bits = bx.clone(); bits[i] = 2; bits[i + 1] = 0;
      let pr = prove_raw(&g, ctx, &p, &q, &Cheat { bits_p: bits.clone(), bits_b: bits, zero_sum: true, self_claim: false, gb_override: None });
      rec!("N2 non-binary digit (2) with correct weighted sum", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    // N3 mismatched scalars: x on Pallas, x' = x xor 2^7 on BLS (claims Q' = x' G_b)
    { let mut x2 = x; x2[0] ^= 0x80; let q2 = g.gb * int_to_bs(&x2).unwrap();
      let pr = prove_raw(&g, ctx, &p, &q2, &Cheat { bits_p: bits_of(&x, NBITS), bits_b: bits_of(&x2, NBITS), zero_sum: true, self_claim: false, gb_override: None });
      rec!("N3 different scalars in the two groups (x vs x^2^7)", false, verify(&g, ctx, &pb, &encb(&q2), &pr.to_bytes())); }
    // N4 F7: blinders do not cancel; statement claims P, Q
    { let pr = prove_raw(&g, ctx, &p, &q, &Cheat { bits_p: bits_of(&x, NBITS), bits_b: bits_of(&x, NBITS), zero_sum: false, self_claim: false, gb_override: None });
      rec!("N4 F7 blinders not summing to zero", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    // N5 F7 attack with shifted published points
    { let pr = prove_raw(&g, ctx, &p, &q, &Cheat { bits_p: bits_of(&x, NBITS), bits_b: bits_of(&x, NBITS), zero_sum: false, self_claim: true, gb_override: None });
      // The attacker PUBLISHES the shifted points P' = xG_p + rho*H_p, Q' = xG_b + sig*H_b (= weighted commitment sums)
      // as his key shares. dlog(P') != dlog(Q') and neither is known; bits, rings and weighted sums all check out.
      let (mut sp, mut sb) = (Pp::identity(), G1Projective::identity());
      for i in (0..NBITS).rev() { sp = sp.double() + decp(&pr.bits[i].c).unwrap(); sb = sb.double() + decb(&pr.bits[i].d).unwrap(); }
      assert!(sp != p && sb != q);
      rec!("N5 F7 attack: published SHIFTED points P'=xG+rhoH, Q'=xG'+sigH' (full verifier, with PoK)", false, verify(&g, ctx, &sp.to_bytes(), &encb(&sb), &pr.to_bytes()));
      // Same attack against the NAIVE verifier without PoKs: accepted -> documents why the PoKs are mandatory.
      let naive = verify_opt(&g, ctx, &sp.to_bytes(), &encb(&sb), &pr.to_bytes(), false).is_ok();
      results.push(("N5-naive (INFO): same F7 attack vs verifier WITHOUT PoKs is accepted (expected gap; PoKs close it)".into(), naive, format!("naive verifier accepted={naive}"))); }
    // N6 out of range: x >= 2^252 (x | 2^252), 253-bit proof => length check
    { let mut xb = x; xb[31] |= 0x10; let (p3, q3) = statement(&g, &xb);
      let pr = prove_raw(&g, ctx, &p3, &q3, &Cheat { bits_p: bits_of(&xb, 253), bits_b: bits_of(&xb, 253), zero_sum: true, self_claim: false, gb_override: None });
      rec!("N6 out-of-range scalar (2^252 <= x), 253-bit proof", false, verify(&g, ctx, &p3.to_bytes(), &encb(&q3), &pr.to_bytes()));
      // N7 same scalar truncated to 252 bits: sums no longer match
      let pr = prove_raw(&g, ctx, &p3, &q3, &Cheat { bits_p: bits_of(&xb, NBITS), bits_b: bits_of(&xb, NBITS), zero_sum: true, self_claim: false, gb_override: None });
      rec!("N7 out-of-range scalar, proof truncated to 252 bits", false, verify(&g, ctx, &p3.to_bytes(), &encb(&q3), &pr.to_bytes())); }
    // N8 x = q_pallas - 1 (i.e. -1 on Pallas): P = -G_p but Q must be (q-1)*G_b; prover claims Q = -G_b
    { let p4 = -g.gp; let q4 = -g.gb;
      let xm1 = (-Ps::ONE).to_repr();
      let pr = prove_raw(&g, ctx, &p4, &q4, &Cheat { bits_p: bits_of(&xm1, NBITS), bits_b: bits_of(&xm1, NBITS), zero_sum: true, self_claim: false, gb_override: None });
      rec!("N8 'negative' scalar q-1 claimed as -G on both curves", false, verify(&g, ctx, &p4.to_bytes(), &encb(&q4), &pr.to_bytes())); }
    // N9 swapped bit proofs (positions 3 and 7)
    { let mut pr = good.clone(); pr.bits.swap(3, 7); rec!("N9 swapped bit proofs 3<->7", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    // N10 swapped commitments only (C3<->C7, D3<->D7), rings kept
    { let mut pr = good.clone(); let (c3, d3) = (pr.bits[3].c, pr.bits[3].d); pr.bits[3].c = pr.bits[7].c; pr.bits[3].d = pr.bits[7].d; pr.bits[7].c = c3; pr.bits[7].d = d3;
      rec!("N10 swapped commitments C3<->C7, D3<->D7", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    // N11 truncated bytes / N12 one extra byte
    rec!("N11 truncated proof (last 10 bytes cut)", false, verify(&g, ctx, &pb, &qb, &gb_bytes[..gb_bytes.len() - 10]));
    { let mut v = gb_bytes.clone(); v.push(0); rec!("N12 proof with trailing byte", false, verify(&g, ctx, &pb, &qb, &v)); }
    // N13 replay under another context (swap id)
    rec!("N13 replay with different swap context", false, verify(&g, b"swap-id:test-0002|alice:A_c|bob:B_c", &pb, &qb, &gb_bytes));
    // N14 replay against another statement (fresh x2)
    { let x2 = rand_x(); let (p2, q2) = statement(&g, &x2); rec!("N14 replay for another statement (P2,Q2)", false, verify(&g, ctx, &p2.to_bytes(), &encb(&q2), &gb_bytes));
      // N15 mix: right P, other Q
      rec!("N15 mismatched points (P from x, Q from x2)", false, verify(&g, ctx, &pb, &encb(&q2), &gb_bytes)); }
    // N16 negated Q / N17 negated P
    rec!("N16 negated Q", false, verify(&g, ctx, &pb, &encb(&-q), &gb_bytes));
    rec!("N17 negated P", false, verify(&g, ctx, &(-p).to_bytes(), &qb, &gb_bytes));
    // N18 tampered response / N19 tampered challenge
    { let mut pr = good.clone(); pr.bits[100].s1b[0] ^= 1; rec!("N18 tampered response s1b (bit 100)", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    { let mut pr = good.clone(); pr.bits[0].e0[0] ^= 1; rec!("N19 tampered challenge e0 (bit 0)", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    // N20 non-canonical response (s + field order would be the same value mod p): set top bytes 0xff
    { let mut pr = good.clone(); pr.bits[1].s0p = [0xffu8; 32]; rec!("N20 non-canonical scalar encoding", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    // N21 wrong generator: prover used H_b as the BLS 'G' (Q = x*H_b)
    { let q5 = g.hb * int_to_bs(&x).unwrap();
      let pr = prove_raw(&g, ctx, &p, &q5, &Cheat { bits_p: bits_of(&x, NBITS), bits_b: bits_of(&x, NBITS), zero_sum: true, self_claim: false, gb_override: Some(g.hb) });
      rec!("N21 swapped generator on BLS side (Q = x*H_b)", false, verify(&g, ctx, &pb, &encb(&q5), &pr.to_bytes())); }
    // N22 identity statement (x = 0)
    { let z = [0u8; 32]; let pr = prove_raw(&g, ctx, &Pp::identity(), &G1Projective::identity(), &honest_cheat(&z));
      rec!("N22 identity statement x=0", false, verify(&g, ctx, &Pp::identity().to_bytes(), &encb(&G1Projective::identity()), &pr.to_bytes())); }
    // N23 BLS point on curve but outside the prime-order subgroup, substituted for D_0
    { let mut found = None;
      for k in 0u32..10000 { let mut bts = [0u8; 48]; OsRng.fill_bytes(&mut bts); bts[0] = (bts[0] & 0x1f) | 0x80;
        if let Some(a) = Option::<G1Affine>::from(G1Affine::from_compressed_unchecked(&bts)) {
          if !bool::from(a.is_torsion_free()) { found = Some((a.to_compressed(), k)); break; } } }
      match found { Some((bts, _)) => { let mut pr = good.clone(); pr.bits[0].d = bts; rec!("N23 non-subgroup BLS point as D_0", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes()));
                                        rec!("N24 non-subgroup BLS point as statement Q", false, verify(&g, ctx, &pb, &bts, &gb_bytes)); }
                    None => results.push(("N23 non-subgroup point: none found (test not run)".into(), false, "not run".into())) } }

    // N25 tampered PoK response (Pallas) / N26 PoK transplanted from another valid proof of the same statement
    { let mut pr = good.clone(); pr.pok_sp[0] ^= 1; rec!("N25 tampered PoK response", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    { let other = prove_raw(&g, ctx, &p, &q, &honest_cheat(&x)); let mut pr = good.clone();
      pr.pok_rp = other.pok_rp; pr.pok_sp = other.pok_sp; pr.pok_rb = other.pok_rb; pr.pok_sb = other.pok_sb;
      rec!("N26 PoK transplanted from another proof (transcript binding)", false, verify(&g, ctx, &pb, &qb, &pr.to_bytes())); }
    // ---- honest proofs at random: all must accept ----
    let t = Instant::now(); let mut ok = 0;
    for k in 0..n_honest {
        let x = rand_x(); let (p, q) = statement(&g, &x);
        let c = format!("swap-id:rand-{k}");
        let pr = prove_raw(&g, c.as_bytes(), &p, &q, &honest_cheat(&x));
        if verify(&g, c.as_bytes(), &p.to_bytes(), &encb(&q), &pr.to_bytes()).is_ok() { ok += 1; }
    }
    let bulk_s = t.elapsed().as_secs_f64();
    results.push((format!("H {n_honest} random honest proofs accepted"), ok == n_honest, format!("{ok}/{n_honest} in {bulk_s:.1}s")));

    let all = results.iter().all(|r| r.1);
    for (n, p, d) in &results { println!("{} | {} | {}", if *p { "PASS" } else { "FAIL" }, n, d); }
    println!("bits={NBITS} proof_size_bytes={} prove_ms={} verify_ms={}", gb_bytes.len(), prove_ms, verify_ms);
    // vector for the Aiken test (fresh throwaway scalar): x (as integer), Q compressed
    let mut be = x; be.reverse();
    println!("AIKEN_VECTOR x_be_hex={} Q_compressed={}", hex::encode(be), hex::encode(qb));
    println!("OVERALL {}", if all { "PASS" } else { "FAIL" });
}
