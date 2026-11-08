// Regression tests for the Nov 8 2026 audit findings A1–A4 (wallet-side; the on-chain escrow is unchanged).
// Each test was written to FAIL on commit 1697e21 and PASS after the fix. Run: node tests/step10/fixes_test.mjs
// (needs `npm ci` in src/ada). Exit code 1 if any test fails.
import fs from "fs";
import path from "path";
import { revealParamsCheck, revealGate9, refundProvenance9, P9 } from "../../src/ada/policy9.mjs";
import { slotToMs, noticeWindow, decodeCreating, CML, Data, Constr } from "../../src/ada/chaintx.mjs";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const out = [];
const t = (id, name, ok, detail) => { out.push({ id, name, ok: !!ok, detail: String(detail ?? "") }); console.log(`${ok ? "[pass]" : "[FAIL]"} ${id} ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`); };
const MIN = 60e3;
const PREPROD = { zeroTime: 1654041600000 + 1728000000, zeroSlot: 86400, slotLength: 1000 };   // = Lucid SLOT_CONFIG_NETWORK.Preprod

// ---- A1: the rehearsal profile must satisfy the wallet's own reveal-timing check ----
{
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, "results/step9/step9_model.json")));
  const key = Object.keys(m).find(k => k.startsWith("rehearsal_nu7_"));
  const r = m[key], br = m.bob_reveal;
  const cfg = { tailMs: (r.T3 - r.T1) * MIN, holdCapMs: br.rehearsal_hold_cap_min * MIN, lateCutoffMs: br.rehearsal_late_cutoff_min_before_T3 * MIN, M: r.M * MIN };
  const v = revealParamsCheck(cfg);
  t("A1a", `published rehearsal profile (${key}) passes revealParamsCheck`, v === null, v ?? `tail ${cfg.tailMs / MIN} cap ${cfg.holdCapMs / MIN} cutoff ${cfg.lateCutoffMs / MIN} M ${cfg.M / MIN} min`);
  const p = P9.rehearsal;
  t("A1b", "policy9 carries the rehearsal profile and it passes revealParamsCheck", !!p && revealParamsCheck(p) === null, p ? revealParamsCheck(p) ?? JSON.stringify(p) : "P9.rehearsal missing");
  t("A1c", "policy9 rehearsal profile equals the model output", !!p && p.tailMs === cfg.tailMs && p.holdCapMs === cfg.holdCapMs && p.lateCutoffMs === cfg.lateCutoffMs && Math.abs(p.M - cfg.M) < 1,
    p ? `policy ${JSON.stringify(p)} vs model ${JSON.stringify(cfg)}` : "P9.rehearsal missing");
}

// ---- A2: Notice t4 must be computed from what the ledger will hand the script ----
{
  // Lucid converts validTo(ms) with floor((ms - zeroTime)/slotLength) + zeroSlot; the script sees slotToBeginUnixTime(slot).
  const lucidSlot = (ms, c) => Math.floor((ms - c.zeroTime) / c.slotLength) + c.zeroSlot;
  const lucidMs = (slot, c) => c.zeroTime + (slot - c.zeroSlot) * c.slotLength;
  const slot = 110_000_000;
  t("A2a", "slotToMs matches the ledger's slot→POSIX conversion on preprod (zeroSlot 86400)", slotToMs(slot, PREPROD) === lucidMs(slot, PREPROD),
    `slotToMs ${slotToMs(slot, PREPROD)} vs ledger ${lucidMs(slot, PREPROD)} (Δ ${(slotToMs(slot, PREPROD) - lucidMs(slot, PREPROD)) / 1000} s)`);
  const now = PREPROD.zeroTime + 7_777_777_437;   // a wall clock that is not on a slot boundary
  const w = noticeWindow(now, 3600e3, PREPROD);
  const onChainHi = lucidMs(lucidSlot(w.hi, PREPROD), PREPROD);
  t("A2b", "Notice upper bound written into t4 equals the on-chain upper bound (unaligned clock)", w.hi === onChainHi, `datum hi ${w.hi} vs on-chain ${onChainHi}`);
  const onChainLo = lucidMs(lucidSlot(w.from, PREPROD), PREPROD);
  t("A2c", "Notice lower bound is not moved below the requested time by slot rounding", onChainLo >= now, `requested ${now}, on-chain ${onChainLo}`);
  t("A2d", "Notice window keeps the requested TTL within one slot and under the 6 h script cap", w.hi - w.from <= 3600e3 && w.hi - w.from > 3600e3 - 2 * PREPROD.slotLength, `${w.hi - w.from} ms`);
}

