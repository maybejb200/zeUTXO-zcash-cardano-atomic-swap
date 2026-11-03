// zeUTXO path 1 step 2 — end-to-end simulated swaps (ZEC on a simulated Orchard node, ADA on a strict
// Lucid emulator). SIMULATOR ONLY: fresh in-run keys, no network, nothing real.
// Usage: node e2e.mjs [happy|refund|punish|setup|all]
import { Lucid, generateEmulatorAccountFromPrivateKey, Data, Constr, validatorToAddress, getAddressDetails, CML } from "@lucid-evolution/lucid";
import { StrictLedger, mainnetParams } from "./ledger.mjs";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const ZEC = path.join(ROOT, "zec/target/release/zec");
const RUNS = path.join(ROOT, "runs");
const bp = JSON.parse(fs.readFileSync(path.join(ROOT, "ada/onchain/plutus.json")));
const SCRIPT = { type: "PlutusV3", script: bp.validators.find(v => v.title === "escrow.escrow.spend").compiledCode };
const PP = mainnetParams();
const ADA_LOCK = 1_000_000_000n, ZEC_AMT = 50_000_000;
const DELTA = 60_000, T0_OFF = 150_000, T1_OFF = 250_000, T2_OFF = 350_000, ZDEPTH = 3;

// ---------- helpers ----------
function zec(args, allowFail = false) {
  const t = Date.now();
  try {
    const out = execFileSync(ZEC, args, { encoding: "utf8", maxBuffer: 1 << 26 });
    return { code: 0, ms: Date.now() - t, ...JSON.parse(out.trim().split("\n").pop()) };
  } catch (e) {
    if (!allowFail) throw new Error(`zec ${args[0]} failed: ${e.stdout} ${e.stderr}`);
    let j = {}; try { j = JSON.parse(String(e.stdout).trim().split("\n").pop()); } catch {}
    return { code: e.status, ms: Date.now() - t, ...j };
  }
}
const leHex = (n) => { let h = n.toString(16).padStart(64, "0"); return h.match(/../g).reverse().join(""); };
const leToBig = (h) => BigInt("0x" + h.match(/../g).reverse().join(""));
const pkhOf = (acct) => getAddressDetails(acct.address).paymentCredential.hash;
const rd = (f) => JSON.parse(fs.readFileSync(f));

class Results {
  constructor(name) { this.name = name; this.checks = []; this.costs = { cardano: [], zcash: [] }; this.notes = []; }
  rec(name, expect, ok, detail) { this.checks.push({ name, expect, ok, detail }); console.log(`  [${ok ? "ok" : "FAIL"}] ${name} (${expect}) ${detail ? "— " + String(detail).slice(0, 160) : ""}`); }
  get pass() { return this.checks.every(c => c.ok); }
}

// Run an action that MUST be rejected; anything accepted is a failure.
async function mustFail(R, name, fn) {
  try { const r = await fn(); if (r && r.rejected) { R.rec(name, "reject", true, r.reason); return; } R.rec(name, "reject", false, "ACCEPTED: " + JSON.stringify(r).slice(0, 200)); }
  catch (e) { R.rec(name, "reject", true, e.message); }
}

