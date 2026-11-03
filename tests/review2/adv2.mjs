// zeUTXO path 1 step 4 (L-1: setup proofs bound to a per-swap transcript; two-round setup) on top of step 3 — end-to-end simulated swaps with the go-MESSAGE design, the settlement-aware timing rule,
// live Zcash depth checks, expiry heights, rollbacks/reorgs/param changes. SIMULATOR ONLY: fresh in-run keys,
// no network, nothing real. Usage: node e2e3.mjs [l1|happy|refund|punish|setup|c1fee|c1cost|c2|c3|rbredeem|rbrefund|zreorg|zexpiry|gomsg|all]
import { Lucid, generateEmulatorAccountFromPrivateKey, Data, Constr, validatorToAddress, getAddressDetails, CML, createCostModels } from "@lucid-evolution/lucid";
import { StrictLedger, mainnetParams } from "./ledger.mjs";
import { goMsg, goKeygen, goSign, goVerify } from "./gomsg.mjs";
import { execFileSync } from "child_process";
import fs from "fs"; import path from "path"; import crypto from "crypto";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const ZEC = path.join(ROOT, "zec/target/release/zec");
const RUNS = path.join(ROOT, "runs");
const bp = JSON.parse(fs.readFileSync(path.join(ROOT, "ada/onchain/plutus.json")));
const V = bp.validators.find(v => v.title === "escrow.escrow.spend");
const SCRIPT = { type: "PlutusV3", script: V.compiledCode }, SCRIPT_HASH = V.hash;
const PP0 = mainnetParams();
const ADA_LOCK = 1_000_000_000n, ZEC_AMT = 50_000_000, NETWORK_ID = 0;
// ---- timing rule (spec v0.2 §T; derived in model/foc_model3.py) ----
// blocks every 20 s. D = inclusion bound (adversary may delay a valid tx up to D), S = settlement (rollbacks
// shallower than K blocks are possible), DA = D + S, E = 1 (a fee/cost-model change may land in any window).
const BLOCK = 20_000, D = 60_000, K = 3, S_SET = K * BLOCK, DA = D + S_SET, E = 1, M = (1 + E) * DA;   // M = 240 s
const ZDEPTH = 3;                                        // Z: Zcash funding depth Alice requires before "go"
const T0_OFF = 240_000;                                  // ≥ DA (lock settles) + Zcash funding + Z
const T1_OFF = T0_OFF + 1_000 + M + 19_000;              // = 500 s  (rule: T1 ≥ T0 + 1 + M)
const T2_OFF = T1_OFF + M + 20_000;                      // = 760 s  (rule: T2 ≥ T1 + M + 1)
const LAST_OFF = T1_OFF - 1_000 - M;                     // = 259 s  Bob's last FIRST Redeem broadcast (rule)

// ---------- helpers ----------
function zec(args, allowFail = false) {
  const t = Date.now();
  try { const out = execFileSync(ZEC, args, { encoding: "utf8", maxBuffer: 1 << 26 }); return { code: 0, ms: Date.now() - t, ...JSON.parse(out.trim().split("\n").pop()) }; }
  catch (e) { if (!allowFail) throw new Error(`zec ${args[0]} failed: ${e.stdout} ${e.stderr}`);
    let j = {}; try { j = JSON.parse(String(e.stdout).trim().split("\n").pop()); } catch {} return { code: e.status, ms: Date.now() - t, ...j }; }
}
const leHex = (n) => { let h = n.toString(16).padStart(64, "0"); return h.match(/../g).reverse().join(""); };
const leToBig = (h) => BigInt("0x" + h.match(/../g).reverse().join(""));
const pkhOf = (acct) => getAddressDetails(acct.address).paymentCredential.hash;
const rd = (f) => JSON.parse(fs.readFileSync(f));
class Results {
  constructor(name) { this.name = name; this.checks = []; this.costs = { cardano: [], zcash: [] }; this.events = []; }
  rec(name, expect, ok, detail) { this.checks.push({ name, expect, ok: !!ok, detail: detail === undefined ? undefined : String(detail).slice(0, 400) }); console.log(`  [${ok ? "ok" : "FAIL"}] ${name} (${expect}) ${detail ? "— " + String(detail).slice(0, 150) : ""}`); }
  get pass() { return this.checks.every(c => c.ok); }
}
// M-6: a negative test passes only if it is rejected WITH THE EXPECTED ERROR (regex), not any error.
async function mustFail(R, name, expect, fn) {
  let reason;
  try { const r = await fn(); if (r && r.rejected) reason = r.reason; else { R.rec(name, `reject /${expect.source}/`, false, "ACCEPTED: " + JSON.stringify(r ?? null).slice(0, 200)); return; } }
  catch (e) { reason = e.message; }
  const ok = expect.test(reason); R.rec(name, `reject /${expect.source}/`, ok, (ok ? "" : "WRONG ERROR: ") + reason);
}
const SCRIPT_FAIL = /^ScriptFailure \(phase 2\)/, BAD_INPUTS = /^BadInputsUTxO/, OUTSIDE = /^OutsideValidityInterval/, NODE_SIG = /bad spend-auth sigs/;

// ---------- swap environment ----------
// Step 4 (L-1): two-round setup. Round 1 = statement P,Q + contribution commitment + FRESH nonce (zec keygen).
// The agreed parameters (both networks, script hash, amounts, T0/T1/T2, both Cardano pkhs, go_vk) go to params.json.
// Round 2 = each party proves over ctx(role, swap_id(params, both round-1 messages)) (zec prove). Each verifier
// recomputes swap_id itself (zec setup) and rejects points or nonces it has already seen (seen= registry).
const ZEC_NET = "zcash-sim-regtest";
const SUITE_ID = `${Date.now()}`;
const seenDefault = (p) => path.join(RUNS, `seen-${p}-${SUITE_ID}.json`);   // one persistent registry per persona per suite run
function paramsOf(S) {
  return { ada_network_id: NETWORK_ID, zec_network: ZEC_NET, script_hash: SCRIPT_HASH, lovelace: Number(ADA_LOCK), zats: ZEC_AMT,
    t0: S.T0, t1: S.T1, t2: S.T2, alice_pkh: pkhOf(S.A), bob_pkh: pkhOf(S.B), alice_go_vk: S.go.vk };
}
async function newSwap(tag, opts = {}) {
  const dir = path.join(RUNS, `${tag}-${Date.now()}`); fs.mkdirSync(dir, { recursive: true });
  const A = generateEmulatorAccountFromPrivateKey({ lovelace: 2_000_000_000n });
  const B = generateEmulatorAccountFromPrivateKey({ lovelace: 300_000_000n });
  const L = new StrictLedger([A, B], { ...PP0 });
  const lucid = await Lucid(L.em, "Custom");
  const go = goKeygen();                               // fresh single-purpose go key, per swap
  const S = { tag, dir, A, B, L, lucid, go, scriptAddr: validatorToAddress("Custom", SCRIPT), d: (...a) => [`dir=${dir}`, ...a],
    seen: { alice: seenDefault("alice"), bob: seenDefault("bob"), ...(opts.seen || {}) } };
  const t0 = L.now(); S.tSetup = t0; S.T0 = t0 + T0_OFF; S.T1 = t0 + T1_OFF; S.T2 = t0 + T2_OFF; S.LAST = t0 + LAST_OFF;
  S.k = {};
  for (const p of ["alice", "bob"]) {
    const extra = typeof (opts.kg || {})[p] === "function" ? opts.kg[p](S) : ((opts.kg || {})[p] || []);
    S.k[p] = zec(["keygen", `dir=${dir}`, `party=${p}`, `cheat=${(opts.cheat || {})[p] || "none"}`, ...extra]);
  }
  fs.writeFileSync(path.join(dir, "params.json"), JSON.stringify(paramsOf(S), null, 1));
  if (opts.beforeProve) opts.beforeProve(S);
  S.pr = {};
  for (const p of ["alice", "bob"]) {
    const ov = (opts.proveParams || {})[p]; let extra = [];
    if (ov) { const f = path.join(dir, `params_${p}_prover.json`); fs.writeFileSync(f, JSON.stringify({ ...paramsOf(S), ...ov }, null, 1)); extra = [`params=${f}`]; }
    S.pr[p] = zec(["prove", `dir=${dir}`, `party=${p}`, ...extra]);
  }
  for (const p of ["alice", "bob"]) zec(["reveal", `dir=${dir}`, `party=${p}`]);
  if (opts.afterProve) opts.afterProve(S);
  return S;
}
function doSetup(S) { const s = {}; for (const p of ["alice", "bob"]) s[p] = zec(["setup", ...S.d(`party=${p}`, `seen=${S.seen[p]}`)], true); return s; }
const setupAs = (S, p) => zec(["setup", ...S.d(`party=${p}`, `seen=${S.seen[p]}`)], true);
async function as(S, acct) { S.lucid.selectWallet.fromPrivateKey(acct.privateKey); return S.lucid; }
function swapIdOf(S, who = "bob") {   // step 4: the swap id each party computed itself in setup (zec setup → view.json)
  return rd(path.join(S.dir, `${who}/view.json`)).swap_id;
}
function datumOf(S, over = {}) {
  const pa = rd(path.join(S.dir, "alice/pub.json")), pb = rd(path.join(S.dir, "bob/pub.json"));
  const f = { alice: pkhOf(S.A), bob: pkhOf(S.B), go_vk: S.go.vk, net: BigInt(NETWORK_ID), swap_id: S.swapId, a_c: pa.Q, b_c: pb.Q, t1: BigInt(S.T1), t2: BigInt(S.T2), ...over };
  return Data.to(new Constr(0, [f.alice, f.bob, f.go_vk, f.net, f.swap_id, f.a_c, f.b_c, f.t1, f.t2]));
}
async function refreshParams(S) { await S.lucid.switchProvider(S.L.em); }   // wallets re-read params after a change
async function lock(S, R, over = {}) {
  if (S.L.now() !== S.tSetup) throw new Error("lock: ledger time moved since setup; T0/T1/T2 in the transcript would be stale");
  S.swapId = swapIdOf(S, "alice");
  const lucid = await as(S, S.A);
  const tx = await lucid.newTx().pay.ToContract(S.scriptAddr, { kind: "inline", value: datumOf(S, over) }, { lovelace: ADA_LOCK }).complete();
  const r = await S.L.submit((await tx.sign.withWallet().complete()).toCBOR(), "lock");
  R.costs.cardano.push({ tx: "Lock", ...r.stats });
  S.lockHash = r.txHash;
  await S.L.awaitBlock(1);
  S.escrow = (await S.L.em.getUtxos(S.scriptAddr)).find(u => u.txHash === r.txHash);   // M-6: the specific outref, not [0]
  return r;
}
// Bob checks the lock before funding ZEC. Step 3: the lock must be SETTLED (≥ K confirmations), the go key / network /
// swap id must be the agreed ones, and the outref is the one from Alice's lock tx (not whatever sits at the script).
function bobChecksLock(S, { needSettled = true } = {}) {
  const u = S.escrow; if (!u) return "no escrow UTxO";
  const e = S.L.entry(u.txHash + u.outputIndex); if (!e) return "escrow outref not in confirmed state";
  if (needSettled && S.L.confirmations(u.txHash) < K) return `lock not settled (${S.L.confirmations(u.txHash)} < ${K} confirmations)`;
  const view = rd(path.join(S.dir, "bob/view.json"));
  const [al, bo, gvk, net, sid, ac, bc, t1, t2] = Data.from(u.datum).fields;
  if (u.address !== S.scriptAddr || getAddressDetails(u.address).paymentCredential.hash !== SCRIPT_HASH) return "wrong script";
  if (BigInt(u.assets.lovelace) !== ADA_LOCK || Object.keys(u.assets).length !== 1) return "wrong ADA amount / extra assets";
  if (al !== pkhOf(S.A) || bo !== pkhOf(S.B)) return "wrong parties";
  if (gvk !== S.go.vk || gvk.length !== 64) return "go key is not the one agreed in setup";
  if (Number(net) !== NETWORK_ID) return "wrong network id";
  if (sid !== swapIdOf(S)) return "wrong swap id";
  if (ac !== view.A_c || bc !== view.B_c) return "datum shares do not match DLEQ-verified points";
  if (Number(t1) !== S.T1 || Number(t2) !== S.T2 || Number(t2) - Number(t1) < M + 1 || Number(t1) - S.T0 < M + 1) return "wrong timelocks (rule T1 ≥ T0+1+M, T2 ≥ T1+M+1)";
  return null;
}
function fundZec(S, R, pay = ZEC_AMT, mineN = ZDEPTH - 1) {
  zec(["genesis", ...S.d()]);
  const f = zec(["fund", ...S.d(`amount=${ZEC_AMT}`, `pay=${pay}`, `out=${S.dir}/fund.tx`)]);
  const s = zec(["submit", ...S.d(`tx=${S.dir}/fund.tx`)]);
  R.costs.zcash.push({ tx: "Fund (Bob → joint key)", bytes: f.info.bytes, actions: f.info.actions, fee_zats: f.info.fee_zats, prove_ms: f.info.prove_ms, verify_ms: s.verify_ms, expiry_height: f.info.expiry_height, height: s.height });
  if (mineN) zec(["mine", ...S.d(`n=${mineN}`)]);
  return { f, s };
}
async function build(S, acct, f, cheatEval = false) {
  const lucid = await as(S, acct);
  if (!cheatEval) return await f(lucid.newTx()).complete();
  const orig = S.L.em.evaluateTx;
  S.L.em.evaluateTx = async (tx, u) => (await orig.call(S.L.em, tx, u)).map(r => ({ ...r, ex_units: { mem: 3_000_000, steps: 1_500_000_000 } }));
  try { return await f(lucid.newTx()).complete({ localUPLCEval: false }); } finally { S.L.em.evaluateTx = orig; }
}
const Redeem = (b, sig) => Data.to(new Constr(0, [b, sig])), Refund = (a) => Data.to(new Constr(1, [a])), Punish = Data.to(new Constr(2, []));
const redeemTx = (S, b, sig, { upper = S.T1 - 1000, signer } = {}) => (tx) => {
  let t = tx.collectFrom([S.escrow], Redeem(b, sig)).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.B));
  if (upper !== null) t = t.validTo(upper); return t; };
