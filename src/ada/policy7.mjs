// zeUTXO path 1 STEP 7 — wallet policy gates, FAIL CLOSED (review4 F3/F4/F6), no option premium (review4 F2),
// two-step escrow gates (Commit / Reveal / Refund-start / Escape). Mirrors model/step7_model.py.
// Every gate returns null (= go ahead) ONLY when every input it needs is present, finite and in range; anything missing,
// NaN, negative, stale or future-dated returns a REFUSE/HOLD string. None of these is a consensus rule.
import { reversalP } from "./valuecap.mjs";

export const P7 = {
  maxAgeH: 24, maxFutureMin: 5,                            // feed may not be older than 24 h or dated > 5 min in the future
  eps: { rehearsal: 0.25, v1: 1e-3 },
  policyUsd: { rehearsal: 500, v1: 15_000 },               // John's caps
  stale: { now: 0.02, nu7: 0.05 },
  qFloor: 0.35, maxSingle: 0.35, maxTop2: 0.50,
  zFloor: { now: 10, nu7: 30 }, kFloor: 15,
  exposure: { v1: 10, rehearsal: 4 },
  gateMult: 1.5, minSpacingWindow: 48,                     // F4: measured spacing over >= 48 blocks, never a nominal fallback
  blackoutH: 24, postBlackoutSpacingS: 25,                 // post-activation blackout = 24 h of the FASTEST (25 s) blocks = 3,456 blocks
  preBlackoutSpacingS: 75,
  mempoolMax: 0.5, minDirectStake: 0.25,
  // no premium: review4 F2 (it was a free payment to Bob); the two-step escrow removes Bob's option instead (decisions D15).
};
const fin = Number.isFinite;
const isInt = (x) => Number.isSafeInteger(x);
const posNum = (x) => fin(x) && x > 0;
const num = (x) => typeof x === "bigint" ? Number(x) : x;   // amounts may arrive as bigint
export const qEff = (q, stale) => q / (q + (1 - q) * (1 - stale));
export function minZ(q, eps, stale) { const qe = qEff(q, stale); for (let z = 1; z < 3000; z++) if (reversalP(qe, z) <= eps) return z; return null; }

/** The swap value in USD, from the LIVE feed (review4 F3: never from hard-coded prices). null if not computable. */
export function swapUsd({ lovelace, zats, feed }) {
  const l = num(lovelace), z = num(zats);
  if (!(fin(l) && l >= 0 && fin(z) && z >= 0)) return null;
  if (!feed || !posNum(feed.zecUsd) || !posNum(feed.adaUsd)) return null;
  return Math.max(l / 1e6 * feed.adaUsd, z / 1e8 * feed.zecUsd);
}
/** Feed validity on its own (prices, pool shares, date). */
export function feedCheck(feed, now) {
  if (!fin(now)) return "REFUSE: wallet clock (now) missing or invalid";
  if (!feed || typeof feed !== "object") return "REFUSE: no pool-share/price feed (fail closed)";
  if (!fin(feed.asOf)) return "REFUSE: feed has no valid date (fail closed)";
  if (feed.asOf > now + P7.maxFutureMin * 60e3) return `REFUSE: feed dated ${((feed.asOf - now) / 3600e3).toFixed(1)} h in the future (clock or feed error)`;
  if (now - feed.asOf > P7.maxAgeH * 3600e3) return `REFUSE: pool-share/price data is ${((now - feed.asOf) / 3600e3).toFixed(1)} h old (> ${P7.maxAgeH} h)`;
  if (!posNum(feed.zecUsd)) return "REFUSE: feed ZEC/USD price missing or invalid";
  if (!posNum(feed.adaUsd)) return "REFUSE: feed ADA/USD price missing or invalid";
  if (!Array.isArray(feed.pools) || feed.pools.length === 0) return "REFUSE: malformed pool-share feed (no pools)";
  if (feed.pools.some(x => !(fin(x) && x >= 0 && x <= 1)) || feed.pools.reduce((a, b) => a + b, 0) > 1.0001) return "REFUSE: malformed pool-share feed";
  return null;
}
/** R3-H3 + review4 F3: value cap. Takes the AMOUNTS and computes USD from the live feed. */
export function valueCap7({ lovelace, zats, zDepth, kDepth, era, tier, feed, now, exposureSoFar = 0 }) {
  const fb = feedCheck(feed, now); if (fb) return fb;
  if (!(era in P7.stale) || !(tier in P7.policyUsd)) return "REFUSE: unknown era or tier";
  if (!isInt(zDepth) || zDepth < 0 || !isInt(kDepth) || kDepth < 0) return "REFUSE: depths missing or invalid";
  if (!isInt(exposureSoFar) || exposureSoFar < 0) return "REFUSE: exposure counter missing or invalid";
  const usd = swapUsd({ lovelace, zats, feed });
  if (usd === null || !fin(usd)) return "REFUSE: swap value not computable (amount or price missing/invalid)";
  const s = [...feed.pools].sort((a, b) => b - a);
  if (s[0] > P7.maxSingle) return `REFUSE: largest mining pool ${(100 * s[0]).toFixed(1)}% > ${100 * P7.maxSingle}%`;
  if ((s[0] + (s[1] ?? 0)) > P7.maxTop2) return `REFUSE: top-2 mining pools ${(100 * (s[0] + (s[1] ?? 0))).toFixed(1)}% > ${100 * P7.maxTop2}%`;
  if (exposureSoFar >= P7.exposure[tier]) return `REFUSE: lifetime exposure counter for this counterparty reached ${P7.exposure[tier]} swaps`;
  if (usd > P7.policyUsd[tier]) return `REFUSE: $${usd.toFixed(0)} above the ${tier} cap $${P7.policyUsd[tier]} (live feed prices)`;
  if (kDepth < P7.kFloor || zDepth < P7.zFloor[era]) return `REFUSE: depth below floor (K ≥ ${P7.kFloor}, Z ≥ ${P7.zFloor[era]})`;
  const q = Math.max(s[0], P7.qFloor), stale = P7.stale[era];
  const need = minZ(q, P7.eps[tier], stale);
  if (need === null || zDepth < need) return `REFUSE: Z=${zDepth} < ${need} needed for ε=${P7.eps[tier]} at q_eff=${qEff(q, stale).toFixed(4)} (q=${q}, stale=${stale})`;
  const rz = (era === "nu7" ? 1.25 / 3 : 1.25) * feed.zecUsd;
  if (usd > 0.5 * zDepth * rz) return `REFUSE: $${usd.toFixed(0)} above ½·Z·block reward $${(0.5 * zDepth * rz).toFixed(0)}`;
  return null;
}

