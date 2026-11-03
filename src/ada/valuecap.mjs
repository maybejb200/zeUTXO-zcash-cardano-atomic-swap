// zeUTXO path 1 step 5 — per-swap value cap (spec v0.4 §V). Mirrors model/step5_model.py. Inputs are dated web
// observations (2026-11-02); a real wallet must refresh prices/threat shares and FAIL CLOSED if they are stale.
export const VC = {
  asOf: "2026-11-02", ZEC_usd: 1254.54, ADA_usd: 0.188,
  zecRewardPerBlock: { now: 1.25, nu7: 1.25 / 3 },       // ZEC to miners per block (1,440 ZEC/day; NU7 = 25 s blocks, reward/3)
  adaRewardPerBlock: 4.61e6 / 21600,                     // ADA epoch rewards / blocks per epoch (cardanoscan, epoch 663)
  qZcash: 0.35, aCardano: 0.15,                          // largest single pool / operator, rounded up
  safety: 10, eps: { rehearsal: 0.25, v1: 1e-3 }, policy: { rehearsal: 500 },
  minK: 15, minZ: { now: 10, nu7: 30 },                  // absolute floors regardless of value
};
const comb = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
export function reversalP(q, n) {                        // Rosenfeld 2014 exact (cross-checked vs Kovalchuk et al. 2026)
  if (q >= 0.5 || n <= 0) return 1; const p = 1 - q; let s = 0;
  for (let m = 0; m <= n; m++) s += comb(m + n - 1, m) * (p ** n * q ** m - q ** n * p ** m);
  return Math.max(0, 1 - s);
}
export function capUsd({ kDepth, zDepth, era = "nu7", tier = "v1" }) {
  const rz = VC.zecRewardPerBlock[era] * VC.ZEC_usd, ra = VC.adaRewardPerBlock * VC.ADA_usd;
  const pz = reversalP(VC.qZcash, zDepth), pa = reversalP(VC.aCardano, kDepth);
  if (kDepth < VC.minK || zDepth < VC.minZ[era]) return { cap: 0, why: `depth below floor (K ≥ ${VC.minK}, Z ≥ ${VC.minZ[era]})` };
  if (pz > VC.eps[tier] || pa > VC.eps[tier]) return { cap: 0, why: `reversal probability by the largest single entity too high (Zcash ${pz.toExponential(2)}, Cardano ${pa.toExponential(2)} > ${VC.eps[tier]})` };
  const evz = (VC.qZcash / (1 - VC.qZcash)) * zDepth * rz / (VC.safety * pz), eva = (VC.aCardano / (1 - VC.aCardano)) * kDepth * ra / (VC.safety * pa);
  const cap = Math.min(VC.policy[tier] ?? Infinity, 0.5 * zDepth * rz, evz, eva);
  return { cap, pz, pa };
}
export function minZFor(usd, { kDepth = 15, era = "nu7", tier = "v1" } = {}) { for (let z = 1; z < 2000; z++) if (capUsd({ kDepth, zDepth: z, era, tier }).cap >= usd) return z; return null; }
// Wallet check (both parties, at setup, before any key material is produced): refuse values above the cap for the agreed depths.
export function valueCapCheck({ lovelace, zats, kDepth, zDepth, era = "nu7", tier = "v1" }) {
  const usd = Math.max(Number(lovelace) / 1e6 * VC.ADA_usd, Number(zats) / 1e8 * VC.ZEC_usd);
  const c = capUsd({ kDepth, zDepth, era, tier });
  if (usd > c.cap) { const z = minZFor(usd, { kDepth, era, tier });
    return `value $${usd.toFixed(0)} above the per-swap cap $${c.cap.toFixed(0)} for K=${kDepth}, Z=${zDepth} (${era}, ${tier})${c.why ? ": " + c.why : ""}; needs Z ≥ ${z ?? "n/a"}`; }
  return null;
}