// ---------- swap environment ----------
async function newSwap(tag, opts = {}) {
  const dir = path.join(RUNS, `${tag}-${Date.now()}`); fs.mkdirSync(dir, { recursive: true });
  const swap = crypto.randomBytes(8).toString("hex");
  const k = {};
  for (const p of ["alice", "bob"]) k[p] = zec(["keygen", `dir=${dir}`, `party=${p}`, `swap=${swap}`, `cheat=${(opts.cheat || {})[p] || "none"}`]);
  for (const p of ["alice", "bob"]) zec(["reveal", `dir=${dir}`, `party=${p}`]);
  const A = generateEmulatorAccountFromPrivateKey({ lovelace: 2_000_000_000n });
  const B = generateEmulatorAccountFromPrivateKey({ lovelace: 300_000_000n });
  const L = new StrictLedger([A, B], PP);
  const lucid = await Lucid(L.em, "Custom");
  const scriptAddr = validatorToAddress("Custom", SCRIPT);
  return { dir, swap, k, A, B, L, lucid, scriptAddr, d: (...a) => [`dir=${dir}`, ...a] };
}
function doSetup(S, R) {
  const s = {};
  for (const p of ["alice", "bob"]) { s[p] = zec(["setup", ...S.d(`party=${p}`)], true); }
  return s;
}
async function as(S, acct) { S.lucid.selectWallet.fromPrivateKey(acct.privateKey); return S.lucid; }
function datumOf(S, over = {}) {
  const pa = rd(path.join(S.dir, "alice/pub.json")), pb = rd(path.join(S.dir, "bob/pub.json"));
  const f = { alice: pkhOf(S.A), bob: pkhOf(S.B), a_c: pa.Q, b_c: pb.Q, t1: BigInt(S.T1), t2: BigInt(S.T2), ...over };
  return Data.to(new Constr(0, [f.alice, f.bob, f.a_c, f.b_c, f.t1, f.t2]));
}
async function lock(S, R, over = {}) {
  const t0 = S.L.now(); S.T0 = t0 + T0_OFF; S.T1 = t0 + T1_OFF; S.T2 = t0 + T2_OFF;
  const lucid = await as(S, S.A);
  const tx = await lucid.newTx().pay.ToContract(S.scriptAddr, { kind: "inline", value: datumOf(S, over) }, { lovelace: ADA_LOCK }).complete();
  const r = await S.L.submit((await tx.sign.withWallet().complete()).toCBOR(), "lock");
  R.costs.cardano.push({ tx: "Lock", ...r.stats });
  S.L.awaitBlock(1);
  S.escrow = (await lucid.utxosAt(S.scriptAddr))[0];
  return r;
}
// Bob checks the lock before funding ZEC: right script, amount, and datum matching the DLEQ-verified points.
function bobChecksLock(S) {
  const u = S.escrow; if (!u) return "no escrow UTxO";
  const view = rd(path.join(S.dir, "bob/view.json"));
  const d = Data.from(u.datum);
  const [al, bo, ac, bc, t1, t2] = d.fields;
  if (u.address !== S.scriptAddr) return "wrong script";
  if (BigInt(u.assets.lovelace) !== ADA_LOCK) return "wrong ADA amount";
  if (al !== pkhOf(S.A) || bo !== pkhOf(S.B)) return "wrong parties";
  if (ac !== view.A_c || bc !== view.B_c) return "datum shares do not match DLEQ-verified points";
  if (Number(t1) !== S.T1 || Number(t2) !== S.T2 || Number(t2) - Number(t1) < DELTA + 1) return "wrong timelocks";
  return null;
}
function fundZec(S, R, pay = ZEC_AMT, mineN = ZDEPTH - 1) {
  zec(["genesis", ...S.d()]);
  const f = zec(["fund", ...S.d(`amount=${ZEC_AMT}`, `pay=${pay}`, `out=${S.dir}/fund.tx`)]);
  const s = zec(["submit", ...S.d(`tx=${S.dir}/fund.tx`)]);
  R.costs.zcash.push({ tx: "Fund (Bob → joint key)", bytes: f.info.bytes, actions: f.info.actions, fee_zats: f.info.fee_zats, prove_ms: f.info.prove_ms, verify_ms: s.verify_ms });
  if (mineN) zec(["mine", ...S.d(`n=${mineN}`)]);
  return s;
}
// Spend-side builders. cheatEval: force-build even if the script would fail (fixed exunits, no local eval).
async function build(S, acct, f, cheatEval = false) {
  const lucid = await as(S, acct);
  if (!cheatEval) return await f(lucid.newTx()).complete();
  const orig = S.L.em.evaluateTx;
  S.L.em.evaluateTx = async (tx, u) => (await orig.call(S.L.em, tx, u)).map(r => ({ ...r, ex_units: { mem: 3_000_000, steps: 1_500_000_000 } }));
  try { return await f(lucid.newTx()).complete({ localUPLCEval: false }); } finally { S.L.em.evaluateTx = orig; }
}
const Redeem = (b) => Data.to(new Constr(0, [b])), Refund = (a) => Data.to(new Constr(1, [a])), Punish = Data.to(new Constr(2, []));
const redeemTx = (S, b, { upper = S.T1 - 1000, aliceSigner = true } = {}) => (tx) => {
  let t = tx.collectFrom([S.escrow], Redeem(b)).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(S.B));
  if (aliceSigner) t = t.addSignerKey(pkhOf(S.A));
  if (upper !== null) t = t.validTo(upper);
  return t;
};
const refundTx = (S, a, from, signer) => (tx) => tx.collectFrom([S.escrow], Refund(a)).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.A)).validFrom(from);
const punishTx = (S, from, signer) => (tx) => tx.collectFrom([S.escrow], Punish).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.B)).validFrom(from);