/** Blocks the NU7 blackout spans (exported so the e2e label is computed from the code — review4 F6). */
export function nu7BlackoutBlocks(swapSeconds) {
  return { pre: Math.ceil(P7.blackoutH * 3600 / P7.preBlackoutSpacingS), swap: Math.ceil(swapSeconds / P7.postBlackoutSpacingS) + 1, post: Math.ceil(P7.blackoutH * 3600 / P7.postBlackoutSpacingS) };
}
/** R3-H1 + review4 F4: NU7 gate. Inputs from the wallet's OWN upgraded node (`status window=48`). */
export function nu7Gate7({ tip, nu7Height, branchNext, expectBranch, measuredSpacing, nominalSpacing, spacingWindow, swapSeconds, nodeSupportsNu7 }) {
  if (nodeSupportsNu7 !== true) return "REFUSE: node does not implement NU7 (or did not say so) — it could follow a minority pre-NU7 chain";
  if (!isInt(tip) || tip < 0) return "REFUSE: node tip height missing or invalid";
  if (!isInt(nu7Height) || nu7Height < 0) return "REFUSE: node did not report a valid NU7 activation height (fail closed)";
  if (!isInt(branchNext) || !isInt(expectBranch)) return "REFUSE: consensus branch id missing or invalid";
  if (branchNext !== expectBranch) return `REFUSE: node's next-block branch 0x${branchNext.toString(16)} ≠ agreed zec_branch 0x${expectBranch.toString(16)}`;
  if (!posNum(nominalSpacing)) return "REFUSE: nominal block spacing missing or invalid";
  if (!isInt(spacingWindow) || spacingWindow < P7.minSpacingWindow) return `REFUSE: block spacing measured over ${spacingWindow ?? "no"} blocks < ${P7.minSpacingWindow} (fail closed; no nominal fallback)`;
  if (!posNum(measuredSpacing)) return "REFUSE: measured block spacing missing, zero or invalid (no nominal fallback)";
  if (measuredSpacing > P7.gateMult * nominalSpacing) return `REFUSE: measured block spacing ${measuredSpacing.toFixed(1)} s > ${P7.gateMult}× nominal ${nominalSpacing} s (DAA recovery / hash drop)`;
  if (!posNum(swapSeconds)) return "REFUSE: swap window length missing or invalid";
  const bl = nu7BlackoutBlocks(swapSeconds);
  if (tip + bl.swap + bl.pre >= nu7Height && tip < nu7Height + bl.post)
    return `REFUSE: NU7 blackout — activation at ${nu7Height} is within ${P7.blackoutH} h of the swap window (tip ${tip})`;
  return null;
}
/** review4 F5: generic upgrade blackout (Cardano hard forks, Zcash recovery-mode activation, any other scheduled
 *  rule change), by wall-clock time. events MUST be an array (empty = "checked, none scheduled"); missing = refuse. */