const refundTx = (S, a, from, signer) => (tx) => tx.collectFrom([S.escrow], Refund(a)).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.A)).validFrom(from);
const punishTx = (S, from, signer) => (tx) => tx.collectFrom([S.escrow], Punish).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.B)).validFrom(from);
const goFields = (S, u = S.escrow, over = {}) => ({ networkId: NETWORK_ID, swapId: S.swapId, scriptHash: SCRIPT_HASH, txId: u.txHash, index: u.outputIndex, lovelace: u.assets.lovelace, t1: S.T1, ...over });

// Alice's "go" (C-1 fix): she signs a MESSAGE about this escrow, never a transaction. Preconditions (H-2): the ZEC note
// is at depth ≥ Z on the LIVE simulated chain (fresh `watch`, never a saved file), the escrow is the settled outref of
// her own lock, and now ≤ T0.
function aliceGo(S, { force = false } = {}) {
  const w = zec(["watch", ...S.d("party=alice", `amount=${ZEC_AMT}`, `min_depth=${ZDEPTH}`)], true);
  let reason = null;
  if (!(w.code === 0 && w.status === "funded_ok")) reason = `ZEC not final on the live chain (${w.status}, tip ${w.tip})`;
  const e = S.L.entry(S.escrow.txHash + S.escrow.outputIndex);
  if (!e || S.L.confirmations(S.escrow.txHash) < K) reason = reason ?? "escrow not settled";
  if (S.L.now() > S.T0) reason = reason ?? "past T0: too late to give go";
  if (reason && !force) return { refused: reason, watch: w };
  const sig = goSign(S.go.sk, goMsg(goFields(S))); S.goSig = sig;
  return { sig, watch: w, forced_despite: reason };
}
async function signSubmit(S, txb, acct, label) { const hex = (await txb.sign.withPrivateKey(acct.privateKey).complete()).toCBOR(); return S.L.submit(hex, label); }
function sweep(S, R, party, extra, label) {
  const out = `${S.dir}/${label.replace(/\W+/g, "_")}.tx`;
  const b = zec(["sweep", ...S.d(`party=${party}`, `out=${out}`, ...extra)], true);
  if (b.code !== 0) return { rejected: true, reason: "sweeper refused: " + b.reason };
  const s = zec(["submit", ...S.d(`tx=${out}`)], true);
  if (s.code !== 0) return { rejected: true, reason: "node rejected: " + s.reason };
  R.costs.zcash.push({ tx: label, bytes: b.info.bytes, actions: b.info.actions, fee_zats: b.info.fee_zats, prove_ms: b.info.prove_ms, verify_ms: s.verify_ms, expiry_height: b.info.expiry_height });
  return { accepted: true, txid: s.txid, file: out };
}
const lovelaceAt = async (S, addr) => (await S.L.em.getUtxos(addr)).reduce((s, u) => s + BigInt(u.assets.lovelace), 0n);
const escrowLive = (S) => !!S.L.entry(S.escrow.txHash + S.escrow.outputIndex);

// Bob's Redeem procedure (spec §B): first broadcast only if now ≤ LAST = T1 − 1 s − M; afterwards, while now < T1,
// rebuild + re-sign + resubmit whenever his Redeem is no longer pending or confirmed (dropped, rolled back and
// dropped, fee/cost-model change...). The go_sig stays valid for every rebuild. Stops once settled (≥ K conf).
async function bobRedeem(S, R, b, { ignoreRule = false, maxBlocks = 60, hook = null } = {}) {
  if (!ignoreRule && S.L.now() > S.LAST) return { refused: "past LAST: Bob must not reveal b" };
  if (!goVerify(S.go.vk, goMsg(goFields(S)), S.goSig)) return { refused: "go_sig does not verify for this escrow" };
  const builds = [];
  const once = async () => { await refreshParams(S); const t = await build(S, S.B, redeemTx(S, b, S.goSig, { upper: S.T1 - 1000 })); const r = await signSubmit(S, t, S.B, `redeem#${builds.length + 1}`); builds.push(r); return r; };
  let cur = await once();
  for (let i = 0; i < maxBlocks; i++) {
    await S.L.awaitBlock(1);
    if (hook) await hook(S, cur, i);
    const st = S.L.status(cur.txHash);
    if (st === "confirmed" && S.L.confirmations(cur.txHash) >= K) return { settled: true, builds, cur };
    if (st !== "confirmed" && st !== "pending") {
      if (!escrowLive(S)) return { settled: false, builds, cur, why: "escrow spent by someone else" };
      if (S.L.now() >= S.T1 - 1000) return { settled: false, builds, cur, why: "T1 reached before settlement" };
      cur = await once();
    }
  }
  return { settled: false, builds, cur, why: "gave up" };
}
// Alice's Refund procedure: from T1, (re)build + resubmit until settled; must settle before T2.
async function aliceRefund(S, R, a, { at = S.T1, maxBlocks = 60, hook = null } = {}) {
  await S.L.untilMs(at);
  const builds = [];
  const once = async () => { await refreshParams(S); const t = await build(S, S.A, refundTx(S, a, Math.max(S.T1, S.L.now() - 1000))); const r = await signSubmit(S, t, S.A, `refund#${builds.length + 1}`); builds.push(r); return r; };
  let cur = await once();
  for (let i = 0; i < maxBlocks; i++) {
    await S.L.awaitBlock(1);
    if (hook) await hook(S, cur, i);
    const st = S.L.status(cur.txHash);
    if (st === "confirmed" && S.L.confirmations(cur.txHash) >= K) return { settled: true, builds, cur, at: S.L.now() };
    if (st !== "confirmed" && st !== "pending") { if (!escrowLive(S)) return { settled: false, builds, cur, why: "escrow spent by someone else" }; cur = await once(); }
  }
  return { settled: false, builds, cur };
}
function cardanoCost(R, label, r) { R.costs.cardano.push({ tx: label, ...r.stats }); }
async function doPunish(S) { await S.L.untilMs(S.T2); await refreshParams(S); const t = await build(S, S.B, punishTx(S, S.T2)); const r = await signSubmit(S, t, S.B, "punish"); await S.L.awaitBlock(K); return r; }
const secret = (S, p) => leToBig(rd(path.join(S.dir, `${p}/secret.json`)).x);
const bumpFee = (pp) => ({ ...pp, minFeeA: pp.minFeeA * 2, minFeeB: pp.minFeeB + 100_000 });
const bumpCost = (pp) => { const cm = [...pp.costModels.PlutusV3]; for (let i = 0; i < cm.length; i++) cm[i] = cm[i] + 1; return { ...pp, costModels: { ...pp.costModels, PlutusV3: cm } }; };

