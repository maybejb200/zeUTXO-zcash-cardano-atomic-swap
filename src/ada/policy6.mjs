// zeUTXO path 1 step 6 — wallet policy gates for review3 R3-H1/H2/H3/M1/M3/L1. Mirrors model/step6_model.py.
// These are WALLET-SIDE refusals (both parties run them); none of them is a consensus rule. Inputs that come from the
// outside world (pool shares, prices, mempool fill, node branch) are passed in as dated observations; a real wallet
// must fetch them itself and FAIL CLOSED when they are missing or older than MAX_AGE_H.
import { reversalP } from "./valuecap.mjs";

export const P6 = {
  maxAgeH: 24,
  eps: { rehearsal: 0.25, v1: 1e-3 },
  policyUsd: { rehearsal: 500, v1: 15_000 },               // John's caps
  stale: { now: 0.02, nu7: 0.05 },                         // ZIP 218: 3.26% theoretical, 4.86% devnet at 25 s -> 5%; 75 s era 2% (assumed)
  qFloor: 0.35,                                            // q used = max(largest pool, 0.35)
  maxSingle: 0.35, maxTop2: 0.50,                          // refuse above these (R3-H3 / John)
  zFloor: { now: 10, nu7: 30 }, kFloor: 15,
  exposure: { v1: 10, rehearsal: 4 },                      // swaps per counterparty: 1-(1-1e-3)^10 ≈ 1% lifetime reversal risk
  nominal: { now: 75, nu7: 25 }, gateMult: 1.5,            // R3-H1: fail closed if measured spacing > 1.5x nominal
  blackoutH: 24,
  mempoolMax: 0.5, minDirectStake: 0.25,                   // R3-H2: Bob reveals b only if mempool < 50% and he reaches >= 25% stake directly
  premium: { v1: 0.007, rehearsal: 0.007 },                // R3-M1: option value 0.66% of notional over the v1 option window, rounded up
};
export const qEff = (q, stale) => q / (q + (1 - q) * (1 - stale));
export function minZ(q, eps, stale) { const qe = qEff(q, stale); for (let z = 1; z < 3000; z++) if (reversalP(qe, z) <= eps) return z; return null; }

/** R3-H3: value-cap gate. feed = { asOf (ms), pools: [shares...], zecUsd, adaUsd } observed by the wallet itself. */
export function valueCap6({ usd, zDepth, kDepth, era, tier, feed, now, exposureSoFar = 0 }) {
  if (!feed || !Number.isFinite(feed.asOf)) return "REFUSE: no pool-share/price feed (fail closed)";
  if (now - feed.asOf > P6.maxAgeH * 3600e3) return `REFUSE: pool-share/price data is ${((now - feed.asOf) / 3600e3).toFixed(1)} h old (> ${P6.maxAgeH} h)`;
  const s = [...feed.pools].sort((a, b) => b - a);
  if (!s.length || s.some(x => !(x >= 0 && x <= 1)) || s.reduce((a, b) => a + b, 0) > 1.0001) return "REFUSE: malformed pool-share feed";
  if (s[0] > P6.maxSingle) return `REFUSE: largest mining pool ${(100 * s[0]).toFixed(1)}% > ${100 * P6.maxSingle}%`;
  if ((s[0] + (s[1] ?? 0)) > P6.maxTop2) return `REFUSE: top-2 mining pools ${(100 * (s[0] + (s[1] ?? 0))).toFixed(1)}% > ${100 * P6.maxTop2}%`;
  if (exposureSoFar >= P6.exposure[tier]) return `REFUSE: lifetime exposure counter for this counterparty reached ${P6.exposure[tier]} swaps`;
  if (usd > P6.policyUsd[tier]) return `REFUSE: $${usd.toFixed(0)} above the ${tier} cap $${P6.policyUsd[tier]}`;
  if (kDepth < P6.kFloor || zDepth < P6.zFloor[era]) return `REFUSE: depth below floor (K ≥ ${P6.kFloor}, Z ≥ ${P6.zFloor[era]})`;
  const q = Math.max(s[0], P6.qFloor), stale = P6.stale[era];
  const need = minZ(q, P6.eps[tier], stale);
  if (need === null || zDepth < need) return `REFUSE: Z=${zDepth} < ${need} needed for ε=${P6.eps[tier]} at q_eff=${qEff(q, stale).toFixed(4)} (q=${q}, stale=${stale})`;
  const rz = (era === "nu7" ? 1.25 / 3 : 1.25) * feed.zecUsd;
  if (usd > 0.5 * zDepth * rz) return `REFUSE: $${usd.toFixed(0)} above ½·Z·block reward $${(0.5 * zDepth * rz).toFixed(0)}`;
  return null;
}

