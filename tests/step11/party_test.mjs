// Step 11 unit tests (Nov 9 2026 assessment): W-1 verified secret watchers, W-2 redeemer/input pairing, and the per-party
// view + durable state (item 4), including the watcher running as a SEPARATE PROCESS per party.
// Run: node tests/step11/party_test.mjs   (needs `npm ci` in src/ada). Exit code 1 if any test fails.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { bls12_381 } from "../../src/ada/node_modules/@noble/curves/esm/bls12-381.js";
import { CML, Data, Constr } from "../../src/ada/chaintx.mjs";
import { shareMatches, revealedShare, spendRedeemer, sortedInputs, SHARE_BOUND, REVEAL, REFUND_REVEAL } from "../../src/ada/watch.mjs";
import { PartyStore, PartyView } from "../../src/ada/party.mjs";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const out = [];
const t = (id, name, ok, detail) => { out.push({ id, name, ok: !!ok, detail: String(detail ?? "") }); console.log(`${ok ? "[pass]" : "[FAIL]"} ${id} ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`); };
const threw = (f) => { try { f(); return null; } catch (e) { return String(e.message); } };

const pt = (x) => Buffer.from(bls12_381.G1.ProjectivePoint.BASE.multiply(x).toRawBytes(true)).toString("hex");
const b = 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdn, a = 0x0fedcba987654321fedcba987654321fedcba987654321fedcba9876543n;
const B_c = pt(b), A_c = pt(a);
const ref = (h, i = 0) => ({ txHash: h.repeat(32), outputIndex: i });
const SCRIPT_ADDR = "addr_test1wqag3rt979nep9g2wtdwu8mr4gz6m4kjdpp5zp705km8wys6t2kla";   // any script address (outputs are not inspected)
/** A tx spending `spends` (in that body order) with one Spend redeemer each; map- or legacy-array-encoded. */
function tx(spends, { legacy = false } = {}) {
  const ins = CML.TransactionInputList.new(); for (const s of spends) ins.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(s.ref.txHash), BigInt(s.ref.outputIndex)));
  const outs = CML.TransactionOutputList.new(); outs.add(CML.TransactionOutput.new(CML.Address.from_bech32(SCRIPT_ADDR), CML.Value.from_coin(2_000_000n)));
  const sorted = spends.map(s => s.ref).sort((p, q) => p.txHash < q.txHash ? -1 : p.txHash > q.txHash ? 1 : p.outputIndex - q.outputIndex);
  const ws = CML.TransactionWitnessSet.new(), ex = CML.ExUnits.new(1_000_000n, 500_000_000n);
  if (legacy) { const l = CML.LegacyRedeemerList.new(); for (const s of spends) l.add(CML.LegacyRedeemer.new(CML.RedeemerTag.Spend, BigInt(sorted.indexOf(s.ref)), CML.PlutusData.from_cbor_hex(Data.to(s.red)), ex)); ws.set_redeemers(CML.Redeemers.new_arr_legacy_redeemer(l)); }
  else { const m = CML.MapRedeemerKeyToRedeemerVal.new(); for (const s of spends) m.insert(CML.RedeemerKey.new(CML.RedeemerTag.Spend, BigInt(sorted.indexOf(s.ref))), CML.RedeemerVal.new(CML.PlutusData.from_cbor_hex(Data.to(s.red)), ex)); ws.set_redeemers(CML.Redeemers.new_map_redeemer_key_to_redeemer_val(m)); }
  return CML.Transaction.new(CML.TransactionBody.new(ins, outs, 300_000n), ws, true, undefined).to_cbor_hex();
}
const reveal = (x, h = "c1", o) => tx([{ ref: ref(h), red: new Constr(REVEAL, [x]) }], o);
const refundReveal = (x, h = "c2", o) => tx([{ ref: ref(h), red: new Constr(REFUND_REVEAL, [x]) }], o);

