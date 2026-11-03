//! step6: moved to the explicitly-named pasta05 / rand_core06 stack (same versions as step 5); proof logic unchanged.
//! Cross-group DLEQ (Pallas <-> BLS12-381 G1), copied verbatim from ../../test_b_dleq/src/main.rs (step 1),
//! with items made `pub` so the step-2 swap tool can call them. Step 4: optional caller-chosen blinders in `Cheat`
//! (so a round-1 F7 cheater can publish its shifted statement before the round-2 transcript exists). Proof logic unchanged.
#![allow(dead_code)]
use bls12_381::{G1Affine, G1Projective, Scalar as Bs};
use pasta05::arithmetic::CurveExt;
use pasta05::group::ff::{Field, PrimeField};
use pasta05::group::{Group, GroupEncoding};
use pasta05::pallas::{Point as Pp, Scalar as Ps};
use rand_core06::{OsRng, RngCore};


pub const NBITS: usize = 252;
pub const DOM: &[u8] = b"zeUTXO-path1/xDLEQ/pallas-bls12_381g1/v1";

pub struct Gens { pub gp: Pp, pub hp: Pp, pub gb: G1Projective, pub hb: G1Projective }
pub fn gens() -> Gens {
    use bls12_381::hash_to_curve::{ExpandMsgXmd, HashToCurve};
    let hb = <G1Projective as HashToCurve<ExpandMsgXmd<sha2::Sha256>>>::hash_to_curve(b"H", b"zeUTXO-path1-xDLEQ-H_b-v1");
    Gens {
        gp: Pp::hash_to_curve("z.cash:Orchard")(b"G"), // Orchard SpendAuthSig basepoint (same as reddsa)
        hp: Pp::hash_to_curve("zeUTXO-path1-xDLEQ")(b"H_p"),
        gb: G1Projective::generator(),
        hb,
    }
}
pub fn encb(p: &G1Projective) -> [u8; 48] { G1Affine::from(p).to_compressed() }
pub fn decb(b: &[u8]) -> Option<G1Projective> {
    let a: [u8; 48] = b.try_into().ok()?;
    Option::<G1Affine>::from(G1Affine::from_compressed(&a)).map(G1Projective::from) // checks on-curve + subgroup
}
pub fn decp(b: &[u8]) -> Option<Pp> { let a: [u8; 32] = b.try_into().ok()?; Option::from(Pp::from_bytes(&a)) }
pub fn int_to_ps(x: &[u8; 32]) -> Option<Ps> { Option::from(Ps::from_repr(*x)) }
pub fn int_to_bs(x: &[u8; 32]) -> Option<Bs> { Option::from(Bs::from_bytes(x)) }
pub fn h(parts: &[&[u8]]) -> [u8; 64] {
    let mut st = blake2b_simd::Params::new().hash_length(64).personal(b"zeUTXO_xDLEQ_v1_").to_state();
    for p in parts { st.update(&(p.len() as u32).to_le_bytes()); st.update(p); }
    *st.finalize().as_array()
}
/// challenge: 248-bit integer (31 bytes), valid & identical in both scalar fields
pub fn chal(t0: &[u8; 64], i: usize, j: u8, rp: &Pp, rb: &G1Projective) -> [u8; 32] {
    let d = h(&[t0, &(i as u32).to_le_bytes(), &[j], &rp.to_bytes(), &encb(rb)]);
    let mut c = [0u8; 32]; c[..31].copy_from_slice(&d[..31]); c
}
pub fn pok_chal(t0: &[u8; 64], rp: &Pp, rb: &G1Projective) -> (Ps, Bs) {
    use pasta05::group::ff::FromUniformBytes;
    let d = h(&[t0, b"pok", &rp.to_bytes(), &encb(rb)]);
    (Ps::from_uniform_bytes(&d), Bs::from_bytes_wide(&d))
}
pub fn pow2p(i: usize) -> Ps { let mut x = Ps::ONE; for _ in 0..i { x = x.double(); } x }
pub fn pow2b(i: usize) -> Bs { let mut x = Bs::one(); for _ in 0..i { x = x.double(); } x }