// ---- A3: provenance must decode redeemers in both Conway encodings ----
function mkTx(useMap, constr) {
  const lock = { txHash: "aa".repeat(32), index: 0 }, fee = { txHash: "11".repeat(32), index: 3 };   // fee input sorts first
  const ins = CML.TransactionInputList.new();
  for (const i of [lock, fee]) ins.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(i.txHash), BigInt(i.index)));
  const addr = CML.EnterpriseAddress.new(0, CML.Credential.new_script(CML.ScriptHash.from_hex("5c".repeat(28)))).to_address();
  const outs = CML.TransactionOutputList.new(); outs.add(CML.TransactionOutput.new(addr, CML.Value.from_coin(1_000_000_000n)));
  const body = CML.TransactionBody.new(ins, outs, 300_000n);
  const data = CML.PlutusData.from_cbor_hex(Data.to(new Constr(constr, [])));
  const ex = CML.ExUnits.new(1_000_000n, 500_000_000n);
  let reds;
  if (useMap) { const m = CML.MapRedeemerKeyToRedeemerVal.new(); m.insert(CML.RedeemerKey.new(CML.RedeemerTag.Spend, 1n), CML.RedeemerVal.new(data, ex)); reds = CML.Redeemers.new_map_redeemer_key_to_redeemer_val(m); }
  else { const l = CML.LegacyRedeemerList.new(); l.add(CML.LegacyRedeemer.new(CML.RedeemerTag.Spend, 1n, data, ex)); reds = CML.Redeemers.new_arr_legacy_redeemer(l); }
  const ws = CML.TransactionWitnessSet.new(); ws.set_redeemers(reds);
  return { tx: CML.Transaction.new(body, ws, true, undefined), lock, addr: addr.to_bech32() };
}
for (const [fmt, useMap] of [["legacy array", false], ["Conway map", true]]) {
  const { tx, lock, addr } = mkTx(useMap, 2);
  const c = decodeCreating(tx, addr);
  const red = c.scriptRedeemers.find(r => r.txHash === lock.txHash && r.index === lock.index);
  const ctor = red ? (red.constr ?? red.tag) : undefined;
  t(`A3${useMap ? "b" : "a"}`, `${fmt} redeemers: the lock's Notice redeemer is found`, ctor === 2, JSON.stringify(c.scriptRedeemers));
}
{
  const { tx, lock, addr } = mkTx(true, 2);
  const c = decodeCreating(tx, addr);
  const datum = "d87980";
  const v = refundProvenance9({ refund: { txHash: "bb".repeat(32), outputIndex: 0, address: addr, datum, assets: { lovelace: 1_000_000_000n } }, creating: c, lock: { txHash: lock.txHash, outputIndex: lock.index },
    scriptAddr: addr, expectedDatum: datum, lovelace: 1_000_000_000n, confs: 15, K: 15 });
  t("A3c", "refundProvenance9 accepts a genuine Notice whose redeemers are map-encoded", v === null, v);
  const { tx: tx3 } = mkTx(true, 3);
  const v3 = refundProvenance9({ refund: { txHash: "bb".repeat(32), outputIndex: 0, address: addr, datum, assets: { lovelace: 1_000_000_000n } }, creating: decodeCreating(tx3, addr), lock: { txHash: lock.txHash, outputIndex: lock.index },
    scriptAddr: addr, expectedDatum: datum, lovelace: 1_000_000_000n, confs: 15, K: 15 });
  t("A3d", "…and still refuses when the lock was spent with another redeemer (RefundReveal = 3)", /redeemer Notice/.test(v3 ?? ""), v3);
}

// ---- A4: Commit depth unknown must not mean "never reveal" ----
{
  const K = 15, T3 = 7 * 86400e3, base = { K, T3, M: 54.9 * MIN, holdCapMs: P9.real.holdCapMs, lateCutoffMs: P9.real.lateCutoffMs, mempoolFill: 0, directStake: 1, commitSettledAt: 30 * MIN };
  const late = revealGate9({ ...base, commitConfs: undefined, commitSeenAt: 20 * MIN, now: T3 - P9.real.lateCutoffMs + MIN });
  t("A4a", "Commit seen in a block, depth now unknown, past the late cutoff: broadcast (GO-…)", /^GO/.test(late ?? ""), late);
  const race = revealGate9({ ...base, commitConfs: NaN, commitSeenAt: 20 * MIN, now: T3 - 10 * MIN });
  t("A4b", "…and past T3 − M: GO-RACE alarm, not REFUSE", /^GO-RACE/.test(race ?? ""), race);
  const early = revealGate9({ ...base, commitConfs: undefined, commitSeenAt: 20 * MIN, now: 2 * 86400e3 });
  t("A4c", "depth unknown before the cutoff: HOLD (wait for the data source), not a permanent REFUSE", /^HOLD/.test(early ?? ""), early);
  const never = revealGate9({ ...base, commitConfs: undefined, commitSeenAt: undefined, now: T3 - 10 * MIN });
  t("A4d", "Commit never seen in any block: still REFUSE (b must never go out without a Claimed escrow)", /^REFUSE/.test(never ?? ""), never);
  const shallow = revealGate9({ ...base, commitConfs: K - 1, commitSeenAt: 20 * MIN, now: T3 - 10 * MIN });
  t("A4e", "known depth < K: still REFUSE (the settlement rule is unchanged)", /^REFUSE/.test(shallow ?? ""), shallow);
}

const fails = out.filter(x => !x.ok);
console.log(`\n${out.length - fails.length}/${out.length} pass`);
fs.mkdirSync(path.join(ROOT, "results/step10"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "results/step10/fixes_test.results.json"), JSON.stringify(out, null, 1));
process.exit(fails.length ? 1 : 0);
