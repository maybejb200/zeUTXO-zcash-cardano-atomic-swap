// review5 adversarial gate probes against step8 policy8/policy7 (copied into review5/sim/ada). Each probe states the
// EXPECTED SAFE behaviour; "finding" = the gate does NOT do it. Simulator/box only.
import fs from "fs";
import { valueCap7, nu7Gate7, nu7BlackoutBlocks, revealGate, refundRevealGate, P7, minZ } from "../sim/ada/policy8.mjs";
const out = []; const t = (id, name, safe, detail) => { out.push({ id, name, safe: !!safe, detail: String(detail ?? "") }); console.log(`${safe ? "[safe]   " : "[FINDING]"} ${id} ${name} — ${detail ?? ""}`); };
const now = Date.now();
const FEED = (o = {}) => ({ asOf: now - 3600e3, pools: [0.33, 0.145, 0.12, 0.1], zecUsd: 1254.54, adaUsd: 0.188, ...o });
const base = { lovelace: 1_000_000_000n, zats: 50_000_000, kDepth: 15, tier: "v1", now, feed: FEED() };
const MIN = 60e3, DAY = 86400e3, M = 54.9 * MIN, T1 = 0, T3 = 7 * DAY;

// H1: reveal HOLD timeline (real profile). Expected safe: a HOLD should be bounded (hours), not last to T3 − M.
{ let first = null; for (let tm = T1 + 30 * MIN; tm <= T3 + MIN; tm += MIN) { if (revealGate({ commitConfs: 15, K: 15, mempoolFill: 0.6, directStake: undefined, now: tm, T3, M }) === null) { first = tm; break; } }
  t("H1", "a persistent HOLD condition (mempool 60 % or probe unknown) delays b until T3 − M", first !== null && T3 - first > DAY, `first allowed reveal ${((T3 - first) / MIN).toFixed(1)} min before T3 (hold lasted ${((first - T1) / DAY).toFixed(2)} days)`); }
// H2: after T3 the gate still says "reveal" although Escape is then valid (script race, aiken r5_a1).
{ const v = revealGate({ commitConfs: 15, K: 15, mempoolFill: 0, directStake: 1, now: T3 + MIN, T3, M }); t("H2", "reveal gate after T3 (Escape already valid) warns/refuses", v !== null, v ?? "null = go ahead (b goes into an Escape race)"); }
// N1: era is a caller-supplied label, never derived from the node (tip vs nu7_height / branch).
{ const v1 = valueCap7({ ...base, zDepth: 62, era: "now" }), v2 = valueCap7({ ...base, zDepth: 62, era: "nu7" });
  t("N1", "post-NU7 swap mislabelled era='now' at Z=62 is refused (needs 69)", v1 !== null, `era now → ${v1 ?? "ALLOWED"}; era nu7 → ${v2}`); }
// N2: block-reward bound uses 1.25 ZEC pre-NU7 vs 1.25/3 post-NU7; a mislabelled era triples the economic bound.
{ const f = FEED({ zecUsd: 900 }); const v1 = valueCap7({ ...base, zats: 1_500_000_000, lovelace: 1n, zDepth: 69, era: "now", feed: f }), v2 = valueCap7({ ...base, zats: 1_500_000_000, lovelace: 1n, zDepth: 69, era: "nu7", feed: f });
  t("N2", "$13.5k swap at ZEC $900, Z=69, era mislabelled 'now' is refused", v1 !== null, `era now → ${v1 ?? "ALLOWED"}; era nu7 → ${v2}`); }
// N3: v1 Z=69 is only enough for $15k when ZEC ≥ $1,043 post-NU7 (½·Z·0.4167·P). Below that the gate refuses (fail closed) but the timing model hard-codes Z=69.
{ const zNeed = (P) => Math.ceil(15000 / (0.5 * (1.25 / 3) * P)); const be = 15000 / (0.5 * 69 * 1.25 / 3);
  const v = valueCap7({ ...base, zats: Math.round(15000 / 800 * 1e8), lovelace: 1n, zDepth: 69, era: "nu7", feed: FEED({ zecUsd: 800 }) });
  t("N3", "Z for a $15k swap is derived from price (timing model uses a fixed Z=69)", false, `break-even ZEC price at Z=69: $${be.toFixed(0)}; at $800 the gate says: ${v}; Z needed at $800 = ${zNeed(800)}, at $500 = ${zNeed(500)} (≈ ${(zNeed(500) * 25 / 60).toFixed(0)} min at 25 s)`); }
// N4: nominalSpacing is caller-supplied; post-NU7 with a stale nominal 75 s, a 100 s measured spacing (4× slower than 25 s) passes.
{ const g = { tip: 3_600_000, nu7Height: 3_543_405, branchNext: 0x77190ad9, expectBranch: 0x77190ad9, measuredSpacing: 100, nominalSpacing: 75, spacingWindow: 48, swapSeconds: 100026, nodeSupportsNu7: true };
  const v = nu7Gate7(g); t("N4", "post-NU7 node, stale nominal 75 s, measured 100 s (4× the 25 s target) is refused", v !== null, v ?? "ALLOWED"); }