// ---------- common start: keys, DLEQ, lock (settled), ZEC funding, go ----------
async function start(tag, R, { go = true } = {}) {
  const S = await newSwap(tag);
  R.costs.dleq = { proof_bytes: S.pr.alice.dleq_bytes, prove_ms: S.pr.alice.dleq_prove_ms };
  const st = doSetup(S);
  R.rec("setup: both verify the other's transcript-bound DLEQ + key reveal; same joint address and same swap id", "accept", st.alice.ok && st.bob.ok && st.alice.addr_j === st.bob.addr_j && st.alice.swap_id === st.bob.swap_id, `σ=${st.alice.sigma} swap_id=${st.alice.swap_id}`);
  await lock(S, R);
  R.rec("Bob refuses to fund while the lock is not yet settled (H-1)", "reject", /not settled/.test(bobChecksLock(S) ?? ""), bobChecksLock(S));
  await S.L.awaitBlock(K);
  const bad = bobChecksLock(S);
  R.rec("Bob checks the SETTLED lock (outref, script, amount, go key, network, swap id, points, timing rule)", "accept", bad === null, bad);
  fundZec(S, R);
  if (go) {
    const g = aliceGo(S);
    R.rec(`Alice gives "go" (note depth ≥ ${ZDEPTH} on the live chain, escrow settled, now ≤ T0)`, "accept", !!g.sig, g.refused ?? `status ${g.watch.status}, ${(S.T0 - S.L.now()) / 1000} s before T0`);
    R.rec("Bob verifies the go signature off-chain against this escrow before revealing b", "accept", goVerify(S.go.vk, goMsg(goFields(S)), S.goSig));
  }
  zec(["watch", ...S.d("party=bob", `amount=${ZEC_AMT}`, "min_depth=1")], true);
  return S;
}
async function aliceTakesZec(S, R, label = "Sweep (Alice, a+b)") {
  const sp = S.L.spendingRedeemer(S.escrow.txHash, S.escrow.outputIndex);
  const b = sp.redeemer.fields[0]; const bHex = leHex(b);
  return { b, bHex, sw: sweep(S, R, "alice", [`other_share=${bHex}`], label) };
}

