// zeUTXO path 1 STEP 9 — wallet gates after review5 (decisions D35-D46). FAIL CLOSED like policy7/8.
// New: bounded Reveal HOLD + late-reveal cutoff (R5-H1/L1), RefundReveal provenance from tx inputs (R5-M1),
// era/branch/spacing/version read from the node (R5-M2), price-driven Z (R5-M3), blackout to T3+margin and
// node end-of-support (R5-L2), min-ADA lock rule (R5-L4).
import { P7, minZ, qEff, swapUsd, feedCheck } from "./policy7.mjs";
export { P7, minZ, qEff, swapUsd, feedCheck, upgradeBlackoutGate, commitGate, escapeGate } from "./policy7.mjs";
export { noticeGate, bobNoticeGate, forfeitGate, NOTICE_RANGE_MAX } from "./policy8.mjs";
const fin = Number.isFinite, isInt = Number.isSafeInteger, posNum = (x) => fin(x) && x > 0;
const num = (x) => typeof x === "bigint" ? Number(x) : x;

export const P9 = {
  // R5-H1: real profile. HOLD at most 90 min after the Commit is K deep; late-reveal cutoff 2 days before T3.
  real: { holdCapMs: 90 * 60e3, lateCutoffMs: 2 * 86400e3, tailMs: 7 * 86400e3 },
  // step 10 (audit A1): rehearsal profile (K15/Z30, M from model/step9_model.py). A 2 h tail is infeasible: it needs cutoff ≥ M
  // (54.9 min) and cap + cutoff + M < tail. 3 h works: cap 18 min (10 %), cutoff 60 min; 18 + 60 + 54.9 = 132.9 < 180.
  rehearsal: { tailMs: 3 * 3600e3, holdCapMs: 18 * 60e3, lateCutoffMs: 60 * 60e3, M: 54.9 * 60e3 },
  maxHoldFrac: 0.10,   // a hold cap may never exceed 10 % of the tail (sim: 120 s of 1200 s; real: 90 min ≪ 16.8 h)
  // R5-M2/M3: network constants (ZIP 259 / ZIP 218 / ZIP 2003). The ERA is never taken from config: it is derived.
  branch: { nu63: 0x37a5165b, nu7: 0x77190ad9 },
  nu7Height: { mainnet: 3_543_405, testnet: 4_465_026 },
  spacingS: { nu63: 75, nu7: 25 },
  minTxVersion: { nu63: 5, nu7: 5 },          // v4 rejected after NU7 (ZIP 2003); we never build v4 anyway
  minZebra: [7, 0, 0],
  // block reward to MINERS per block (ZEC): NU6 subsidy 1.5625 × 80 % = 1.25; NU7 divides the subsidy by 3 (ZIP 218).
  minerRewardZec: { nu63: 1.25, nu7: 1.25 / 3 },
  blackoutMarginH: 24,
  minAda: { coinsPerUTxOByte: 4310, overheadBytes: 160, marginLovelace: 2_000_000 },
};

/** Era from the node only (R5-M2). st = node status RPC: { tip, nu7_height, branch_next_id, nominal_spacing_s, version, network }.
 *  Returns { era, branch, spacingS } or { refuse }. Any disagreement with config (if supplied) or unknown value refuses. */