/** R3-H1: NU7 transition gate. heights/times from the wallet's OWN upgraded node (status command). */
export function nu7Gate({ tip, nu7Height, branchNext, expectBranch, measuredSpacing, nominalSpacing, swapSeconds, nodeSupportsNu7 = true }) {
  if (!nodeSupportsNu7) return "REFUSE: node does not implement NU7 (it could follow a minority pre-NU7 chain)";
  if (branchNext !== expectBranch) return `REFUSE: node's next-block branch 0x${branchNext.toString(16)} ≠ agreed zec_branch 0x${expectBranch.toString(16)}`;
  if (measuredSpacing > P6.gateMult * nominalSpacing) return `REFUSE: measured block spacing ${measuredSpacing.toFixed(1)} s > ${P6.gateMult}× nominal ${nominalSpacing} s (DAA recovery / hash drop)`;
  // blackout: the whole swap window [now, now + swapSeconds + 24 h] must not come within 24 h of activation
  const preBlocks = Math.ceil(P6.blackoutH * 3600 / 75);
  const swapBlocks = Math.ceil(swapSeconds / 25) + 1;               // conservative: fastest spacing reaches the height soonest
  const postBlocks = 3332;                                          // model: blocks in the first 24 h after activation
  if (nu7Height !== null && tip + swapBlocks + preBlocks >= nu7Height && tip < nu7Height + postBlocks)
    return `REFUSE: NU7 blackout — activation at ${nu7Height} is within ${P6.blackoutH} h of the swap window (tip ${tip})`;
  return null;
}

/** R3-H2: Bob's broadcast gate for the Redeem (which publishes b as soon as any mempool admits it). */
export function redeemBroadcastGate({ mempoolFill, directStake, now, LAST }) {
  if (now > LAST) return "REFUSE: past LAST";
  if (!(mempoolFill < P6.mempoolMax)) return `HOLD: own node's mempool ${(100 * mempoolFill).toFixed(0)}% ≥ ${100 * P6.mempoolMax}% — do not reveal b now`;
  if (!(directStake >= P6.minDirectStake)) return `HOLD: direct submission reaches ${(100 * directStake).toFixed(0)}% stake < ${100 * P6.minDirectStake}%`;
  return null;
}
/** R3-M3: Alice's refund start gate. */
export function refundStartGate({ now, T1, T2, M }) {
  if (now < T1) return "REFUSE: before T1";
  if (now > T2 - M) return "REFUSE: past LAST_REFUND = T2 − M (a refund pending at T2 hands a to Bob, who could Punish)";
  return null;
}
/** R3-M1: Bob funds only after Alice's premium payment is settled. */
export function premiumGate({ usd, tier, premiumPaidUsd, premiumConfs, K }) {
  const need = P6.premium[tier] * usd;
  if (!(premiumPaidUsd >= need)) return `REFUSE: option premium $${(premiumPaidUsd ?? 0).toFixed(2)} < $${need.toFixed(2)} (${100 * P6.premium[tier]}% of notional)`;
  if (premiumConfs < K) return `REFUSE: premium not settled (${premiumConfs} < ${K})`;
  return null;
}
