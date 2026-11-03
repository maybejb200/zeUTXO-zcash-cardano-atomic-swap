// step 7: review4's 16 fail-open probes (tests/gates_test.mjs) PORTED to the step-7 fail-closed gates (ada/policy7.mjs),
// plus extra fail-closed probes and positive controls. Every probe states the SAFE expectation. Pure functions, no network.
import { valueCap7, nu7Gate7, nu7BlackoutBlocks, revealGate, commitGate, escapeGate, upgradeBlackoutGate, feedCheck, P7, noticeGate, bobNoticeGate, refundRevealGate, forfeitGate } from "../ada/policy8.mjs";
import * as policy7 from "../ada/policy8.mjs";
import fs from "fs";
const src = fs.readFileSync(new URL("../ada/e2e4.mjs", import.meta.url), "utf8");
const out = []; const t = (id, name, safe, detail) => { out.push({ id, name, safe: !!safe, detail: String(detail) }); console.log(`  [${safe ? "safe" : "FAILS OPEN"}] ${id} ${name} — ${detail}`); };
const now = Date.now();
const FEED = (o = {}) => ({ asOf: now - 3600e3, pools: [0.33, 0.145, 0.12, 0.1], zecUsd: 1254.54, adaUsd: 0.188, ...o });
const base = { lovelace: 1_000_000_000n, zats: 50_000_000, zDepth: 69, kDepth: 15, era: "nu7", tier: "v1", now };
const R = (v) => v !== null && v !== undefined;
// --- value cap (ported V1-V5) ---
{ const v = valueCap7({ ...base, lovelace: NaN, feed: FEED() }); t("V1", "amount NaN (bad lovelace parse) → swap usd NaN is refused", R(v), v); }
{ const v = valueCap7({ ...base, feed: FEED({ zecUsd: NaN }) }); t("V2", "feed.zecUsd = NaN is refused", R(v), v); }
{ const v = valueCap7({ ...base, feed: FEED({ zecUsd: undefined }) }); t("V2b", "feed without zecUsd is refused", R(v), v); }
{ const v = valueCap7({ ...base, feed: FEED({ asOf: now + 30 * 86400e3 }) }); t("V3", "feed dated 30 days in the FUTURE is refused", R(v), v); }
{ const v = valueCap7({ ...base, feed: FEED({ pools: [] }) }); t("V4", "empty pool list is refused", R(v), v); }
{ const v = valueCap7({ ...base, zats: 1_000_000_000, feed: FEED({ zecUsd: 2 * 1254.54 }) }); t("V5", "10 ZEC when the LIVE feed says $2,509/ZEC ($25,091 > $15k cap) is refused (usd from the feed, not constants)", R(v) && /above the v1 cap/.test(v), v); }
// --- NU7 gate (ported N1-N6) ---
const g0 = { tip: 1000, nu7Height: 1_000_000_000, branchNext: 0x37a5165b, expectBranch: 0x37a5165b, measuredSpacing: 75, nominalSpacing: 75, spacingWindow: 48, swapSeconds: 1000 * 60 + 86400, nodeSupportsNu7: true };
{ const v = nu7Gate7({ ...g0, nu7Height: undefined }); t("N1", "node status without nu7_height (undefined) is refused", R(v), v); }
{ const v = nu7Gate7({ ...g0, nu7Height: NaN }); t("N2", "nu7_height = NaN is refused", R(v), v); }
{ const v = nu7Gate7({ ...g0, measuredSpacing: NaN }); t("N3", "measured spacing NaN is refused", R(v), v); }
{ const v = nu7Gate7({ ...g0, measuredSpacing: 0 }); const noFallback = !/measured_mean_spacing_s\s*\|\|/.test(src);
  t("N4", "unmeasurable spacing (0) is refused, and e2e4.mjs no longer substitutes nominal via `||`", R(v) && noFallback, `${v}; fallback in source: ${!noFallback}`); }
{ const usesCode = /nu7BlackoutBlocks\(/.test(src) && !/3,613/.test(src); const b = nu7BlackoutBlocks(g0.swapSeconds);
  t("N5", "the nu7-far test label is computed from the code (no hard-coded '3,613')", usesCode, `label uses nu7BlackoutBlocks(): ${usesCode}; e.g. ${b.swap} swap + ${b.pre} pre blocks`); }
{ const v = nu7Gate7({ ...g0, tip: 200, nu7Height: 100, branchNext: 0x77190ad9, expectBranch: 0x77190ad9, nominalSpacing: 25, measuredSpacing: 25 });
  t("N6", "post-activation blackout fires on its own (branch agreed = NU7, tip 100 blocks after activation)", /blackout/.test(v ?? ""), v); }
// --- premium (ported P1-P2): removed ---
t("P1", "no premium exists any more (P7 has no premium, policy7 exports no premiumGate)", !("premium" in P7) && !("premiumGate" in policy7), `P7 keys: ${Object.keys(P7).join(",")}`);
t("P2", "the swap flow references no premium gate", !/premiumGate|P6\.premium/.test(src), "grep e2e4.mjs for premiumGate / P6.premium");
// --- refund/reveal gates (ported G1-G2) ---
{ const v = noticeGate({ now: NaN, T1: 1, escrowOpen: true }); t("G1", "noticeGate refuses NaN now", R(v), v); }
{ const v = revealGate({ commitConfs: 5, K: 3, mempoolFill: NaN, directStake: 1, now: 0, T3: 1e9, M: 1 }); t("G2", "revealGate holds on NaN mempool fill (before T3 − M)", R(v), v); }
// --- step-7 extra fail-closed probes ---
{ const v = nu7Gate7({ ...g0, spacingWindow: 12 }); t("X1", "spacing measured over only 12 blocks is refused (needs ≥ 48)", R(v), v); }
{ const v = nu7Gate7({ ...g0, nu7Height: null }); t("X2", "nu7_height = null is refused (the node must always report one)", R(v), v); }
{ const v = nu7Gate7({ ...g0, nodeSupportsNu7: undefined }); t("X3", "node NU7 support unknown is refused", R(v), v); }
{ const v = valueCap7({ ...base, feed: FEED({ adaUsd: -0.2 }) }); t("X4", "negative ADA price is refused", R(v), v); }
{ const v = valueCap7({ ...base, feed: FEED({ pools: [0.3, NaN] }) }); t("X5", "NaN pool share is refused", R(v), v); }
{ const v = valueCap7({ ...base, zats: -1, feed: FEED() }); t("X6", "negative amount is refused", R(v), v); }
{ const v = valueCap7({ ...base, now: NaN, feed: FEED() }); t("X7", "NaN wallet clock is refused", R(v), v); }
{ const v = valueCap7({ ...base, zDepth: NaN, feed: FEED() }); t("X8", "NaN depth is refused", R(v), v); }
{ const v = noticeGate({ now: 5, T1: 1, escrowOpen: undefined }); t("X9", "Notice with escrow state unknown is refused", R(v), v); }
{ const v = refundRevealGate({ noticeConfs: NaN, K: 3, datumOk: true, now: 5, t4: 1000, M: 1 }); t("X10", "RefundReveal with NaN Notice confirmations is refused", R(v), v); }
{ const v = refundRevealGate({ noticeConfs: 2, K: 3, datumOk: true, now: 5, t4: 1000, M: 1 }); t("X11", "RefundReveal with the Notice < K deep is refused (mirror of Bob's rule)", R(v), v); }
{ const v = revealGate({ commitConfs: NaN, K: 3, mempoolFill: 0, directStake: 1, now: 0, T3: 1e9, M: 1 }); t("X12", "reveal with Commit depth NaN is refused", R(v), v); }
{ const v = revealGate({ commitConfs: 2, K: 3, mempoolFill: 0, directStake: 1, now: 0, T3: 1e9, M: 1 }); t("X13", "reveal before the Commit has K confirmations is refused", R(v), v); }
{ const v = commitGate({ now: NaN, LAST_COMMIT: 10 }); t("X14", "commit gate refuses NaN now", R(v), v); }
{ const v = upgradeBlackoutGate({ now, windowEnd: now + 3600e3, events: undefined }); t("X15", "upgrade blackout refuses a missing upgrade list", R(v), v); }
{ const v = upgradeBlackoutGate({ now, windowEnd: now + 3600e3, events: [{ name: "Cardano hard fork", atMs: now + 20 * 3600e3 }] }); t("X16", "Cardano hard fork 19 h after the window: refused", R(v), v); }
{ const v = escapeGate({ now: 10, T3: 5, claimed: true, sawB: undefined }); t("X17", "escape with 'saw b' unknown is refused", R(v), v); }
{ const v = feedCheck(FEED({ asOf: now + 6 * 60e3 }), now); t("X18", "feed dated 6 min in the future is refused", R(v), v); }
// --- step 8: two-step refund gates (D26-D31) ---
{ const v = noticeGate({ now: 0, T1: 1, escrowOpen: true }); t("R1", "Alice Notice before T1 is refused", R(v), v); }
{ const v = noticeGate({ now: 5, T1: 1, escrowOpen: false }); t("R2", "Notice on a committed/spent escrow is refused", R(v), v); }
{ const v = bobNoticeGate({ now: 99, T2: 100, escrowOpen: true }); t("R3", "Bob Notice before T2 is refused", R(v), v); }
{ const v = bobNoticeGate({ now: 100, T2: undefined, escrowOpen: true }); t("R4", "Bob Notice with T2 missing is refused", R(v), v); }
{ const v = refundRevealGate({ noticeConfs: 3, K: 3, datumOk: false, now: 5, t4: 1000, M: 1 }); t("R5", "RefundReveal on an unexpected Refunding datum (e.g. short t4) is refused", R(v), v); }
{ const v = refundRevealGate({ noticeConfs: 3, K: 3, datumOk: true, now: 1000, t4: 1000, M: 1 }); t("R6", "RefundReveal after t4 − M is refused", R(v), v); }
{ const v = refundRevealGate({ noticeConfs: 3, K: 3, datumOk: true, now: 5, t4: 0, M: 1 }); t("R7", "RefundReveal with t4 = 0 (not a Refunding datum) is refused", R(v), v); }
{ const v = refundRevealGate({ noticeConfs: 3, K: undefined, datumOk: true, now: 5, t4: 1000, M: 1 }); t("R8", "RefundReveal with K missing is refused", R(v), v); }
{ const v = forfeitGate({ now: 999, t4: 1000, refunding: true, sawA: false }); t("R9", "Forfeit before t4 is refused", R(v), v); }
{ const v = forfeitGate({ now: 1000, t4: 1000, refunding: true, sawA: true }); t("R10", "Forfeit after a was seen is refused (honest Bob sweeps instead)", R(v), v); }
{ const v = forfeitGate({ now: 1000, t4: 1000, refunding: true, sawA: undefined }); t("R11", "Forfeit with 'saw a' unknown is refused", R(v), v); }
{ const v = forfeitGate({ now: 1000, t4: 1000, refunding: false, sawA: false }); t("R12", "Forfeit on a non-Refunding escrow is refused", R(v), v); }
t("R13", "the swap flow no longer references refundStartGate7 / LAST_REFUND", !/refundStartGate7|LAST_REFUND_OFF\s*=/.test(src), "grep e2e4.mjs");
// --- positive controls (the gates are not trivially refusing) ---
const pos = [
  ["C1", "valid feed + $1,627 swap at K=15, Z=69", valueCap7({ ...base, feed: FEED() })],
  ["C2", "NU7 far away, 48-block measured spacing 75 s", nu7Gate7(g0)],
  ["C3", "Notice: Open, at/after T1", noticeGate({ now: 5, T1: 1, escrowOpen: true })],
  ["C9", "Bob Notice: Open, at/after T2", bobNoticeGate({ now: 100, T2: 100, escrowOpen: true })],
  ["C10", "RefundReveal: Notice K deep, datum ok, before t4 − M", refundRevealGate({ noticeConfs: 3, K: 3, datumOk: true, now: 5, t4: 1000, M: 1 })],
  ["C11", "Forfeit: at t4, Refunding, a not seen", forfeitGate({ now: 1000, t4: 1000, refunding: true, sawA: false })],
  ["C4", "reveal: Commit K-deep, mempool 10%, stake 100%", revealGate({ commitConfs: 3, K: 3, mempoolFill: 0.1, directStake: 1, now: 0, T3: 1e9, M: 1 })],
  ["C5", "reveal late (≥ T3 − M) despite a full mempool: reveal anyway", revealGate({ commitConfs: 3, K: 3, mempoolFill: 0.9, directStake: 0, now: 1e9, T3: 1e9, M: 1 })],
  ["C6", "commit before LAST_COMMIT", commitGate({ now: 1, LAST_COMMIT: 10 })],
  ["C7", "upgrade list present and empty", upgradeBlackoutGate({ now, windowEnd: now + 3600e3, events: [] })],
  ["C8", "escape at T3, Claimed, b not seen", escapeGate({ now: 10, T3: 5, claimed: true, sawB: false })]];
for (const [id, nm, v] of pos) t(id, `positive control: ${nm} → allowed`, v === null, v ?? "allowed");
const bad = out.filter(o => !o.safe).map(o => o.id);
const ported = out.filter(o => /^(V|N|P|G)/.test(o.id));
console.log(`\n${out.length} probes (${ported.length} ported from review4), ${out.length - bad.length} safe, ${bad.length} fail open: ${bad.join(", ")}`);
fs.writeFileSync(new URL("../results/gates8_test.results.json", import.meta.url), JSON.stringify(out, null, 1));