// ---------- (a) happy ----------
async function happy() {
  const R = new Results("happy"); console.log("== (a) happy path");
  const S = await start("happy", R);
  const bobX = secret(S, "bob"), aliceX = secret(S, "alice");
  await mustFail(R, "Alice tries to take the ZEC with her share a only", NODE_SIG, () => sweep(S, R, "alice", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_alice_one_share"));
  await mustFail(R, "Bob Redeems with a wrong b (b+1) + valid go_sig: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, redeemTx(S, bobX + 1n, S.goSig), true), S.B, "cheat_wrong_b"));
  await mustFail(R, "Bob Redeems with an empty go_sig: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, redeemTx(S, bobX, ""), true), S.B, "cheat_no_gosig"));
  await mustFail(R, "Bob Redeems with a go_sig over another outref: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, redeemTx(S, bobX, goSign(S.go.sk, goMsg(goFields(S, S.escrow, { index: 1 })))), true), S.B, "cheat_gosig_other_outref"));
  await mustFail(R, "Bob Redeem with upper bound after T1 (T1+60 s): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, redeemTx(S, bobX, S.goSig, { upper: S.T1 + 60_000 }), true), S.B, "cheat_late_upper"));
  await mustFail(R, "Bob Redeem with no upper bound: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, redeemTx(S, bobX, S.goSig, { upper: null }), true), S.B, "cheat_no_upper"));
  await mustFail(R, "Alice Refunds early (validFrom now < T1): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.L.now()), true), S.A, "cheat_early_refund"));
  await mustFail(R, "Alice submits a Refund valid only from T1 before T1: ledger rejects", OUTSIDE, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.T1)), S.A, "cheat_refund_not_yet_valid"));
  await mustFail(R, "Bob Punishes before T2: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, punishTx(S, S.L.now()), true), S.B, "cheat_early_punish"));
  R.rec("Bob's first Redeem broadcast is before LAST = T1 − 1 s − M", "accept", S.L.now() <= S.LAST, `${(S.LAST - S.L.now()) / 1000} s before LAST`);
  const rr = await bobRedeem(S, R, bobX);
  cardanoCost(R, "Redeem (Bob, reveals b, go-message checked on-chain)", rr.builds[0]);
  R.rec("Bob's Redeem settles (≥ K confirmations) before T1", "accept", rr.settled && S.L.now() < S.T1, `${(S.T1 - S.L.now()) / 1000} s before T1, builds ${rr.builds.length}`);
  const { b, bHex, sw: _x } = { ...(await (async () => { const sp = S.L.spendingRedeemer(S.escrow.txHash, S.escrow.outputIndex); return { b: sp.redeemer.fields[0], bHex: leHex(sp.redeemer.fields[0]) }; })()) };
  R.rec("Alice extracts b from the Redeem; b·G(Pallas) = Bob's DLEQ point", "accept", zec(["share-point", `share=${bHex}`, `P=${rd(path.join(S.dir, "alice/view.json")).B_p}`]).ok);
  await mustFail(R, "Alice sweeps with a wrong share (b+1): her tool refuses", /sweeper refused: REFUSE/, () => sweep(S, R, "alice", [`other_share=${leHex(b + 1n)}`], "cheat_wrong_share_refuse"));
  await mustFail(R, "Alice forces a sweep signed with a wrong share: node rejects", NODE_SIG, () => sweep(S, R, "alice", ["cheat=wrong_share", `other_share=${bHex}`], "cheat_wrong_share_forced"));
  await mustFail(R, "sweep without ỹ-negation: node rejects", NODE_SIG, () => sweep(S, R, "alice", ["cheat=no_negation", `other_share=${bHex}`], "cheat_no_negation"));
  await mustFail(R, "sweep signature over a different sighash: node rejects", NODE_SIG, () => sweep(S, R, "alice", ["cheat=wrong_sighash", `other_share=${bHex}`], "cheat_wrong_sighash"));
  await mustFail(R, "sweep with tampered Halo2 proof: node rejects", /proof_ok=false/, () => sweep(S, R, "alice", ["cheat=tamper_proof", `other_share=${bHex}`], "cheat_tamper_proof"));
  await mustFail(R, "Bob tries to take the ZEC back with b only", NODE_SIG, () => sweep(S, R, "bob", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_bob_one_share"));
  for (const m of ["joint", "adaptor"]) { const o = `${S.dir}/alt0_${m}.tx`; zec(["sweep", ...S.d("party=alice", `mode=${m}`, `out=${o}`)]); const c = zec(["check", ...S.d(`tx=${o}`)], true);
    R.rec(`alternative ${m} signature on the sweep verifies (not mined)`, "accept", c.code === 0, c.reason); }
  const sw = sweep(S, R, "alice", [`other_share=${bHex}`], "Sweep (Alice, a+b)");
  R.rec("Alice's real Orchard sweep with σ(a+b) accepted; expiry_height = tip+40", "accept", sw.accepted && R.costs.zcash.at(-1).expiry_height > 0, `expiry ${R.costs.zcash.at(-1).expiry_height}`);
  await mustFail(R, "a second, different spend of the swept joint note (double spend): node rejects", /nullifier/, async () => { const o = `${S.dir}/alt_joint.tx`; zec(["sweep", ...S.d("party=alice", "mode=joint", `out=${o}`)]); const c = zec(["submit", ...S.d(`tx=${o}`)], true); return c.code === 0 ? { accepted: true } : { rejected: true, reason: c.reason }; });
  await S.L.untilMs(S.T1 + 1000);
  await mustFail(R, "Alice tries to Refund after Bob redeemed", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.T1), true), S.A, "cheat_refund_after_redeem"));
  const ab = zec(["balance", ...S.d("party=alice")]); const bobAda = await lovelaceAt(S, S.B.address);
  R.rec("final: Alice holds the ZEC", "accept", ab.unspent_zats === ZEC_AMT - 10000, `${ab.unspent_zats} zats`);
  R.rec("final: Bob holds the ADA", "accept", bobAda > 300_000_000n + ADA_LOCK - 2_000_000n, `${Number(bobAda) / 1e6} ADA`);
  return { R, S };
}
// ---------- (b) refund ----------
async function refund() {
  const R = new Results("refund"); console.log("== (b) refund path (Bob never redeems)");
  const S = await start("refund", R);
  const aliceX = secret(S, "alice"), bobX = secret(S, "bob");
  await S.L.untilMs(S.LAST + 1000);
  const late = await bobRedeem(S, R, bobX);
  R.rec("Bob's own tool refuses a FIRST Redeem after LAST (b would be public too close to T1)", "reject", /past LAST/.test(late.refused ?? ""), late.refused);
  await mustFail(R, "Alice Refunds before T1: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.L.now()), true), S.A, "cheat_early_refund"));
  await S.L.untilMs(S.T1);
  await mustFail(R, "Bob Redeems at/after T1 (TTL T1−1 s): ledger rejects", OUTSIDE, async () => signSubmit(S, await build(S, S.B, redeemTx(S, bobX, S.goSig, { upper: S.T1 - 1000 }), true), S.B, "cheat_stale_redeem"));
  await mustFail(R, "Bob Redeems after T1 with a later upper bound: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, redeemTx(S, bobX, S.goSig, { upper: S.L.now() + 60_000 }), true), S.B, "cheat_late_redeem"));
  await mustFail(R, "Bob Punishes between T1 and T2: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, punishTx(S, S.L.now()), true), S.B, "cheat_punish_t1_t2"));
  await mustFail(R, "Alice Refunds with a wrong a (a+1): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX + 1n, S.T1), true), S.A, "cheat_wrong_a"));
  await mustFail(R, "Alice Refunds with a + r (same BLS point, out of range): script rejects", SCRIPT_FAIL, async () => {
    const r = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n; return signSubmit(S, await build(S, S.A, refundTx(S, aliceX + r, S.T1), true), S.A, "cheat_a_plus_r"); });
  const rf = await aliceRefund(S, R, aliceX);
  cardanoCost(R, "Refund (Alice, reveals a)", rf.builds[0]);
  R.rec("Alice's Refund settles before T2", "accept", rf.settled && S.L.now() < S.T2, `${(S.T2 - S.L.now()) / 1000} s before T2`);
  const a = S.L.spendingRedeemer(S.escrow.txHash, S.escrow.outputIndex, { confirmedOnly: true }).redeemer.fields[0];
  R.rec("Bob extracts a from the Refund; a·G(Pallas) = Alice's point", "accept", zec(["share-point", `share=${leHex(a)}`, `P=${rd(path.join(S.dir, "bob/view.json")).A_p}`]).ok);
  await mustFail(R, "Alice tries to keep the ZEC too, with a only", NODE_SIG, () => sweep(S, R, "alice", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_alice_one_share"));
  const sw = sweep(S, R, "bob", [`other_share=${leHex(a)}`], "Sweep (Bob, a+b, takes ZEC back)");
  R.rec("Bob's Orchard sweep with σ(a+b) accepted (ZEC back)", "accept", !!sw.accepted, sw.reason);
  await S.L.untilMs(S.T2 + 1000);
  await mustFail(R, "Bob Punishes after T2 although Alice refunded", BAD_INPUTS, async () => signSubmit(S, await build(S, S.B, punishTx(S, S.T2), true), S.B, "cheat_punish_after_refund"));
  const bb = zec(["balance", ...S.d("party=bob")]); const aliceAda = await lovelaceAt(S, S.A.address);
  R.rec("final: Bob holds his ZEC again", "accept", bb.unspent_zats === 100_000_000 - 20_000, `${bb.unspent_zats} zats`);
  R.rec("final: Alice holds her ADA again", "accept", aliceAda > 2_000_000_000n - 3_000_000n, `${Number(aliceAda) / 1e6} ADA`);
  return { R, S };
}
// ---------- (c) punish ----------
async function punish() {
  const R = new Results("punish"); console.log("== (c) punish path (Alice silent after ZEC is locked)");
  const S = await start("punish", R, { go: false });
  await mustFail(R, "Bob tries to take the ZEC back with b only", NODE_SIG, () => sweep(S, R, "bob", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_bob_one_share"));
  const nogo = await (async () => { S.goSig = "00".repeat(64); return bobRedeem(S, R, secret(S, "bob")); })();
  R.rec("without a valid go signature Bob's tool never reveals b", "reject", /go_sig does not verify/.test(nogo.refused ?? ""), nogo.refused);
  await S.L.untilMs(S.T1 + 5000);
  await mustFail(R, "Bob Punishes after T1 but before T2: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, punishTx(S, S.L.now()), true), S.B, "cheat_early_punish"));
  await mustFail(R, "Bob tries a Refund with a guessed a: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, refundTx(S, BigInt("0x" + crypto.randomBytes(31).toString("hex")), S.T1, S.B), true), S.B, "cheat_bob_refund"));
  await mustFail(R, "Bob submits a Punish valid from T2 before T2: ledger rejects", OUTSIDE, async () => signSubmit(S, await build(S, S.B, punishTx(S, S.T2)), S.B, "cheat_punish_not_yet_valid"));
  await S.L.untilMs(S.T2);
  await mustFail(R, "a party other than Bob tries Punish after T2: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, punishTx(S, S.T2, S.A), true), S.A, "cheat_punish_not_bob"));
  const r = await doPunish(S);
  cardanoCost(R, "Punish (Bob, after T2)", r);
  R.rec("Bob's Punish settles after T2", "accept", S.L.confirmations(r.txHash) >= K);
  await mustFail(R, "Alice wakes up late and tries to Refund after Punish", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, refundTx(S, secret(S, "alice"), S.T1), true), S.A, "cheat_late_refund"));
  const w = zec(["watch", ...S.d("party=bob", `amount=${ZEC_AMT}`, "min_depth=1")], true);
  R.rec("final: Bob holds the ADA", "accept", (await lovelaceAt(S, S.B.address)) > 300_000_000n + ADA_LOCK - 2_000_000n);
  R.rec("final: the ZEC stays locked at the joint key (accepted trade-off)", "accept", w.code === 0 && w.status === "funded_ok", w.status);
  return { R, S };
}
// ---------- setup cheats ----------
async function setupCheats() {
  const R = new Results("setup"); console.log("== setup-phase cheats");
  for (const [c, nm, re] of [["tamper", "corrupted DLEQ proof", /DLEQ proof invalid/], ["shifted", "F7 shifted-points DLEQ", /DLEQ proof invalid/], ["mismatch", "BLS point not matching the Pallas point", /DLEQ proof invalid/], ["wrongctx", "DLEQ proof bound to the other role", /DLEQ proof invalid/]]) {
    const S = await newSwap(`setup-${c}`, { cheat: { bob: c } }); const s = setupAs(S, "alice");
    R.rec(`Bob publishes ${nm}: Alice aborts`, `reject /${re.source}/`, s.code !== 0 && re.test(s.reason), s.reason); }
  { const S = await newSwap("setup-reveal"); fs.writeFileSync(path.join(S.dir, "bob/reveal.json"), JSON.stringify({ contrib: crypto.randomBytes(32).toString("hex") }));
    const s = setupAs(S, "alice"); R.rec("Bob changes his key contribution after committing: Alice aborts", "reject /does not match commitment/", s.code !== 0 && /does not match commitment/.test(s.reason), s.reason); }
  const lockCase = async (tag, over, re, nm) => { const S = await newSwap(tag); doSetup(S); await lock(S, R, over); await S.L.awaitBlock(K); const bad = bobChecksLock(S); R.rec(nm, `reject /${re.source}/`, bad !== null && re.test(bad), bad); };
  { const S = await newSwap("setup-datum2"); doSetup(S); await lock(S, R, { b_c: rd(path.join(S.dir, "alice/pub.json")).Q }); await S.L.awaitBlock(K); const bad = bobChecksLock(S);
    R.rec("datum B_c is not Bob's DLEQ point: Bob refuses to fund", "reject /DLEQ-verified/", /DLEQ-verified/.test(bad ?? ""), bad); }
  await lockCase("setup-t2", { t2: 0n }, /timelocks/, "wrong T2: Bob refuses to fund");
  await lockCase("setup-govk", { go_vk: goKeygen().vk }, /go key/, "datum go key ≠ the one agreed: Bob refuses to fund");
  await lockCase("setup-net", { net: 1n }, /network/, "datum network id = mainnet in a testnet swap: Bob refuses to fund");
  await lockCase("setup-swapid", { swap_id: "00".repeat(32) }, /swap id/, "datum swap id ≠ H(setup transcript): Bob refuses to fund");
  { const S = await newSwap("setup-unsettled"); doSetup(S); await lock(S, R); const bad = bobChecksLock(S);
    R.rec("lock only 1 confirmation deep: Bob waits (does not fund)", "reject /not settled/", /not settled/.test(bad ?? ""), bad); }
  { const S = await newSwap("setup-amount"); doSetup(S); await lock(S, R); await S.L.awaitBlock(K); fundZec(S, R, ZEC_AMT - 10_000_000);
    const g = aliceGo(S); R.rec("Bob funds less ZEC than agreed: Alice withholds go", "reject /wrong_amount/", /wrong_amount/.test(g.refused ?? ""), g.refused); }
  { const S = await newSwap("setup-shallow"); doSetup(S); await lock(S, R); await S.L.awaitBlock(K); fundZec(S, R, ZEC_AMT, 0);
    const g = aliceGo(S); R.rec("ZEC funding at depth 1 < Z: Alice withholds go", "reject /too_shallow/", /too_shallow/.test(g.refused ?? ""), g.refused); }
  { const S = await newSwap("setup-late"); doSetup(S); await lock(S, R); await S.L.awaitBlock(K); fundZec(S, R); await S.L.untilMs(S.T0 + 1000);
    const g = aliceGo(S); R.rec("ZEC final but now > T0: Alice withholds go (then refunds at T1)", "reject /past T0/", /past T0/.test(g.refused ?? ""), g.refused); }
  { const S = await newSwap("setup-badgo"); doSetup(S); await lock(S, R); await S.L.awaitBlock(K); fundZec(S, R); aliceGo(S);
    S.goSig = goSign(S.go.sk, goMsg(goFields(S, S.escrow, { lovelace: ADA_LOCK - 1n })));
    const r = await bobRedeem(S, R, secret(S, "bob")); R.rec("Alice sends a go signature over the wrong amount: Bob's tool refuses before revealing b", "reject /does not verify/", /does not verify/.test(r.refused ?? ""), r.refused); }
  return { R };
}
// ---------- review reproductions, ported ----------
// C-1 (fee / cost-model change after b is public). Malicious Alice: holds Bob's Redeem out of blocks for up to D,
// reads b from the mempool, sweeps the ZEC, and the params change before inclusion. Bob must still get the ADA.
async function c1(kind) {
  const R = new Results(`c1${kind}`); console.log(`== C-1 reproduction (${kind} change after b is public)`);
  const S = await start(`c1${kind}`, R);
  const bobX = secret(S, "bob");
  let stolen = null;
  const origSubmit = S.L.submit.bind(S.L);
  S.L.submit = async (hex, label) => { const r = await origSubmit(hex, label);
    if (label === "redeem#1") {
      S.L.held.add(r.txHash);                                 // adversary delays inclusion (≤ D)
      const t = await aliceTakesZec(S, R, "Sweep (malicious Alice, b read from mempool)"); stolen = t.sw;
      S.L.setParams(kind === "fee" ? bumpFee(S.L.pp) : bumpCost(S.L.pp));
    }
    return r; };
  const hook = async (S2, cur, i) => { if (i === 2) S.L.held.clear(); };   // D = 3 blocks elapsed
  const rr = await bobRedeem(S, R, bobX, { hook });
  R.rec("Alice swept the ZEC with b read from the mempool (the attack's first half succeeds)", "accept", stolen?.accepted, stolen?.reason);
  const first = rr.builds[0];
  R.rec(`Bob's first Redeem is DROPPED at block time by the ${kind} change (sim no longer accepts it)`, "accept", S.L.status(first.txHash) === "dropped" && (kind === "fee" ? /FeeTooSmall/ : /PPViewHashesDontMatch/).test(S.L.dropReason(first.txHash) ?? ""), S.L.dropReason(first.txHash));
  R.rec("Bob rebuilds + re-signs his Redeem with the SAME go_sig; it settles before T1 (C-1 fixed)", "accept", rr.settled && rr.builds.length >= 2 && S.L.now() < S.T1, `builds ${rr.builds.length}, ${(S.T1 - S.L.now()) / 1000} s before T1`);
  if (rr.builds.length >= 2) cardanoCost(R, `Redeem rebuilt after ${kind} change`, rr.builds.at(-1));
  await S.L.untilMs(S.T1);
  await mustFail(R, "Alice then tries to Refund at T1", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, refundTx(S, secret(S, "alice"), S.T1), true), S.A, "attack_refund"));
  R.rec("final: Bob holds the ADA (honest Bob NOT harmed)", "accept", (await lovelaceAt(S, S.B.address)) > 300_000_000n + ADA_LOCK - 3_000_000n);
  R.events = S.L.events; return { R, S };
}
// C2: the step-2 sim confirmed txs after their TTL. Now a held tx whose TTL passes is dropped at block time.
async function c2() {
  const R = new Results("c2"); console.log("== C2 reproduction (expired tx must not confirm)");
  const S = await start("c2", R);
  const t = await build(S, S.B, redeemTx(S, secret(S, "bob"), S.goSig, { upper: S.L.now() + 25_000 }));
  const r = await signSubmit(S, t, S.B, "redeem_short_ttl"); S.L.held.add(r.txHash);
  await S.L.awaitBlock(2); S.L.held.clear(); await S.L.awaitBlock(1);
  R.rec("tx held past its TTL is DROPPED at block time, never confirmed", "accept", S.L.status(r.txHash) === "dropped" && OUTSIDE.test(S.L.dropReason(r.txHash)), S.L.dropReason(r.txHash));
  R.rec("escrow still unspent", "accept", escrowLive(S));
  const rr = await bobRedeem(S, R, secret(S, "bob"), { ignoreRule: true });
  R.rec("Bob simply rebuilds with a fresh TTL (no new go needed) and it settles before T1", "accept", rr.settled && S.L.now() < S.T1, `${(S.T1 - S.L.now()) / 1000} s before T1`);
  return { R, S };
}
// C3: Bob slipping Alice's own UTxO into a tx she signs. Alice now signs no tx at all.
async function c3() {
  const R = new Results("c3"); console.log("== C3 reproduction (Alice's other inputs)");
  const S = await start("c3", R);
  const aU = (await S.L.em.getUtxos(S.A.address))[0];
  await mustFail(R, "Bob's Redeem also spending Alice's base-address UTxO: no Alice witness exists → ledger rejects", /MissingVKeyWitnesses/, async () => {
    const t = await build(S, S.B, (tx) => redeemTx(S, secret(S, "bob"), S.goSig)(tx).collectFrom([aU])); return signSubmit(S, t, S.B, "cheat_c3"); });
  R.rec("Alice's go step produces only a 64-byte signature over the 129-byte go message (nothing that can authorise a tx)", "accept", S.goSig.length === 128 && goMsg(goFields(S)).length === 129);
  await mustFail(R, "the go signature is not a valid tx witness for Alice's key either (Bob attaches it as one)", /InvalidWitnesses|MissingVKeyWitnesses|ScriptFailure|Extraneous/, async () => {
    const t = await build(S, S.B, (tx) => redeemTx(S, secret(S, "bob"), S.goSig)(tx).collectFrom([aU]));
    const ws = CML.TransactionWitnessSet.new(); const l = CML.VkeywitnessList.new();
    l.add(CML.Vkeywitness.new(CML.PublicKey.from_bytes(Buffer.from(S.go.vk, "hex")), CML.Ed25519Signature.from_raw_bytes(Buffer.from(S.goSig, "hex")))); ws.set_vkeywitnesses(l);
    return S.L.submit((await t.assemble([ws.to_cbor_hex()]).sign.withPrivateKey(S.B.privateKey).complete()).toCBOR(), "cheat_c3_gosig_as_witness"); });
  return { R, S };
}
// H-1: rollback near T1 (Redeem) and near T2 (Refund), with controls that break the rule.
async function rbRedeem() {
  const R = new Results("rbredeem"); console.log("== H-1: Cardano rollback of the Redeem");
  { const S = await start("rbredeem", R); let done = false;
    const hook = async (S2, cur, i) => { if (!done && S.L.confirmations(cur.txHash) === K - 1) { S.L.rollback(K - 1); done = true; } };
    const rr = await bobRedeem(S, R, secret(S, "bob"), { hook });
    R.rec(`honest Bob (first broadcast ≤ LAST): his Redeem is rolled back ${K - 1} blocks, returns to the pool, re-confirms and settles before T1`, "accept", done && rr.settled && S.L.now() < S.T1, `${(S.T1 - S.L.now()) / 1000} s before T1; ${S.L.events.filter(e => /ROLLBACK/.test(e)).join("; ")}`);
    await S.L.untilMs(S.T1);
    await mustFail(R, "Alice's Refund at T1 fails", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, refundTx(S, secret(S, "alice"), S.T1), true), S.A, "rb_refund")); }
  { const S = await start("rbredeem-ctl", R);
    await S.L.untilMs(S.T1 - 40_000);   // CONTROL: Bob violates the rule (first broadcast 40 s before T1)
    let done = false; let gone = false;
    const hook = async (S2, cur, i) => { if (!done && S.L.now() >= S.T1 && S.L.confirmations(cur.txHash) > 0 && S.L.confirmations(cur.txHash) < K) { S.L.rollback(S.L.confirmations(cur.txHash)); done = true; } };
    const rr = await bobRedeem(S, R, secret(S, "bob"), { ignoreRule: true, hook });
    for (let i = 0; i < 3 && !done; i++) { await S.L.awaitBlock(1); await hook(S, rr.cur, 0); }
    await S.L.awaitBlock(1);
    gone = S.L.status(rr.cur.txHash) === "dropped";
    const rf = await aliceRefund(S, R, secret(S, "alice"), { at: S.L.now() });
    R.rec("CONTROL (rule broken: Bob first broadcasts 40 s before T1): rollback after T1 drops his Redeem, Alice refunds AND can sweep the ZEC with b → shows the LAST rule is necessary", "accept (expected loss)", done && gone && rf.settled, S.L.events.slice(-3).join("; ")); }
  return { R };
}
async function rbRefund() {
  const R = new Results("rbrefund"); console.log("== H-1: Cardano rollback of the Refund (+ a fee change mid-refund)");
  { const S = await start("rbrefund", R); let rb = false, pc = false;
    const hook = async (S2, cur, i) => { if (!pc) { S.L.setParams(bumpFee(S.L.pp)); pc = true; return; } if (!rb && S.L.confirmations(cur.txHash) === K - 1) { S.L.rollback(K - 1); rb = true; } };
    const rf = await aliceRefund(S, R, secret(S, "alice"), { hook });
    R.rec(`honest Alice refunds from T1: first Refund dropped by a fee change, rebuilt, rolled back ${K - 1} blocks, re-confirmed; settles before T2`, "accept", rf.settled && rb && rf.builds.length >= 2 && S.L.now() < S.T2, `builds ${rf.builds.length}, ${(S.T2 - S.L.now()) / 1000} s before T2; ${S.L.events.join("; ").slice(0, 300)}`);
    await mustFail(R, "Bob's Punish at T2 fails", BAD_INPUTS, async () => { await S.L.untilMs(S.T2); await refreshParams(S); return signSubmit(S, await build(S, S.B, punishTx(S, S.T2), true), S.B, "rb_punish"); }); }
  { const S = await start("rbrefund-ctl", R);
    // CONTROL: Alice ignores the rule and refunds only 30 s before T2; a 2-block rollback after T2 lets Punish win.
    await S.L.untilMs(S.T2 - 30_000);
    const t = await build(S, S.A, refundTx(S, secret(S, "alice"), S.T1)); const r = await signSubmit(S, t, S.A, "late_refund");
    await S.L.untilMs(S.T2 + 1000); const n = S.L.confirmations(r.txHash); S.L.rollback(n, { dropOrphans: true });
    await refreshParams(S); const p = await signSubmit(S, await build(S, S.B, punishTx(S, S.T2)), S.B, "punish"); await S.L.awaitBlock(1);
    R.rec("CONTROL (rule broken: Refund 30 s before T2): rollback after T2 + Punish → Alice loses → shows the T2 margin is necessary", "accept (expected loss)", S.L.confirmations(p.txHash) > 0, `refund had ${n} conf when rolled back`); }
  return { R };
}
// H-2: Zcash reorg / double spend of the funding; Alice must use LIVE depth.
async function zReorg() {
  const R = new Results("zreorg"); console.log("== H-2: Zcash reorgs and the live depth check");
  { const S = await start("zreorg-ds", R, { go: false });
    zec(["reorg", ...S.d("n=3")]); // drop fund block (+2 empty)
    // Bob's double spend of his funding input, then the original funding can no longer be mined
    const ss = zec(["selfspend", ...S.d()]); zec(["submit", ...S.d(`tx=${ss.tx}`)]); zec(["mine", ...S.d("n=3")]);
    const re = zec(["submit", ...S.d(`tx=${S.dir}/fund.tx`)], true);
    R.rec("after the reorg Bob double-spends his funding input; the orphaned funding tx can't be re-mined", "reject /nullifier/", re.code !== 0 && /nullifier/.test(re.reason), re.reason);
    const g = aliceGo(S); R.rec("Alice's go re-checks the LIVE chain: note gone → no go (b never needed)", "reject /not_found/", /not_found/.test(g.refused ?? ""), g.refused);
    const rf = await aliceRefund(S, R, secret(S, "alice")); R.rec("Alice refunds at T1 and settles before T2: nobody loses", "accept", rf.settled); }
  { const S = await newSwap("zreorg-stale"); doSetup(S); await lock(S, R); await S.L.awaitBlock(K); fundZec(S, R);
    const w = zec(["watch", ...S.d("party=alice", `amount=${ZEC_AMT}`, `min_depth=${ZDEPTH}`)], true);
    const had = fs.existsSync(path.join(S.dir, "alice/joint_note.json"));
    zec(["reorg", ...S.d(`n=${ZDEPTH}`)]); const ss = zec(["selfspend", ...S.d()]); zec(["submit", ...S.d(`tx=${ss.tx}`)]);
    const g = aliceGo(S);
    R.rec("stale-file test: note was at depth Z (file saved), then a reorg + double spend; go re-checks live chain and refuses; stale file deleted", "reject /not_found/", w.status === "funded_ok" && had && /not_found/.test(g.refused ?? "") && !fs.existsSync(path.join(S.dir, "alice/joint_note.json")), g.refused); }
  { const S = await newSwap("zreorg-shallow"); doSetup(S); await lock(S, R); await S.L.awaitBlock(K); fundZec(S, R, ZEC_AMT, ZDEPTH);
    zec(["reorg", ...S.d("n=1")]); const g = aliceGo(S);
    R.rec("a 1-block reorg above a note at depth Z+1 leaves it at depth Z: go still given", "accept", !!g.sig, g.refused ?? g.watch.status); }
  return { R };
}
async function zExpiry() {
  const R = new Results("zexpiry"); console.log("== M-3: Zcash expiry heights");
  const S = await newSwap("zexpiry"); doSetup(S); zec(["genesis", ...S.d()]);
  const tip = zec(["watch", ...S.d("party=alice", `amount=${ZEC_AMT}`, "min_depth=1")], true).tip;
  const f = zec(["fund", ...S.d(`amount=${ZEC_AMT}`, `pay=${ZEC_AMT}`, `out=${S.dir}/f40.tx`)]);
  R.rec("wallet-default fund tx carries expiry_height = tip + 40", "accept", f.info.expiry_height === tip + 40, `tip ${tip}, expiry ${f.info.expiry_height}`);
  const e = zec(["fund", ...S.d(`amount=${ZEC_AMT}`, `pay=${ZEC_AMT}`, `out=${S.dir}/fexp.tx`, `expiry=${tip + 1}`)]);
  zec(["mine", ...S.d("n=1")]);
  const s1 = zec(["submit", ...S.d(`tx=${S.dir}/fexp.tx`)], true);
  R.rec("tx with expiry tip+1 submitted after 1 more block: node rejects (TxExpired)", "reject /TxExpired/", s1.code !== 0 && /TxExpired/.test(s1.reason), s1.reason);
  zec(["fund", ...S.d(`amount=${ZEC_AMT}`, `pay=${ZEC_AMT}`, `out=${S.dir}/f0.tx`, "expiry=0")]);
  const s0 = zec(["submit", ...S.d(`tx=${S.dir}/f0.tx`)], true);
  R.rec("expiry 0 (step-2 fingerprint) is refused by the step-3 node policy", "reject /ExpiryZero/", s0.code !== 0 && /ExpiryZero/.test(s0.reason), s0.reason);
  const s2 = zec(["submit", ...S.d(`tx=${S.dir}/f40.tx`)], true);
  R.rec("the tip+40 tx is still accepted", "accept", s2.code === 0, s2.reason);
  return { R, S };
}
// Go-message design on the real ledger: replay across swaps, wrong network/domain, malleated sig, front-running.
async function goCases() {
  const R = new Results("gomsg"); console.log("== go-message attacks on the strict ledger");
  const S1 = await start("go-s1", R); const S2 = await start("go-s2", R);
  const b2 = secret(S2, "bob");
  // replay: Bob of swap 2 is also Bob of swap 1? Use swap 1's go sig on swap 2's escrow (same keys impossible; reuse S1's sig)
  S2.go = S1.go; // worst case: Alice reused her go key across swaps (spec forbids; tests that outref binding still holds)
  await mustFail(R, "go_sig from swap 1 replayed on swap 2 (even with a reused go key in the datum): script rejects", SCRIPT_FAIL, async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, S1.goSig), true), S2.B, "replay"));
  const mk = (over) => goSign(S2.go.sk, goMsg(goFields(S2, S2.escrow, over)));
  await mustFail(R, "go_sig over network id 1 (mainnet) for a testnet escrow: script rejects", SCRIPT_FAIL, async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, mk({ networkId: 1 })), true), S2.B, "wrong_net"));
  await mustFail(R, "go_sig under another signing domain: script rejects", SCRIPT_FAIL, async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, mk({ domain: Buffer.from("zeUTXO/path1/go/v0") })), true), S2.B, "wrong_domain"));
  await mustFail(R, "go_sig over another T1: script rejects", SCRIPT_FAIL, async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, mk({ t1: S2.T1 + 1 })), true), S2.B, "wrong_t1"));
  const sig = Buffer.from(S2.goSig, "hex"); const L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");
  const sInt = BigInt("0x" + Buffer.from(sig.subarray(32)).reverse().toString("hex")) + L; const sBytes = Buffer.from(sInt.toString(16).padStart(64, "0"), "hex").reverse();
  const mall = Buffer.concat([sig.subarray(0, 32), sBytes]).toString("hex");
  await mustFail(R, "malleated go_sig (S + ℓ, non-canonical): script rejects", SCRIPT_FAIL, async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, mall), true), S2.B, "malleated"));
  const C = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
  await mustFail(R, "front-runner copies b + go_sig from the mempool, signs as itself: script rejects (Bob's signature required)", SCRIPT_FAIL, async () => signSubmit(S2, await build(S2, S2.A, redeemTx(S2, b2, S2.goSig, { signer: S2.A }), true), S2.A, "frontrun"));
  return { R };
}

