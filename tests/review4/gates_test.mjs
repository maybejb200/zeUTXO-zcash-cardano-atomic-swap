// review4: fail-open probes of step6 policy6.mjs gates + the premium economics. Each test states the SAFE expectation;
// a FAIL here is a reproduced finding (the gate fails open). Pure functions, no network.
import { valueCap6, nu7Gate, premiumGate, refundStartGate, redeemBroadcastGate, P6 } from "../work/step6/ada/policy6.mjs";
import { VC } from "../work/step6/ada/valuecap.mjs";
const out = []; const t = (id, name, safe, detail) => { out.push({ id, name, safe: !!safe, detail: String(detail) }); console.log(`  [${safe ? "safe" : "FAILS OPEN"}] ${id} ${name} — ${detail}`); };
const now = Date.now();
const FEED = (o = {}) => ({ asOf: now - 3600e3, pools: [0.33, 0.145, 0.12, 0.1], zecUsd: VC.ZEC_usd, adaUsd: VC.ADA_usd, ...o });
const base = { zDepth: 69, kDepth: 15, era: "nu7", tier: "v1", now };
// --- value cap ---
{ const v = valueCap6({ ...base, usd: NaN, feed: FEED() }); t("V1", "usd = NaN (e.g. bad lovelace/zats parse) is refused", v !== null, v); }
{ const v = valueCap6({ ...base, usd: 600, feed: FEED({ zecUsd: NaN }) }); t("V2", "feed.zecUsd = NaN is refused", v !== null, v); }
{ const v = valueCap6({ ...base, usd: 600, feed: FEED({ zecUsd: undefined }) }); t("V2b", "feed without zecUsd is refused", v !== null, v); }
{ const v = valueCap6({ ...base, usd: 600, feed: FEED({ asOf: now + 30 * 86400e3 }) }); t("V3", "feed dated 30 days in the FUTURE is refused (clock/feed error)", v !== null, v); }
{ const v = valueCap6({ ...base, usd: 600, feed: FEED({ pools: [] }) }); t("V4", "empty pool list is refused", v !== null, v); }
{ // the usd fed into the cap comes from the hard-coded VC constants (e2e3.mjs paramsCheck), not from the feed
  const zats = 1_000_000_000, feedPrice = 2 * VC.ZEC_usd;              // 10 ZEC, live price doubled since 2026-11-02
  const usdAsComputed = Math.max(1000, zats / 1e8 * VC.ZEC_usd);        // = e2e3.mjs:122
  const v = valueCap6({ ...base, usd: usdAsComputed, feed: FEED({ zecUsd: feedPrice }) });
  t("V5", `10 ZEC when the live feed says $${feedPrice.toFixed(0)}/ZEC (true value $${(10 * feedPrice).toFixed(0)} > $15k cap) is refused`, v !== null, v ?? `ACCEPTED: cap saw $${usdAsComputed.toFixed(0)} from VC.ZEC_usd=${VC.ZEC_usd}`); }
// --- NU7 gate ---
const g0 = { tip: 1000, nu7Height: 1_000_000_000, branchNext: 0x37a5165b, expectBranch: 0x37a5165b, measuredSpacing: 75, nominalSpacing: 75, swapSeconds: 265 * 60 + 86400 };
{ const v = nu7Gate({ ...g0, nu7Height: undefined }); t("N1", "node status without nu7_height (undefined) is refused", v !== null, v); }
{ const v = nu7Gate({ ...g0, nu7Height: NaN }); t("N2", "nu7_height = NaN is refused", v !== null, v); }
{ const v = nu7Gate({ ...g0, measuredSpacing: NaN }); t("N3", "measured spacing NaN is refused", v !== null, v); }
{ // zecGate passes `measured_mean_spacing_s || nominal_spacing_s`: a node that cannot measure (0/undefined) silently gets nominal
  const st = { measured_mean_spacing_s: 0, nominal_spacing_s: 75 }; const v = nu7Gate({ ...g0, measuredSpacing: st.measured_mean_spacing_s || st.nominal_spacing_s });
  t("N4", "unmeasurable spacing (0 / missing) is refused, not replaced by nominal (e2e3.mjs:220)", v !== null, v ?? "ACCEPTED with measuredSpacing := nominal"); }
{ const swapBlocks = Math.ceil(g0.swapSeconds / 25) + 1; t("N5", "test label '3,613 blocks' matches the code's swapBlocks", swapBlocks === 3613, `code: ${swapBlocks} blocks; 6000 > ${1000 /*tip in test is ~1*/ ? 1 + swapBlocks + 1152 : 0} so the test still passes`); }
{ // the e2e "100 blocks after activation" case is caught by the BRANCH check, not the blackout: probe the blackout alone
  const v = nu7Gate({ ...g0, tip: 200, nu7Height: 100, branchNext: 0x77190ad9, expectBranch: 0x77190ad9, nominalSpacing: 25, measuredSpacing: 25 });
  t("N6", "post-activation blackout fires on its own (branch agreed = NU7, tip 100 blocks after activation)", /blackout/.test(v ?? ""), v); }
// --- premium (R3-M1) ---
{ // Alice pays 0.7% before Bob funds; nothing makes Bob fund afterwards. Bob's best response: take the premium and walk.
  const usd = 15000, prem = P6.premium.v1 * usd; const g = premiumGate({ usd, tier: "v1", premiumPaidUsd: prem, premiumConfs: 15, K: 15 });
  t("P1", "premium is refundable or conditional on Bob funding (else Bob can take it and never fund)", false, `gate says ${g ?? "OK to fund"}; but the premium ($${prem}) is already Bob's. Riskless profit per walk-away: $${prem}; exposure counter is per-counterparty, Sybil-trivial`); }
{ t("P2", "premiumGate is wired into the swap flow (bobChecksLock / fundZec)", false, "only called in premiumCases unit tests (e2e3.mjs:964-966); fundZec never checks it"); }
// --- refund/redeem gates: boundary sanity (expected safe) ---
{ t("G1", "refundStartGate refuses NaN now", refundStartGate({ now: NaN, T1: 1, T2: 10, M: 1 }) !== null, refundStartGate({ now: NaN, T1: 1, T2: 10, M: 1 })); }
{ t("G2", "redeemBroadcastGate holds on NaN mempool fill", redeemBroadcastGate({ mempoolFill: NaN, directStake: 1, now: 0, LAST: 1 }) !== null, redeemBroadcastGate({ mempoolFill: NaN, directStake: 1, now: 0, LAST: 1 })); }
const bad = out.filter(o => !o.safe).map(o => o.id);
console.log(`\n${out.length} probes, ${out.length - bad.length} safe, ${bad.length} fail open: ${bad.join(", ")}`);
(await import("fs")).writeFileSync(new URL("./gates_test.results.json", import.meta.url), JSON.stringify(out, null, 1));