// Alice's go-signature: she signs only the Redeem BODY after checking it cannot hurt her.
function aliceGoSign(S, bodyHex, force = false) {
  const body = CML.TransactionBody.from_cbor_hex(bodyHex);
  const refs = []; for (let i = 0; i < body.inputs().len(); i++) { const x = body.inputs().get(i); refs.push(x.transaction_id().to_hex() + "#" + x.index()); }
  const coll = body.collateral_inputs(); if (coll) for (let i = 0; i < coll.len(); i++) { const x = coll.get(i); refs.push(x.transaction_id().to_hex() + "#" + x.index()); }
  let reason = null;
  if (!refs.includes(S.escrow.txHash + "#" + S.escrow.outputIndex)) reason = "does not spend the escrow";
  for (const r of refs) { const [h, i] = r.split("#"); const e = S.L.entry(h + i); if (e && e.utxo.address === S.A.address) reason = "spends one of Alice's own UTxOs"; }
  const ttl = body.ttl();
  if (ttl === undefined || S.L.zeroTime + Number(ttl) * 1000 > S.T1 - 1) reason = reason ?? "upper bound missing or not before T1";
  if (S.L.now() >= S.T1 - DELTA / 2) reason = reason ?? "too close to T1";
  if (!fs.existsSync(path.join(S.dir, "alice/joint_note.json"))) reason = reason ?? "ZEC not seen at depth";
  if (reason && !force) return { refused: reason };
  const w = CML.make_vkey_witness(CML.hash_transaction(body), CML.PrivateKey.from_bech32(S.A.privateKey));
  const ws = CML.TransactionWitnessSet.new(); const l = CML.VkeywitnessList.new(); l.add(w); ws.set_vkeywitnesses(l);
  return { witness: ws.to_cbor_hex(), forced_despite: reason };
}
async function signSubmit(S, R, txb, acct, label, extraWitness = null) {
  let sb = extraWitness ? txb.assemble([extraWitness]) : txb;
  sb = sb.sign.withPrivateKey(acct.privateKey);
  const hex = (await sb.complete()).toCBOR();
  const r = await S.L.submit(hex, label);
  return r;
}
function sweep(S, R, party, extra, label, mustAccept = true) {
  const out = `${S.dir}/${label.replace(/\W+/g, "_")}.tx`;
  const b = zec(["sweep", ...S.d(`party=${party}`, `out=${out}`, ...extra)], true);
  if (b.code !== 0) return { rejected: true, reason: "sweeper refused: " + b.reason };
  const s = zec(["submit", ...S.d(`tx=${out}`)], true);
  if (s.code !== 0) return { rejected: true, reason: "node rejected: " + s.reason };
  R.costs.zcash.push({ tx: label, bytes: b.info.bytes, actions: b.info.actions, fee_zats: b.info.fee_zats, prove_ms: b.info.prove_ms, verify_ms: s.verify_ms });
  return { accepted: true, txid: s.txid };
}
const lovelaceAt = async (S, addr) => (await S.L.em.getUtxos(addr)).reduce((s, u) => s + BigInt(u.assets.lovelace), 0n);
function cardanoCost(R, label, r) { R.costs.cardano.push({ tx: label, ...r.stats }); }