// N5: blackout covers only T2 + 24 h (swapSeconds 100,026 s), not the 7-day Reveal/RefundReveal tail.
{ const bl = nu7BlackoutBlocks(100026); const nu7 = 3_543_405; const tip = nu7 - bl.swap - bl.pre - 1;
  const v = nu7Gate7({ tip, nu7Height: nu7, branchNext: 0x37a5165b, expectBranch: 0x37a5165b, measuredSpacing: 75, nominalSpacing: 75, spacingWindow: 48, swapSeconds: 100026, nodeSupportsNu7: true });
  const tailBlocks75 = Math.ceil(7.2 * 86400 / 75);
  t("N5", "a swap whose 7-day tail crosses NU7 activation is refused or flagged", v !== null, `tip ${tip} (${nu7 - tip} blocks ≈ ${((nu7 - tip) * 75 / 3600).toFixed(0)} h before NU7): gate → ${v ?? "ALLOWED"}; the 7.2-day tail spans ≈ ${tailBlocks75} pre-NU7 blocks`); }
// N6 (positive, today's facts): mainnet NU7 at 3,543,405 ~Nov 5 2026: every tip within the pre+swap window before activation and 24 h after is refused.
{ const bl = nu7BlackoutBlocks(100026); const nu7 = 3_543_405; const r = [nu7 - bl.swap - bl.pre, nu7 - 1000, nu7 + 1000, nu7 + bl.post - 1].map(tip => nu7Gate7({ tip, nu7Height: nu7, branchNext: tip >= nu7 ? 0x77190ad9 : 0x37a5165b, expectBranch: tip >= nu7 ? 0x77190ad9 : 0x37a5165b, measuredSpacing: tip >= nu7 ? 25 : 75, nominalSpacing: tip >= nu7 ? 25 : 75, spacingWindow: 48, swapSeconds: 100026, nodeSupportsNu7: true }));
  t("N6", "blackout around mainnet NU7 (3,543,405) refuses swaps from ~4.5 days before to 24 h after", r.every(x => x && /blackout/.test(x)), `pre ${bl.pre} + swap ${bl.swap} blocks before, ${bl.post} after`); }
// N7: rehearsal floor post-NU7 = 30 (testnet is post-NU7 since 4,465,026); Z=10 must be refused under era nu7.
{ const v = valueCap7({ ...base, lovelace: 1_000_000_000n, zats: 1_000_000, zDepth: 10, era: "nu7", tier: "rehearsal" }); t("N7", "rehearsal at Z=10 under era nu7 is refused (floor 30)", v !== null, v); }
// P1: refundRevealGate takes datumOk as a bare boolean — it cannot check that the Refunding UTxO came from a Notice that spent the lock outref.
{ const v = refundRevealGate({ noticeConfs: 15, K: 15, datumOk: true, now: 0, t4: 7 * DAY, M }); const src = fs.readFileSync(new URL("../sim/ada/e2e4.mjs", import.meta.url), "utf8");
  const labelBased = /\/\^\(notice\|bobnotice\)\/\.test\(tx\.label\)/.test(src);
  t("P1", "RefundReveal provenance (Notice spends the lock outref) is checked by content, not by a label", !labelBased, `gate signature has no provenance input (returns ${v}); sim wallet uses tx.label regex: ${labelBased}`); }
// T1: tautological checks in e2e4 (constant true).
{ const src = fs.readFileSync(new URL("../sim/ada/e2e4.mjs", import.meta.url), "utf8"); const n = (src.match(/"observe", true\)/g) || []).length;
  t("T1", "no e2e4 check is a constant 'true'", n === 0, `${n} R.rec(..., "observe", true) checks always pass`); }
// MA: min-ADA growth on Notice (t4: 0 → 13-digit ms = 1 → 9 CBOR bytes) at mainnet coinsPerUtxoByte 4,310.
{ const pp = JSON.parse(fs.readFileSync(new URL("../sim/ada/mainnet_params_koios.json", import.meta.url))); const c = Number(pp.utxoCostPerByte);
  t("MA", "Notice output needs no more min-ADA than the lock (else a min-ADA lock can never be refunded)", false, `datum grows by 8 bytes → +${8 * c} lovelace min-ADA; W.1 has no 'lock ≥ min-ADA of the Refunding output' rule (only matters for tiny locks or a coinsPerUtxoByte rise)`); }
const bad = out.filter(o => !o.safe);
console.log(`\n${out.length} probes, ${out.length - bad.length} safe, ${bad.length} findings: ${bad.map(o => o.id).join(", ")}`);
fs.writeFileSync(new URL("../results/gates5_test.results.json", import.meta.url), JSON.stringify(out, null, 1));