export function nodeEra9(st, { configEra, configBranch, configSpacingS, network } = {}) {
  if (!st || typeof st !== "object") return { refuse: "REFUSE: node status unavailable (fail closed)" };
  if (!isInt(st.tip) || st.tip < 0 || !isInt(st.nu7_height) || st.nu7_height < 0 || !isInt(st.branch_next_id)) return { refuse: "REFUSE: node did not report tip / NU7 height / next-block branch (fail closed)" };
  if (network !== undefined && network in P9.nu7Height && st.network === network && st.nu7_height !== P9.nu7Height[network])
    return { refuse: `REFUSE: node's NU7 height ${st.nu7_height} ≠ ZIP 259 ${network} height ${P9.nu7Height[network]}` };
  const next = st.tip + 1;
  const era = next >= st.nu7_height ? "nu7" : "nu63";
  if (st.branch_next_id !== P9.branch[era]) return { refuse: `REFUSE: node's next-block branch 0x${st.branch_next_id.toString(16)} does not match the ${era} branch 0x${P9.branch[era].toString(16)} implied by tip ${st.tip} vs NU7 at ${st.nu7_height}` };
  const spacingS = P9.spacingS[era];
  if (st.nominal_spacing_s !== undefined && st.nominal_spacing_s !== spacingS) return { refuse: `REFUSE: node's nominal spacing ${st.nominal_spacing_s} s ≠ ${spacingS} s for ${era}` };
  if (configEra !== undefined && configEra !== (era === "nu7" ? "nu7" : "now")) return { refuse: `REFUSE: config era "${configEra}" disagrees with the node (${era})` };
  if (configBranch !== undefined && configBranch !== P9.branch[era]) return { refuse: `REFUSE: agreed zec_branch 0x${(configBranch >>> 0).toString(16)} disagrees with the node's era ${era}` };
  if (configSpacingS !== undefined && configSpacingS !== spacingS) return { refuse: `REFUSE: config spacing ${configSpacingS} s disagrees with the node (${spacingS} s)` };
  return { era, branch: P9.branch[era], spacingS, legacyEra: era === "nu7" ? "nu7" : "now" };
}
/** Zebra version gate: "7.0.0" or newer, parsed strictly; unknown refuses. */
export function zebraVersionGate(v) {
  const m = typeof v === "string" ? /^(\d+)\.(\d+)\.(\d+)/.exec(v) : null; if (!m) return "REFUSE: node version unknown (fail closed)";
  const a = m.slice(1, 4).map(Number), b = P9.minZebra; for (let i = 0; i < 3; i++) { if (a[i] > b[i]) return null; if (a[i] < b[i]) return `REFUSE: Zebra ${v} < ${b.join(".")}`; } return null;
}
/** R5-M3: Z from the live price: Z = max(minZ(q, ε, stale), ceil(2·V / (R_miner·P))). */
export function zNeeded9({ usd, zecUsd, era, tier, q }) {
  if (!posNum(usd) || !posNum(zecUsd) || !(era in P9.minerRewardZec) || !(tier in P7.eps)) return null;
  const stale = era === "nu7" ? P7.stale.nu7 : P7.stale.now;
  const zs = minZ(Math.max(q ?? P7.qFloor, P7.qFloor), P7.eps[tier], stale);
  const ze = Math.ceil(2 * usd / (P9.minerRewardZec[era] * zecUsd));
  const floor = era === "nu7" ? P7.zFloor.nu7 : P7.zFloor.now;
  return { z: Math.max(zs, ze, floor), zSecurity: zs, zEconomic: ze, zFloor: floor };
}
/** Value cap with the era taken from the node (R5-M2) — no era string from the caller. */
export function valueCap9({ lovelace, zats, zDepth, kDepth, node, tier, feed, now, exposureSoFar = 0 }) {
  const fb = feedCheck(feed, now); if (fb) return fb;
  if (!node || node.refuse || !(node.era in P9.minerRewardZec)) return node?.refuse ?? "REFUSE: era not derived from the node";
  if (!(tier in P7.policyUsd)) return "REFUSE: unknown tier";
  if (!isInt(zDepth) || zDepth < 0 || !isInt(kDepth) || kDepth < 0) return "REFUSE: depths missing or invalid";
  if (!isInt(exposureSoFar) || exposureSoFar < 0) return "REFUSE: exposure counter missing or invalid";
  const usd = swapUsd({ lovelace, zats, feed }); if (usd === null || !fin(usd)) return "REFUSE: swap value not computable";
  const s = [...feed.pools].sort((a, b) => b - a);
  if (s[0] > P7.maxSingle) return `REFUSE: largest mining pool ${(100 * s[0]).toFixed(1)}% > ${100 * P7.maxSingle}%`;
  if ((s[0] + (s[1] ?? 0)) > P7.maxTop2) return `REFUSE: top-2 mining pools ${(100 * (s[0] + (s[1] ?? 0))).toFixed(1)}% > ${100 * P7.maxTop2}%`;
  if (exposureSoFar >= P7.exposure[tier]) return `REFUSE: lifetime exposure counter reached ${P7.exposure[tier]} swaps`;
  if (usd > P7.policyUsd[tier]) return `REFUSE: $${usd.toFixed(0)} above the ${tier} cap $${P7.policyUsd[tier]}`;
  if (kDepth < P7.kFloor) return `REFUSE: K=${kDepth} < ${P7.kFloor}`;
  const need = zNeeded9({ usd, zecUsd: feed.zecUsd, era: node.era, tier, q: s[0] });
  if (!need || zDepth < need.z) return `REFUSE: Z=${zDepth} < ${need?.z} needed (security ${need?.zSecurity}, economic 2V/(R·P) ${need?.zEconomic}, floor ${need?.zFloor}; era ${node.era} from node)`;
  return null;
}
/** R5-L2: NU7 blackout over the WHOLE swap incl. the T3 tail + margin, plus node end-of-support (Zebra halts at an EOS height). */
export function nu7Gate9({ st, node, measuredSpacing, spacingWindow, tailSeconds, preT1Seconds, eosHeight, nodeSupportsNu7 }) {
  if (nodeSupportsNu7 !== true) return "REFUSE: node does not implement NU7 (or did not say so)";
  if (!node || node.refuse) return node?.refuse ?? "REFUSE: era not derived from the node";
  const vg = zebraVersionGate(st?.version); if (vg) return vg;
  if (!isInt(spacingWindow) || spacingWindow < P7.minSpacingWindow) return `REFUSE: block spacing measured over ${spacingWindow ?? "no"} blocks < ${P7.minSpacingWindow}`;
  if (!posNum(measuredSpacing)) return "REFUSE: measured block spacing missing or invalid";
  if (measuredSpacing > P7.gateMult * node.spacingS) return `REFUSE: measured block spacing ${measuredSpacing.toFixed(1)} s > ${P7.gateMult}× ${node.spacingS} s (nominal for ${node.era}, from the node)`;
  if (!posNum(tailSeconds) || !posNum(preT1Seconds)) return "REFUSE: swap window length missing or invalid";
  const H = P9.blackoutMarginH * 3600, swapS = preT1Seconds + tailSeconds + H;
  const fastBlocks = Math.ceil(swapS / P9.spacingS.nu7) + 1;            // conservative: count at the FASTEST spacing
  const pre = Math.ceil(H / P9.spacingS.nu63), post = Math.ceil(H / P9.spacingS.nu7);
  if (st.tip + fastBlocks + pre >= st.nu7_height && st.tip < st.nu7_height + post) return `REFUSE: NU7 blackout — activation at ${st.nu7_height} within the swap window to T3 + ${P9.blackoutMarginH} h (tip ${st.tip}, ${fastBlocks} blocks)`;
  if (!isInt(eosHeight)) return "REFUSE: node end-of-support height unknown (fail closed)";
  if (st.tip + fastBlocks >= eosHeight) return `REFUSE: node end-of-support at ${eosHeight} falls before T3 + ${P9.blackoutMarginH} h (tip ${st.tip} + ${fastBlocks}): upgrade Zebra first`;
  return null;
}
/** R5-H1/L1: Reveal gate with a BOUNDED hold. Returns null (go), "GO-…" (go, with an alarm the caller must log/show),
 *  "HOLD: …" (wait, only inside the cap) or "REFUSE: …". Unknown inputs HOLD only inside the cap, never beyond it. */