// ---------- common start: keys, DLEQ, lock, ZEC funding ----------
async function start(tag, R) {
  const S = await newSwap(tag);
  R.costs.dleq = { proof_bytes: S.k.alice.dleq_bytes, prove_ms: S.k.alice.dleq_prove_ms };
  const st = doSetup(S, R);
  R.rec("setup: both parties verify the other's cross-group DLEQ + key-contribution reveal; same joint address", "accept",
        st.alice.ok && st.bob.ok && st.alice.addr_j === st.bob.addr_j, `σ=${st.alice.sigma}, DLEQ verify (both proofs) ${st.alice.dleq_verify_ms_both} ms`);
  await lock(S, R);
  const bad = bobChecksLock(S);
  R.rec("Bob checks Lock (script, amount, datum points = DLEQ points, T1/T2)", "accept", bad === null, bad);
  fundZec(S, R);
  const w = zec(["watch", ...S.d("party=alice", `amount=${ZEC_AMT}`, `min_depth=${ZDEPTH}`)], true);
  R.rec(`Alice sees ${ZEC_AMT} zats at the joint address, depth ≥ ${ZDEPTH}, before T0`, "accept", w.code === 0 && S.L.now() < S.T0, w.status);
  zec(["watch", ...S.d("party=bob", `amount=${ZEC_AMT}`, "min_depth=1")], true);
  return S;
}

