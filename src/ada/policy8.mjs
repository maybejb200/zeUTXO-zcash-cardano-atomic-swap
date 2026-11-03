// zeUTXO path 1 STEP 8 — wallet gates for the two-step REFUND (decisions D26-D31). FAIL CLOSED like policy7.
// Re-exports every step-7 gate except refundStartGate7 (removed: the Notice carries no secret, D26).
export { P7, minZ, qEff, swapUsd, feedCheck, valueCap7, nu7BlackoutBlocks, nu7Gate7, upgradeBlackoutGate, commitGate, revealGate, escapeGate } from "./policy7.mjs";
const fin = Number.isFinite, isInt = Number.isSafeInteger;
export const NOTICE_RANGE_MAX = 21_600_000;   // mirrors escrow.ak notice_max_range (6 h)
/** Alice's Notice gate: from T1, only while the escrow is still OPEN (a Commit already settled => no refund). No deadline. */
export function noticeGate({ now, T1, escrowOpen }) {
  if (!fin(now) || !fin(T1)) return "REFUSE: time inputs missing or invalid";
  if (now < T1) return "REFUSE: before T1 (the script rejects a Notice before T1)";
  if (escrowOpen !== true) return "REFUSE: escrow not Open (committed, already noticed, spent or unknown)";
  return null;
}
/** Bob's Notice gate: from T2 (liveness: Alice had the first chance), escrow still Open. Reveals nothing. */
export function bobNoticeGate({ now, T2, escrowOpen }) {
  if (!fin(now) || !fin(T2)) return "REFUSE: time inputs missing or invalid";
  if (now < T2) return "REFUSE: before T2 (Alice has the first chance to Notice)";
  if (escrowOpen !== true) return "REFUSE: escrow not Open";
  return null;
}
/** Alice's RefundReveal gate (D26/D27): only on the Refunding output of a SETTLED Notice (≥ K confirmations) whose datum
 *  is byte-equal to what she expects (t4 = that Notice's upper bound + tail), and only while now ≤ t4 − M. */
export function refundRevealGate({ noticeConfs, K, datumOk, now, t4, M }) {
  if (!isInt(K) || K < 1) return "REFUSE: settlement depth K missing or invalid";
  if (!isInt(noticeConfs) || noticeConfs < K) return `REFUSE: Notice not settled (${noticeConfs} < ${K} confirmations): do not reveal a`;
  if (datumOk !== true) return "REFUSE: no Refunding output with the expected datum/value (never reveal a on any other UTxO)";
  if (!fin(now) || !fin(t4) || !fin(M) || t4 <= 0) return "REFUSE: time inputs missing or invalid";
  if (now > t4 - M) return "REFUSE: past t4 − M (a RefundReveal pending at t4 would hand a to Bob, who could Forfeit)";
  return null;
}
/** Bob's Forfeit gate (honest Bob): from t4, Refunding state, and only if he has NOT seen a (if he has, he sweeps his ZEC). */
export function forfeitGate({ now, t4, refunding, sawA }) {
  if (!fin(now) || !fin(t4) || t4 <= 0) return "REFUSE: time inputs missing or invalid";
  if (now < t4) return "REFUSE: before t4";
  if (refunding !== true) return "REFUSE: escrow is not in the Refunding state";
  if (sawA !== false) return "REFUSE: a was seen (or unknown) — honest Bob sweeps his ZEC back and does not Forfeit";
  return null;
}