// ---------- L-1 (step 4): setup proofs are bound to the per-swap transcript ----------
// Every "old" proof below comes from a swap created earlier IN THIS RUN with fresh throwaway keys (that is the attack).
async function l1Cases() {
  const R = new Results("l1"); console.log("== L-1 setup-proof replay / binding");
  const RING = (who) => new RegExp(`^ABORT: ${who}'s DLEQ proof invalid \\(ring\\)$`);
  const iso = () => ({ alice: path.join(RUNS, `seen-iso-alice-${crypto.randomBytes(6).toString("hex")}.json`), bob: path.join(RUNS, `seen-iso-bob-${crypto.randomBytes(6).toString("hex")}.json`) });
  const expect = (name, s, re) => R.rec(name, `reject /${re.source}/`, s.code !== 0 && re.test(s.reason ?? ""), s.reason ?? JSON.stringify(s).slice(0, 200));
  // control: an honest swap with persistent registries; both agree on swap_id; re-running setup on the same swap is idempotent
  const seenOld = iso();
  const OLD = await newSwap("l1-old", { seen: seenOld });
  { const st = doSetup(OLD), again = setupAs(OLD, "alice");
    R.rec("control: honest two-round setup accepted by both; same swap_id; re-running setup on the SAME swap is not flagged", "accept",
      st.alice.ok && st.bob.ok && st.alice.swap_id === st.bob.swap_id && again.ok && again.swap_id === st.alice.swap_id, st.alice.swap_id); }
  const oldDir = OLD.dir;
  // The replayer sends the OLD round-1 message in round 1 (so the honest peer proves over it) and the OLD proof in round 2.
  const cp = (S, who, from, files) => { for (const f of files) fs.copyFileSync(path.join(from, who, f), path.join(S.dir, who, f)); };
  const replay = (who) => ({ beforeProve: (S) => cp(S, who, oldDir, ["pub.json", "secret.json"]), afterProve: (S) => cp(S, who, oldDir, ["dleq.bin", "reveal.json"]) });
  // 1. cross-swap replay to a NEW counterparty (fresh registry, so only the transcript binding can catch it)
  { const S = await newSwap("l1-replay-bob", { seen: iso(), ...replay("bob") });
    expect("Bob replays his whole round-1 message + proof from another swap to a new Alice (fresh registry): transcript binding rejects", setupAs(S, "alice"), RING("bob")); }
  { const S = await newSwap("l1-replay-alice", { seen: iso(), ...replay("alice") });
    expect("Alice replays her round-1 message + proof from another swap to a new Bob: transcript binding rejects", setupAs(S, "bob"), RING("alice")); }
  { const S = await newSwap("l1-replay-proofonly", { seen: iso(), beforeProve: (S) => {
      const op = rd(path.join(oldDir, "bob/pub.json")), np = rd(path.join(S.dir, "bob/pub.json"));
      fs.writeFileSync(path.join(S.dir, "bob/pub.json"), JSON.stringify({ ...np, P: op.P, Q: op.Q })); },
    afterProve: (S) => fs.copyFileSync(path.join(oldDir, "bob/dleq.bin"), path.join(S.dir, "bob/dleq.bin")) });
    expect("Bob replays only the old (P, Q, proof) with a fresh nonce/commitment: rejects", setupAs(S, "alice"), RING("bob")); }
  // 2. same counterparty: points / nonces already seen (catches reuse even with a VALID fresh proof)
  { const S = await newSwap("l1-reuse-x", { seen: seenOld, kg: { bob: [`reuse_x=${path.join(oldDir, "bob/secret.json")}`] } });
    expect("Bob re-proves his OLD share (valid proof, new transcript) to an Alice who saw it: seen-point registry rejects", setupAs(S, "alice"), /^ABORT: bob's share point P already seen in an earlier swap/); }
  { const S = await newSwap("l1-reuse-x-onchain", { seen: iso(), kg: { bob: [`reuse_x=${path.join(oldDir, "bob/secret.json")}`] } });
    const s = setupAs(S, "alice");
    R.rec("(limit) same reused share to a NEW Alice with a fresh registry: the valid proof is accepted; only a global/on-chain seen list (spec A.5) can catch it", "accept (documented limit)", s.ok === true, s.reason ?? "accepted"); }
  { const S = await newSwap("l1-reuse-nonce", { seen: seenOld, kg: { bob: [`reuse_nonce=${rd(path.join(oldDir, "bob/pub.json")).nonce}`] } });
    expect("Bob reuses his setup nonce from an earlier swap with the same Alice: rejected", setupAs(S, "alice"), /^ABORT: bob's setup nonce already seen in an earlier swap/); }
  { const S = await newSwap("l1-echo-nonce", { seen: iso(), kg: { bob: (S) => [`reuse_nonce=${rd(path.join(S.dir, "alice/pub.json")).nonce}`] } });
    expect("Bob echoes Alice's nonce as his own: rejected", setupAs(S, "alice"), /^ABORT: duplicate setup nonce/); }
  // 3. another network / other escrow parameters / other counterparty key: Bob proved under a different agreed parameter set
  const pcase = async (tag, ov, nm) => { const S = await newSwap(`l1-${tag}`, { seen: iso(), proveParams: { bob: ov } }); expect(nm, setupAs(S, "alice"), RING("bob")); };
  await pcase("net-ada", { ada_network_id: 1 }, "Bob's proof made for Cardano network id 1 (mainnet), verified in a network-0 swap: rejects");
  await pcase("net-zec", { zec_network: "zcash-mainnet" }, "Bob's proof made for another Zcash network: rejects");
  await pcase("amount", { lovelace: Number(ADA_LOCK) + 1 }, "Bob's proof made for a different ADA amount: rejects");
  await pcase("zats", { zats: ZEC_AMT - 1 }, "Bob's proof made for a different ZEC amount: rejects");
  await pcase("t1", { t1: OLD.T1 + 1000 }, "Bob's proof made for a different T1: rejects");
  await pcase("script", { script_hash: "00".repeat(28) }, "Bob's proof made for a different escrow script: rejects");
  await pcase("pkh", { alice_pkh: pkhOf(generateEmulatorAccountFromPrivateKey({ lovelace: 0n })) }, "Bob's proof made for a different Alice Cardano key: rejects");
  await pcase("govk", { alice_go_vk: goKeygen().vk }, "Bob's proof made for a different go key: rejects");
  // 4. swapped roles
  { const S = await newSwap("l1-role-label", { seen: iso(), cheat: { bob: "wrongctx" } });
    expect("Bob's proof made under Alice's role label: rejects", setupAs(S, "alice"), RING("bob")); }
  { const S = await newSwap("l1-role-slots", { seen: iso(), cheat: { bob: "swapslots" } });
    expect("Bob's proof made with the two parties' messages in swapped slots: rejects", setupAs(S, "alice"), RING("bob")); }
  { const S = await newSwap("l1-mirror", { seen: iso(), afterProve: (S) => {
      const ap = rd(path.join(S.dir, "alice/pub.json")); fs.writeFileSync(path.join(S.dir, "bob/pub.json"), JSON.stringify({ ...ap, role: "bob", dleq_file: "bob/dleq.bin" }));
      fs.copyFileSync(path.join(S.dir, "alice/dleq.bin"), path.join(S.dir, "bob/dleq.bin")); } });
    expect("Bob mirrors Alice's own round-1 message + proof back as his: rejected (A == B)", setupAs(S, "alice"), /^ABORT: duplicate share point \(A == B\)$/); }
  { const S = await newSwap("l1-mirror-nonce", { seen: iso(), afterProve: (S) => {
      const ap = rd(path.join(S.dir, "alice/pub.json")), bp_ = rd(path.join(S.dir, "bob/pub.json")); fs.writeFileSync(path.join(S.dir, "bob/pub.json"), JSON.stringify({ ...bp_, role: "alice" })); } });
    expect("Bob's round-1 message claims the alice role: rejected", setupAs(S, "alice"), /^ABORT: bob's round-1 message carries role/); }
  // 5. sanity: the old proof still verifies in its own swap (so the rejections above come from the transcript, not corrupt bytes)
  { const s = zec(["setup", `dir=${oldDir}`, "party=bob"], true); R.rec("sanity: the replayed proofs still verify in their own (old) swap", "accept", s.ok === true, s.reason ?? s.swap_id); }
  return { R };
}

// =====================================================================================================================
// review2 adversarial scenarios (independent review). Same harness as e2e3 (copied), fresh throwaway keys only.
// =====================================================================================================================
import { identityRSign } from "../../tests/ed25519_prims.mjs";
import { createRequire } from "module";
const requireR2 = createRequire(import.meta.url);
const sodium = requireR2("libsodium-wrappers-sumo"); await sodium.ready;
const sodiumVerify = (vk, msg, sig) => { try { return sodium.crypto_sign_verify_detached(Buffer.from(sig, "hex"), msg, Buffer.from(vk, "hex")); } catch { return false; } };
const lockRaw = async (S, R, datumCbor) => {   // Alice locks with an arbitrary (attacker-built) inline datum
  if (S.L.now() !== S.tSetup) throw new Error("time moved");
  S.swapId = swapIdOf(S, "alice");
  const lucid = await as(S, S.A);
  const tx = await lucid.newTx().pay.ToContract(S.scriptAddr, { kind: "inline", value: datumCbor }, { lovelace: ADA_LOCK }).complete();
  const r = await S.L.submit((await tx.sign.withWallet().complete()).toCBOR(), "lock");
  S.lockHash = r.txHash; await S.L.awaitBlock(1);
  S.escrow = (await S.L.em.getUtxos(S.scriptAddr)).find(u => u.txHash === r.txHash); return r;
};
const fieldsOf = (S) => { const pa = rd(path.join(S.dir, "alice/pub.json")), pb = rd(path.join(S.dir, "bob/pub.json"));
  return [pkhOf(S.A), pkhOf(S.B), S.go.vk, BigInt(NETWORK_ID), S.swapId, pa.Q, pb.Q, BigInt(S.T1), BigInt(S.T2)]; };
// Try a spend; returns "ACCEPTED" or the error string. Uses cheatEval so the ledger (not Lucid) decides.
const trySpend = async (S, acct, f) => { try { const t = await build(S, acct, f, true); const r = await signSubmit(S, t, acct, "probe"); return "ACCEPTED " + r.txHash.slice(0, 8); } catch (e) { return String(e.message).slice(0, 160); } };

// R2-A: datum type confusion. Bob's JS check compares Int fields with Number(x) and ignores the constructor tag and
// extra fields; Aiken decodes the datum on-chain. Does any datum pass Bob's check but disable a spending path?
async function dtype() {
  const R = new Results("r2-dtype"); console.log("== R2-A datum type confusion");
  const variants = [
    ["t2 as ByteArray of its decimal digits", (S, f) => { f[8] = (S.T2.toString().length % 2 ? "0" : "") + S.T2.toString(); return new Constr(0, f); }],
    ["network_id as ByteArray 0x00", (S, f) => { f[3] = "00"; return new Constr(0, f); }],
    ["t1 as ByteArray of its decimal digits", (S, f) => { f[7] = (S.T1.toString().length % 2 ? "0" : "") + S.T1.toString(); return new Constr(0, f); }],
    ["constructor tag 1 instead of 0", (S, f) => new Constr(1, f)],
    ["extra trailing field", (S, f) => new Constr(0, [...f, 7n])],
  ];
  const out = [];
  for (const [nm, mk] of variants) {
    const S = await newSwap(`r2-dtype`); doSetup(S); S.swapId = swapIdOf(S, "alice");
    const d = Data.to(mk(S, fieldsOf(S)));
    await lockRaw(S, R, d); await S.L.awaitBlock(K);
    let bob; try { bob = bobChecksLock(S) ?? "ACCEPTS (would fund ZEC)"; } catch (e) { bob = "THROWS: " + e.message.slice(0, 80); }
    // Redeem with a correct go_sig from Alice's real key, before T1
    S.goSig = goSign(S.go.sk, goMsg(goFields(S)));
    const red = await trySpend(S, S.B, redeemTx(S, secret(S, "bob"), S.goSig));
    // roll the probe back (if it was accepted it is only pending) by clearing the pool
    S.L.pending = [];
    await S.L.untilMs(S.T1); const ref = await trySpend(S, S.A, refundTx(S, secret(S, "alice"), S.T1)); S.L.pending = [];
    await S.L.untilMs(S.T2); const pun = await trySpend(S, S.B, punishTx(S, S.T2)); S.L.pending = [];
    out.push({ variant: nm, bobChecksLock: bob, redeem: red, refund: ref, punish: pun });
    console.log(JSON.stringify(out.at(-1)));
    const bobFunds = /ACCEPTS/.test(bob); const someDisabled = [red, ref, pun].some(x => !/^ACCEPTED/.test(x));
    R.rec(`datum variant "${nm}": Bob must refuse any datum under which a spending path differs from the honest datum`, "Bob refuses OR all paths behave as honest",
      !bobFunds || !someDisabled, JSON.stringify(out.at(-1)));
  }
  R.out = out; return { R };
}

// R2-B: go key sanity and evaluator divergence. Bob never checks that alice_go_vk is a valid prime-order point, and the
// simulator (and Lucid's local evaluator) use a UPLC Ed25519 builtin that is LAXER than cardano-node's libsodium.
async function gokey() {
  const R = new Results("r2-gokey"); console.log("== R2-B go key / Ed25519 evaluator divergence");
  const seed = crypto.randomBytes(32);
  const S = await newSwap("r2-gokey-idR");
  // replace go key before setup so params/swap_id/datum all use it consistently
  const probe = identityRSign(seed, Buffer.alloc(1));
  S.go = { vk: probe.vk, sk: probe.sk };
  fs.writeFileSync(path.join(S.dir, "params.json"), JSON.stringify(paramsOf(S), null, 1));
  for (const p of ["alice", "bob"]) zec(["prove", `dir=${S.dir}`, `party=${p}`]);
  doSetup(S); await lock(S, R); await S.L.awaitBlock(K); fundZec(S, R);
  const msg = goMsg(goFields(S));
  const { sig } = identityRSign(seed, msg);
  const offchain = goVerify(S.go.vk, msg, sig), lib = sodiumVerify(S.go.vk, msg, sig);
  S.goSig = sig;
  const sim = await trySpend(S, S.B, redeemTx(S, secret(S, "bob"), sig)); S.L.pending = [];
  R.rec("B1 identity-R go_sig: simulator ledger (Lucid UPLC builtin) ACCEPTS the Redeem", "observe", true, sim);
  R.rec("B1 identity-R go_sig: libsodium (= cardano-node builtin) REJECTS", "observe", lib === false, `libsodium=${lib}`);
  R.rec("B1 identity-R go_sig: Bob's Node/OpenSSL goVerify REJECTS (this, not the evaluator, is what protects Bob)", "observe", offchain === false, `node=${offchain}`);
  // B2: Alice agrees a SMALL-ORDER go key (identity point). Bob's setup/lock checks accept it.
  const S2 = await newSwap("r2-gokey-small");
  S2.go = { vk: "01" + "00".repeat(31), sk: null };
  fs.writeFileSync(path.join(S2.dir, "params.json"), JSON.stringify(paramsOf(S2), null, 1));
  for (const p of ["alice", "bob"]) zec(["prove", `dir=${S2.dir}`, `party=${p}`]);
  const st = doSetup(S2); await lock(S2, R); await S2.L.awaitBlock(K);
  const chk = bobChecksLock(S2);
  R.rec("B2 Alice's agreed go_vk is the identity point (small order): setup + Bob's lock check ACCEPT it (no key validation)", "observe", st.alice.ok && st.bob.ok && chk === null, chk ?? "accepted");
  // Under the lax builtin, ANYONE can forge a go: R = [r]B, S = r. Bob redeems WITHOUT Alice ever giving go.
  const r = BigInt("0x" + crypto.randomBytes(32).toString("hex")) % ((1n << 252n) + 27742317777372353535851937790883648493n);
  const rLe = Buffer.from(r.toString(16).padStart(64, "0"), "hex").reverse();
  const Rpt = Buffer.from(sodium.crypto_scalarmult_ed25519_base_noclamp(rLe));
  const forged = Buffer.concat([Rpt, rLe]).toString("hex");
  const m2 = goMsg(goFields(S2));
  const sim2 = await trySpend(S2, S2.B, redeemTx(S2, secret(S2, "bob"), forged)); S2.L.pending = [];
  R.rec("B2 forged go (no Alice involvement) under the identity go_vk: SIMULATOR accepts Bob's Redeem", "observe", /^ACCEPTED/.test(sim2), sim2);
  R.rec("B2 same forged go: libsodium (= cardano-node) rejects; Node/OpenSSL rejects", "observe", !sodiumVerify(S2.go.vk, m2, forged) && !goVerify(S2.go.vk, m2, forged), `libsodium=${sodiumVerify(S2.go.vk, m2, forged)} node=${goVerify(S2.go.vk, m2, forged)}`);
  return { R };
}

// R2-C: the e2e go-message negatives in goCases() are signed with the WRONG key (S2.go = S1.go after S2's datum was
// written), so they fail for the wrong reason. Show it: sign the CORRECT message with that same key -> still rejected.
async function gomsgIntegrity() {
  const R = new Results("r2-gomsg-integrity"); console.log("== R2-C are the e2e go-message negatives specific?");
  const S1 = await start("r2-go-s1", R); const S2 = await start("r2-go-s2", R);
  const b2 = secret(S2, "bob"); const own = S2.go;
  S2.go = S1.go;   // exactly what goCases() does
  const correctMsgWrongKey = goSign(S2.go.sk, goMsg(goFields(S2)));
  await mustFail(R, "C1 goCases-style sig over the CORRECT message (no field changed) is ALSO rejected => goCases negatives prove nothing about the fields", SCRIPT_FAIL,
    async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, correctMsgWrongKey), true), S2.B, "c1_correct_msg_wrong_key"));
  S2.go = own;     // fixed tests: Alice's REAL key, one field changed each
  const mk = (over) => goSign(own.sk, goMsg(goFields(S2, S2.escrow, over)));
  for (const [nm, over] of [["network id 1", { networkId: 1 }], ["domain v0", { domain: Buffer.from("zeUTXO/path1/go/v0") }], ["T1+1", { t1: S2.T1 + 1 }], ["other output index", { index: S2.escrow.outputIndex + 1 }], ["other swap id", { swapId: "ab".repeat(32) }]])
    await mustFail(R, `C2 fixed negative (real key, only ${nm} changed): script rejects`, SCRIPT_FAIL, async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, mk(over)), true), S2.B, `fixed_${nm}`));
  const ok = await trySpend(S2, S2.B, redeemTx(S2, b2, mk({})));
  R.rec("C3 control: real key, correct message: accepted", "accept", /^ACCEPTED/.test(ok), ok);
  return { R };
}