// ---- W-1: the share test is the escrow's own (0 < x < 2^252, x·G1 = datum point) ----
t("W1a", "shareMatches accepts the real share for its point", shareMatches(b, B_c) && shareMatches(a, A_c));
t("W1b", "…and rejects a junk integer, the other party's share, 0, negatives, x ≥ 2^252 and non-integers", ![12345n, a, 0n, -b, SHARE_BOUND, b + SHARE_BOUND, Number(1), "1", null].some(x => shareMatches(x, B_c)));
t("W1c", "…and fails closed on a malformed point (wrong length, not hex, not on the curve)", !shareMatches(b, B_c.slice(2)) && !shareMatches(b, "zz".repeat(48)) && !shareMatches(b, "ff".repeat(48)) && !shareMatches(b, undefined));
t("W1d", "an upper-case point encoding is the same point", shareMatches(b, B_c.toUpperCase()));
t("W1e", "revealedShare ignores a decoy Reveal{12345}: nothing was seen", revealedShare([reveal(12345n, "d0")], REVEAL, B_c) === null);
t("W1f", "a decoy seen BEFORE the real Reveal cannot hide it (map and legacy encodings)", revealedShare([reveal(777n, "d0"), reveal(b)], REVEAL, B_c) === b && revealedShare([{ txHex: reveal(777n, "d0", { legacy: true }) }, { txHex: reveal(b, "c1", { legacy: true }) }], REVEAL, B_c) === b);
t("W1g", "the right integer under the WRONG constructor is not a reveal (Alice does not take b from a RefundReveal-shaped redeemer)", revealedShare([refundReveal(b)], REVEAL, B_c) === null && revealedShare([reveal(a)], REFUND_REVEAL, A_c) === null);
t("W1h", "Bob's side: a from a RefundReveal{a}; Alice's own share a is never returned as b", revealedShare([refundReveal(777n, "d1"), refundReveal(a)], REFUND_REVEAL, A_c) === a && revealedShare([reveal(a)], REVEAL, B_c) === null);
t("W1i", "garbage in the feed (not a tx, a tx without redeemers) is skipped, not fatal", revealedShare(["00", "zz", { txHex: "84" }, reveal(b)], REVEAL, B_c) === b);

// ---- W-2: Spend redeemers pair with inputs in SORTED order; no fallback to another redeemer ----
{
  const lo = ref("01"), hi = ref("fe"), same1 = ref("77", 1), same0 = ref("77", 0);
  const x = tx([{ ref: hi, red: new Constr(REVEAL, [b]) }, { ref: lo, red: new Constr(5, []) }]);   // body order hi, lo; sorted lo, hi
  t("W2a", "body order ≠ sorted order: each input gets its own redeemer", spendRedeemer(x, hi)?.index === REVEAL && spendRedeemer(x, hi).fields[0] === b && spendRedeemer(x, lo)?.index === 5, JSON.stringify(sortedInputs(x).map(i => i.txHash.slice(0, 2))));
  const y = tx([{ ref: same1, red: new Constr(4, []) }, { ref: same0, red: new Constr(2, []) }], { legacy: true });
  t("W2b", "same tx hash, different output index: ordered by index (legacy array)", spendRedeemer(y, same0)?.index === 2 && spendRedeemer(y, same1)?.index === 4);
  t("W2c", "an outref the tx does not spend: null", spendRedeemer(x, ref("ab")) === null);
  // a tx spending (lo, hi) that carries a redeemer only for hi (index 1): lo is a key-locked fee input
  const ins = [{ ref: hi, red: new Constr(REVEAL, [b]) }]; const z0 = CML.Transaction.from_cbor_hex(tx(ins));
  const il = CML.TransactionInputList.new(); il.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(hi.txHash), 0n)); il.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(lo.txHash), 0n));
  const m = CML.MapRedeemerKeyToRedeemerVal.new(); m.insert(CML.RedeemerKey.new(CML.RedeemerTag.Spend, 1n), CML.RedeemerVal.new(CML.PlutusData.from_cbor_hex(Data.to(new Constr(REVEAL, [b]))), CML.ExUnits.new(1n, 1n)));
  const ws = CML.TransactionWitnessSet.new(); ws.set_redeemers(CML.Redeemers.new_map_redeemer_key_to_redeemer_val(m));
  const z = CML.Transaction.new(CML.TransactionBody.new(il, z0.body().outputs(), 300_000n), ws, true, undefined).to_cbor_hex();
  t("W2d", "an input with NO redeemer (a key-locked fee input) gets null, not the tx's first redeemer", spendRedeemer(z, lo) === null && spendRedeemer(z, hi)?.fields[0] === b);
}

