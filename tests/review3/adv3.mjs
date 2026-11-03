// zeUTXO path 1 STEP 5 (review2 fixes: F1 byte-exact datum, F2 strict Ed25519 + go-key validation, timing R/drift, value cap) on top of step 4 (L-1: setup proofs bound to a per-swap transcript; two-round setup) on top of step 3 — end-to-end simulated swaps with the go-MESSAGE design, the settlement-aware timing rule,
// live Zcash depth checks, expiry heights, rollbacks/reorgs/param changes. SIMULATOR ONLY: fresh in-run keys,
// no network, nothing real. Usage: node e2e3.mjs [l1|happy|refund|punish|setup|c1fee|c1cost|c2|c3|rbredeem|rbrefund|zreorg|zexpiry|gomsg|all]
import { Lucid, generateEmulatorAccountFromPrivateKey, Data, Constr, validatorToAddress, getAddressDetails, CML, createCostModels } from "@lucid-evolution/lucid";
import { StrictLedger, mainnetParams } from "./ledger.mjs";
import { goMsg, goKeygen, goSign, goVerify, goVerifyBob, goKeyCheck, sodiumVerify } from "./gomsg.mjs";
import { identityRSign } from "./ed25519_attack.mjs";
import { ledgerEd25519 } from "./nodecheck.mjs";
import { valueCapCheck, capUsd, VC } from "./valuecap.mjs";
import { createRequire } from "module";
const sodium = createRequire(import.meta.url)("libsodium-wrappers-sumo"); await sodium.ready;
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
const R_SLACK = 60_000;                                   // step 5 (F3): minimum slack R after a go given exactly at T0
const DRIFT = 30_000;                                    // step 5 (F4): Bob's clock-error margin; Bob's "now" = max(own clock, chain tip time) + DRIFT
const T1_OFF = T0_OFF + 1_000 + M + R_SLACK + 19_000;    // = 560 s  (rule v0.4: T1 ≥ T0 + 1 + M + R)
const T2_OFF = T1_OFF + M + 20_000;                      // = 820 s  (rule: T2 ≥ T1 + M + 1)
const LAST_OFF = T1_OFF - 1_000 - M;                     // = 319 s  Bob's last FIRST Redeem broadcast (LAST − T0 = 79 s ≥ R)
// Real-world depth profile the swap is agreed under (spec v0.4 §V): drives the value cap. The simulator's own K/ZDEPTH
// above are scaled-down logic-test depths; the cap check uses the agreed real depths in params (k_depth, z_depth).
const PROFILE = { kDepth: 15, zDepth: 60, era: "nu7", tier: "v1" };

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
    t0: S.T0, t1: S.T1, t2: S.T2, alice_pkh: pkhOf(S.A), bob_pkh: pkhOf(S.B), alice_go_vk: S.go.vk,
    k_depth: S.profile.kDepth, z_depth: S.profile.zDepth, ...(S.paramsOver || {}) };
}
async function newSwap(tag, opts = {}) {
  const dir = path.join(RUNS, `${tag}-${Date.now()}`); fs.mkdirSync(dir, { recursive: true });
  const A = generateEmulatorAccountFromPrivateKey({ lovelace: 2_000_000_000n });
  const B = generateEmulatorAccountFromPrivateKey({ lovelace: 300_000_000n });
  const L = new StrictLedger([A, B], { ...PP0 });
  if (!opts.laxLedger) L.overlay = ledgerEd25519(SCRIPT_HASH);   // F2: node-equivalent strict Ed25519 (separate from Bob's check)
  const lucid = await Lucid(L.em, "Custom");
  const go = goKeygen();                               // fresh single-purpose go key, per swap
  const S = { tag, dir, A, B, L, lucid, go, scriptAddr: validatorToAddress("Custom", SCRIPT), d: (...a) => [`dir=${dir}`, ...a],
    seen: { alice: seenDefault("alice"), bob: seenDefault("bob"), ...(opts.seen || {}) }, profile: { ...PROFILE, ...(opts.profile || {}) }, paramsOver: opts.paramsOver, bobSkew: 0 };
  if (opts.go) S.go = opts.go(S);
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
// Step 5: each party validates the agreed parameters before accepting setup (F2 go-key validation, F3 timing rule with R,
// F6 value cap). Then the Rust setup (DLEQ, transcript, canonical point encodings, seen-registry).
function paramsCheck(P) {
  const k = goKeyCheck(P.alice_go_vk); if (k) return k;
  for (const f of ["alice_pkh", "bob_pkh", "script_hash"]) if (typeof P[f] !== "string" || !/^[0-9a-f]{56}$/.test(P[f])) return `${f} must be 28 bytes lowercase hex`;
  if (P.alice_pkh === P.bob_pkh) return "alice_pkh == bob_pkh";
  if (P.script_hash !== SCRIPT_HASH) return "script hash is not the audited escrow";
  if (P.ada_network_id !== NETWORK_ID || P.zec_network !== ZEC_NET) return "network ids are not this wallet's networks";
  for (const f of ["lovelace", "zats", "t0", "t1", "t2", "k_depth", "z_depth"]) if (!Number.isSafeInteger(P[f]) || P[f] < 0) return `${f} must be a non-negative integer`;
  if (P.t1 < P.t0 + 1000 + M + R_SLACK || P.t2 < P.t1 + M + 1000) return "params violate the timing rule (T1 ≥ T0+1+M+R, T2 ≥ T1+M+1)";
  const v = valueCapCheck({ lovelace: P.lovelace, zats: P.zats, kDepth: P.k_depth, zDepth: P.z_depth, era: PROFILE.era, tier: PROFILE.tier }); if (v) return v;
  return null;
}
function setupAs(S, p) {
  const bad = paramsCheck(rd(path.join(S.dir, "params.json")));
  if (bad) return { code: 1, reason: `ABORT: ${p} refuses the agreed parameters: ${bad}` };
  return zec(["setup", ...S.d(`party=${p}`, `seen=${S.seen[p]}`)], true);
}
function doSetup(S) { const s = {}; for (const p of ["alice", "bob"]) s[p] = setupAs(S, p); return s; }
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
// Bob checks the lock before funding ZEC (step 5, F1 fix). Bob REBUILDS the expected inline datum himself — canonical
// Plutus-Data CBOR (the reference serialiser's bytes, as Data.to produces) from HIS copy of the agreed params, the swap
// id HE computed in setup, and the DLEQ-verified points from his view — and refuses unless the on-chain inline datum is
// byte-for-byte equal. He also checks: the exact outref of Alice's lock tx, confirmed + settled (≥ K); address = the
// escrow script with NO stake credential (none agreed); value = exactly the agreed lovelace, no other assets; datum
// INLINE (not a hash); and the params obey the timing rule. Every failure names its specific reason.
function expectedDatum(S) {
  const P = rd(path.join(S.dir, "params.json")), view = rd(path.join(S.dir, "bob/view.json"));
  return Data.to(new Constr(0, [P.alice_pkh, P.bob_pkh, P.alice_go_vk, BigInt(P.ada_network_id), view.swap_id, view.A_c, view.B_c, BigInt(P.t1), BigInt(P.t2)]));
}
const FIELD_NAMES = ["alice_pkh", "bob_pkh", "go_vk", "network_id", "swap_id", "a_c", "b_c", "t1", "t2"];
function datumDiag(raw, exp) {   // only for a precise error message; the decision is the byte comparison
  let d; try { d = Data.from(raw); } catch (e) { return "datum is not decodable Plutus data"; }
  const e = Data.from(exp);
  if (!(d instanceof Constr)) return "datum is not a constructor";
  if (d.index !== e.index) return `wrong constructor tag ${d.index} (expected ${e.index})`;
  if (d.fields.length !== e.fields.length) return `wrong field count ${d.fields.length} (expected ${e.fields.length})`;
  for (let i = 0; i < e.fields.length; i++) {
    const a = d.fields[i], b = e.fields[i];
    if (typeof a !== typeof b) return `field ${FIELD_NAMES[i]} has wrong type (${typeof a === "bigint" ? "int" : typeof a === "string" ? "bytes" : "other"}, expected ${typeof b === "bigint" ? "int" : "bytes"})`;
    if (a !== b) return `field ${FIELD_NAMES[i]} value differs from the agreed one`;
  }
  return "non-canonical CBOR encoding of the agreed values";
}
function bobChecksLock(S, { needSettled = true } = {}) {
  const u = S.escrow; if (!u) return "no escrow UTxO";
  if (u.txHash !== S.lockHash) return "escrow outref is not the output of Alice's announced lock tx";
  const e = S.L.entry(u.txHash + u.outputIndex); if (!e) return "escrow outref not in confirmed state";
  if (needSettled && S.L.confirmations(u.txHash) < K) return `lock not settled (${S.L.confirmations(u.txHash)} < ${K} confirmations)`;
  const ad = getAddressDetails(u.address);
  if (ad.paymentCredential?.type !== "Script" || ad.paymentCredential.hash !== SCRIPT_HASH) return "wrong script (payment credential is not the escrow script)";
  if (ad.stakeCredential) return "stake credential not agreed (escrow address must carry no stake credential)";
  if (u.address !== S.scriptAddr) return "wrong script address";
  if (Object.keys(u.assets).length !== 1 || BigInt(u.assets.lovelace) !== BigInt(rd(path.join(S.dir, "params.json")).lovelace)) return "wrong ADA amount / extra assets";
  if (!u.datum) return u.datumHash ? "datum is a hash, not inline" : "no datum";
  const exp = expectedDatum(S);
  if (u.datum !== exp) return `datum bytes differ from the expected canonical datum: ${datumDiag(u.datum, exp)}`;
  const P = rd(path.join(S.dir, "params.json"));
  if (P.t1 - P.t0 < M + R_SLACK + 1000 || P.t2 - P.t1 < M + 1000) return "wrong timelocks (rule T1 ≥ T0+1+M+R, T2 ≥ T1+M+1)";
  return null;
}
// raw Plutus-Data CBOR builder for attack datums (definite/indefinite lists, forced int widths, bignums)
const CB = {
  head: (major, n, width = null) => { const w = width ?? (n < 24 ? 0 : n < 256 ? 1 : n < 65536 ? 2 : n < 2 ** 32 ? 4 : 8);
    const m = major << 5; if (w === 0) return Buffer.from([m | Number(n)]);
    const ai = { 1: 24, 2: 25, 4: 26, 8: 27 }[w]; const b = Buffer.alloc(w); let x = BigInt(n); for (let i = w - 1; i >= 0; i--) { b[i] = Number(x & 255n); x >>= 8n; } return Buffer.concat([Buffer.from([m | ai]), b]); },
  int: (n, width) => n >= 0n ? CB.head(0, n, width) : CB.head(1, -1n - n, width),
  bignum: (n) => { let h = n.toString(16); if (h.length % 2) h = "0" + h; const b = Buffer.from(h, "hex"); return Buffer.concat([Buffer.from([0xc2]), CB.head(2, b.length), b]); },
  bytes: (hex) => { const b = Buffer.from(hex, "hex"); return Buffer.concat([CB.head(2, b.length), b]); },
  constr0: (items, { definite = false } = {}) => Buffer.concat([Buffer.from([0xd8, 0x79]), definite ? CB.head(4, items.length) : Buffer.from([0x9f]), ...items, definite ? Buffer.alloc(0) : Buffer.from([0xff])]),
};
const lockRaw = async (S, R, datumCbor, { kind = "inline", addr = S.scriptAddr, lovelace = ADA_LOCK } = {}) => {   // Alice locks with an attacker-built datum
  if (S.L.now() !== S.tSetup) throw new Error("time moved");
  S.swapId = swapIdOf(S, "alice");
  const lucid = await as(S, S.A);
  const tx = await lucid.newTx().pay.ToContract(addr, { kind, value: datumCbor }, { lovelace }).complete();
  const r = await S.L.submit((await tx.sign.withWallet().complete()).toCBOR(), "lock");
  S.lockHash = r.txHash; await S.L.awaitBlock(1);
  S.escrow = (await S.L.em.getUtxos(addr)).find(u => u.txHash === r.txHash); return r;
};
const fieldsOf = (S) => { const pa = rd(path.join(S.dir, "alice/pub.json")), pb = rd(path.join(S.dir, "bob/pub.json"));
  return [pkhOf(S.A), pkhOf(S.B), S.go.vk, BigInt(NETWORK_ID), S.swapId, pa.Q, pb.Q, BigInt(S.T1), BigInt(S.T2)]; };
const trySpend = async (S, acct, f) => { try { const t = await build(S, acct, f, true); const r = await signSubmit(S, t, acct, "probe"); return "ACCEPTED " + r.txHash.slice(0, 8); } catch (e) { return String(e.message).slice(0, 200); } };
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
// F4: Bob's notion of "now" is chain time — the slot time of the chain tip — never only his wall clock; a slow clock
// therefore cannot make him reveal b after LAST. DRIFT covers his own clock error and tip staleness within a block.
const tipTime = (S) => { const b = S.L.blocks.at(-1); return b ? S.L.zeroTime + b.slot * 1000 : S.L.zeroTime; };
const bobWall = (S) => S.L.now() + (S.bobSkew || 0);
const bobNow = (S) => Math.max(bobWall(S), tipTime(S)) + DRIFT;
const lovelaceAt = async (S, addr) => (await S.L.em.getUtxos(addr)).reduce((s, u) => s + BigInt(u.assets.lovelace), 0n);
const escrowLive = (S) => !!S.L.entry(S.escrow.txHash + S.escrow.outputIndex);

// Bob's Redeem procedure (spec §B): first broadcast only if now ≤ LAST = T1 − 1 s − M; afterwards, while now < T1,
// rebuild + re-sign + resubmit whenever his Redeem is no longer pending or confirmed (dropped, rolled back and
// dropped, fee/cost-model change...). The go_sig stays valid for every rebuild. Stops once settled (≥ K conf).
async function bobRedeem(S, R, b, { ignoreRule = false, maxBlocks = 60, hook = null } = {}) {
  if (!ignoreRule && bobNow(S) > S.LAST) return { refused: `past LAST (Bob's chain-time estimate ${(bobNow(S) - S.LAST) / 1000} s past it): Bob must not reveal b` };
  { const bad = goVerifyBob(S.go.vk, goMsg(goFields(S)), S.goSig); if (bad) return { refused: bad }; }   // F2: strict, two implementations, not the UPLC builtin
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
  R.rec("Bob checks the SETTLED lock (outref, script credential, no stake credential, exact value, inline datum byte-equal to his own canonical rebuild, timing rule)", "accept", bad === null, bad);
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
  R.rec("without a valid go signature Bob's tool never reveals b", "reject /^go_sig/", /^go_sig/.test(nogo.refused ?? ""), nogo.refused);
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
    R.rec("datum B_c is not Bob's DLEQ point: Bob refuses to fund", "reject /field b_c value differs/", /field b_c value differs/.test(bad ?? ""), bad); }
  await lockCase("setup-t2", { t2: 0n }, /field t2 value differs/, "wrong T2: Bob refuses to fund");
  await lockCase("setup-govk", { go_vk: goKeygen().vk }, /field go_vk value differs/, "datum go key ≠ the one agreed: Bob refuses to fund");
  await lockCase("setup-net", { net: 1n }, /field network_id value differs/, "datum network id = mainnet in a testnet swap: Bob refuses to fund");
  await lockCase("setup-swapid", { swap_id: "00".repeat(32) }, /field swap_id value differs/, "datum swap id ≠ H(setup transcript): Bob refuses to fund");
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
// Go-message design on the real ledger (step 5, F5 fix): every negative is signed with Alice's REAL go key of the swap
// under test and changes exactly ONE field of the go message; a positive control with no change is accepted. Errors are
// required to come from the escrow script itself (UPLC phase 2), not from the strict overlay.
const UPLC_FAIL = /^ScriptFailure \(phase 2\): /;
async function goCases() {
  const R = new Results("gomsg"); console.log("== go-message attacks on the strict ledger (field-isolated, real keys)");
  const S1 = await start("go-s1", R); const S2 = await start("go-s2", R);
  const b2 = secret(S2, "bob");
  await mustFail(R, "go_sig from swap 1 (its own key + escrow) replayed on swap 2: script rejects", UPLC_FAIL, async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, S1.goSig), true), S2.B, "replay"));
  const mk = (over) => goSign(S2.go.sk, goMsg(goFields(S2, S2.escrow, over)));
  for (const [nm, over] of [["network id 1 (mainnet)", { networkId: 1 }], ["signing domain v0", { domain: Buffer.from("zeUTXO/path1/go/v0") }], ["T1 + 1 ms", { t1: S2.T1 + 1 }],
      ["output index + 1", { index: S2.escrow.outputIndex + 1 }], ["swap id of another swap", { swapId: S1.swapId }], ["lovelace − 1", { lovelace: BigInt(S2.escrow.assets.lovelace) - 1n }], ["escrow txid of swap 1", { txId: S1.escrow.txHash }]])
    await mustFail(R, `real go key, ONLY ${nm} changed in the go message: script rejects`, UPLC_FAIL, async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, mk(over)), true), S2.B, `field_${nm}`));
  const sig = Buffer.from(S2.goSig, "hex"); const L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");
  const sInt = BigInt("0x" + Buffer.from(sig.subarray(32)).reverse().toString("hex")) + L; const sBytes = Buffer.from(sInt.toString(16).padStart(64, "0"), "hex").reverse();
  const mall = Buffer.concat([sig.subarray(0, 32), sBytes]).toString("hex");
  await mustFail(R, "malleated go_sig (S + ℓ, non-canonical): script rejects", SCRIPT_FAIL, async () => signSubmit(S2, await build(S2, S2.B, redeemTx(S2, b2, mall), true), S2.B, "malleated"));
  R.rec("malleated go_sig: Bob's own strict check names the reason", "reject /S ≥ ℓ/", /S ≥ ℓ/.test(goVerifyBob(S2.go.vk, goMsg(goFields(S2)), mall) ?? ""), goVerifyBob(S2.go.vk, goMsg(goFields(S2)), mall));
  await mustFail(R, "front-runner copies b + go_sig from the mempool, signs as itself: script rejects (Bob's signature required)", UPLC_FAIL, async () => signSubmit(S2, await build(S2, S2.A, redeemTx(S2, b2, S2.goSig, { signer: S2.A }), true), S2.A, "frontrun"));
  const ok = await trySpend(S2, S2.B, redeemTx(S2, b2, mk({})));
  R.rec("positive control: real key, unchanged go message: Redeem accepted by script + strict overlay", "accept", /^ACCEPTED/.test(ok), ok);
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