// ---------- outcome (a): happy path ----------
async function happy() {
  const R = new Results("happy"); console.log("== (a) happy path");
  const S = await start("happy", R);
  const bobX = leToBig(rd(path.join(S.dir, "bob/secret.json")).x);
  // cheats before Redeem
  await mustFail(R, "Alice tries to take the ZEC with her share a only", () => sweep(S, R, "alice", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_alice_one_share"));
  await mustFail(R, "Bob Redeems with a wrong b (b+1), Alice's go-sig attached", async () => {
    const t = await build(S, S.B, redeemTx(S, bobX + 1n), true); const g = aliceGoSign(S, t.toTransaction().body().to_cbor_hex());
    if (g.refused) return { rejected: true, reason: "alice refused: " + g.refused }; return signSubmit(S, R, t, S.B, "cheat_wrong_b", g.witness); });
  await mustFail(R, "Bob Redeems without Alice's go-signature (Alice not a required signer)", async () => {
    const t = await build(S, S.B, redeemTx(S, bobX, { aliceSigner: false }), true); return signSubmit(S, R, t, S.B, "cheat_no_gosig"); });
  await mustFail(R, "Bob Redeems with Alice listed as signer but no Alice witness", async () => {
    const t = await build(S, S.B, redeemTx(S, bobX)); return signSubmit(S, R, t, S.B, "cheat_missing_witness"); });
  for (const [nm, up] of [["upper bound after T1 (T1+60 s)", S.T1 + 60_000], ["no upper bound", null]]) {
    await mustFail(R, `Bob Redeem with ${nm}: Alice refuses to go-sign`, async () => {
      const t = await build(S, S.B, redeemTx(S, bobX, { upper: up }), true); const g = aliceGoSign(S, t.toTransaction().body().to_cbor_hex());
      return g.refused ? { rejected: true, reason: g.refused } : { accepted: true }; });
    await mustFail(R, `Bob Redeem with ${nm}, go-sig forced anyway: script rejects`, async () => {
      const t = await build(S, S.B, redeemTx(S, bobX, { upper: up }), true); const g = aliceGoSign(S, t.toTransaction().body().to_cbor_hex(), true);
      return signSubmit(S, R, t, S.B, "cheat_late_upper", g.witness); });
  }
  await mustFail(R, "Bob asks Alice to go-sign a body that also spends Alice's own UTxO", async () => {
    const aU = (await S.L.em.getUtxos(S.A.address))[0];
    const t = await build(S, S.B, (tx) => redeemTx(S, bobX)(tx).collectFrom([aU]).addSignerKey(pkhOf(S.A)));
    const g = aliceGoSign(S, t.toTransaction().body().to_cbor_hex()); return g.refused ? { rejected: true, reason: g.refused } : { accepted: true }; });
  await mustFail(R, "Alice Refunds early (validFrom now < T1): script rejects", async () => {
    const t = await build(S, S.A, refundTx(S, leToBig(rd(path.join(S.dir, "alice/secret.json")).x), S.L.now()), true); return signSubmit(S, R, t, S.A, "cheat_early_refund"); });
  await mustFail(R, "Alice submits a Refund valid only from T1 before T1: ledger rejects", async () => {
    const t = await build(S, S.A, refundTx(S, leToBig(rd(path.join(S.dir, "alice/secret.json")).x), S.T1)); return signSubmit(S, R, t, S.A, "cheat_refund_not_yet_valid"); });
  await mustFail(R, "Bob Punishes before T2 (validFrom now): script rejects", async () => {
    const t = await build(S, S.B, punishTx(S, S.L.now()), true); return signSubmit(S, R, t, S.B, "cheat_early_punish"); });
  // honest Redeem
  const t = await build(S, S.B, redeemTx(S, bobX));
  const g = aliceGoSign(S, t.toTransaction().body().to_cbor_hex());
  R.rec("Alice checks and go-signs the Redeem body (b not visible to her)", "accept", !!g.witness, g.refused);
  const safe = S.L.now() + DELTA <= S.T1 - 1000;
  R.rec("Bob broadcasts Redeem only while now + Δ ≤ T1 − 1 s (so b is never public without the Redeem confirming)", "accept", safe, `${(S.T1 - S.L.now()) / 1000} s before T1`);
  const r = await signSubmit(S, R, t, S.B, "redeem", g.witness);
  cardanoCost(R, "Redeem (Bob, reveals b)", r);
  R.rec("Bob's Redeem accepted (b·G1 = B_c checked on-chain, before T1)", "accept", !!r.txHash, `slot ${S.L.slot()}, T1 slot ${S.L.slotOf(S.T1)}`);
  S.L.awaitBlock(1);
  // Alice learns b from the chain
  const sp = S.L.spendingRedeemer(S.escrow.txHash, S.escrow.outputIndex);
  const b = sp.redeemer.fields[0];
  const bHex = leHex(b);
  const pt = zec(["share-point", `share=${bHex}`, `P=${rd(path.join(S.dir, "alice/view.json")).B_p}`]);
  R.rec("Alice extracts b from the Redeem redeemer; b·G(Pallas) = Bob's DLEQ-linked point", "accept", pt.ok);
  await mustFail(R, "Alice sweeps with a wrong share (b+1): her tool refuses", () => sweep(S, R, "alice", [`other_share=${leHex(b + 1n)}`], "cheat_wrong_share_refuse"));
  await mustFail(R, "Alice forces a sweep signed with wrong share: node rejects", () => sweep(S, R, "alice", ["cheat=wrong_share", `other_share=${bHex}`], "cheat_wrong_share_forced"));
  await mustFail(R, "Alice's sweep without ỹ-negation (σ dropped): node rejects", () => sweep(S, R, "alice", ["cheat=no_negation", `other_share=${bHex}`], "cheat_no_negation"));
  await mustFail(R, "sweep signature over a different sighash: node rejects", () => sweep(S, R, "alice", ["cheat=wrong_sighash", `other_share=${bHex}`], "cheat_wrong_sighash"));
  await mustFail(R, "sweep with tampered Halo2 proof: node rejects", () => sweep(S, R, "alice", ["cheat=tamper_proof", `other_share=${bHex}`], "cheat_tamper_proof"));
  await mustFail(R, "Bob tries to take the ZEC back with b only", () => sweep(S, R, "bob", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_bob_one_share"));
  // alternative signing modes (validity only, not mined)
  for (const m of ["joint", "adaptor"]) {
    const o = `${S.dir}/alt_${m}.tx`; const bb = zec(["sweep", ...S.d("party=alice", `mode=${m}`, `out=${o}`)]); const c = zec(["check", ...S.d(`tx=${o}`)], true);
    R.rec(`alternative: ${m === "joint" ? "2-party joint" : "adaptor-completed"} signature on the sweep verifies (not mined)`, "accept", c.code === 0, c.reason);
  }
  const sw = sweep(S, R, "alice", [`other_share=${bHex}`], "Sweep (Alice, a+b)");
  R.rec("Alice's real Orchard sweep with σ(a+b) accepted", "accept", !!sw.accepted, sw.reason);
  await mustFail(R, "a second spend of the already-swept joint note (double spend)", async () => {
    const o = `${S.dir}/alt_joint.tx`; const c = zec(["submit", ...S.d(`tx=${o}`)], true); return c.code === 0 ? { accepted: true } : { rejected: true, reason: c.reason }; });
  S.L.awaitSlot(S.L.slotOf(S.T1) - S.L.slot() + 1);
  await mustFail(R, "Alice tries to Refund after Bob redeemed (after T1)", async () => {
    const t = await build(S, S.A, refundTx(S, leToBig(rd(path.join(S.dir, "alice/secret.json")).x), S.T1), true); return signSubmit(S, R, t, S.A, "cheat_refund_after_redeem"); });
  const ab = zec(["balance", ...S.d("party=alice")]);
  const bobAda = await lovelaceAt(S, S.B.address);
  R.rec("final: Alice holds the ZEC (0.5 ZEC − fee) in her own wallet", "accept", ab.unspent_zats === ZEC_AMT - 10000, `${ab.unspent_zats} zats`);
  R.rec("final: Bob holds the ADA (≈ +1000 ADA − fees)", "accept", bobAda > 300_000_000n + ADA_LOCK - 2_000_000n, `${Number(bobAda) / 1e6} ADA`);
  return { R, S };
}

// ---------- outcome (b): Refund ----------
async function refund() {
  const R = new Results("refund"); console.log("== (b) refund path (Bob does not redeem before T1)");
  const S = await start("refund", R);
  const aliceX = leToBig(rd(path.join(S.dir, "alice/secret.json")).x), bobX = leToBig(rd(path.join(S.dir, "bob/secret.json")).x);
  // Bob obtains a go-signed Redeem body early but sits on it.
  const stale = await build(S, S.B, redeemTx(S, bobX)); const g = aliceGoSign(S, stale.toTransaction().body().to_cbor_hex());
  await mustFail(R, "Alice Refunds before T1: script rejects", async () => { const t = await build(S, S.A, refundTx(S, aliceX, S.L.now()), true); return signSubmit(S, R, t, S.A, "cheat_early_refund"); });
  S.L.awaitSlot(S.L.slotOf(S.T1) - S.L.slot());
  await mustFail(R, "Bob submits his go-signed Redeem after T1: ledger rejects (expired)", () => signSubmit(S, R, stale, S.B, "cheat_stale_redeem", g.witness));
  await mustFail(R, "Bob builds a fresh Redeem after T1 (go-sig forced): script rejects", async () => {
    const t = await build(S, S.B, redeemTx(S, bobX, { upper: S.L.now() + 60_000 }), true); const w = aliceGoSign(S, t.toTransaction().body().to_cbor_hex(), true); return signSubmit(S, R, t, S.B, "cheat_late_redeem", w.witness); });
  await mustFail(R, "Bob Punishes between T1 and T2: script rejects", async () => { const t = await build(S, S.B, punishTx(S, S.L.now()), true); return signSubmit(S, R, t, S.B, "cheat_punish_t1_t2"); });
  await mustFail(R, "Alice Refunds with a wrong a (a+1): script rejects", async () => { const t = await build(S, S.A, refundTx(S, aliceX + 1n, S.T1), true); return signSubmit(S, R, t, S.A, "cheat_wrong_a"); });
  await mustFail(R, "Alice Refunds with a + r (BLS group order; same point, out of range): script rejects", async () => {
    const r = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n; const t = await build(S, S.A, refundTx(S, aliceX + r, S.T1), true); return signSubmit(S, R, t, S.A, "cheat_a_plus_r"); });
  const t = await build(S, S.A, refundTx(S, aliceX, S.T1));
  const r = await signSubmit(S, R, t, S.A, "refund");
  cardanoCost(R, "Refund (Alice, reveals a)", r);
  R.rec("Alice's Refund accepted at/after T1 (a·G1 = A_c checked on-chain)", "accept", !!r.txHash, `slot ${S.L.slot()}`);
  S.L.awaitBlock(1);
  const sp = S.L.spendingRedeemer(S.escrow.txHash, S.escrow.outputIndex);
  const a = sp.redeemer.fields[0]; const aHex = leHex(a);
  R.rec("Bob extracts a from the Refund redeemer; a·G(Pallas) = Alice's point", "accept", zec(["share-point", `share=${aHex}`, `P=${rd(path.join(S.dir, "bob/view.json")).A_p}`]).ok);
  await mustFail(R, "Alice tries to keep the ZEC too, with a only", () => sweep(S, R, "alice", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_alice_one_share"));
  const sw = sweep(S, R, "bob", [`other_share=${aHex}`], "Sweep (Bob, a+b, takes ZEC back)");
  R.rec("Bob's real Orchard sweep with σ(a+b) accepted (ZEC back)", "accept", !!sw.accepted, sw.reason);
  S.L.awaitSlot(S.L.slotOf(S.T2) - S.L.slot() + 1);
  await mustFail(R, "Bob Punishes after T2 although Alice refunded: escrow already spent", async () => { const t = await build(S, S.B, punishTx(S, S.T2), true); return signSubmit(S, R, t, S.B, "cheat_punish_after_refund"); });
  const bb = zec(["balance", ...S.d("party=bob")]);
  const aliceAda = await lovelaceAt(S, S.A.address);
  R.rec("final: Bob holds his ZEC again (change + swept note)", "accept", bb.unspent_zats === 100_000_000 - 20_000, `${bb.unspent_zats} zats`);
  R.rec("final: Alice holds her ADA again (≈ 2000 ADA − fees)", "accept", aliceAda > 2_000_000_000n - 3_000_000n, `${Number(aliceAda) / 1e6} ADA`);
  return { R, S };
}

// ---------- outcome (c): Punish (Alice silent after ZEC is locked) ----------
async function punish() {
  const R = new Results("punish"); console.log("== (c) punish path (Alice silent)");
  const S = await start("punish", R);
  const bobX = leToBig(rd(path.join(S.dir, "bob/secret.json")).x);
  await mustFail(R, "Bob tries to take the ZEC back with b only", () => sweep(S, R, "bob", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_bob_one_share"));
  S.L.awaitSlot(S.L.slotOf(S.T1) - S.L.slot() + 5);
  await mustFail(R, "Bob Punishes after T1 but before T2: script rejects", async () => { const t = await build(S, S.B, punishTx(S, S.L.now()), true); return signSubmit(S, R, t, S.B, "cheat_early_punish"); });
  await mustFail(R, "Bob tries a Refund with a guessed a, signing himself: script rejects", async () => {
    const t = await build(S, S.B, refundTx(S, BigInt("0x" + crypto.randomBytes(31).toString("hex")), S.T1, S.B), true); return signSubmit(S, R, t, S.B, "cheat_bob_refund"); });
  await mustFail(R, "Bob submits a Punish valid from T2 before T2: ledger rejects", async () => { const t = await build(S, S.B, punishTx(S, S.T2)); return signSubmit(S, R, t, S.B, "cheat_punish_not_yet_valid"); });
  S.L.awaitSlot(S.L.slotOf(S.T2) - S.L.slot());
  const C = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
  await mustFail(R, "a third party (not Bob) tries Punish after T2: script rejects", async () => { const t = await build(S, S.A, punishTx(S, S.T2, S.A), true); return signSubmit(S, R, t, S.A, "cheat_punish_not_bob"); });
  const t = await build(S, S.B, punishTx(S, S.T2));
  const r = await signSubmit(S, R, t, S.B, "punish");
  cardanoCost(R, "Punish (Bob, after T2)", r);
  R.rec("Bob's Punish accepted at T2 (takes the ADA)", "accept", !!r.txHash, `slot ${S.L.slot()}, T2 slot ${S.L.slotOf(S.T2)}`);
  S.L.awaitBlock(1);
  await mustFail(R, "Alice wakes up late and tries to Refund after Punish", async () => {
    const t = await build(S, S.A, refundTx(S, leToBig(rd(path.join(S.dir, "alice/secret.json")).x), S.T1), true); return signSubmit(S, R, t, S.A, "cheat_late_refund"); });
  await mustFail(R, "after Punish, Bob still cannot move the ZEC (b only)", () => sweep(S, R, "bob", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_bob_one_share_after"));
  const w = zec(["watch", ...S.d("party=bob", `amount=${ZEC_AMT}`, "min_depth=1")], true);
  const bobAda = await lovelaceAt(S, S.B.address);
  R.rec("final: Bob holds the ADA (≈ +1000 ADA − fees)", "accept", bobAda > 300_000_000n + ADA_LOCK - 2_000_000n, `${Number(bobAda) / 1e6} ADA`);
  R.rec("final: the 0.5 ZEC stays locked and unspent at the joint key (accepted trade-off)", "accept", w.code === 0 && w.status === "funded_ok", w.status);
  return { R, S };
}

// ---------- setup-phase cheats ----------
async function setupCheats() {
  const R = new Results("setup"); console.log("== setup-phase cheats");
  for (const [c, nm] of [["tamper", "corrupted DLEQ proof"], ["shifted", "F7 shifted-points DLEQ (blinders not cancelling)"], ["mismatch", "BLS point not matching the Pallas point"], ["wrongctx", "DLEQ proof bound to the other role (replay)"]]) {
    const S = await newSwap(`setup-${c}`, { cheat: { bob: c } });
    const s = zec(["setup", ...S.d("party=alice")], true);
    R.rec(`Bob publishes ${nm}: Alice aborts before locking anything`, "reject", s.code !== 0, s.reason);
  }
  { const S = await newSwap("setup-reveal");
    fs.writeFileSync(path.join(S.dir, "bob/reveal.json"), JSON.stringify({ contrib: crypto.randomBytes(32).toString("hex") }));
    const s = zec(["setup", ...S.d("party=alice")], true);
    R.rec("Bob changes his nk/rivk contribution after committing: Alice aborts", "reject", s.code !== 0, s.reason); }
  { const S = await newSwap("setup-datum"); doSetup(S, R);
    await lock(S, R, { b_c: rd(path.join(S.dir, "alice/pub.json")).Q });
    const bad = bobChecksLock(S);
    R.rec("Alice locks with a datum whose B_c is not Bob's DLEQ point: Bob refuses to fund ZEC", "reject", bad !== null, bad);
    const S2 = await newSwap("setup-timelock"); doSetup(S2, R); await lock(S2, R, { t2: BigInt(0) });
    const bad2 = bobChecksLock(S2); S2.T2 = S2.T2; R.rec("Alice locks with wrong T2: Bob refuses to fund ZEC", "reject", bad2 !== null, bad2); }
  { const S = await newSwap("setup-amount"); doSetup(S, R); await lock(S, R); fundZec(S, R, ZEC_AMT - 10_000_000);
    const w = zec(["watch", ...S.d("party=alice", `amount=${ZEC_AMT}`, `min_depth=${ZDEPTH}`)], true);
    const t = await build(S, S.B, redeemTx(S, leToBig(rd(path.join(S.dir, "bob/secret.json")).x))); const g = aliceGoSign(S, t.toTransaction().body().to_cbor_hex());
    R.rec("Bob funds less ZEC than agreed: Alice's watcher flags it and she withholds the go-signature", "reject", w.code !== 0 && !!g.refused, `${w.status}; ${g.refused}`); }
  { const S = await newSwap("setup-shallow"); doSetup(S, R); await lock(S, R); fundZec(S, R, ZEC_AMT, 0);
    const w = zec(["watch", ...S.d("party=alice", `amount=${ZEC_AMT}`, `min_depth=${ZDEPTH}`)], true);
    R.rec("ZEC funding not yet deep enough: Alice waits (no go-signature)", "reject", w.code !== 0 && w.status === "too_shallow", w.status); }
  return { R };
}

const which = process.argv[2] || "all";
const all = { happy, refund, punish, setup: setupCheats };
const out = {};
const t0 = Date.now();
for (const [k, f] of Object.entries(all)) {
  if (which !== "all" && which !== k) continue;
  const { R, S } = await f();
  out[k] = { pass: R.pass, checks: R.checks, costs: R.costs, run_dir: S?.dir, rejected_cardano: S?.L.rejected.length };
  console.log(`== ${k}: ${R.pass ? "PASS" : "FAIL"} (${R.checks.filter(c => c.ok).length}/${R.checks.length} checks)`);
}
out.elapsed_s = (Date.now() - t0) / 1000;
fs.mkdirSync(path.join(ROOT, "results"), { recursive: true });
const f = path.join(ROOT, "results", `e2e-${which}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(f, JSON.stringify(out, (k, v) => typeof v === "bigint" ? Number(v) : v, 2));
console.log("results:", f);