export function revealGate9({ commitConfs, K, commitSettledAt, commitSeenAt, now, T3, M, mempoolFill, directStake, holdCapMs, lateCutoffMs }) {
  if (!isInt(K) || K < 1) return "REFUSE: settlement depth K missing or invalid";
  // step 10 (audit A4): depth UNKNOWN (data source down) is not the same as depth < K. If the Commit was seen in a block, wait,
  // but from the late cutoff on broadcast anyway: never revealing guarantees the loss at T3 (D36/D37). Never seen = REFUSE.
  if (!isInt(commitConfs)) {
    if (!fin(commitSeenAt)) return "REFUSE: Commit depth unknown and the Commit was never seen in a block: do not reveal b";
    if (![now, T3, M, lateCutoffMs].every(fin)) return "GO-CAP: Commit depth and time/config inputs unknown — treated as cap reached (broadcast on every channel)";
    if (now >= T3 - M) return "GO-RACE: ALARM past T3 − M with Commit depth unknown: broadcasting b on every channel (not revealing loses the ZEC for sure)";
    if (now >= T3 - lateCutoffMs) return "GO-LATE: ALARM Commit depth unknown past the late-reveal cutoff (Commit was seen in a block): broadcasting b on every channel";
    return "HOLD: Commit depth unknown (chain data source unavailable); retry, and broadcast regardless from the late-reveal cutoff";
  }
  if (!isInt(commitConfs) || commitConfs < K) return `REFUSE: Commit not settled (${commitConfs} < ${K} confirmations): do not reveal b`;
  if (![now, T3, M, holdCapMs, lateCutoffMs].every(fin) || !fin(commitSettledAt)) return "GO-CAP: time/config inputs unknown — treated as hold cap reached (broadcast on every channel)";
  if (now >= T3 - M) return "GO-RACE: ALARM past T3 − M: Reveal and Escape may both be valid at T3; broadcasting b anyway on every channel (not revealing loses the ZEC for sure)";
  if (now >= T3 - lateCutoffMs) return "GO-LATE: ALARM past the late-reveal cutoff: broadcasting b on every channel; exposure is tail-limited";
  const congested = !(fin(mempoolFill) && mempoolFill >= 0 && mempoolFill < P7.mempoolMax);
  const weakReach = !(fin(directStake) && directStake >= P7.minDirectStake);
  if (!congested && !weakReach) return null;
  const why = congested ? `mempool fill ${fin(mempoolFill) ? (100 * mempoolFill).toFixed(0) + "%" : "unknown"}` : `direct reach ${fin(directStake) ? (100 * directStake).toFixed(0) + "%" : "unknown"}`;
  if (now >= commitSettledAt + holdCapMs) return `GO-CAP: hold cap ${holdCapMs / 1000} s after Commit settled reached (${why}): broadcast on every channel`;
  return `HOLD: ${why} (until at most ${(commitSettledAt + holdCapMs - now) / 1000} s more)`;
}
/** Config check for the reveal timing (D36): cap ≤ 10 % of tail and ≤ 2 h real; cutoff + cap + M < tail. */
export function revealParamsCheck({ tailMs, holdCapMs, lateCutoffMs, M }) {
  if (![tailMs, holdCapMs, lateCutoffMs, M].every(posNum)) return "REFUSE: reveal timing config missing";
  if (holdCapMs > P9.maxHoldFrac * tailMs) return `REFUSE: hold cap ${holdCapMs} > ${P9.maxHoldFrac} × tail`;
  if (holdCapMs + lateCutoffMs + M >= tailMs) return "REFUSE: hold cap + cutoff + M must be < tail";
  if (lateCutoffMs < M) return "REFUSE: late cutoff must be ≥ M";
  return null;
}
/** R5-M1: provenance of the Refunding UTxO, from the CREATING TX's inputs (not labels).
 *  ctx = { refund: {txHash, outputIndex, address, datum, assets}, creating: { inputs:[{txHash,index}], scriptRedeemers:[{txHash,index,constr}],
 *          scriptOutputs:[index…] }, lock: {txHash, outputIndex} (the outref Bob verified at funding), scriptAddr, expectedDatum, lovelace, confs, K } */