// R2-D: seen-registry and A==B checks compare HEX STRINGS from the counterparty's JSON. Upper-case hex decodes to the
// same bytes (same swap id, same point) but a different registry key.
async function seenHex() {
  const R = new Results("r2-seenhex"); console.log("== R2-D seen-registry bypass via hex case");
  const seen = { alice: path.join(RUNS, `seen-r2-alice-${crypto.randomBytes(4).toString("hex")}.json`), bob: path.join(RUNS, `seen-r2-bob-${crypto.randomBytes(4).toString("hex")}.json`) };
  const OLD = await newSwap("r2-seen-old", { seen }); const st = doSetup(OLD);
  R.rec("control: old swap set up, registry populated", "accept", st.alice.ok && st.bob.ok);
  const up = (S) => { const f = path.join(S.dir, "bob/pub.json"); const j = rd(f); fs.writeFileSync(f, JSON.stringify({ ...j, P: j.P.toUpperCase(), Q: j.Q.toUpperCase() })); };
  { const S = await newSwap("r2-seen-lower", { seen, kg: { bob: [`reuse_x=${path.join(OLD.dir, "bob/secret.json")}`] } });
    const s = setupAs(S, "alice"); R.rec("D1 control: Bob re-proves his OLD share (lower-case hex) to the same Alice: registry rejects", "reject", s.code !== 0 && /already seen/.test(s.reason ?? ""), s.reason); }
  { const S = await newSwap("r2-seen-upper", { seen, kg: { bob: [`reuse_x=${path.join(OLD.dir, "bob/secret.json")}`] }, beforeProve: up });
    const s = setupAs(S, "alice"); R.rec("D2 same reuse but Bob writes P,Q in UPPER-case hex: registry SHOULD reject", "reject", s.code !== 0 && /already seen/.test(s.reason ?? ""), s.reason ?? `ACCEPTED (swap_id ${s.swap_id})`); }
  return { R };
}