#[derive(Clone)]
pub struct BitProof { pub c: [u8; 32], pub d: [u8; 48], e0: [u8; 32], s0p: [u8; 32], s0b: [u8; 32], s1p: [u8; 32], s1b: [u8; 32] }
#[derive(Clone)]
pub struct Proof { pub bits: Vec<BitProof>, pub pok_rp: [u8; 32], pok_sp: [u8; 32], pok_rb: [u8; 48], pok_sb: [u8; 32] }
pub const BITLEN: usize = 32 + 48 + 32 * 5;
pub const POKLEN: usize = 32 + 32 + 48 + 32;
impl Proof {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut v = vec![];
        for b in &self.bits { for f in [&b.c[..], &b.d[..], &b.e0[..], &b.s0p[..], &b.s0b[..], &b.s1p[..], &b.s1b[..]] { v.extend_from_slice(f); } }
        for f in [&self.pok_rp[..], &self.pok_sp[..], &self.pok_rb[..], &self.pok_sb[..]] { v.extend_from_slice(f); }
        v
    }
    pub fn from_bytes(v: &[u8]) -> Option<Proof> {
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
pub fn transcript(g: &Gens, ctx: &[u8], p: &Pp, q: &G1Projective, cs: &[[u8; 32]], ds: &[[u8; 48]]) -> [u8; 64] {
    let mut all = vec![];
    for c in cs { all.extend_from_slice(c); }
    for d in ds { all.extend_from_slice(d); }
    h(&[DOM, ctx, &(NBITS as u32).to_le_bytes(), &g.gp.to_bytes(), &g.hp.to_bytes(), &encb(&g.gb), &encb(&g.hb), &p.to_bytes(), &encb(q), &all])
}

/// Prover. `bits_p` / `bits_b` are the bit vectors used on each side (equal for an honest prover; cheating
/// provers pass different ones or non-binary values). `claim_p` / `claim_q` are the statement points.
/// `zero_sum` = false reproduces self-review bug F7 (blinders not cancelling).
pub struct Cheat { pub bits_p: Vec<u64>, pub bits_b: Vec<u64>, pub zero_sum: bool, pub self_claim: bool, pub gb_override: Option<G1Projective>, pub blinders: Option<(Vec<Ps>, Vec<Bs>)> }
/// The PoK secrets are the prover's best guess of dlog(P), dlog(Q): the integer it actually knows.
pub fn pok_secret(bits: &[u64]) -> [u8; 32] { let mut x = [0u8; 32]; let mut acc: Vec<u64> = bits.to_vec(); let mut carry = 0u64; for i in 0..256 { let v = if i < acc.len() { acc[i] } else { 0 } + carry; if v & 1 == 1 { x[i / 8] |= 1 << (i % 8); } carry = v >> 1; } acc.clear(); x }
pub fn prove_raw(g: &Gens, ctx: &[u8], claim_p: &Pp, claim_q: &G1Projective, ch: &Cheat) -> Proof {
    let n = ch.bits_p.len();
    let gb = ch.gb_override.unwrap_or(g.gb);
    let (mut rp, mut rb): (Vec<Ps>, Vec<Bs>) = match &ch.blinders { Some((a, b)) => (a.clone(), b.clone()),
        None => ((0..n).map(|_| Ps::random(OsRng)).collect(), (0..n).map(|_| Bs::random(OsRng)).collect()) };
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
pub fn bits_of(x: &[u8; 32], n: usize) -> Vec<u64> { (0..n).map(|i| ((x[i / 8] >> (i % 8)) & 1) as u64).collect() }
pub fn honest_cheat(x: &[u8; 32]) -> Cheat { Cheat { bits_p: bits_of(x, NBITS), bits_b: bits_of(x, NBITS), zero_sum: true, self_claim: false, gb_override: None, blinders: None } }
pub fn statement(g: &Gens, x: &[u8; 32]) -> (Pp, G1Projective) {
    (g.gp * int_to_ps(x).unwrap(), g.gb * int_to_bs(x).unwrap())
}

/// Verifier. Takes the statement as bytes, exactly as a counterparty receives it.
pub fn verify(g: &Gens, ctx: &[u8], p_b: &[u8], q_b: &[u8], proof_bytes: &[u8]) -> Result<(), &'static str> { verify_opt(g, ctx, p_b, q_b, proof_bytes, true) }
/// `with_pok = false` is the NAIVE variant (bit commitments + rings + weighted sums only), kept to show its gap.
pub fn verify_opt(g: &Gens, ctx: &[u8], p_b: &[u8], q_b: &[u8], proof_bytes: &[u8], with_pok: bool) -> Result<(), &'static str> {
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

pub fn rand_x() -> [u8; 32] {
    loop {
        let mut x = [0u8; 32]; OsRng.fill_bytes(&mut x); x[31] &= 0x0f; // < 2^252
        if x != [0u8; 32] { return x; }
    }
}