export function upgradeBlackoutGate({ now, windowEnd, events }) {
  if (!fin(now) || !fin(windowEnd) || windowEnd < now) return "REFUSE: swap window times missing or invalid";
  if (!Array.isArray(events)) return "REFUSE: scheduled-upgrade list missing (fail closed)";
  const H = P7.blackoutH * 3600e3;
  for (const e of events) {
    if (!e || typeof e.name !== "string" || !fin(e.atMs)) return "REFUSE: malformed scheduled-upgrade entry";
    if (e.atMs >= now - H && e.atMs <= windowEnd + H) return `REFUSE: upgrade blackout — ${e.name} within ${P7.blackoutH} h of the swap window`;
  }
  return null;
}
/** Two-step escrow: Bob's Commit gate (no secret in the tx; past LAST_COMMIT the Commit might land after T1). */
export function commitGate({ now, LAST_COMMIT }) {
  if (!fin(now) || !fin(LAST_COMMIT)) return "REFUSE: time inputs missing or invalid";
  if (now > LAST_COMMIT) return "REFUSE: past LAST_COMMIT (a Commit broadcast now might not be included before T1)";
  return null;
}
/** Two-step escrow: Bob's Reveal gate. Never reveal b before his OWN Commit has K confirmations. Before T3 − M he
 *  HOLDs on congestion (defence in depth: censorship of a Reveal is no longer a theft path); from T3 − M he reveals
 *  regardless, because revealing (weakly) dominates not revealing (not revealing forfeits his ZEC for certain). */
export function revealGate({ commitConfs, K, mempoolFill, directStake, now, T3, M }) {
  if (!isInt(K) || K < 1) return "REFUSE: settlement depth K missing or invalid";
  if (!isInt(commitConfs) || commitConfs < K) return `REFUSE: Commit not settled (${commitConfs} < ${K} confirmations): do not reveal b`;
  if (!fin(now) || !fin(T3) || !fin(M)) return "REFUSE: time inputs missing or invalid";
  if (now >= T3 - M) return null;   // late: reveal anyway (logged by the caller)
  if (!(fin(mempoolFill) && mempoolFill >= 0 && mempoolFill < P7.mempoolMax)) return `HOLD: own node's mempool fill ${fin(mempoolFill) ? (100 * mempoolFill).toFixed(0) + "%" : "unknown"} — not < ${100 * P7.mempoolMax}%`;
  if (!(fin(directStake) && directStake >= P7.minDirectStake)) return `HOLD: direct submission reaches ${fin(directStake) ? (100 * directStake).toFixed(0) + "%" : "unknown"} stake < ${100 * P7.minDirectStake}%`;
  return null;
}
/** Alice's Refund start gate (two-step): only when the escrow is still OPEN at least K blocks after T1 (a Commit
 *  included before T1 but not yet seen/settled could otherwise win against her Refund and hand Bob a — decisions D18),
 *  and not after LAST_REFUND = T2 − M. */
export function refundStartGate7({ now, T1, T2, M, escrowOpen, blocksAfterT1, K }) {
  if (![now, T1, T2, M].every(fin)) return "REFUSE: time inputs missing or invalid";
  if (now < T1) return "REFUSE: before T1";
  if (escrowOpen !== true) return "REFUSE: escrow not Open (committed, spent or unknown): never reveal a";
  if (!isInt(K) || K < 1 || !isInt(blocksAfterT1)) return "REFUSE: block counts missing or invalid";
  if (blocksAfterT1 < K) return `REFUSE: only ${blocksAfterT1} blocks after T1 (< K = ${K}): a pre-T1 Commit could still appear`;
  if (now > T2 - M) return "REFUSE: past LAST_REFUND = T2 − M (a refund pending at T2 hands a to Bob, who could Punish)";
  return null;
}
/** Alice's Escape gate: only from T3, only on a Claimed escrow, and never once she has seen b (honest Alice). */
export function escapeGate({ now, T3, claimed, sawB }) {
  if (!fin(now) || !fin(T3)) return "REFUSE: time inputs missing or invalid";
  if (now < T3) return "REFUSE: before T3";
  if (claimed !== true) return "REFUSE: escrow is not in the Claimed state";
  if (sawB !== false) return "REFUSE: b was seen (or unknown) — honest Alice already swept the ZEC and does not escape";
  return null;
}