// R2-A2: full hostage sequence for the t2-as-ByteArray datum. Bob checks + funds ZEC; Alice never gives go; at T2 Bob's
// Punish is rejected by the script; long after T2 Alice can still Refund whenever she likes (or never).
async function hostage() {
  const R = new Results("r2-hostage"); console.log("== R2-A2 hostage: t2 encoded as ByteArray");
  const S = await newSwap("r2-hostage"); doSetup(S); S.swapId = swapIdOf(S, "alice");
  const f = fieldsOf(S); f[8] = (S.T2.toString().length % 2 ? "0" : "") + S.T2.toString();
  const d = Data.to(new Constr(0, f)); const honest = datumOf(S);
  await lockRaw(S, R, d); await S.L.awaitBlock(K);
  R.rec("Bob's bobChecksLock() accepts the malformed lock", "observe", bobChecksLock(S) === null, bobChecksLock(S) ?? "accepted");
  R.rec("but the inline datum bytes differ from the honest datum Bob could have rebuilt (byte-equality check would catch it)", "observe", d !== honest, `${d.slice(-40)} vs ${honest.slice(-40)}`);
  fundZec(S, R); R.rec("Bob funded the joint ZEC note (Z deep)", "observe", true);
  await S.L.untilMs(S.T2 + 20_000);
  const pun = await trySpend(S, S.B, punishTx(S, S.T2 + 20_000)); S.L.pending = [];
  R.rec("after T2 Bob tries Punish: SCRIPT REJECTS (t2 field cannot be decoded as Int)", "observe", !/^ACCEPTED/.test(pun), pun);
  await S.L.untilMs(S.T2 + 3_600_000);
  const ref = await trySpend(S, S.A, refundTx(S, secret(S, "alice"), S.T2 + 3_600_000));
  R.rec("one hour after T2 Alice can still Refund at a time of HER choosing (free option / extortion over Bob's ZEC)", "observe", /^ACCEPTED/.test(ref), ref);
  return { R };
}
const which = process.argv[2] || "all";
const all = { dtype, hostage, gokey, gomsgint: gomsgIntegrity, seenhex: seenHex };
const out = {}; const t0 = Date.now();
for (const [k, f] of Object.entries(all)) {
  if (which !== "all" && which !== k) continue;
  let R;
  try { ({ R } = await f()); } catch (e) { console.log(`== ${k}: CRASH ${e.stack}`); out[k] = { pass: false, crash: String(e.stack) }; continue; }
  out[k] = { pass: R.pass, checks: R.checks, extra: R.out };
  console.log(`== ${k}: ${R.pass ? "PASS" : "FINDING"} (${R.checks.filter(c => c.ok).length}/${R.checks.length} checks as expected-by-spec)`);
}
const f = path.join(ROOT, "results", `adv2-${which}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(f, JSON.stringify(out, (k, v) => typeof v === "bigint" ? Number(v) : v, 2));
console.log("results:", f);