// ======================================================================================================================
// ---------- step 5 new scenarios ----------
// F1: Bob's lock check is a byte comparison against his own canonical rebuild of the datum (plus address, stake
// credential, value, inline). Every attacker-built datum variant must be refused with its specific error.
async function f1Cases() {
  const R = new Results("f1"); console.log("== F1: Bob refuses any lock whose datum is not byte-identical to the canonical agreed datum");
  const bytesOf = (v) => typeof v === "bigint" ? CB.int(v) : CB.bytes(v);
  const raw = (fs_, opt) => CB.constr0(fs_.map(bytesOf), opt).toString("hex");
  const variants = [
    ["t2 encoded as bytes (review2 dtype/hostage)", (f) => { const g = [...f]; return CB.constr0([...g.slice(0, 8).map(bytesOf), CB.bytes(Buffer.from(String(f[8])).toString("hex"))]).toString("hex"); }, /field t2 has wrong type \(bytes, expected int\)/],
    ["t1 encoded as bytes", (f) => CB.constr0([...f.slice(0, 7).map(bytesOf), CB.bytes("00"), bytesOf(f[8])]).toString("hex"), /field t1 has wrong type \(bytes, expected int\)/],
    ["network_id encoded as bytes", (f) => CB.constr0([...f.slice(0, 3).map(bytesOf), CB.bytes("00"), ...f.slice(4).map(bytesOf)]).toString("hex"), /field network_id has wrong type \(bytes, expected int\)/],
    ["a_c encoded as an int", (f) => CB.constr0([...f.slice(0, 5).map(bytesOf), CB.int(7n), ...f.slice(6).map(bytesOf)]).toString("hex"), /field a_c has wrong type \(int, expected bytes\)/],
    ["constructor tag 1 instead of 0", (f) => Data.to(new Constr(1, f)), /wrong constructor tag 1/],
    ["extra 10th field", (f) => raw([...f, 0n]), /wrong field count 10/],
    ["missing t2 (8 fields)", (f) => raw(f.slice(0, 8)), /wrong field count 8/],
    ["same values, definite-length list", (f) => raw(f, { definite: true }), /non-canonical CBOR encoding/],
    ["same values, network_id as a 2-byte (non-minimal) int", (f) => CB.constr0([...f.slice(0, 3).map(bytesOf), CB.int(f[3], 2), ...f.slice(4).map(bytesOf)]).toString("hex"), /non-canonical CBOR encoding/],
    ["same values, t2 as a CBOR bignum (tag 2)", (f) => CB.constr0([...f.slice(0, 8).map(bytesOf), CB.bignum(f[8])]).toString("hex"), /non-canonical CBOR encoding/],
    ["t2 = 2^70 (big int)", (f) => Data.to(new Constr(0, [...f.slice(0, 8), 1n << 70n])), /field t2 value differs/],
    ["t2 = −1", (f) => Data.to(new Constr(0, [...f.slice(0, 8), -1n])), /field t2 value differs/],
    ["go_vk of 33 bytes", (f) => Data.to(new Constr(0, [f[0], f[1], f[2] + "00", ...f.slice(3)])), /field go_vk value differs/],
  ];
  { const S = await newSwap("f1-control"); doSetup(S); S.swapId = swapIdOf(S, "alice");
    const viaCB = raw(fieldsOf(S)); const viaData = Data.to(new Constr(0, fieldsOf(S)));
    R.rec("builder sanity: hand-built canonical CBOR == Plutus Data.to bytes", "accept", viaCB === viaData && viaData === expectedDatum(S), viaData.slice(0, 24) + "…");
    await lockRaw(S, R, viaData); await S.L.awaitBlock(K);
    const bad = bobChecksLock(S); R.rec("control: honest canonical lock is accepted", "accept", bad === null, bad); }
  for (const [nm, mk, re] of variants) {
    const S = await newSwap("f1"); doSetup(S); S.swapId = swapIdOf(S, "alice");
    await lockRaw(S, R, mk(fieldsOf(S))); await S.L.awaitBlock(K);
    const stored = S.escrow?.datum; const bad = bobChecksLock(S);
    R.rec(`datum ${nm}: Bob refuses to fund`, `reject /datum bytes differ.*${re.source}/`, /^datum bytes differ from the expected canonical datum/.test(bad ?? "") && re.test(bad ?? ""), bad + (stored ? ` [ledger stored ${stored.length / 2} B verbatim]` : ""));
  }
  { const S = await newSwap("f1-hash"); doSetup(S); S.swapId = swapIdOf(S, "alice"); await lockRaw(S, R, Data.to(new Constr(0, fieldsOf(S))), { kind: "asHash" }); await S.L.awaitBlock(K);
    const bad = bobChecksLock(S); R.rec("canonical datum but attached as a datum HASH: Bob refuses", "reject /datum is a hash, not inline/", /datum is a hash, not inline/.test(bad ?? ""), bad); }
  { const S = await newSwap("f1-stake"); doSetup(S); S.swapId = swapIdOf(S, "alice");
    const addr = validatorToAddress("Custom", SCRIPT, { type: "Key", hash: pkhOf(S.A) });
    await lockRaw(S, R, Data.to(new Constr(0, fieldsOf(S))), { addr }); await S.L.awaitBlock(K);
    const bad = bobChecksLock(S); R.rec("right script, but Alice's stake credential on the escrow address: Bob refuses", "reject /stake credential not agreed/", /stake credential not agreed/.test(bad ?? ""), bad); }
  { const S = await newSwap("f1-value"); doSetup(S); S.swapId = swapIdOf(S, "alice"); await lockRaw(S, R, Data.to(new Constr(0, fieldsOf(S))), { lovelace: ADA_LOCK - 1n }); await S.L.awaitBlock(K);
    const bad = bobChecksLock(S); R.rec("canonical datum, 1 lovelace short: Bob refuses", "reject /wrong ADA amount/", /wrong ADA amount/.test(bad ?? ""), bad); }
  return { R };
}
// review2 hostage, re-run: Alice locks with t2 as bytes (Punish can never succeed, Bob's ZEC would be hostage).
// Expected now: Bob never funds; Alice just gets her own ADA back at T1. No honest party loses anything.
async function hostage() {
  const R = new Results("hostage"); console.log("== hostage (review2) re-run: Bob must refuse to fund");
  const S = await newSwap("hostage"); doSetup(S); S.swapId = swapIdOf(S, "alice"); const f = fieldsOf(S);
  await lockRaw(S, R, CB.constr0([...f.slice(0, 8).map(v => typeof v === "bigint" ? CB.int(v) : CB.bytes(v)), CB.bytes(Buffer.from(String(f[8])).toString("hex"))]).toString("hex")); await S.L.awaitBlock(K);
  const bad = bobChecksLock(S);
  R.rec("t2-as-bytes lock (Punish impossible): Bob refuses to fund ZEC", "reject /field t2 has wrong type/", /field t2 has wrong type/.test(bad ?? ""), bad);
  const bz = zec(["balance", ...S.d("party=bob")], true);
  R.rec("Bob's ZEC never left his wallet (no funding tx exists)", "accept", !fs.existsSync(path.join(S.dir, "fund.tx")), bz.unspent_zats !== undefined ? `${bz.unspent_zats} zats` : "no ZEC chain started");
  return { R, S };
}
// F2: strict Ed25519 (go signature) and go-key validation.
async function gokeyCases() {
  const R = new Results("f2"); console.log("== F2: forged go signatures and bad go keys");
  // (1) identity-R forgery-style signature under a VALID go key. Bob's tool and the node-equivalent ledger both refuse.
  { const S = await newSwap("f2-idr", { go: () => { const seed = crypto.randomBytes(32); const k = identityRSign(seed, Buffer.alloc(1)); return { vk: k.vk, sk: k.sk, seed }; } });
    const st = doSetup(S); R.rec("valid (prime-order) go key: setup accepted", "accept", st.alice.ok && st.bob.ok, st.alice.reason ?? st.bob.reason);
    await lock(S, R); await S.L.awaitBlock(K); fundZec(S, R);
    const idr = identityRSign(S.go.seed, goMsg(goFields(S))); S.goSig = idr.sig;
    const r = await bobRedeem(S, R, secret(S, "bob"));
    R.rec("go_sig with R = identity (small order): Bob's strict check refuses before revealing b", "reject /R is small-order/", /R is small-order/.test(r.refused ?? ""), r.refused);
    const ov = S.L.overlay; S.L.overlay = null;
    const lax = await trySpend(S, S.B, redeemTx(S, secret(S, "bob"), idr.sig)); S.L.pending = []; S.L.overlay = ov;
    R.rec("(observe) the local UPLC evaluator ALONE accepts this signature — why the strict node-equivalent check is required", "observe", true, lax);
    const strict = await trySpend(S, S.B, redeemTx(S, secret(S, "bob"), idr.sig));
    R.rec("same Redeem on the strict ledger (node Ed25519 = libsodium): rejected", "reject /node Ed25519 builtin = libsodium/", /node Ed25519 builtin = libsodium/.test(strict), strict); }
  // (2) bad go keys are refused by both parties at setup (paramsCheck), before any money moves.
  { const S = await newSwap("f2-idkey", { go: () => ({ vk: "01" + "00".repeat(31), sk: null }) });
    const st = doSetup(S);
    R.rec("go_vk = identity point (review2 gokey): Alice refuses at setup", "reject /go key .*identity/", st.alice.code !== 0 && /go key .*identity/.test(st.alice.reason ?? ""), st.alice.reason);
    R.rec("go_vk = identity point: Bob refuses at setup", "reject /go key .*identity/", st.bob.code !== 0 && /go key .*identity/.test(st.bob.reason ?? ""), st.bob.reason);
  }
  // and if a careless wallet had skipped that check: forged go (R=[r]B, S=r) under the identity key, valid for EVERY message
  const P0 = rd(path.join((await newSwapLite()).dir, "params.json"));
  const rr = 7n; const Rpt = Buffer.from(sodium.crypto_scalarmult_ed25519_base_noclamp(Buffer.from(rr.toString(16).padStart(64, "0"), "hex").reverse()));
  const forged = Buffer.concat([Rpt, Buffer.from(rr.toString(16).padStart(64, "0"), "hex").reverse()]).toString("hex");
  R.rec("(observe) OpenSSL alone on the identity-key forgery (R=[7]B, S=7, random message)", "observe", true, `openssl=${goVerify("01" + "00".repeat(31), crypto.randomBytes(129), forged)}`);
  { // review2 gokey end-to-end, with the setup check deliberately BYPASSED (careless wallet): the ledger must still refuse.
    const S = await newSwap("f2-idkey-bypass", { go: () => ({ vk: "01" + "00".repeat(31), sk: null }) });
    for (const p of ["alice", "bob"]) zec(["setup", ...S.d(`party=${p}`, `seen=${S.seen[p]}`)]);
    await lock(S, R); await S.L.awaitBlock(K);
    const ov = S.L.overlay; S.L.overlay = null;
    const lax = await trySpend(S, S.B, redeemTx(S, secret(S, "bob"), forged)); S.L.pending = []; S.L.overlay = ov;
    R.rec("(observe) setup check bypassed, identity go key on chain: the local UPLC evaluator alone accepts the forged go (review2 result)", "observe", true, lax);
    const strict = await trySpend(S, S.B, redeemTx(S, secret(S, "bob"), forged));
    R.rec("same forged Redeem on the strict ledger: rejected", "reject /node Ed25519 builtin = libsodium/", /node Ed25519 builtin = libsodium/.test(strict), strict); }
  R.rec("same forgery: Bob's strict go check refuses", "reject /go key|small-order|disagree|does not verify/", /identity|small-order|disagree|does not verify/.test(goVerifyBob("01" + "00".repeat(31), crypto.randomBytes(129), forged) ?? ""), goVerifyBob("01" + "00".repeat(31), crypto.randomBytes(129), forged));
  R.rec("same forgery: node-equivalent libsodium verify refuses", "reject", sodiumVerify("01" + "00".repeat(31), crypto.randomBytes(129), forged) === false, `libsodium=${sodiumVerify("01" + "00".repeat(31), crypto.randomBytes(129), forged)}`);
  const T = "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f";   // y = −1: the order-2 point
  const good = goKeygen().vk; const mixed = Buffer.from(sodium.crypto_core_ed25519_add(Buffer.from(good, "hex"), Buffer.from(T, "hex"))).toString("hex");
  let offCurve; for (;;) { const c = crypto.randomBytes(32); c[31] &= 0x7f; if (!sodium.crypto_core_ed25519_is_valid_point(c) && !sodium.crypto_core_ed25519_is_valid_point(Buffer.concat([c.subarray(0, 31), Buffer.from([c[31] | 0x80])]))) { offCurve = c.toString("hex"); break; } }
  for (const [nm, vk, re] of [["order-2 point (y = −1)", T, /small-order|not in the prime-order subgroup/], ["non-canonical encoding of the identity (y = p+1)", "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", /non-canonical/],
      ["honest key + order-2 component (mixed order)", mixed, /not in the prime-order subgroup/], ["32 bytes that are not a curve point", offCurve, /not on the curve/], ["31 bytes", good.slice(0, 62), /32 bytes/], ["upper-case hex", good.toUpperCase(), /lowercase hex/]]) {
    const bad = paramsCheck({ ...P0, alice_go_vk: vk }); R.rec(`go_vk = ${nm}: refused at setup`, `reject /${re.source}/`, bad !== null && re.test(bad), bad); }
  R.rec("control: a fresh honest go key passes the same check", "accept", paramsCheck({ ...P0, alice_go_vk: good }) === null, paramsCheck({ ...P0, alice_go_vk: good }));
  return { R };
}
async function newSwapLite() { return newSwap("lite"); }
// F3/F4 timing: late go, Bob's clock error, and the R slack rule.
async function timingCases() {
  const R = new Results("timing"); console.log("== F3/F4: late go at T0, Bob's clock skew, timing rule with R");
  { const S = await start("tm-late", R, { go: false }); await S.L.untilMs(S.T0);
    const g = aliceGo(S); R.rec("Alice gives go at exactly T0 (latest allowed)", "accept", !!g.sig, g.refused ?? `${(S.T0 - S.L.now()) / 1000} s before T0`);
    R.rec(`slack after a go at T0: LAST − T0 = ${(S.LAST - S.T0) / 1000} s ≥ R (${R_SLACK / 1000} s)`, "accept", S.LAST - S.T0 >= R_SLACK, `${(S.LAST - S.T0) / 1000} s`);
    const r = await bobRedeem(S, R, secret(S, "bob"));
    R.rec("Bob redeems after a go at T0 and settles before T1", "accept", r.settled && S.L.now() < S.T1, r.refused ?? r.why ?? `${(S.T1 - S.L.now()) / 1000} s before T1`);
    const { sw } = await aliceTakesZec(S, R); R.rec("Alice still sweeps the ZEC", "accept", !!sw.accepted, sw.reason); }
  { const S = await start("tm-slow", R); S.bobSkew = -120_000; await S.L.untilMs(S.LAST + 10_000);
    R.rec("(control) a wall-clock-only rule would let a 120 s-slow Bob reveal b now", "observe", bobWall(S) <= S.LAST, `Bob's wall clock ${(S.LAST - bobWall(S)) / 1000} s before LAST`);
    const r = await bobRedeem(S, R, secret(S, "bob"));
    R.rec("Bob's clock 120 s slow, true time LAST+10 s: chain-time rule refuses (uses max(own clock, tip time) + drift)", "reject /past LAST/", /past LAST/.test(r.refused ?? ""), r.refused);
    const rf = await aliceRefund(S, R, secret(S, "alice")); R.rec("Alice refunds; Bob keeps his ZEC (nothing revealed)", "accept", rf.settled, rf.why); }
  { const S = await start("tm-fast", R, { go: false }); S.bobSkew = +120_000; await S.L.untilMs(S.T0); aliceGo(S);
    const r = await bobRedeem(S, R, secret(S, "bob"));
    R.rec("Bob's clock 120 s fast, go at T0: he refuses early (liveness cost only, fails safe)", "reject /past LAST/", /past LAST/.test(r.refused ?? ""), r.refused);
    const rf = await aliceRefund(S, R, secret(S, "alice")); R.rec("Alice refunds; Bob keeps his ZEC", "accept", rf.settled, rf.why); }
  { const S = await newSwapLite(); const P = rd(path.join(S.dir, "params.json"));
    const bad = paramsCheck({ ...P, t1: P.t0 + 1000 + M }); R.rec("params with T1 = T0+1+M (no slack R): refused at setup", "reject /timing rule/", /timing rule/.test(bad ?? ""), bad);
    const ok = paramsCheck({ ...P, t1: P.t0 + 1000 + M + R_SLACK, t2: P.t0 + 1000 + M + R_SLACK + M + 1000 }); R.rec("params exactly at T1 = T0+1+M+R, T2 = T1+M+1: accepted", "accept", ok === null, ok); }
  return { R };
}
// F7: seen-registry hex-case bypass and non-canonical point encodings.
async function seenhexCases() {
  const R = new Results("seenhex"); console.log("== F7: seen registry canonicalises, non-canonical points rejected");
  const seen = { alice: path.join(RUNS, `seen-s5-alice-${crypto.randomBytes(4).toString("hex")}.json`), bob: path.join(RUNS, `seen-s5-bob-${crypto.randomBytes(4).toString("hex")}.json`) };
  const OLD = await newSwap("s5-seen-old", { seen }); const st = doSetup(OLD); R.rec("first swap: setup accepted", "accept", st.alice.ok && st.bob.ok, st.alice.reason);
  const reuse = { bob: [`reuse_x=${path.join(OLD.dir, "bob/secret.json")}`] };
  const edit = (fn) => (S) => { const f = path.join(S.dir, "bob/pub.json"); fs.writeFileSync(f, JSON.stringify(fn(rd(f)))); };
  { const S = await newSwap("s5-seen-lower", { seen, kg: reuse }); const s = setupAs(S, "alice"); R.rec("control: Bob re-uses his old share (lower-case): rejected as already seen", "reject /already seen/", s.code !== 0 && /already seen/.test(s.reason ?? ""), s.reason); }
  { const S = await newSwap("s5-seen-upper", { seen, kg: reuse, beforeProve: edit(j => ({ ...j, P: j.P.toUpperCase(), Q: j.Q.toUpperCase() })) }); const s = setupAs(S, "alice");
    R.rec("review2 bypass: same reuse in UPPER-case hex: now rejected as already seen", "reject /already seen/", s.code !== 0 && /already seen/.test(s.reason ?? ""), s.reason ?? `ACCEPTED ${s.swap_id}`); }
  { const S = await newSwap("s5-mirror", { seen: { alice: path.join(RUNS, `seen-m-${crypto.randomBytes(4).toString("hex")}.json`), bob: path.join(RUNS, `seen-m2-${crypto.randomBytes(4).toString("hex")}.json`) },
      afterProve: (S) => { const a = rd(path.join(S.dir, "alice/pub.json")); edit(j => ({ ...j, P: a.P.toUpperCase(), Q: a.Q.toUpperCase() }))(S); } });
    const s = setupAs(S, "alice"); R.rec("Bob mirrors Alice's points in upper-case: rejected", "reject /duplicate share point/", s.code !== 0 && /duplicate share point/.test(s.reason ?? ""), s.reason); }
  const fresh = () => ({ alice: path.join(RUNS, `seen-f-${crypto.randomBytes(4).toString("hex")}.json`), bob: path.join(RUNS, `seen-f2-${crypto.randomBytes(4).toString("hex")}.json`) });
  const PP = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001n;   // Pallas base field modulus
  for (const [nm, fn, re] of [
      ["Pallas P with x + p (non-canonical field element)", (j) => { const b = Buffer.from(j.P, "hex"); const sign = b[31] & 0x80; b[31] &= 0x7f; let x = BigInt("0x" + Buffer.from(b).reverse().toString("hex")) + PP; if (x >= (1n << 255n)) x -= PP; const o = Buffer.from(x.toString(16).padStart(64, "0"), "hex").reverse(); o[31] |= sign; return { ...j, P: o.toString("hex") }; }, /P is (a non-canonical encoding|not a valid Pallas point encoding)/],
      ["Pallas P = identity (all zero)", (j) => ({ ...j, P: "00".repeat(32) }), /P is (the identity|a non-canonical|not a valid)/],
      ["BLS Q with the compression flag cleared", (j) => { const b = Buffer.from(j.Q, "hex"); b[0] &= 0x7f; return { ...j, Q: b.toString("hex") }; }, /Q is not a valid BLS12-381 G1 subgroup point|non-canonical/],
      ["BLS Q = point at infinity", (j) => ({ ...j, Q: "c0" + "00".repeat(47) }), /Q is the identity|identity/]]) {
    const S = await newSwap("s5-noncanon", { seen: fresh(), afterProve: edit(fn) }); const s = setupAs(S, "alice");
    R.rec(`Bob publishes ${nm}: Alice aborts`, `reject /${re.source}/`, s.code !== 0 && re.test(s.reason ?? ""), s.reason ?? "ACCEPTED"); }
  return { R };
}
// F6: per-swap value cap in the wallet checks.
async function capCases() {
  const R = new Results("cap"); console.log("== value cap");
  const usd = (l, z) => Math.max(Number(l) / 1e6 * VC.ADA_usd, z / 1e8 * VC.ZEC_usd);   // value = larger leg (spec §V)
  { const S = await newSwap("cap-ok"); const st = doSetup(S); R.rec(`default swap ($${usd(ADA_LOCK, ZEC_AMT).toFixed(0)}) at K=15, Z=60 post-NU7 (cap $${capUsd(PROFILE).cap.toFixed(0)}): accepted`, "accept", st.alice.ok && st.bob.ok, st.alice.reason); }
  { const S = await newSwap("cap-big", { paramsOver: { zats: 2_000_000_000 } }); const st = doSetup(S);
    R.rec(`20 ZEC + 1000 ADA ($${usd(ADA_LOCK, 2e9).toFixed(0)}) at Z=60: both refuse, wallet names the depth needed`, "reject /above the per-swap cap.*needs Z ≥ 96/", st.alice.code !== 0 && st.bob.code !== 0 && /above the per-swap cap.*needs Z ≥ 96/.test(st.alice.reason ?? ""), st.alice.reason); }
  { const S = await newSwap("cap-deep", { paramsOver: { zats: 2_000_000_000 }, profile: { zDepth: 96 } }); const st = doSetup(S);
    R.rec("same value agreed at Z=96: accepted", "accept", st.alice.ok && st.bob.ok, st.alice.reason ?? `cap $${capUsd({ ...PROFILE, zDepth: 96 }).cap.toFixed(0)}`); }
  { const v = valueCapCheck({ lovelace: Number(ADA_LOCK), zats: ZEC_AMT, kDepth: 15, zDepth: 10, era: "now", tier: "rehearsal" });
    R.rec(`rehearsal tier ($500 ceiling): this $${usd(ADA_LOCK, ZEC_AMT).toFixed(0)} swap refused`, "reject /above the per-swap cap \\$500/", /above the per-swap cap \$500/.test(v ?? ""), v);
    const v2 = valueCapCheck({ lovelace: 1_000_000_000, zats: 10_000_000, kDepth: 15, zDepth: 10, era: "now", tier: "rehearsal" });
    R.rec("rehearsal tier: 1000 ADA + 0.1 ZEC (~$313) at K=15, Z=10 now: accepted", "accept", v2 === null, v2); }
  { const v = valueCapCheck({ lovelace: 1_000_000, zats: 1_000_000, kDepth: 15, zDepth: 30, era: "nu7", tier: "v1" });
    R.rec("v1 tier at Z=30: any value refused (reversal probability for the largest pool above 1e-3)", "reject", v !== null, v);
    const v3 = valueCapCheck({ lovelace: 1_000_000, zats: 1_000_000, kDepth: 10, zDepth: 60, era: "nu7", tier: "v1" });
    R.rec("Cardano depth K=10 below the K=15 floor: refused", "reject", v3 !== null, v3); }
  return { R };
}