export function refundProvenance9(c) {
  if (!c || !c.refund || !c.creating || !c.lock) return "REFUSE: provenance inputs missing (fail closed)";
  if (!isInt(c.K) || !isInt(c.confs) || c.confs < c.K) return `REFUSE: Notice not settled (${c.confs} < ${c.K})`;
  if (c.refund.address !== c.scriptAddr) return "REFUSE: Refunding UTxO is not at the escrow script address";
  if (c.refund.datum !== c.expectedDatum) return "REFUSE: Refunding datum not byte-equal to the expected one";
  const ks = Object.keys(c.refund.assets ?? {}); if (ks.length !== 1 || BigInt(c.refund.assets.lovelace) !== BigInt(c.lovelace)) return "REFUSE: Refunding value not exactly the escrow value";
  const spendsLock = c.creating.inputs.some(i => i.txHash === c.lock.txHash && Number(i.index) === Number(c.lock.outputIndex));
  if (!spendsLock) return "REFUSE: the tx that created this UTxO did not spend my lock outref (look-alike, not my escrow)";
  const red = c.creating.scriptRedeemers.find(r => r.txHash === c.lock.txHash && Number(r.index) === Number(c.lock.outputIndex));
  if (!red || red.constr !== 2) return "REFUSE: my lock was not spent with redeemer Notice";   // constr = Action constructor index (Notice = 2)
  if (c.creating.scriptOutputs.length !== 1 || c.creating.scriptOutputs[0] !== c.refund.outputIndex) return "REFUSE: Refunding UTxO is not the single continuing output of the Notice";
  return null;
}
/** R5-L4 (W.1): lock value ≥ minADA(Refunding datum) + margin, so every lock can always Notice (t4 grows the datum). */
export function minAdaLock9({ lovelace, refundingDatumBytes, addrBytes = 57 }) {
  const l = num(lovelace); if (!fin(l) || !isInt(refundingDatumBytes)) return "REFUSE: lock value or datum size unknown";
  const need = (P9.minAda.overheadBytes + addrBytes + refundingDatumBytes + 10) * P9.minAda.coinsPerUTxOByte + P9.minAda.marginLovelace;
  return l >= need ? null : `REFUSE: lock ${l} lovelace < minADA(Refunding datum) + margin = ${need}`;
}