// ---- item 4: per-party durable state and view ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeutxo-party-"));
const dirA = path.join(tmp, "alice"), dirB = path.join(tmp, "bob");
{
  const st = new PartyStore(dirA);
  t("P1a", "an absent state file reads as empty", st.get("k") === undefined && JSON.stringify(st.load()) === "{}");
  st.set("k", { v: 1 }); st.set("k2", "x");
  t("P1b", "values survive a reload from disk (a new store object, as after a restart)", new PartyStore(dirA).get("k").v === 1 && new PartyStore(dirA).get("k2") === "x");
  t("P1c", "writes are atomic: no temp file is left behind", fs.readdirSync(dirA).every(f => !/\.tmp-/.test(f)), fs.readdirSync(dirA).join(","));
  fs.writeFileSync(path.join(dirA, "bad.json"), "{ not json");
  t("P1d", "a corrupt state file is refused loudly, never read as empty", /unreadable/.test(threw(() => new PartyStore(dirA, "bad.json").load()) ?? ""));
  fs.rmSync(dirA, { recursive: true });
}
{
  let feedA = [reveal(777n, "d0")];
  const alice = () => new PartyView({ role: "alice", dir: dirA, otherPoint: B_c, feed: () => feedA });
  t("P2a", "Alice's view: only a decoy in her feed → b not seen, nothing saved", alice().otherShare() === null && !fs.existsSync(path.join(dirA, "state.json")));
  feedA = [...feedA, reveal(b)];
  t("P2b", "the real Reveal reaches her feed → she has b, and it is on disk", alice().otherShare() === b && JSON.parse(fs.readFileSync(path.join(dirA, "state.json"))).other_share.x === b.toString(16));
  feedA = [];
  t("P2c", "after a restart with an EMPTY feed (tx dropped from her mempool) she still has b from her saved state", alice().otherShare() === b && alice().sawOtherShare());
  let feedB = [];
  const bob = () => new PartyView({ role: "bob", dir: dirB, otherPoint: A_c, feed: () => feedB });
  t("P2d", "views are separate: Bob, with his own feed and directory, has seen nothing although Alice has", bob().otherShare() === null && !fs.existsSync(path.join(dirB, "state.json")));
  feedB = [reveal(b), refundReveal(a)];
  t("P2e", "Bob's view takes a from a RefundReveal{a} and ignores the Reveal{b} in the same feed", bob().otherShare() === a);
  const f = path.join(dirA, "state.json"), good = fs.readFileSync(f, "utf8"), sv = JSON.parse(good);
  fs.writeFileSync(f, JSON.stringify({ ...sv, other_share: { ...sv.other_share, x: (12345n).toString(16) } }));
  t("P2f", "a tampered saved share (does not open B_c) is refused, not handed to the sweep", /REFUSE: saved counterparty share/.test(threw(() => alice().otherShare()) ?? ""));
  fs.writeFileSync(f, JSON.stringify({ ...sv, other_share: { ...sv.other_share, point: A_c } }));
  t("P2g", "a saved share recorded for ANOTHER swap's point is refused", /REFUSE: saved counterparty share/.test(threw(() => alice().otherShare()) ?? ""));
  fs.writeFileSync(f, good);
  t("P2h", "constructor refuses a missing/malformed point, role or feed", [() => new PartyView({ role: "alice", dir: dirA, otherPoint: "00", feed: () => [] }), () => new PartyView({ role: "carol", dir: dirA, otherPoint: B_c, feed: () => [] }), () => new PartyView({ role: "bob", dir: dirB, otherPoint: A_c })].every(f => threw(f) !== null));
}

// ---- item 4: the watcher as a separate OS process per party, each with only its own directory and feed file ----
{
  const cli = path.join(ROOT, "src/ada/party_watch_cli.mjs");
  const run = (role, dir, point, feed) => { try { return { code: 0, ...JSON.parse(execFileSync(process.execPath, [cli, `role=${role}`, `dir=${dir}`, `point=${point}`, `feed=${feed}`], { encoding: "utf8" })) }; } catch (e) { return { code: e.status, ...JSON.parse(e.stdout || "{}") }; } };
  const pa = path.join(tmp, "p-alice"), pb = path.join(tmp, "p-bob"); fs.mkdirSync(pa); fs.mkdirSync(pb);
  const fa = path.join(pa, "seen.txt"), fb = path.join(pb, "seen.txt");
  fs.writeFileSync(fa, reveal(12345n, "d0") + "\n"); fs.writeFileSync(fb, "");
  const r1 = run("alice", pa, B_c, fa); t("X1a", "Alice's process, decoy only: share null", r1.code === 0 && r1.share === null, JSON.stringify(r1));
  fs.appendFileSync(fa, reveal(b) + "\n");
  const r2 = run("alice", pa, B_c, fa); t("X1b", "Alice's process after the real Reveal reaches HER feed: b", r2.share === b.toString(16), JSON.stringify(r2).slice(0, 80));
  const r3 = run("bob", pb, A_c, fb); t("X1c", "Bob's process (own directory, own empty feed) still sees nothing", r3.code === 0 && r3.share === null, JSON.stringify(r3));
  fs.writeFileSync(fa, "");
  const r4 = run("alice", pa, B_c, fa); t("X1d", "Alice's process killed and restarted with an empty feed: b comes back from her saved state", r4.share === b.toString(16));
  fs.writeFileSync(path.join(pa, "state.json"), "{ truncated");
  const r5 = run("alice", pa, B_c, fa); t("X1e", "a corrupt state file: the process refuses (exit 2), it does not report 'not seen'", r5.code === 2 && /unreadable/.test(r5.refused ?? ""), JSON.stringify(r5).slice(0, 120));
}
fs.rmSync(tmp, { recursive: true, force: true });

const fails = out.filter(o => !o.ok);
console.log(`${out.length - fails.length}/${out.length} pass`);
process.exit(fails.length ? 1 : 0);
