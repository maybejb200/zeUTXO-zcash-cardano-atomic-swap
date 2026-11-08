// step 9: review5's 12 gate probes re-run as BEHAVIOUR tests against policy9 (no source greps). Each must now be safe.
import fs from "fs";
import { revealGate9, nodeEra9, nu7Gate9, valueCap9, zNeeded9, refundProvenance9, minAdaLock9, P9, P7 } from "../../src/ada/policy9.mjs";
const out = []; const t = (id, name, safe, detail) => { out.push({ id, name, safe: !!safe, detail: String(detail ?? "") }); console.log(`${safe ? "[safe]   " : "[FINDING]"} ${id} ${name} — ${detail ?? ""}`); };
const now = Date.now(), MIN = 60e3, DAY = 86400e3, M = 54.9 * MIN, T3 = 7 * DAY;
const FEED = (o = {}) => ({ asOf: now - 3600e3, pools: [0.33, 0.145, 0.12, 0.1], zecUsd: 1254.54, adaUsd: 0.188, ...o });
const base = { lovelace: 1_000_000_000n, zats: 50_000_000, kDepth: 15, tier: "v1", now, feed: FEED() };
const st7 = (o = {}) => ({ tip: 3_600_000, nu7_height: 3_543_405, branch_next_id: 0x77190ad9, nominal_spacing_s: 25, version: "7.0.0", network: "mainnet", ...o });
const nodeNu7 = nodeEra9(st7(), { network: "mainnet" });
const rg = (o) => revealGate9({ commitConfs: 15, K: 15, commitSettledAt: 30 * MIN, T3, M, holdCapMs: P9.real.holdCapMs, lateCutoffMs: P9.real.lateCutoffMs, ...o });
{ let first = null, g; for (let tm = 30 * MIN; tm <= T3; tm += MIN) { g = rg({ now: tm, mempoolFill: 0.6, directStake: undefined }); if (g === null || /^GO/.test(g)) { first = tm; break; } }
  t("H1", "persistent HOLD condition: b broadcast within 90 min of Commit settling", first !== null && first - 30 * MIN <= 90 * MIN, `first broadcast ${((first - 30 * MIN) / MIN).toFixed(0)} min after settle, ${((T3 - first) / DAY).toFixed(2)} d before T3 (${g?.slice(0, 40)})`); }
{ const v = rg({ now: T3 + MIN, mempoolFill: 0, directStake: 1 }); t("H2", "reveal after T3 − M carries a race ALARM (never silent)", /^GO-RACE/.test(v ?? ""), v); }
{ const n = nodeEra9(st7(), { configEra: "now" }); t("N1", "post-NU7 node + config era 'now' refused; with node era, Z=62 refused", !!n.refuse && !!valueCap9({ ...base, zDepth: 62, node: nodeNu7 }), n.refuse); }
{ const f = FEED({ zecUsd: 900 }); const v = valueCap9({ ...base, zats: 1_500_000_000, lovelace: 1n, zDepth: 69, node: nodeNu7, feed: f }); t("N2", "$13.5k at ZEC $900, Z=69, era from node: refused", v !== null, v); }
{ const z = (p) => zNeeded9({ usd: 15000, zecUsd: p, era: "nu7", tier: "v1", q: 0.33 }).z; t("N3", "Z for $15k derived from price", z(800) === 90 && z(500) === 144 && z(1254.54) === 69, `Z(1254.54)=${z(1254.54)}, Z(800)=${z(800)}, Z(500)=${z(500)}`); }
{ const v = nu7Gate9({ st: st7(), node: nodeNu7, measuredSpacing: 100, spacingWindow: 48, tailSeconds: 7.2 * 86400, preT1Seconds: 15000, eosHeight: 9e6, nodeSupportsNu7: true });
  const v2 = nodeEra9(st7(), { configSpacingS: 75 }); t("N4", "post-NU7, measured 100 s refused; stale config 75 s refused", !!v && !!v2.refuse, `${v} | ${v2.refuse}`); }
{ const nu7 = 3_543_405, tip = nu7 - 4003 - 1152 - 1; const st = st7({ tip, branch_next_id: 0x37a5165b, nominal_spacing_s: 75 });
  const v = nu7Gate9({ st, node: nodeEra9(st), measuredSpacing: 75, spacingWindow: 48, tailSeconds: 7.2 * 86400, preT1Seconds: 15000, eosHeight: 9e6, nodeSupportsNu7: true }); t("N5", "swap whose 7-day tail crosses NU7 refused", /blackout/.test(v ?? ""), v); }
{ const nu7 = 3_543_405; const r = [nu7 - 30000, nu7 - 1000, nu7 + 1000, nu7 + 3455].map(tip => { const st = st7({ tip, branch_next_id: tip + 1 >= nu7 ? 0x77190ad9 : 0x37a5165b, nominal_spacing_s: tip + 1 >= nu7 ? 25 : 75 });
    return nu7Gate9({ st, node: nodeEra9(st), measuredSpacing: tip + 1 >= nu7 ? 25 : 75, spacingWindow: 48, tailSeconds: 7.2 * 86400, preT1Seconds: 15000, eosHeight: 9e6, nodeSupportsNu7: true }); });
  t("N6", "mainnet blackout: ~8.5 d before NU7 to 24 h after", r.every(x => /blackout/.test(x ?? "")), r.map(x => (x ?? "ALLOWED").slice(0, 25)).join(" | ")); }
{ const v = valueCap9({ ...base, zats: 1_000_000, zDepth: 10, node: nodeNu7, tier: "rehearsal" }); t("N7", "rehearsal Z=10 post-NU7 refused (floor 30)", v !== null, v); }
{ const v = refundProvenance9({ refund: { txHash: "f", outputIndex: 0, address: "s", datum: "d", assets: { lovelace: 5n } }, creating: { inputs: [{ txHash: "bob-wallet", index: 0 }], scriptRedeemers: [], scriptOutputs: [0] }, lock: { txHash: "lock", outputIndex: 0 }, scriptAddr: "s", expectedDatum: "d", lovelace: 5n, confs: 15, K: 15 });
  t("P1", "look-alike Refunding UTxO (plain payment) refused by provenance", /lock outref/.test(v ?? ""), v); }
{ const src = fs.readFileSync(new URL("../../src/ada/e2e9.mjs", import.meta.url), "utf8"); const n = (src.match(/"observe", true\)/g) || []).length, notes = (src.match(/"observe", true, /g) || []).length;
  t("T1", "no e2e9 check is a constant 'true' (the 3 f2 '(observe)' library notes carry evidence, documented D44)", n === 0 && notes === 3, `${n} constant checks; ${notes} f2 notes`); }
{ const v = minAdaLock9({ lovelace: (160 + 57 + 300) * 4310, refundingDatumBytes: 308 }); t("MA", "lock at Open-datum min-ADA refused by W.1 min-ADA rule", /minADA/.test(v ?? ""), v); }
{ const tip = 3_600_000; const v = nu7Gate9({ st: st7({ tip }), node: nodeNu7, measuredSpacing: 25, spacingWindow: 48, tailSeconds: 7.2 * 86400, preT1Seconds: 15000, eosHeight: tip + 20000, nodeSupportsNu7: true }); t("L2", "Zebra EOS before T3 + 24 h refused", /end-of-support/.test(v ?? ""), v); }
const bad = out.filter(o => !o.safe);
console.log(`\n${out.length} probes, ${out.length - bad.length} safe, ${bad.length} findings: ${bad.map(o => o.id).join(", ")}`);
fs.writeFileSync(new URL("../../results/step9/gates9_test.results.json", import.meta.url), JSON.stringify(out, null, 1));