// ===== review3 adversarial additions (fresh throwaway emulator keys only) =====
async function r3RefScript() {
  const R = new Results("r3-refscript"); console.log("== R3: lock UTxO carrying a reference script");
  const S = await newSwap("r3-refscript"); doSetup(S); S.swapId = swapIdOf(S, "alice");
  const lucid = await as(S, S.A);
  const datum = Data.to(new Constr(0, fieldsOf(S)));
  const tx = await lucid.newTx().pay.ToContract(S.scriptAddr, { kind: "inline", value: datum }, { lovelace: ADA_LOCK }, SCRIPT).complete();
  const r = await S.L.submit((await tx.sign.withWallet().complete()).toCBOR(), "lock+refscript");
  S.lockHash = r.txHash; await S.L.awaitBlock(1);
  S.escrow = (await S.L.em.getUtxos(S.scriptAddr)).find(u => u.txHash === r.txHash);
  await S.L.awaitBlock(K);
  const bad = bobChecksLock(S);
  const refBytes = S.escrow?.scriptRef ? S.escrow.scriptRef.script.length / 2 : 0;
  R.rec(`lock with canonical datum + ${refBytes}-byte reference script attached: does Bob's F1 check refuse?`, "reject (spec B.1 should pin the whole output)", bad !== null, bad ?? `ACCEPTED (scriptRef present: ${!!S.escrow?.scriptRef})`);
  return { R, S };
}
const which = process.argv[2] || "r3";
const all = { r3: r3RefScript };
for (const [k, f] of Object.entries(all)) { if (which !== k) continue; const { R } = await f(); console.log(JSON.stringify(R.checks, (k, v) => typeof v === "bigint" ? Number(v) : v, 1)); }
