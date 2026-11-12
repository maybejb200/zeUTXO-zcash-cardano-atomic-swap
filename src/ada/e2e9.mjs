// zeUTXO path 1 STEP 9 (review5 fixes: bounded Reveal HOLD + late cutoff, provenance-checked RefundReveal, node-derived era, T3-wide blackout, min-ADA; D35-D46).
// zeUTXO path 1 STEP 8: TWO-STEP CLAIM AND TWO-STEP REFUND (Notice → RefundReveal{a} | Forfeit at t4; Punish removed — decisions D23-D32).
// Built on STEP 7: TWO-STEP escrow (Commit{go_sig} → Reveal{b}, Escape at T3; review4 escrow2, tightened), no premium, fail-closed gates (policy7).
// Built on STEP 6: Zcash leg on IRONWOOD (NU6.3 v6, ZIP 2005 use_qsk) + review3 gates (NU7, congestion, value cap, LAST_REFUND, scriptRef). Built on STEP 5 (review2 fixes: F1 byte-exact datum, F2 strict Ed25519 + go-key validation, timing R/drift, value cap) on top of step 4 (L-1: setup proofs bound to a per-swap transcript; two-round setup) on top of step 3 — end-to-end simulated swaps with the go-MESSAGE design, the settlement-aware timing rule,
// live Zcash depth checks, expiry heights, rollbacks/reorgs/param changes. SIMULATOR ONLY: fresh in-run keys,
// no network, nothing real. Usage: node e2e3.mjs [l1|happy|refund|punish|setup|c1fee|c1cost|c2|c3|rbredeem|rbrefund|zreorg|zexpiry|gomsg|all]
import { Lucid, generateEmulatorAccountFromPrivateKey, Data, Constr, validatorToAddress, getAddressDetails, CML, createCostModels } from "@lucid-evolution/lucid";
import { StrictLedger, mainnetParams } from "./ledger.mjs";
import { goMsg, goKeygen, goSign, goVerify, goVerifyBob, goKeyCheck, sodiumVerify } from "./gomsg.mjs";
import { identityRSign } from "./ed25519_attack.mjs";
import { ledgerEd25519 } from "./nodecheck.mjs";
import { valueCapCheck, capUsd, VC } from "./valuecap.mjs";
import { valueCap7, nu7Gate7, nu7BlackoutBlocks, commitGate, revealGate, escapeGate, upgradeBlackoutGate, swapUsd, P7, minZ, noticeGate, bobNoticeGate, refundRevealGate, forfeitGate, NOTICE_RANGE_MAX } from "./policy8.mjs";
import { revealGate9, revealParamsCheck, refundProvenance9, nodeEra9, nu7Gate9, valueCap9, zNeeded9, minAdaLock9, zebraVersionGate, P9 } from "./policy9.mjs";
import { slotToMs, noticeWindow, decodeCreating, lowerBoundMs, txRedeemerData } from "./chaintx.mjs";
import { PartyView } from "./party.mjs";
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
// step 10 (audit A5): E2E_PROFILE=rehearsal runs the suite at the rehearsal's NU7 / K=15 / Z=30 settings (default: the step 9 sim).
const REH = process.env.E2E_PROFILE === "rehearsal";
const ADA_LOCK = 1_000_000_000n, ZEC_AMT = REH ? 30_000_000 : 50_000_000, NETWORK_ID = 0;   // rehearsal: 0.3 ZEC keeps the swap under the $500 cap
// ---- timing rule (spec v0.2 §T; derived in model/foc_model3.py) ----
// blocks every 20 s. D = inclusion bound (adversary may delay a valid tx up to D), S = settlement (rollbacks
// shallower than K blocks are possible), DA = D + S, E = 1 (a fee/cost-model change may land in any window).
const BLOCK = 20_000, D = 60_000, K = REH ? 15 : 3, S_SET = K * BLOCK, DA = D + S_SET, E = 1, M = (1 + E) * DA;   // M = 240 s
const ZDEPTH = REH ? 30 : 3;                                      // Z: Zcash funding depth Alice requires before "go"
const T0_OFF = 2 * DA;                                     // ≥ DA (lock settles) + Zcash funding + Z
const R_SLACK = 60_000;                                   // step 5 (F3): minimum slack R after a go given exactly at T0
const DRIFT = 30_000;                                    // step 5 (F4): Bob's clock-error margin; Bob's "now" = max(own clock, chain tip time) + DRIFT
// step 7 (two-step escrow; derivation in model/step7_model.py and decisions D16): the Commit carries NO secret, so it only
// has to be INCLUDED before T1: Mc = (1+E)·D. Alice may start a Refund only once the escrow is still Open K blocks after T1.
const MC = (1 + E) * D;                                  // = 120 s  Commit inclusion budget
const T1_OFF = T0_OFF + 1_000 + R_SLACK + MC + 19_000;   // = 440 s  (rule v0.6: T1 ≥ T0 + 1 + R + Mc)
const LAST_OFF = T1_OFF - 1_000 - MC;                    // = 319 s  LAST_COMMIT: Bob's last first Commit broadcast (LAST − T0 = 79 s ≥ R)
// step 8 (D25/D26): Alice may send her (secret-free) Notice from T1; Bob may send the same Notice from T2 (liveness only).
const T2_OFF = T1_OFF + S_SET + 1_000 + R_SLACK + MC + 19_000;   // = 700 s  (rule v0.7: T2 ≥ T1 + S + 1 + R + Mc)
const NOTICE_TTL = 120_000;                               // sim: a Notice is valid for 120 s (real wallet: 1 h; script cap 6 h)
const T3_OFF = T1_OFF + (REH ? 3_000_000 : 1_200_000);                     // = 1640 s Escape (sim: T1 + 20 min; real profile: T1 + 7 days)
const T3_MIN = T3_OFF - T1_OFF;                              // wallets refuse T3 < T1 + T3_MIN (real: 7 days)
const TAIL = T3_OFF - T1_OFF;
const HOLD_CAP = REH ? 300_000 : 120_000, LATE_CUTOFF = REH ? 860_000 : 343_000;   // rehearsal: 10 % of the 3000 s tail; cutoff ≥ M = 720 s          // step 9 (R5-H1): sim hold cap (10 % of tail) and late-reveal cutoff (2/7 of tail); real 90 min and 2 d
{ const bad = revealParamsCheck({ tailMs: TAIL, holdCapMs: HOLD_CAP, lateCutoffMs: LATE_CUTOFF, M }); if (bad) throw new Error(bad); }                            // = 1200 s refund-reveal tail: t4 = Notice upper + TAIL (real: 7 days), D24
// Real-world depth profile the swap is agreed under (spec v0.4 §V): drives the value cap. The simulator's own K/ZDEPTH
// above are scaled-down logic-test depths; the cap check uses the agreed real depths in params (k_depth, z_depth).
const PROFILE = REH ? { kDepth: 15, zDepth: 30, era: "nu7", tier: "rehearsal" } : { kDepth: 15, zDepth: 69, era: "nu7", tier: "v1" };   // step 6 (R3-H3): Z = 69 for ε = 1e-3 at q = 0.35 with 5% stales
const ZEC_BRANCH = REH ? 0x77190ad9 : 0x37a5165b;                                        // NU6.3 (the sim chain runs NU6.3 unless a test activates NU7)
// dated feed the wallet observed (sim: fixed, refreshed "1 h ago"); a real wallet fetches it and fails closed if > 24 h old
// step 7 (review4 F3): the cap uses THESE feed prices, never constants; explicit dated values (2026-11-02 observation)
const FEED = () => ({ asOf: Date.now() - 3600e3, pools: [0.33, 0.145, 0.12, 0.1], zecUsd: 1254.54, adaUsd: 0.188 });
const UPGRADES = () => [];   // review4 F5: the wallet's scheduled-upgrade list (sim: none scheduled; a missing list refuses)

// ---------- helpers ----------
// step 10 (A5): under the rehearsal profile every sim Zcash chain starts post-NU7, past the 24 h post-activation blackout
// (3,456 blocks at 25 s), unless the test sets its own nu7_height.
let PIN_NU63 = false;   // the nu7 group tests the NU6.3 → NU7 transition itself, so it pins the step 9 NU6.3 chain in both profiles
const REH_GENESIS = ["nu7_height=100", `start_height=${100 + 3456 + 500}`];
function zec(args, allowFail = false) {
  if (REH && !PIN_NU63 && args[0] === "genesis" && !args.some(a => /^nu7_height=/.test(a))) args = [...args, ...REH_GENESIS.filter(g => !(g.startsWith("start_height=") && args.some(a => /^start_height=/.test(a))))];
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
    t0: S.T0, t1: S.T1, t2: S.T2, t3: S.T3, alice_pkh: pkhOf(S.A), bob_pkh: pkhOf(S.B), alice_go_vk: S.go.vk,
    k_depth: S.profile.kDepth, z_depth: S.profile.zDepth, zec_branch: PIN_NU63 ? 0x37a5165b : ZEC_BRANCH, ...(S.paramsOver || {}) };
}
async function newSwap(tag, opts = {}) {
  const dir = path.join(RUNS, `${tag}-${Date.now()}`); fs.mkdirSync(dir, { recursive: true });
  const A = generateEmulatorAccountFromPrivateKey({ lovelace: 2_000_000_000n });
  const B = generateEmulatorAccountFromPrivateKey({ lovelace: /^r9-fake/.test(tag) ? 3_000_000_000n : 300_000_000n });   // step 9: Bob funds a look-alike in r9_fake_refunding
  const L = new StrictLedger([A, B], { ...PP0 });
  if (!opts.laxLedger) L.overlay = ledgerEd25519(SCRIPT_HASH);   // F2: node-equivalent strict Ed25519 (separate from Bob's check)
  const lucid = await Lucid(L.em, "Custom");
  const go = goKeygen();                               // fresh single-purpose go key, per swap
  const S = { tag, dir, A, B, L, lucid, go, scriptAddr: validatorToAddress("Custom", SCRIPT), d: (...a) => [`dir=${dir}`, ...a],
    seen: { alice: seenDefault("alice"), bob: seenDefault("bob"), ...(opts.seen || {}) }, profile: { ...PROFILE, ...(opts.profile || {}) }, paramsOver: opts.paramsOver, bobSkew: 0 };
  if (opts.go) S.go = opts.go(S);
  const t0 = L.now(); S.tSetup = t0; S.T0 = t0 + T0_OFF; S.T1 = t0 + T1_OFF; S.T2 = t0 + T2_OFF; S.T3 = t0 + T3_OFF; S.LAST = t0 + LAST_OFF; S.directStake = 1.0;
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
let P7feed = undefined, P7exposure = 0, P7upgrades = undefined;   // test hooks: the observed feed and this counterparty's exposure counter
function paramsCheck(P) {
  const k = goKeyCheck(P.alice_go_vk); if (k) return k;
  for (const f of ["alice_pkh", "bob_pkh", "script_hash"]) if (typeof P[f] !== "string" || !/^[0-9a-f]{56}$/.test(P[f])) return `${f} must be 28 bytes lowercase hex`;
  if (P.alice_pkh === P.bob_pkh) return "alice_pkh == bob_pkh";
  if (P.script_hash !== SCRIPT_HASH) return "script hash is not the audited escrow";
  if (P.ada_network_id !== NETWORK_ID || P.zec_network !== ZEC_NET) return "network ids are not this wallet's networks";
  for (const f of ["lovelace", "zats", "t0", "t1", "t2", "t3", "k_depth", "z_depth"]) if (!Number.isSafeInteger(P[f]) || P[f] < 0) return `${f} must be a non-negative integer`;
  const tr = timingRule(P); if (tr) return tr;
  if (P.zec_branch !== 0x37a5165b && P.zec_branch !== 0x77190ad9) return "zec_branch must be NU6.3 or NU7";
  const now = Date.now();
  const v = valueCap7({ lovelace: P.lovelace, zats: P.zats, zDepth: P.z_depth, kDepth: P.k_depth, era: PROFILE.era, tier: PROFILE.tier, feed: P7feed === undefined ? FEED() : P7feed, now, exposureSoFar: P7exposure }); if (v) return v;
  // step 10 (review 6 R6-M3): the scheduled-upgrade blackout covers the whole swap to T3 (the refund tail), as the NU7 gate
  // already does (R5-L2); it used to stop at T2. upgradeBlackoutGate adds its own P7.blackoutH margin on both sides.
  const u = upgradeBlackoutGate({ now, windowEnd: now + (P.t3 - P.t0) + T0_OFF, events: P7upgrades === undefined ? UPGRADES() : P7upgrades }); if (u) return u;
  return null;
}
// step 8 timing rule (spec v0.7 §T): T1 ≥ T0+1+Mc+R, T2 ≥ T1+S+1+R+Mc (liveness only), T3 ≥ T1+T3min (T3−T1 is also the refund tail)
function timingRule(P) {
  if (!(P.t1 >= P.t0 + 1000 + MC + R_SLACK) || !(P.t2 >= P.t1 + S_SET + 1000 + R_SLACK + MC) || !(P.t3 >= P.t1 + T3_MIN))
    return "params violate the timing rule (T1 ≥ T0+1+Mc+R, T2 ≥ T1+S+1+R+Mc, T3 ≥ T1+T3min)";
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
// Size of this swap's Refunding datum with the widest t4 a POSIX-ms value can take (8-byte CBOR int), for the W.1 min-ADA rule.
const refundingDatumBytes = (S) => datumOf(S, { phase: 2n, t4: BigInt(Number.MAX_SAFE_INTEGER) }).length / 2;
function datumOf(S, over = {}) {
  const pa = rd(path.join(S.dir, "alice/pub.json")), pb = rd(path.join(S.dir, "bob/pub.json"));
  const f = { alice: pkhOf(S.A), bob: pkhOf(S.B), go_vk: S.go.vk, net: BigInt(NETWORK_ID), swap_id: S.swapId, a_c: pa.Q, b_c: pb.Q, t1: BigInt(S.T1), t2: BigInt(S.T2), t3: BigInt(S.T3), phase: 0n, t4: 0n, ...over };
  return Data.to(new Constr(0, [f.alice, f.bob, f.go_vk, f.net, f.swap_id, f.a_c, f.b_c, f.t1, f.t2, f.t3, f.phase, f.t4]));
}
async function refreshParams(S) { await S.lucid.switchProvider(S.L.em); }   // wallets re-read params after a change
async function lock(S, R, over = {}) {
  if (S.L.now() !== S.tSetup) throw new Error("lock: ledger time moved since setup; T0/T1/T2 in the transcript would be stale");
  S.swapId = swapIdOf(S, "alice");
  { const m = minAdaLock9({ lovelace: ADA_LOCK, refundingDatumBytes: refundingDatumBytes(S) }); if (m) throw new Error("lock: " + m); }   // step 10 (review 6 R6-M3): W.1 before Alice locks
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
  return Data.to(new Constr(0, [P.alice_pkh, P.bob_pkh, P.alice_go_vk, BigInt(P.ada_network_id), view.swap_id, view.A_c, view.B_c, BigInt(P.t1), BigInt(P.t2), BigInt(P.t3), 0n, 0n]));   // phase 0 = Open, t4 = 0
}
const FIELD_NAMES = ["alice_pkh", "bob_pkh", "go_vk", "network_id", "swap_id", "a_c", "b_c", "t1", "t2", "t3", "phase", "t4"];
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
  { const m = minAdaLock9({ lovelace: u.assets.lovelace, refundingDatumBytes: refundingDatumBytes(S) }); if (m) return m; }   // step 10 (review 6 R6-M3): W.1 min-ADA
  if (!u.datum) return u.datumHash ? "datum is a hash, not inline" : "no datum";
  const exp = expectedDatum(S);
  if (u.datum !== exp) return `datum bytes differ from the expected canonical datum: ${datumDiag(u.datum, exp)}`;
  const P = rd(path.join(S.dir, "params.json"));
  if (timingRule(P)) return "wrong timelocks (" + timingRule(P) + ")";
  if (u.scriptRef) return `lock output carries a reference script (${u.scriptRef.script.length / 2} B): refuse (R3-L1, the full TxOut is pinned)`;
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
  return [pkhOf(S.A), pkhOf(S.B), S.go.vk, BigInt(NETWORK_ID), S.swapId, pa.Q, pb.Q, BigInt(S.T1), BigInt(S.T2), BigInt(S.T3), 0n, 0n]; };
const trySpend = async (S, acct, f) => { try { const t = await build(S, acct, f, true); const r = await signSubmit(S, t, acct, "probe"); return "ACCEPTED " + r.txHash.slice(0, 8); } catch (e) { return String(e.message).slice(0, 200); } };
function zecGate(S) {   // step 6 R3-H1 + step 7 (review4 F4): own node, measured spacing over ≥ 48 blocks, NO nominal fallback
  const st = zec(["status", ...S.d(`window=${P7.minSpacingWindow}`)]); const P = rd(path.join(S.dir, "params.json"));
  const meta = { version: "7.0.0", eosOffset: 1_000_000, ...(S.nodeMeta || {}) };            // simulated node RPC fields (getinfo build / EOS height)
  const rpc = { ...st, version: meta.version };
  const node = nodeEra9(rpc, { configBranch: P.zec_branch, configEra: S.configEra, configSpacingS: S.configSpacingS });   // step 9 (R5-M2): era from the node
  if (node.refuse) return node.refuse;
  S.nodeEra = node;
  const g = nu7Gate9({ st: rpc, node, measuredSpacing: st.measured_mean_spacing_s, spacingWindow: st.window, tailSeconds: REAL_TAIL_S, preT1Seconds: REAL_PRE_S,
    eosHeight: "eos" in meta ? meta.eos : (st.tip + meta.eosOffset), nodeSupportsNu7: S.nodeSupportsNu7 ?? true });
  if (g) return g;
  // step 10 (review 6 R6-M3): re-run the value cap with the era the NODE reports (valueCap9, R5-M2/M3). Setup's paramsCheck only
  // has the configured era (valueCap7), because the node is not consulted until here, before Bob funds ZEC.
  return valueCap9({ lovelace: P.lovelace, zats: P.zats, zDepth: P.z_depth, kDepth: P.k_depth, node, tier: PROFILE.tier, feed: P7feed === undefined ? FEED() : P7feed, now: Date.now(), exposureSoFar: P7exposure });
}
// v1 real window, setup → T2 = 252.1 min (model/step7_model.py, gate profile) + 24 h: the T3 tail is not blacked out (D19)
const REAL_SWAP_S = Math.round(252.1 * 60) + 24 * 3600;
const REAL_PRE_S = Math.round(252.1 * 60), REAL_TAIL_S = 7 * 86400 + 3 * 3600;   // step 9 (R5-L2): blackout/EOS cover setup → T3 (+ t4 slack) + 24 h
const ZEC_HISTORY = P7.minSpacingWindow;   // the sim chain mines this many nominal blocks after genesis so the gate can measure
function fundZec(S, R, pay = ZEC_AMT, mineN = ZDEPTH - 1, genesisArgs = []) {
  zec(["genesis", ...S.d(...genesisArgs)]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]);
  { const g = zecGate(S); if (g) throw new Error("Bob's Zcash gate: " + g); }
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
// step 8 redeemers (escrow v0.7): Commit{go_sig}=0, Reveal{b}=1, Notice=2, RefundReveal{a}=3, Forfeit=4, Escape=5
const Commit = (sig) => Data.to(new Constr(0, [sig])), Reveal = (b) => Data.to(new Constr(1, [b])), Notice = Data.to(new Constr(2, [])), RefundReveal = (a) => Data.to(new Constr(3, [a])), Forfeit = Data.to(new Constr(4, [])), Escape = Data.to(new Constr(5, []));
// Commit: spends the OPEN escrow, recreates it at the same script address with the same value and the phase=1 datum.
const commitTx = (S, sig, { upper = S.T1 - 1000, signer, out = null, utxo = null, lovelace = null } = {}) => (tx) => {
  const u = utxo ?? S.escrow;
  let t = tx.collectFrom([u], Commit(sig)).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.B))
    .pay.ToContract(S.scriptAddr, { kind: "inline", value: out ?? datumOf(S, { phase: 1n }) }, { lovelace: lovelace ?? BigInt(u.assets.lovelace) });
  if (upper !== null) t = t.validTo(upper); return t; };
const revealTx = (S, b, { utxo = null, signer } = {}) => (tx) => tx.collectFrom([utxo ?? S.claimed], Reveal(b)).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.B));
const escapeTx = (S, from, { utxo = null, signer } = {}) => (tx) => tx.collectFrom([utxo ?? S.claimed], Escape).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.A)).validFrom(lowerBoundMs(from, S.T3, slotCfg(S)));   // step 10 (A2): lower ≥ T3 survives slot rounding
// step 8: Notice spends the OPEN escrow and recreates it with phase=2 and t4 = upper + TAIL (validity [from, to]).
const slotCfg = (S) => ({ zeroTime: S.L.zeroTime, zeroSlot: 0, slotLength: 1000 });   // emulator ("Custom") slot config
const refundingDatum = (S, to) => datumOf(S, { phase: 2n, t4: BigInt(to + TAIL) });
const noticeTx = (S, from, { to = null, signer, utxo = null, out = null, lovelace = null, minLo } = {}) => (tx) => {
  const u = utxo ?? S.escrow; const w = to !== null ? { from, hi: to } : noticeWindow(from, NOTICE_TTL, slotCfg(S), minLo); const hi = w.hi; from = w.from;
  return tx.collectFrom([u], Notice).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.A))
    .pay.ToContract(S.scriptAddr, { kind: "inline", value: out ?? refundingDatum(S, hi) }, { lovelace: lovelace ?? BigInt(u.assets.lovelace) }).validFrom(from).validTo(hi); };
// refundTx = RefundReveal{a} (on the Refunding UTxO by default; tests point it at Open/Claimed to show the script refuses)
const refundTx = (S, a, from, signer, utxo = null) => (tx) => tx.collectFrom([utxo ?? S.refunding ?? S.escrow], RefundReveal(a)).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.A)).validFrom(from);
const forfeitTx = (S, from, signer, utxo = null) => (tx) => tx.collectFrom([utxo ?? S.refunding ?? S.escrow], Forfeit).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.B)).validFrom(lowerBoundMs(from, S.t4, slotCfg(S)));   // step 10 (A2): lower ≥ t4
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
async function signSubmit(S, txb, acct, label, opts = {}) { const hex = (await txb.sign.withPrivateKey(acct.privateKey).complete()).toCBOR(); return S.L.submit(hex, label, opts); }
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
const claimedLive = (S) => !!S.claimed && !!S.L.entry(S.claimed.txHash + S.claimed.outputIndex);
const blocksAfter = (S, ms) => S.L.blocks.filter(b => S.L.zeroTime + b.slot * 1000 >= ms).length;
// Bob's view of the Claimed UTxO: ONLY the phase-1 output of his OWN Commit tx, with the exact expected datum and value
// (a fake phase=1 UTxO someone else paid to the script address is ignored — decisions D14).
async function ownClaimed(S) {
  if (!S.commitHash) return null;
  const u = (await S.L.em.getUtxos(S.scriptAddr)).find(x => x.txHash === S.commitHash);
  if (!u || u.datum !== datumOf(S, { phase: 1n }) || Object.keys(u.assets).length !== 1 || BigInt(u.assets.lovelace) !== BigInt(S.escrow.assets.lovelace)) return null;
  return u;
}

// Bob's two-step procedure (spec v0.6 §B). COMMIT: only if now ≤ LAST_COMMIT = T1 − 1 s − Mc, only after his strict go
// check; it carries NO secret, so a dropped/rolled-back Commit costs nothing — he rebuilds while now < T1. REVEAL: only on
// the Claimed output of his OWN Commit, only once that Commit has ≥ K confirmations (revealGate); then he resubmits until
// settled — there is no deadline before T3. bobRedeem = Commit then Reveal (kept as the name of the whole procedure).
async function bobCommit(S, R, { ignoreRule = false, maxBlocks = 60, hook = null, direct } = {}) {
  if (!ignoreRule) { const g = commitGate({ now: bobNow(S), LAST_COMMIT: S.LAST }); if (g) return { refused: g + ` (Bob's chain-time estimate ${(bobNow(S) - S.LAST) / 1000} s past it)` }; }
  { const bad = goVerifyBob(S.go.vk, goMsg(goFields(S)), S.goSig); if (bad) return { refused: bad }; }   // F2: strict, two implementations
  const builds = [];
  const once = async () => { await refreshParams(S); const t = await build(S, S.B, commitTx(S, S.goSig)); const r = await signSubmit(S, t, S.B, `commit#${builds.length + 1}`, { direct: direct ?? S.direct }); builds.push(r); return r; };
  let cur;
  try { cur = await once(); } catch (e) { return { settled: false, builds, why: "Commit not admitted: " + e.message }; }
  for (let i = 0; i < maxBlocks; i++) {
    await S.L.awaitBlock(1);
    if (hook) await hook(S, cur, i);
    const st = S.L.status(cur.txHash);
    if (st === "confirmed" && S.L.confirmations(cur.txHash) >= K) { S.commitHash = cur.txHash; S.commitSettledAt = S.L.now(); S.claimed = await ownClaimed(S); return { settled: !!S.claimed, builds, cur, why: S.claimed ? undefined : "Commit settled but its Claimed output is not the expected one" }; }
    if (st !== "confirmed" && st !== "pending") {
      if (!escrowLive(S)) return { settled: false, builds, cur, why: "escrow spent by someone else" };
      if (S.L.now() >= S.T1 - 1000) return { settled: false, builds, cur, why: "T1 reached before the Commit was included (abort: nothing revealed)" };
      try { cur = await once(); } catch (e) { return { settled: false, builds, cur, why: "Commit rebuild not admitted: " + e.message }; }
    }
    if (st === "pending" && S.L.now() >= S.T1) return { settled: false, builds, cur, why: "T1 passed with the Commit still pending (it can no longer be included)" };
  }
  return { settled: false, builds, cur, why: "gave up" };
}
async function bobReveal(S, R, b, { ignoreRule = false, maxBlocks = 120, hook = null } = {}) {
  if (!ignoreRule) {
    const g = revealGate9({ commitConfs: S.commitHash ? S.L.confirmations(S.commitHash) : 0, K, commitSettledAt: S.commitSettledAt, mempoolFill: S.L.mempoolFill(), directStake: S.directStake, now: bobNow(S), T3: S.T3, M, holdCapMs: HOLD_CAP, lateCutoffMs: LATE_CUTOFF });
    if (g && !/^GO-/.test(g)) return { refused: g };
    if (g) { S.L.events.push(`slot ${S.L.slot()}: Bob reveal ${g.slice(0, 70)}`); S.revealAlarm = g; if (S.multiChannel !== false) S.direct = true; }
    S.claimed = await ownClaimed(S);
    if (!S.claimed) return { refused: "REFUSE: no Claimed output of Bob's own settled Commit (never reveal b on any other UTxO)" };
  }
  const builds = [];
  const once = async () => { await refreshParams(S); const t = await build(S, S.B, revealTx(S, b)); const r = await signSubmit(S, t, S.B, `reveal#${builds.length + 1}`, { direct: S.direct }); builds.push(r); return r; };
  let cur = await once();
  for (let i = 0; i < maxBlocks; i++) {
    await S.L.awaitBlock(1);
    if (hook) await hook(S, cur, i);
    const st = S.L.status(cur.txHash);
    if (st === "confirmed" && S.L.confirmations(cur.txHash) >= K) return { settled: true, builds, cur, at: S.L.now() };
    if (st !== "confirmed" && st !== "pending") { if (!claimedLive(S)) return { settled: false, builds, cur, why: "Claimed UTxO spent by someone else" }; cur = await once(); }
  }
  return { settled: false, builds, cur, why: "gave up" };
}
async function bobRedeem(S, R, b, { ignoreRule = false, maxBlocks = 60, hook = null, revealHook = null } = {}) {
  const c = await bobCommit(S, R, { ignoreRule, maxBlocks, hook });
  if (c.refused || !c.settled) return { ...c, stage: "commit" };
  const r = await bobReveal(S, R, b, { ignoreRule, hook: revealHook });
  return { ...r, stage: "reveal", commit: c, commitBuilds: c.builds };
}
// Alice's TWO-STEP refund (step 8, D26/D27). NOTICE: from T1 (no secret), only while the escrow is Open; (re)build and
// resubmit until it is K deep. Either party's settled Notice counts (Bob may Notice from T2). REVEAL a: only on the
// phase-2 output of that settled Notice, with the exact expected datum (t4 = its upper + TAIL) and value, and only while
// now ≤ t4 − M; then resubmit until settled — there is no deadline (t4 is ≥ TAIL away).
async function ownRefunding(S) {
  const us = await S.L.em.getUtxos(S.scriptAddr);
  S.provenanceRefusals = [];
  for (const u of us) { const tx = S.L.log.find(t => t.hash === u.txHash); if (!tx) continue;   // step 9 (R5-M1): no labels — provenance from the creating tx
    const ctx = CML.Transaction.from_cbor_hex(tx.txHex); const ttl = ctx.body().ttl(); if (ttl === undefined) { S.provenanceRefusals.push("no upper bound"); continue; }
    const ttlMs = slotToMs(ttl, slotCfg(S));
    const creating = decodeCreating(ctx, S.scriptAddr);
    const why = refundProvenance9({ refund: { ...u }, creating, lock: { txHash: S.escrow.txHash, outputIndex: S.escrow.outputIndex }, scriptAddr: S.scriptAddr,
      expectedDatum: refundingDatum(S, ttlMs), lovelace: S.escrow.assets.lovelace, confs: Math.max(S.L.confirmations(u.txHash), K), K });   // depth is checked by the callers
    if (why) { S.provenanceRefusals.push(why); continue; }
    return { u, hash: u.txHash, t4: ttlMs + TAIL }; }
  return null;
}
async function aliceNotice(S, R, { at = S.T1, maxBlocks = 60, hook = null, ignoreRule = false, signer = null, label = "notice" } = {}) {
  await S.L.untilMs(at);
  const who = signer ?? S.A;
  if (!ignoreRule) { const g = who === S.A ? noticeGate({ now: S.L.now(), T1: S.T1, escrowOpen: escrowLive(S) }) : bobNoticeGate({ now: S.L.now(), T2: S.T2, escrowOpen: escrowLive(S) }); if (g) return { settled: false, refused: g, builds: [] }; }
  const builds = [];
  const once = async () => { await refreshParams(S); const from = Math.max(who === S.A ? S.T1 : S.T2, S.L.now() - 1000); const t = await build(S, who, noticeTx(S, from, { signer: who, minLo: who === S.A ? S.T1 : S.T2 })); const r = await signSubmit(S, t, who, `${label}#${builds.length + 1}`, { direct: S.direct }); builds.push(r); return r; };
  const tryOnce = async () => { try { return await once(); } catch (e) { if (/mempool conflict|MempoolFull/.test(e.message)) { S.L.events.push(`slot ${S.L.slot()}: ${label} not admitted (${e.message.slice(0, 60)}), retry next block`); return null; } throw e; } };
  let cur; try { cur = await tryOnce(); } catch (e) { return { settled: false, builds, why: "Notice not admitted: " + e.message }; }
  for (let i = 0; i < maxBlocks; i++) {
    await S.L.awaitBlock(1);
    if (hook) await hook(S, cur, i);
    const o = await ownRefunding(S);
    if (o && S.L.confirmations(o.hash) >= K) { S.refunding = o.u; S.noticeHash = o.hash; S.t4 = o.t4; return { settled: true, builds, cur, by: S.L.log.find(t => t.hash === o.hash)?.label }; }
    if (o) continue;   // a Notice (ours or Bob's) is in a block but not yet K deep: wait
    const st = cur ? S.L.status(cur.txHash) : "none";
    if (st === "confirmed") continue;
    if (st !== "pending") { if (!escrowLive(S)) return { settled: false, builds, cur, why: "escrow spent by someone else (e.g. a Commit won): nothing revealed" }; try { cur = await tryOnce(); } catch (e) { return { settled: false, builds, cur, why: "Notice rebuild not admitted: " + e.message }; } }
  }
  return { settled: false, builds, cur, why: "gave up" };
}
async function aliceRefundReveal(S, R, a, { maxBlocks = 120, hook = null, ignoreRule = false } = {}) {
  if (!ignoreRule) { const o = await ownRefunding(S);
    const g = refundRevealGate({ noticeConfs: o ? S.L.confirmations(o.hash) : 0, K, datumOk: !!o, now: S.L.now(), t4: o?.t4 ?? 0, M });
    if (g) return { settled: false, refused: g, builds: [] }; S.refunding = o.u; S.t4 = o.t4; }
  const builds = [];
  const once = async () => { await refreshParams(S); const t = await build(S, S.A, refundTx(S, a, S.L.now() - 1000)); const r = await signSubmit(S, t, S.A, `refundreveal#${builds.length + 1}`, { direct: S.direct }); builds.push(r); return r; };
  let cur; try { cur = await once(); } catch (e) { return { settled: false, builds, why: "RefundReveal not admitted: " + e.message }; }
  for (let i = 0; i < maxBlocks; i++) {
    await S.L.awaitBlock(1);
    if (hook) await hook(S, cur, i);
    const st = S.L.status(cur.txHash);
    if (st === "confirmed" && S.L.confirmations(cur.txHash) >= K) return { settled: true, builds, cur, at: S.L.now() };
    if (st !== "confirmed" && st !== "pending") { if (!S.L.entry(S.refunding.txHash + S.refunding.outputIndex)) return { settled: false, builds, cur, why: "Refunding UTxO spent by someone else" }; cur = await once(); }
  }
  return { settled: false, builds, cur, why: "gave up" };
}
// aliceRefund = Notice then RefundReveal (kept as the name of the whole procedure for the ported groups)
async function aliceRefund(S, R, a, { at = S.T1, maxBlocks = 60, hook = null, revealHook = null, ignoreRule = false } = {}) {
  const n = await aliceNotice(S, R, { at, maxBlocks, hook, ignoreRule });
  if (n.refused || !n.settled) return { ...n, stage: "notice" };
  const r = await aliceRefundReveal(S, R, a, { hook: revealHook, ignoreRule });
  return { ...r, stage: "reveal", notice: n, noticeBuilds: n.builds, builds: [...n.builds, ...(r.builds ?? [])], revealBuilds: r.builds };
}
function cardanoCost(R, label, r) { R.costs.cardano.push({ tx: label, ...r.stats }); }
// Bob's recourse against a silent Alice (replaces Punish, D25): Notice himself from T2, wait to t4, Forfeit (honest Bob only if a was never seen).
async function bobForfeit(S, R) {
  const o = await ownRefunding(S); if (o) { S.refunding = o.u; S.t4 = o.t4; }
  await S.L.untilMs(S.t4);
  const g = forfeitGate({ now: S.L.now(), t4: S.t4, refunding: !!(S.refunding && S.L.entry(S.refunding.txHash + S.refunding.outputIndex)), sawA: refundA(S) !== null });
  if (g) return { refused: g };
  await refreshParams(S); const t = await build(S, S.B, forfeitTx(S, S.t4)); const r = await signSubmit(S, t, S.B, "forfeit"); await S.L.awaitBlock(K); return { ...r, settled: S.L.confirmations(r.txHash) >= K };
}
async function bobNoticeThenForfeit(S, R) { const n = await aliceNotice(S, R, { at: Math.max(S.T2, S.L.now()), signer: S.B, label: "bobnotice" }); if (!n.settled) return { notice: n, refused: n.refused ?? n.why }; const f = await bobForfeit(S, R); return { notice: n, ...f }; }
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
  // step 11 (W-1; review 6 R6-L1): Alice takes b from HER OWN view — any Reveal{b} she has seen (mempool or chain) whose b
  // opens B_c. She needs neither Bob's record of the Claimed outref nor a particular spending tx, so a rebuilt Commit or a
  // decoy cannot hide it.
  const b = aliceSeesB(S);
  if (b === null) return { b: null, bHex: null, sw: { rejected: true, reason: "no Reveal seen" } };
  const bHex = leHex(b);
  return { b, bHex, sw: sweep(S, R, "alice", [`other_share=${bHex}`], label) };
}

async function aliceTakesZecPeek(S) { const u = S.claimed; const sp = S.L.spendingRedeemer(u.txHash, u.outputIndex); const b = sp.redeemer.fields[0]; return { b, bHex: leHex(b) }; }
// step 10 (review 6 R6-M2): the watchers below read legacy-array AND Conway map redeemers (txRedeemerData)
const secretInMempool = (S, x) => S.L.seen.some(t => txRedeemerData(CML.Transaction.from_cbor_hex(t.txHex)).some(d => d.fields?.some(f => typeof f === "bigint" && f === x)));
// step 8: any broadcast RefundReveal{a} (redeemer 3), whatever its label
// step 11 (assessment W-1 + item 4): each party has its OWN view (party.mjs): its own feed of seen txs (S.feeds?.<party>, default
// = everything the simulated network has seen), its own state file in its own directory, and a watcher that accepts a share
// only if it opens the counterparty's datum point. A decoy redeemer is not "seen"; a real share is saved before it is used.
function viewOf(S, role) {
  S.views ??= {};
  return S.views[role] ??= new PartyView({ role, dir: path.join(S.dir, role), otherPoint: rd(path.join(S.dir, `${role === "alice" ? "bob" : "alice"}/pub.json`)).Q, feed: () => (S.feeds?.[role] ?? (() => S.L.seen))() });
}
function refundA(S) { return viewOf(S, "bob").otherShare(); }   // Bob's view: a from any RefundReveal{a} with a·G1 = A_c
// A bribed producer can include ANY valid tx regardless of what other mempools hold, so script-level rejections are
// tested by submitting with the conflicting censored tx set aside (restored afterwards). (review4 helper)
async function asideFrom(S, re, fn) { const keep = S.L.pending.filter(p => re.test(p.label)); S.L.pending = S.L.pending.filter(p => !re.test(p.label));
  try { return await fn(); } finally { const now = new Set(S.L.pending.map(p => p.hash)); S.L.pending = S.L.pending.filter(p => !keep.some(k => [...k.inputs].some(i => p.inputs.has(i)))).concat(keep.filter(k => !now.has(k.hash))); } }
// ---------- (a) happy ----------
async function happy() {
  const R = new Results("happy"); console.log("== (a) happy path (two-step: Commit, then Reveal)");
  const S = await start("happy", R);
  const bobX = secret(S, "bob"), aliceX = secret(S, "alice");
  await mustFail(R, "Alice tries to take the ZEC with her share a only", NODE_SIG, () => sweep(S, R, "alice", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_alice_one_share"));
  await mustFail(R, "Bob Commits with an empty go_sig: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, ""), true), S.B, "cheat_no_gosig"));
  await mustFail(R, "Bob Commits with a go_sig over another outref: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, goSign(S.go.sk, goMsg(goFields(S, S.escrow, { index: 1 })))), true), S.B, "cheat_gosig_other_outref"));
  await mustFail(R, "Bob Commit with upper bound after T1 (T1+60 s): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { upper: S.T1 + 60_000 }), true), S.B, "cheat_late_upper"));
  await mustFail(R, "Bob Commit with no upper bound: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { upper: null }), true), S.B, "cheat_no_upper"));
  await mustFail(R, "Bob Reveals b directly on the OPEN escrow (skipping Commit): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, revealTx(S, bobX, { utxo: S.escrow }), true), S.B, "cheat_reveal_open"));
  await mustFail(R, "Alice Notices early (validFrom now < T1): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, noticeTx(S, S.L.now()), true), S.A, "cheat_early_notice"));
  await mustFail(R, "Alice submits a Notice valid only from T1 before T1: ledger rejects", OUTSIDE, async () => signSubmit(S, await build(S, S.A, noticeTx(S, S.T1)), S.A, "cheat_notice_not_yet_valid"));
  await mustFail(R, "Alice RefundReveals a on the Open escrow (old one-step refund): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.L.now(), null, S.escrow), true), S.A, "cheat_onestep_refund"));
  await mustFail(R, "Bob Forfeits the Open escrow before T2: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, forfeitTx(S, S.L.now(), null, S.escrow), true), S.B, "cheat_early_forfeit"));
  R.rec("Bob's first Commit broadcast is before LAST_COMMIT = T1 − 1 s − Mc", "accept", bobNow(S) <= S.LAST, `${(S.LAST - bobNow(S)) / 1000} s before LAST_COMMIT (chain time + drift)`);
  const c = await bobCommit(S, R);
  cardanoCost(R, "Commit (Bob, go-message checked on-chain, no secret)", c.builds[0]);
  R.rec("Bob's Commit settles (≥ K) before T1", "accept", c.settled && S.L.now() < S.T1, c.why ?? `${(S.T1 - S.L.now()) / 1000} s before T1`);
  R.rec("the Commit carried no secret (neither a nor b in any broadcast redeemer)", "accept", !secretInMempool(S, bobX) && !secretInMempool(S, aliceX));
  R.rec("Claimed UTxO = output of Bob's own Commit, same script address, same value, phase-1 datum (byte-equal)", "accept", !!S.claimed && S.claimed.txHash === S.commitHash && S.claimed.datum === datumOf(S, { phase: 1n }));
  await mustFail(R, "Bob Reveals a wrong b (b+1) on the Claimed UTxO: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, revealTx(S, bobX + 1n), true), S.B, "cheat_wrong_b"));
  await mustFail(R, "a third party (Alice's key) front-runs the Reveal with b: script rejects (Bob's signature required)", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, revealTx(S, bobX, { signer: S.A }), true), S.A, "cheat_reveal_not_bob"));
  await mustFail(R, "Commit replayed on the Claimed UTxO (same go_sig): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { utxo: S.claimed }), true), S.B, "cheat_commit_replay"));
  await mustFail(R, "Alice Escapes before T3: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, escapeTx(S, S.L.now()), true), S.A, "cheat_escape_early"));
  const rv = await bobReveal(S, R, bobX);
  cardanoCost(R, "Reveal (Bob, reveals b)", rv.builds[0]);
  R.rec("Bob's Reveal settles (no deadline; here before T1)", "accept", rv.settled, rv.refused ?? rv.why ?? `${(S.T1 - S.L.now()) / 1000} s before T1`);
  const { b, bHex } = await aliceTakesZecPeek(S);
  R.rec("Alice extracts b from the Reveal; b·G(Pallas) = Bob's DLEQ point", "accept", zec(["share-point", `share=${bHex}`, `P=${rd(path.join(S.dir, "alice/view.json")).B_p}`]).ok);
  await mustFail(R, "Alice sweeps with a wrong share (b+1): her tool refuses", /sweeper refused: REFUSE/, () => sweep(S, R, "alice", [`other_share=${leHex(b + 1n)}`], "cheat_wrong_share_refuse"));
  await mustFail(R, "Alice forces a sweep signed with a wrong share: node rejects", NODE_SIG, () => sweep(S, R, "alice", ["cheat=wrong_share", `other_share=${bHex}`], "cheat_wrong_share_forced"));
  await mustFail(R, "sweep without ỹ-negation: node rejects", NODE_SIG, () => sweep(S, R, "alice", ["cheat=no_negation", `other_share=${bHex}`], "cheat_no_negation"));
  await mustFail(R, "sweep signature over a different sighash: node rejects", NODE_SIG, () => sweep(S, R, "alice", ["cheat=wrong_sighash", `other_share=${bHex}`], "cheat_wrong_sighash"));
  await mustFail(R, "sweep with tampered Halo2 proof: node rejects", /proof_ok=false/, () => sweep(S, R, "alice", ["cheat=tamper_proof", `other_share=${bHex}`], "cheat_tamper_proof"));
  await mustFail(R, "Bob tries to take the ZEC back with b only", NODE_SIG, () => sweep(S, R, "bob", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_bob_one_share"));
  for (const m of ["joint", "adaptor"]) { const o = `${S.dir}/alt0_${m}.tx`; zec(["sweep", ...S.d("party=alice", `mode=${m}`, `out=${o}`)]); const c2 = zec(["check", ...S.d(`tx=${o}`)], true);
    R.rec(`alternative ${m} signature on the sweep verifies (not mined)`, "accept", c2.code === 0, c2.reason); }
  const sw = sweep(S, R, "alice", [`other_share=${bHex}`], "Sweep (Alice, a+b)");
  R.rec("Alice's real Orchard sweep with σ(a+b) accepted; expiry_height = tip+40", "accept", sw.accepted && R.costs.zcash.at(-1).expiry_height > 0, `expiry ${R.costs.zcash.at(-1).expiry_height}`);
  await mustFail(R, "a second, different spend of the swept joint note (double spend): node rejects", /nullifier/, async () => { const o = `${S.dir}/alt_joint.tx`; zec(["sweep", ...S.d("party=alice", "mode=joint", `out=${o}`)]); const c3 = zec(["submit", ...S.d(`tx=${o}`)], true); return c3.code === 0 ? { accepted: true } : { rejected: true, reason: c3.reason }; });
  await S.L.untilMs(S.T1 + 1000);
  await mustFail(R, "Alice tries to Refund after Bob committed (Open escrow already spent)", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.T1), true), S.A, "cheat_refund_after_redeem"));
  const ab = zec(["balance", ...S.d("party=alice")]); const bobAda = await lovelaceAt(S, S.B.address);
  R.rec("final: Alice holds the ZEC", "accept", ab.unspent_zats === ZEC_AMT - 10000, `${ab.unspent_zats} zats`);
  R.rec("final: Bob holds the ADA", "accept", bobAda > 300_000_000n + ADA_LOCK - 3_000_000n, `${Number(bobAda) / 1e6} ADA`);
  return { R, S };
}
// ---------- (b) refund ----------
async function refund() {
  const R = new Results("refund"); console.log("== (b) two-step refund path (Bob never commits): Notice (no secret) → RefundReveal{a} (no deadline)");
  const S = await start("refund", R);
  const aliceX = secret(S, "alice"), bobX = secret(S, "bob");
  await S.L.untilMs(S.LAST + 1000);
  const late = await bobRedeem(S, R, bobX);
  R.rec("Bob's own tool refuses a first Commit after LAST_COMMIT (it might not be included before T1)", "reject", /past LAST/.test(late.refused ?? ""), late.refused);
  await mustFail(R, "Alice Notices before T1: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, noticeTx(S, S.L.now() - 1000), true), S.A, "cheat_early_notice"));
  await mustFail(R, "Alice RefundReveals a on the OPEN escrow (step-7 one-step refund): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.L.now(), null, S.escrow), true), S.A, "cheat_onestep_refund"));
  await S.L.untilMs(S.T1);
  await mustFail(R, "Bob Commits at/after T1 (TTL T1−1 s): ledger rejects", OUTSIDE, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { upper: S.T1 - 1000 }), true), S.B, "cheat_stale_commit"));
  await mustFail(R, "Bob Commits after T1 with a later upper bound: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { upper: S.L.now() + 60_000 }), true), S.B, "cheat_late_commit"));
  await mustFail(R, "Bob Reveals b on the Open escrow after T1: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, revealTx(S, bobX, { utxo: S.escrow }), true), S.B, "cheat_reveal_open_t1"));
  await mustFail(R, "Bob Notices between T1 and T2: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, noticeTx(S, S.L.now(), { signer: S.B }), true), S.B, "cheat_bob_notice_early"));
  await mustFail(R, "Bob Forfeits an Open escrow (datum t4 = 0): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, forfeitTx(S, S.L.now(), null, S.escrow), true), S.B, "cheat_forfeit_open"));
  await mustFail(R, "Alice Notices with a t4 one second short: script rejects", SCRIPT_FAIL, async () => { const to = S.L.now() + NOTICE_TTL; return signSubmit(S, await build(S, S.A, noticeTx(S, S.L.now(), { to, out: datumOf(S, { phase: 2n, t4: BigInt(to + TAIL - 1000) }) }), true), S.A, "cheat_short_t4"); });
  await mustFail(R, "Alice Notices with a 6 h + 1 s validity range (pushes t4 out): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, noticeTx(S, S.L.now(), { to: S.L.now() + NOTICE_RANGE_MAX + 1000 }), true), S.A, "cheat_wide_notice"));
  await mustFail(R, "Alice Notices but skims 1 ADA from the continuing output: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, noticeTx(S, S.L.now(), { lovelace: ADA_LOCK - 1_000_000n }), true), S.A, "cheat_skim_notice"));
  const n = await aliceNotice(S, R);
  cardanoCost(R, "Notice (Alice, no secret)", n.builds[0]);
  R.rec("Alice's Notice (no secret) settles from T1; Refunding output has t4 = upper + tail", "accept", n.settled && S.t4 >= S.L.seen.find(t => t.hash === n.builds[0].txHash).slot * 1000 + S.L.zeroTime + TAIL, n.why ?? n.refused ?? `t4 − now = ${(S.t4 - S.L.now()) / 1000} s`);
  R.rec("the Notice carried no secret", "accept", !secretInMempool(S, aliceX) && !secretInMempool(S, bobX));
  await mustFail(R, "Bob Commits on the Refunding UTxO (with Alice's go): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { utxo: S.refunding, upper: S.L.now() + 60_000 }), true), S.B, "cheat_commit_refunding"));
  await mustFail(R, "Bob Forfeits before t4: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, forfeitTx(S, S.L.now()), true), S.B, "cheat_forfeit_early"));
  await mustFail(R, "Alice re-Notices the Refunding UTxO (to extend t4): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, noticeTx(S, S.L.now(), { utxo: S.refunding }), true), S.A, "cheat_renotice"));
  await mustFail(R, "Alice RefundReveals a wrong a (a+1): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX + 1n, S.L.now()), true), S.A, "cheat_wrong_a"));
  await mustFail(R, "Alice RefundReveals a + r (same BLS point, out of range): script rejects", SCRIPT_FAIL, async () => {
    const r = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n; return signSubmit(S, await build(S, S.A, refundTx(S, aliceX + r, S.L.now()), true), S.A, "cheat_a_plus_r"); });
  const rv = await aliceRefundReveal(S, R, aliceX);
  cardanoCost(R, "RefundReveal (Alice, reveals a)", rv.builds[0]);
  R.rec("Alice's RefundReveal settles (Notice was ≥ K deep; long before t4 − M)", "accept", rv.settled, rv.refused ?? rv.why ?? `${(S.t4 - S.L.now()) / 1000} s before t4`);
  const a = refundA(S);
  R.rec("Bob extracts a from the RefundReveal; a·G(Pallas) = Alice's point", "accept", a !== null && zec(["share-point", `share=${leHex(a)}`, `P=${rd(path.join(S.dir, "bob/view.json")).A_p}`]).ok);
  await mustFail(R, "Alice tries to keep the ZEC too, with a only", NODE_SIG, () => sweep(S, R, "alice", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_alice_one_share"));
  const sw = sweep(S, R, "bob", [`other_share=${leHex(a)}`], "Sweep (Bob, a+b, takes ZEC back)");
  R.rec("Bob's Orchard sweep with σ(a+b) accepted (ZEC back)", "accept", !!sw.accepted, sw.reason);
  await S.L.untilMs(S.t4 + 1000);
  await mustFail(R, "Bob Forfeits after t4 although Alice refunded", BAD_INPUTS, async () => signSubmit(S, await build(S, S.B, forfeitTx(S, S.t4), true), S.B, "cheat_forfeit_after_refund"));
  const bb = zec(["balance", ...S.d("party=bob")]); const aliceAda = await lovelaceAt(S, S.A.address);
  R.rec("final: Bob holds his ZEC again", "accept", bb.unspent_zats === 100_000_000 - 20_000, `${bb.unspent_zats} zats`);
  R.rec("final: Alice holds her ADA again", "accept", aliceAda > 2_000_000_000n - 3_000_000n, `${Number(aliceAda) / 1e6} ADA`);
  return { R, S };
}

async function punish() {
  const R = new Results("punish"); console.log("== (c) silent Alice (no go, no refund): Bob Notices at T2, Forfeits at t4 — Punish's replacement (D25)");
  const S = await start("punish", R, { go: false });
  await mustFail(R, "Bob tries to take the ZEC back with b only", NODE_SIG, () => sweep(S, R, "bob", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_bob_one_share"));
  const nogo = await (async () => { S.goSig = "00".repeat(64); return bobRedeem(S, R, secret(S, "bob")); })();
  R.rec("without a valid go signature Bob's tool never commits (so never reveals b)", "reject /^go_sig/", /^go_sig/.test(nogo.refused ?? ""), nogo.refused);
  await S.L.untilMs(S.T1 + 5000);
  await mustFail(R, "Bob Notices after T1 but before T2: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, noticeTx(S, S.L.now(), { signer: S.B }), true), S.B, "cheat_early_bob_notice"));
  await mustFail(R, "Bob tries a RefundReveal with a guessed a on the Open escrow: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, refundTx(S, BigInt("0x" + crypto.randomBytes(31).toString("hex")), S.T1, S.B, S.escrow), true), S.B, "cheat_bob_refund"));
  await mustFail(R, "Bob submits a Notice valid from T2 before T2: ledger rejects", OUTSIDE, async () => signSubmit(S, await build(S, S.B, noticeTx(S, S.T2, { signer: S.B })), S.B, "cheat_notice_not_yet_valid"));
  await S.L.untilMs(S.T2);
  await mustFail(R, "a third party (neither key) Notices after T2: script rejects", SCRIPT_FAIL, async () => { const C = generateEmulatorAccountFromPrivateKey({ lovelace: 0n }); return signSubmit(S, await build(S, S.B, noticeTx(S, S.T2, { signer: C }), true), S.B, "cheat_notice_third"); });
  const r = await bobNoticeThenForfeit(S, R);
  cardanoCost(R, "Notice (Bob, from T2, no secret)", r.notice.builds[0]);
  R.rec("Bob's Notice from T2 settles; it starts Alice's 7-day (sim 20 min) clock", "accept", r.notice.settled, r.notice.why ?? r.notice.refused);
  if (r.txHash) cardanoCost(R, "Forfeit (Bob, at t4)", r);
  R.rec("Alice stays silent: Bob's Forfeit settles at t4 (≥ his Notice + tail)", "accept", r.settled && S.L.now() >= S.t4, r.refused ?? `${(S.L.now() - S.T2) / 1000} s after T2`);
  await mustFail(R, "Alice wakes up late and tries RefundReveal after the Forfeit", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, refundTx(S, secret(S, "alice"), S.L.now()), true), S.A, "cheat_late_refund"));
  const w = zec(["watch", ...S.d("party=bob", `amount=${ZEC_AMT}`, "min_depth=1")], true);
  R.rec("final: Bob holds the ADA", "accept", (await lovelaceAt(S, S.B.address)) > 300_000_000n + ADA_LOCK - 3_000_000n);
  R.rec("final: the ZEC stays locked at the joint key (accepted trade-off); a was never broadcast", "accept", w.code === 0 && w.status === "funded_ok" && !secretInMempool(S, secret(S, "alice")), w.status);
  return { R, S };
}

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
  await lockCase("setup-t3", { t3: 0n }, /field t3 value differs/, "wrong T3: Bob refuses to fund");
  await lockCase("setup-phase", { phase: 1n }, /field phase value differs/, "lock already in phase 1 (Claimed, Refund disabled): Bob refuses to fund");
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
  const R = new Results(`c1${kind}`); console.log(`== C-1 reproduction (${kind} change while the Commit is held, and again after b is public)`);
  const S = await start(`c1${kind}`, R);
  const bobX = secret(S, "bob");
  let stolen = null;
  const origSubmit = S.L.submit.bind(S.L);
  const change = () => S.L.setParams(kind === "fee" ? bumpFee(S.L.pp) : bumpCost(S.L.pp));
  S.L.submit = async (hex, label, o) => { const r = await origSubmit(hex, label, o);
    if (label === "commit#1") { S.L.held.add(r.txHash); change(); }   // adversary delays the Commit (≤ D) and params change
    if (label === "reveal#1") {
      S.L.held.add(r.txHash);                                 // adversary delays the Reveal
      const t = await aliceTakesZec(S, R, "Sweep (malicious Alice, b read from mempool)"); stolen = t.sw;
      change();
    }
    return r; };
  const hook = async (S2, cur, i) => { if (i === 2) S.L.held.clear(); };   // D = 3 blocks elapsed
  const rr = await bobRedeem(S, R, bobX, { hook, revealHook: hook });
  const re = kind === "fee" ? /FeeTooSmall/ : /PPViewHashesDontMatch/;
  const c0 = rr.commitBuilds?.[0];
  R.rec(`Bob's first Commit is DROPPED at block time by the ${kind} change`, "accept", c0 && S.L.status(c0.txHash) === "dropped" && re.test(S.L.dropReason(c0.txHash) ?? ""), c0 && S.L.dropReason(c0.txHash));
  R.rec("Bob rebuilds his Commit with the SAME go_sig; it settles before T1 (no secret was exposed meanwhile)", "accept", rr.commit?.settled && rr.commitBuilds.length >= 2, `commit builds ${rr.commitBuilds?.length}`);
  R.rec("Alice swept the ZEC with b read from the held Reveal (the attack's first half succeeds)", "accept", stolen?.accepted, stolen?.reason);
  const first = rr.builds?.[0];
  R.rec(`Bob's first Reveal is DROPPED at block time by the ${kind} change`, "accept", first && S.L.status(first.txHash) === "dropped" && re.test(S.L.dropReason(first.txHash) ?? ""), first && S.L.dropReason(first.txHash));
  R.rec("Bob rebuilds + re-signs his Reveal; it settles (no deadline: C-1 fixed by construction)", "accept", rr.settled && rr.builds.length >= 2, `reveal builds ${rr.builds?.length}, ${(S.L.now() - S.T1) / 1000} s relative to T1`);
  if (rr.builds?.length >= 2) cardanoCost(R, `Reveal rebuilt after ${kind} change`, rr.builds.at(-1));
  await S.L.untilMs(Math.max(S.T1, S.L.now()));
  await mustFail(R, "Alice then tries to Refund at T1", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, refundTx(S, secret(S, "alice"), S.T1), true), S.A, "attack_refund"));
  R.rec("final: Bob holds the ADA (honest Bob NOT harmed)", "accept", (await lovelaceAt(S, S.B.address)) > 300_000_000n + ADA_LOCK - 4_000_000n);
  R.events = S.L.events; return { R, S };
}
// C2: the step-2 sim confirmed txs after their TTL. Now a held tx whose TTL passes is dropped at block time.
async function c2() {
  const R = new Results("c2"); console.log("== C2 reproduction (expired tx must not confirm)");
  const S = await start("c2", R);
  const t = await build(S, S.B, commitTx(S, S.goSig, { upper: S.L.now() + 25_000 }));
  const r = await signSubmit(S, t, S.B, "commit_short_ttl"); S.L.held.add(r.txHash);
  await S.L.awaitBlock(2); S.L.held.clear(); await S.L.awaitBlock(1);
  R.rec("tx held past its TTL is DROPPED at block time, never confirmed", "accept", S.L.status(r.txHash) === "dropped" && OUTSIDE.test(S.L.dropReason(r.txHash)), S.L.dropReason(r.txHash));
  R.rec("escrow still unspent", "accept", escrowLive(S));
  const rr = await bobRedeem(S, R, secret(S, "bob"), { ignoreRule: true });
  R.rec("Bob simply rebuilds the Commit with a fresh TTL (no new go needed); Commit settles before T1, Reveal settles", "accept", rr.settled && rr.commit?.settled, rr.why ?? `${(S.T1 - S.L.now()) / 1000} s before T1`);
  return { R, S };
}
// C3: Bob slipping Alice's own UTxO into a tx she signs. Alice now signs no tx at all.
async function c3() {
  const R = new Results("c3"); console.log("== C3 reproduction (Alice's other inputs)");
  const S = await start("c3", R);
  const aU = (await S.L.em.getUtxos(S.A.address))[0];
  await mustFail(R, "Bob's Commit also spending Alice's base-address UTxO: no Alice witness exists → ledger rejects", /MissingVKeyWitnesses/, async () => {
    const t = await build(S, S.B, (tx) => commitTx(S, S.goSig)(tx).collectFrom([aU])); return signSubmit(S, t, S.B, "cheat_c3"); });
  R.rec("Alice's go step produces only a 64-byte signature over the 129-byte go message (nothing that can authorise a tx)", "accept", S.goSig.length === 128 && goMsg(goFields(S)).length === 129);
  await mustFail(R, "the go signature is not a valid tx witness for Alice's key either (Bob attaches it as one)", /InvalidWitnesses|MissingVKeyWitnesses|ScriptFailure|Extraneous/, async () => {
    const t = await build(S, S.B, (tx) => commitTx(S, S.goSig)(tx).collectFrom([aU]));
    const ws = CML.TransactionWitnessSet.new(); const l = CML.VkeywitnessList.new();
    l.add(CML.Vkeywitness.new(CML.PublicKey.from_bytes(Buffer.from(S.go.vk, "hex")), CML.Ed25519Signature.from_raw_bytes(Buffer.from(S.goSig, "hex")))); ws.set_vkeywitnesses(l);
    return S.L.submit((await t.assemble([ws.to_cbor_hex()]).sign.withPrivateKey(S.B.privateKey).complete()).toCBOR(), "cheat_c3_gosig_as_witness"); });
  return { R, S };
}
// H-1: rollback near T1 (Redeem) and near T2 (Refund), with controls that break the rule.
async function rbRedeem() {
  const R = new Results("rbredeem"); console.log("== H-1: Cardano rollback of the Commit and of the Reveal");
  { const S = await start("rbredeem", R); let done = false, done2 = false;
    const hook = async (S2, cur, i) => { if (!done && S.L.confirmations(cur.txHash) === K - 1) { S.L.rollback(K - 1); done = true; } };
    const hook2 = async (S2, cur, i) => { if (!done2 && S.L.confirmations(cur.txHash) === K - 1) { S.L.rollback(K - 1); done2 = true; } };
    const rr = await bobRedeem(S, R, secret(S, "bob"), { hook, revealHook: hook2 });
    R.rec(`honest Bob: his Commit is rolled back ${K - 1} blocks, returns to the pool, re-confirms and settles before T1`, "accept", done && rr.commit?.settled, S.L.events.filter(e => /ROLLBACK/.test(e)).join("; "));
    R.rec(`his Reveal is rolled back ${K - 1} blocks, re-confirms and settles`, "accept", done2 && rr.settled, rr.why);
    await S.L.untilMs(Math.max(S.T1, S.L.now()));
    await mustFail(R, "Alice's Refund at T1 fails", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, refundTx(S, secret(S, "alice"), S.T1), true), S.A, "rb_refund")); }
  { const S = await start("rbredeem-ctl", R); const bobX = secret(S, "bob");
    await S.L.untilMs(S.T1 - 30_000);   // rule broken: Bob first broadcasts his Commit 30 s before T1 (LAST_COMMIT ignored)
    let done = false;
    const hook = async (S2, cur, i) => { if (!done && S.L.now() >= S.T1 && S.L.confirmations(cur.txHash) > 0 && S.L.confirmations(cur.txHash) < K) { S.L.rollback(S.L.confirmations(cur.txHash)); done = true; } };
    const c = await bobCommit(S, R, { ignoreRule: true, hook });
    for (let i = 0; i < 3 && !done; i++) { await S.L.awaitBlock(1); if (c.cur) await hook(S, c.cur, 0); }
    await S.L.awaitBlock(1);
    const gone = c.cur && S.L.status(c.cur.txHash) === "dropped";
    const rv = await bobReveal(S, R, bobX);
    const rf = await aliceRefund(S, R, secret(S, "alice"), { at: S.L.now() });
    const sw = rf.settled ? sweep(S, R, "bob", [`other_share=${leHex(refundA(S))}`], "Sweep (Bob, a+b)") : { reason: "no refund" };
    R.rec("step-6 CONTROL re-run (late Commit 30 s before T1, rolled back after T1): Commit dropped, Bob's wallet never reveals b, Alice refunds, Bob recovers his ZEC → NO loss now (LAST_COMMIT is a liveness rule only)", "accept (no loss)",
      done && gone && /not settled/.test(rv.refused ?? "") && !secretInMempool(S, bobX) && rf.settled && sw.accepted === true, `${rv.refused}; ${S.L.events.slice(-3).join("; ")}`); }
  { const S = await start("rbredeem-ctl2", R); const bobX = secret(S, "bob");
    // CONTROL: Bob breaks the REVEAL rule — reveals as soon as his late Commit has 1 confirmation; a rollback after T1
    // orphans both: the Commit cannot re-enter (TTL), the Reveal loses its input, but b is public → Bob loses.
    await S.L.untilMs(S.T1 - 30_000);
    const cm = await signSubmit(S, await build(S, S.B, commitTx(S, S.goSig)), S.B, "commit#late");
    while (S.L.confirmations(cm.txHash) === 0 && S.L.now() < S.T1) await S.L.awaitBlock(1);
    S.commitHash = cm.txHash; S.claimed = await ownClaimed(S);
    const rvx = await signSubmit(S, await build(S, S.B, revealTx(S, bobX)), S.B, "reveal#early");
    await S.L.untilMs(S.T1 + 1000); const n = S.L.confirmations(cm.txHash); S.L.rollback(n); await S.L.awaitBlock(1);
    const both = S.L.status(cm.txHash) === "dropped" && S.L.status(rvx.txHash) === "dropped";
    const tk = await aliceTakesZec(S, R, "Sweep (Alice, a+b) after the orphaned Reveal");
    const rf = await aliceRefund(S, R, secret(S, "alice"), { at: S.L.now() });
    R.rec("CONTROL (rule broken: Reveal before the Commit is K deep): rollback after T1 drops both, Alice sweeps the ZEC with b AND refunds → shows the 'reveal only after K' rule is necessary", "accept (expected loss)", n > 0 && n < K && both && tk.sw.accepted === true && rf.settled, `rolled back ${n}; ${S.L.dropReason(rvx.txHash)?.slice(0, 60)}`); }
  return { R };
}
async function rbRefund() {
  const R = new Results("rbrefund"); console.log("== H-1 (step 8): rollbacks of BOTH refund steps (+ a fee change mid-Notice); CONTROL for the t4 − M margin");
  { const S = await start("rbrefund", R); let rb = false, pc = false, rb2 = false;
    const hook = async (S2, cur, i) => { if (!pc) { S.L.setParams(bumpFee(S.L.pp)); pc = true; return; } if (!rb && cur && S.L.confirmations(cur.txHash) === K - 1) { S.L.rollback(K - 1); rb = true; } };
    const revealHook = async (S2, cur, i) => { if (!rb2 && S.L.confirmations(cur.txHash) === K - 1) { S.L.rollback(K - 1); rb2 = true; } };
    const rf = await aliceRefund(S, R, secret(S, "alice"), { hook, revealHook });
    R.rec(`Notice dropped by a fee change, rebuilt, rolled back ${K - 1} blocks, re-confirmed; a revealed only after it was K deep`, "accept", rf.notice?.settled && rb && rf.noticeBuilds.length >= 2 && !S.L.seen.filter(t => /^refundreveal/.test(t.label)).some(t => t.slot < S.L.log.find(x => x.hash === S.noticeHash).slot + (K - 1) * BLOCK / 1000), `notice builds ${rf.noticeBuilds?.length}; ${S.L.events.join("; ").slice(0, 300)}`);
    R.rec(`RefundReveal rolled back ${K - 1} blocks, re-included from the pool; settles long before t4`, "accept", rf.settled && rb2 && S.L.now() < S.t4 - M, `${(S.t4 - S.L.now()) / 1000} s before t4`);
    await mustFail(R, "Bob's Forfeit at t4 fails (Refunding UTxO already spent)", BAD_INPUTS, async () => { await S.L.untilMs(S.t4); await refreshParams(S); return signSubmit(S, await build(S, S.B, forfeitTx(S, S.t4), true), S.B, "rb_forfeit"); }); }
  { const S = await start("rbrefund-ctl", R);
    // CONTROL: Alice ignores the t4 − M rule and reveals 30 s before t4; a rollback after t4 lets a Forfeit win.
    const n0 = await aliceNotice(S, R); await S.L.untilMs(S.t4 - 30_000);
    const t = await build(S, S.A, refundTx(S, secret(S, "alice"), S.L.now() - 1000)); const r = await signSubmit(S, t, S.A, "refundreveal_late");
    await S.L.untilMs(S.t4 + 1000); const n = S.L.confirmations(r.txHash); S.L.rollback(n, { dropOrphans: true });
    await refreshParams(S); const p = await signSubmit(S, await build(S, S.B, forfeitTx(S, S.t4)), S.B, "forfeit"); await S.L.awaitBlock(1);
    R.rec("CONTROL (rule broken: RefundReveal 30 s before t4): rollback after t4 + Forfeit → Alice loses ADA and a is public → shows the t4 − M margin is necessary", "accept (expected loss)", n0.settled && S.L.confirmations(p.txHash) > 0, `reveal had ${n} conf when rolled back`); }
  return { R };
}
// H-2: Zcash reorg / double spend of the funding; Alice must use LIVE depth.
async function zReorg() {
  const R = new Results("zreorg"); console.log("== H-2: Zcash reorgs and the live depth check");
  { const S = await start("zreorg-ds", R, { go: false });
    zec(["reorg", ...S.d(`n=${ZDEPTH}`)]); // drop fund block (+ ZDEPTH−1 empty; step 10: was a literal 3 = the sim ZDEPTH)
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
  R.rec(`wallet-default fund tx carries expiry_height = target height (tip+1) + ${REH ? "120 (NU7 era)" : "40 (ZIP 203, pre-NU7 era)"}`, "accept", f.info.expiry_height === tip + 1 + (REH ? 120 : 40), `tip ${tip}, expiry ${f.info.expiry_height}`);
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
  await mustFail(R, "go_sig from swap 1 (its own key + escrow) replayed on swap 2: script rejects", UPLC_FAIL, async () => signSubmit(S2, await build(S2, S2.B, commitTx(S2, S1.goSig), true), S2.B, "replay"));
  const mk = (over) => goSign(S2.go.sk, goMsg(goFields(S2, S2.escrow, over)));
  for (const [nm, over] of [["network id 1 (mainnet)", { networkId: 1 }], ["signing domain v0", { domain: Buffer.from("zeUTXO/path1/go/v0") }], ["T1 + 1 ms", { t1: S2.T1 + 1 }],
      ["output index + 1", { index: S2.escrow.outputIndex + 1 }], ["swap id of another swap", { swapId: S1.swapId }], ["lovelace − 1", { lovelace: BigInt(S2.escrow.assets.lovelace) - 1n }], ["escrow txid of swap 1", { txId: S1.escrow.txHash }]])
    await mustFail(R, `real go key, ONLY ${nm} changed in the go message: script rejects`, UPLC_FAIL, async () => signSubmit(S2, await build(S2, S2.B, commitTx(S2, mk(over)), true), S2.B, `field_${nm}`));
  const sig = Buffer.from(S2.goSig, "hex"); const L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");
  const sInt = BigInt("0x" + Buffer.from(sig.subarray(32)).reverse().toString("hex")) + L; const sBytes = Buffer.from(sInt.toString(16).padStart(64, "0"), "hex").reverse();
  const mall = Buffer.concat([sig.subarray(0, 32), sBytes]).toString("hex");
  await mustFail(R, "malleated go_sig (S + ℓ, non-canonical): script rejects", SCRIPT_FAIL, async () => signSubmit(S2, await build(S2, S2.B, commitTx(S2, mall), true), S2.B, "malleated"));
  R.rec("malleated go_sig: Bob's own strict check names the reason", "reject /S ≥ ℓ/", /S ≥ ℓ/.test(goVerifyBob(S2.go.vk, goMsg(goFields(S2)), mall) ?? ""), goVerifyBob(S2.go.vk, goMsg(goFields(S2)), mall));
  await mustFail(R, "front-runner copies go_sig from Bob's Commit in the mempool, signs as itself: script rejects (Bob's signature required)", UPLC_FAIL, async () => signSubmit(S2, await build(S2, S2.A, commitTx(S2, S2.goSig, { signer: S2.A }), true), S2.A, "frontrun"));
  await mustFail(R, "front-runner Commit that sends the continuing output to a different address (its own key): script rejects", UPLC_FAIL, async () => signSubmit(S2, await build(S2, S2.B, (tx) => tx.collectFrom([S2.escrow], Commit(S2.goSig)).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(S2.B)).pay.ToAddress(S2.B.address, { lovelace: ADA_LOCK }).validTo(S2.T1 - 1000), true), S2.B, "commit_to_key"));
  void b2;
  const ok = await trySpend(S2, S2.B, commitTx(S2, mk({})));
  R.rec("positive control: real key, unchanged go message: Commit accepted by script + strict overlay", "accept", /^ACCEPTED/.test(ok), ok);
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
  const at = (f, i, item) => CB.constr0(f.map((v, j) => j === i ? item : bytesOf(v))).toString("hex");
  const setF = (f, i, v) => Data.to(new Constr(0, f.map((x, j) => j === i ? v : x)));
  const variants = [
    ["t2 encoded as bytes (review2 dtype/hostage)", (f) => at(f, 8, CB.bytes(Buffer.from(String(f[8])).toString("hex"))), /field t2 has wrong type \(bytes, expected int\)/],
    ["t1 encoded as bytes", (f) => at(f, 7, CB.bytes("00")), /field t1 has wrong type \(bytes, expected int\)/],
    ["t3 encoded as bytes", (f) => at(f, 9, CB.bytes("00")), /field t3 has wrong type \(bytes, expected int\)/],
    ["phase encoded as bytes", (f) => at(f, 10, CB.bytes("00")), /field phase has wrong type \(bytes, expected int\)/],
    ["network_id encoded as bytes", (f) => at(f, 3, CB.bytes("00")), /field network_id has wrong type \(bytes, expected int\)/],
    ["a_c encoded as an int", (f) => at(f, 5, CB.int(7n)), /field a_c has wrong type \(int, expected bytes\)/],
    ["constructor tag 1 instead of 0", (f) => Data.to(new Constr(1, f)), /wrong constructor tag 1/],
    ["extra 13th field", (f) => raw([...f, 0n]), /wrong field count 13/],
    ["missing phase (10 fields, the step-6 layout + t3)", (f) => raw(f.slice(0, 10)), /wrong field count 10/],
    ["step-6 9-field datum (no t3, no phase)", (f) => raw(f.slice(0, 9)), /wrong field count 9/],
    ["same values, definite-length list", (f) => raw(f, { definite: true }), /non-canonical CBOR encoding/],
    ["same values, network_id as a 2-byte (non-minimal) int", (f) => at(f, 3, CB.int(f[3], 2)), /non-canonical CBOR encoding/],
    ["same values, t2 as a CBOR bignum (tag 2)", (f) => at(f, 8, CB.bignum(f[8])), /non-canonical CBOR encoding/],
    ["t2 = 2^70 (big int)", (f) => setF(f, 8, 1n << 70n), /field t2 value differs/],
    ["t2 = −1", (f) => setF(f, 8, -1n), /field t2 value differs/],
    ["t3 = T1 (Escape right after T1)", (f) => setF(f, 9, f[7]), /field t3 value differs/],
    ["phase = 1 (already Claimed: Refund disabled)", (f) => setF(f, 10, 1n), /field phase value differs/],
    ["phase = 2 (unknown phase)", (f) => setF(f, 10, 2n), /field phase value differs/],
    ["go_vk of 33 bytes", (f) => setF(f, 2, f[2] + "00"), /field go_vk value differs/],
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
// review2 hostage, re-run: Alice locks with t2 as bytes (Bob's Notice from T2 could never succeed, Bob's ZEC would be hostage).
// Expected now: Bob never funds; Alice just gets her own ADA back at T1. No honest party loses anything.
async function hostage() {
  const R = new Results("hostage"); console.log("== hostage (review2) re-run: Bob must refuse to fund");
  const S = await newSwap("hostage"); doSetup(S); S.swapId = swapIdOf(S, "alice"); const f = fieldsOf(S);
  await lockRaw(S, R, CB.constr0(f.map((v, j) => j === 8 ? CB.bytes(Buffer.from(String(f[8])).toString("hex")) : typeof v === "bigint" ? CB.int(v) : CB.bytes(v))).toString("hex")); await S.L.awaitBlock(K);
  const bad = bobChecksLock(S);
  R.rec("t2-as-bytes lock (Bob's Notice impossible): Bob refuses to fund ZEC", "reject /field t2 has wrong type/", /field t2 has wrong type/.test(bad ?? ""), bad);
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
    R.rec("go_sig with R = identity (small order): Bob's strict check refuses before committing", "reject /R is small-order/", /R is small-order/.test(r.refused ?? ""), r.refused);
    const ov = S.L.overlay; S.L.overlay = null;
    const lax = await trySpend(S, S.B, commitTx(S, idr.sig)); S.L.pending = []; S.L.overlay = ov;
    R.rec("(observe) the local UPLC evaluator ALONE accepts this signature — why the strict node-equivalent check is required", "observe", true, lax);
    const strict = await trySpend(S, S.B, commitTx(S, idr.sig));
    R.rec("same Commit on the strict ledger (node Ed25519 = libsodium): rejected", "reject /node Ed25519 builtin = libsodium/", /node Ed25519 builtin = libsodium/.test(strict), strict); }
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
    const lax = await trySpend(S, S.B, commitTx(S, forged)); S.L.pending = []; S.L.overlay = ov;
    R.rec("(observe) setup check bypassed, identity go key on chain: the local UPLC evaluator alone accepts the forged go (review2 result)", "observe", true, lax);
    const strict = await trySpend(S, S.B, commitTx(S, forged));
    R.rec("same forged Commit on the strict ledger: rejected", "reject /node Ed25519 builtin = libsodium/", /node Ed25519 builtin = libsodium/.test(strict), strict); }
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
    R.rec(`slack after a go at T0: LAST_COMMIT − T0 = ${(S.LAST - S.T0) / 1000} s ≥ R (${R_SLACK / 1000} s)`, "accept", S.LAST - S.T0 >= R_SLACK, `${(S.LAST - S.T0) / 1000} s`);
    const r = await bobRedeem(S, R, secret(S, "bob"));
    R.rec("Bob commits after a go at T0 (settles before T1), then reveals", "accept", r.settled && r.commit?.settled, r.refused ?? r.why ?? `${(S.T1 - S.L.now()) / 1000} s before T1`);
    const { sw } = await aliceTakesZec(S, R); R.rec("Alice still sweeps the ZEC", "accept", !!sw.accepted, sw.reason); }
  { const S = await start("tm-slow", R); S.bobSkew = -120_000; await S.L.untilMs(S.LAST + 10_000);
    R.rec("(control) a wall-clock-only rule would let a 120 s-slow Bob commit now", "observe", bobWall(S) <= S.LAST, `Bob's wall clock ${(S.LAST - bobWall(S)) / 1000} s before LAST`);
    const r = await bobRedeem(S, R, secret(S, "bob"));
    R.rec("Bob's clock 120 s slow, true time LAST+10 s: chain-time rule refuses (uses max(own clock, tip time) + drift)", "reject /past LAST/", /past LAST/.test(r.refused ?? ""), r.refused);
    const rf = await aliceRefund(S, R, secret(S, "alice")); R.rec("Alice refunds; Bob keeps his ZEC (nothing revealed)", "accept", rf.settled, rf.why); }
  { const S = await start("tm-fast", R, { go: false }); S.bobSkew = +120_000; await S.L.untilMs(S.T0); aliceGo(S);
    const r = await bobRedeem(S, R, secret(S, "bob"));
    R.rec("Bob's clock 120 s fast, go at T0: he refuses early (liveness cost only, fails safe)", "reject /past LAST/", /past LAST/.test(r.refused ?? ""), r.refused);
    const rf = await aliceRefund(S, R, secret(S, "alice")); R.rec("Alice refunds; Bob keeps his ZEC", "accept", rf.settled, rf.why); }
  { const S = await newSwapLite(); const P = rd(path.join(S.dir, "params.json"));
    const t1 = P.t0 + 1000 + MC + R_SLACK, t2 = t1 + S_SET + 1000 + R_SLACK + M, t3 = t1 + T3_MIN;
    const bad = paramsCheck({ ...P, t1: P.t0 + 1000 + MC }); R.rec("params with T1 = T0+1+Mc (no slack R): refused at setup", "reject /timing rule/", /timing rule/.test(bad ?? ""), bad);
    const ok = paramsCheck({ ...P, t1, t2, t3 }); R.rec("params exactly at T1 = T0+1+Mc+R, T2 = T1+S+1+R+M, T3 = T1+T3min: accepted", "accept", ok === null, ok);
    const old = paramsCheck({ ...P, t1, t2: t1 + 1000 + R_SLACK + MC, t3 }); R.rec("T2 = T1+1+R+Mc (no S: Bob could Notice before Alice's own T1 Notice is settled): refused", "reject /T2 ≥ T1\+S\+1\+R\+Mc/", /T2 ≥ T1\+S\+1\+R\+Mc/.test(old ?? ""), old);
    const short3 = paramsCheck({ ...P, t1, t2, t3: t1 + T3_MIN - 1 }); R.rec("T3 < T1 + T3min: refused", "reject /timing rule/", /timing rule/.test(short3 ?? ""), short3);
    const no3 = paramsCheck({ ...P, t3: undefined }); R.rec("t3 missing: refused (fail closed)", "reject /t3 must be/", /t3 must be/.test(no3 ?? ""), no3);
  }
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
  const R = new Results("cap"); console.log("== value cap (step 7: live feed prices, fail closed; q_eff with stales, pool-share gate, staleness, exposure)");
  const usd = (l, z) => swapUsd({ lovelace: l, zats: z, feed: FEED() });
  const amt = (u) => ({ lovelace: 0, zats: Math.floor(u / FEED().zecUsd * 1e8) });
  const base = { kDepth: 15, era: "nu7", tier: "v1", now: Date.now() };
  { const S = await newSwap("cap-ok"); const st = doSetup(S); R.rec(`default swap ($${usd(ADA_LOCK, ZEC_AMT).toFixed(0)} at feed prices) at K=15, Z=69 post-NU7: accepted`, "accept", st.alice.ok && st.bob.ok, st.alice.reason); }
  { const zt = REH ? 29 : 60, zre = REH ? /depth below floor .*Z ≥ 30/ : /Z=60 < 69/;   // step 10 (A5): rehearsal profile floor is Z = 30
    const S = await newSwap("cap-z60", { profile: { zDepth: zt } }); const st = doSetup(S);
    R.rec(REH ? "rehearsal depth Z=29 refused (post-NU7 floor 30)" : "step-5 depth Z=60 refused (needs 69 for ε=1e-3 at q=0.35 with 5% stales)", `reject /${zre.source}/`, !st.alice.ok && zre.test(st.alice.reason ?? ""), st.alice.reason); }
  { const v = valueCap7({ ...base, ...amt(600), zDepth: 64, feed: FEED() }); R.rec("Z=64 (enough only at 3.26% stales) refused at the 5% stale assumption", "reject /< 69/", /< 69/.test(v ?? ""), v); }
  { const S = await newSwap("cap-big", { paramsOver: { zats: 2_000_000_000 } }); const st = doSetup(S);
    R.rec(`20 ZEC ($${usd(ADA_LOCK, 2e9).toFixed(0)} at feed prices) above the $15,000 v1 cap: both refuse`, `reject /above the ${PROFILE.tier} cap/`, st.alice.code !== 0 && st.bob.code !== 0 && new RegExp(`above the ${PROFILE.tier} cap`).test(st.alice.reason ?? ""), st.alice.reason); }
  { const P = rd(path.join((await newSwapLite()).dir, "params.json"));
    P7feed = { ...FEED(), zecUsd: FEED().zecUsd * 30 }; const v = paramsCheck(P); P7feed = undefined;
    R.rec(`review4 F3: the SAME ${ZEC_AMT / 1e8} ZEC swap with the feed's ZEC price ×30 is refused (the cap follows the live feed, not constants)`, `reject /above the ${PROFILE.tier} cap/`, new RegExp(`above the ${PROFILE.tier} cap`).test(v ?? ""), v);
    for (const [nm, fd, re] of [["feed missing", null, /no pool-share/], ["ZEC price NaN", { ...FEED(), zecUsd: NaN }, /ZEC\/USD price/], ["ADA price negative", { ...FEED(), adaUsd: -1 }, /ADA\/USD price/],
        ["feed dated 2 h in the future", { ...FEED(), asOf: Date.now() + 2 * 3600e3 }, /in the future/], ["feed 25 h old", { ...FEED(), asOf: Date.now() - 25 * 3600e3 }, /h old/], ["feed without a date", { ...FEED(), asOf: undefined }, /no valid date/]]) {
      P7feed = fd; const w = paramsCheck(P); P7feed = undefined; R.rec(`setup with ${nm}: refused (fail closed)`, `reject /${re.source}/`, re.test(w ?? ""), w); }
    P7upgrades = null; const u = paramsCheck(P); P7upgrades = undefined; R.rec("review4 F5: scheduled-upgrade list missing: refused", "reject /upgrade list missing/", /upgrade list missing/.test(u ?? ""), u);
    P7upgrades = [{ name: "Cardano hard fork (test)", atMs: Date.now() + 3600e3 }]; const u2 = paramsCheck(P); P7upgrades = undefined; R.rec("review4 F5: a scheduled upgrade 1 h ahead: refused", "reject /upgrade blackout/", /upgrade blackout/.test(u2 ?? ""), u2);
    P7exposure = -1; const x = paramsCheck(P); P7exposure = 0; R.rec("exposure counter invalid (−1): refused", "reject /exposure counter missing or invalid/", /exposure counter missing or invalid/.test(x ?? ""), x);
    R.rec("control: same params with the honest feed and an empty upgrade list: accepted", "accept", paramsCheck(P) === null, paramsCheck(P)); }
  { const v = valueCap7({ ...base, ...amt(14_999), zDepth: 69, feed: FEED() }); R.rec("$14,999 at Z=69 with largest pool 33%: accepted", "accept", v === null, v); }
  { const v = valueCap7({ ...base, ...amt(600), zDepth: 69, feed: { ...FEED(), pools: [0.36, 0.1] } }); R.rec("largest pool 36% > 35%: refused", "reject /largest mining pool/", /largest mining pool/.test(v ?? ""), v); }
  { const v = valueCap7({ ...base, ...amt(600), zDepth: 69, feed: { ...FEED(), pools: [0.33, 0.18] } }); R.rec("top-2 pools 51% > 50%: refused", "reject /top-2/", /top-2/.test(v ?? ""), v); }
  { const v = valueCap7({ ...base, ...amt(600), zDepth: 69, feed: { ...FEED(), pools: [0.6, 0.6] } }); R.rec("malformed feed (shares sum > 1): refused", "reject /malformed/", /malformed/.test(v ?? ""), v); }
  { const v = valueCap7({ ...base, ...amt(600), zDepth: 69, feed: FEED(), exposureSoFar: 10 }); R.rec("11th swap with the same counterparty (exposure counter 10): refused", "reject /exposure/", /exposure/.test(v ?? ""), v); }
  { const v = valueCap7({ ...base, era: "now", tier: "rehearsal", ...amt(501), zDepth: 10, feed: FEED() }); R.rec("rehearsal tier: $501 refused ($500 cap)", "reject /above the rehearsal cap/", /above the rehearsal cap/.test(v ?? ""), v);
    const v2 = valueCap7({ ...base, era: "now", tier: "rehearsal", ...amt(313), zDepth: 10, feed: FEED() }); R.rec("rehearsal tier: $313 at K=15, Z=10 (NU6.3 era, 75 s): accepted", "accept", v2 === null, v2);
    const v3 = valueCap7({ ...base, ...amt(100), zDepth: 69, kDepth: 10, feed: FEED() }); R.rec("Cardano depth K=10 below the K=15 floor: refused", "reject /depth below floor/", /depth below floor/.test(v3 ?? ""), v3); }
  R.rec(`model cross-check: minZ(q=0.35, ε=1e-3) = ${minZ(0.35, 1e-3, 0)} / ${minZ(0.35, 1e-3, 0.0326)} / ${minZ(0.35, 1e-3, 0.05)} at 0 / 3.26 / 5% stales (review3: 58 / 64 / 69)`, "observe", minZ(0.35, 1e-3, 0) === 58 && minZ(0.35, 1e-3, 0.05) === 69);
  return { R };
}

// ---------- step 6: NU7 transition (R3-H1) ----------
const BL9 = Math.ceil((REAL_PRE_S + REAL_TAIL_S + 24 * 3600) / 25) + 1, NU7_FAR = BL9 + 1152 + 2000;
async function nu7Cases() {
  const R = new Results("nu7"); console.log("== R3-H1: NU7 activation — blackout, branch/version gate, measured spacing, rebuild across activation");
  const BL = nu7BlackoutBlocks(REAL_SWAP_S);
  { const S = await newSwap("nu7-blackout"); doSetup(S); zec(["genesis", ...S.d("nu7_height=1500")]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]); const g = zecGate(S);
    R.rec("NU7 activates within 24 h of the swap window (tip 1, NU7 at 1500): Bob refuses to fund", "reject /blackout/", /blackout/.test(g ?? ""), g); }
  { const S = await newSwap("nu7-far"); doSetup(S); zec(["genesis", ...S.d(`nu7_height=${NU7_FAR}`)]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]); const g = zecGate(S); const tip = zec(["status", ...S.d()]).tip;
    R.rec(`NU7 at ${NU7_FAR} (> tip ${tip} + setup→T3+24 h at 25 s (${BL9} blocks) + 1,152 pre blocks): allowed`, "accept", g === null && tip + BL9 + 1152 < NU7_FAR, g); }
  { const S = await newSwap("nu7-tail"); doSetup(S); zec(["genesis", ...S.d("nu7_height=20000")]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]); const g = zecGate(S);
    R.rec("step 9 (R5-L2): NU7 at 20,000 — outside the old T2+24 h window (4,003 blocks) but INSIDE setup→T3+24 h: refused", "reject /NU7 blackout/", /NU7 blackout/.test(g ?? ""), g); }
  { const S = await newSwap("nu7-after"); doSetup(S); zec(["genesis", ...S.d("nu7_height=100", "start_height=200")]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]); const g = zecGate(S);
    R.rec("after activation, params still agreed for NU6.3: refused by the branch check", "reject /branch/", /branch/.test(g ?? ""), g); }
  { const S = await newSwap("nu7-after2", { paramsOver: { zec_branch: 0x77190ad9 } }); doSetup(S); zec(["genesis", ...S.d("nu7_height=100", "start_height=200")]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]); const g = zecGate(S);
    R.rec(`${200 + ZEC_HISTORY - 100} blocks after activation, params agreed for NU7 (branch OK): the post-activation blackout (${BL.post.toLocaleString("en-US")} blocks) fires on its own`, "reject /NU7 blackout/", /NU7 blackout/.test(g ?? ""), g); }
  { const S = await newSwap("nu7-slow"); doSetup(S); zec(["genesis", ...S.d()]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`, "spacing=120")]); const g = zecGate(S);
    R.rec("measured spacing 120 s over 48 blocks vs nominal 75 s (> 1.5×): refused, fail closed", "reject /measured block spacing/", /measured block spacing/.test(g ?? ""), g);
    zec(["mine", ...S.d(`n=${ZEC_HISTORY}`, "spacing=80")]); const g2 = zecGate(S); R.rec("measured spacing back to 80 s over the last 48 blocks (≤ 112.5 s): allowed", "accept", g2 === null, g2); }
  { const S = await newSwap("nu7-short"); doSetup(S); zec(["genesis", ...S.d()]); zec(["mine", ...S.d("n=12")]); const g = zecGate(S);
    R.rec("review4 F4: only 12 blocks of history (< 48): refused, no nominal fallback", "reject /measured over 12 blocks/", /measured over 12 blocks/.test(g ?? ""), g); }
  { const S = await newSwap("nu7-zero"); doSetup(S); zec(["genesis", ...S.d()]); const g = zecGate(S);
    R.rec("review4 F4: no block history at all (spacing 0, window 0): refused", "reject /measured over 0 blocks/", /measured over 0 blocks/.test(g ?? ""), g); }
  { const S = await newSwap("nu7-oldnode"); doSetup(S); zec(["genesis", ...S.d()]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]); S.nodeSupportsNu7 = false; const g = zecGate(S);
    R.rec("wallet's node does not implement NU7: refused (minority-chain risk)", "reject /does not implement NU7/", /does not implement NU7/.test(g ?? ""), g); }
  { const S = await newSwap("nu7-unknown"); doSetup(S); zec(["genesis", ...S.d()]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]); S.nodeSupportsNu7 = undefined; const st = zec(["status", ...S.d("window=48")]);
    const g = nu7Gate7({ tip: st.tip, nu7Height: st.nu7_height, branchNext: st.branch_next_id, expectBranch: 0x37a5165b, measuredSpacing: st.measured_mean_spacing_s, nominalSpacing: st.nominal_spacing_s, spacingWindow: st.window, swapSeconds: REAL_SWAP_S, nodeSupportsNu7: undefined });
    R.rec("node did not say whether it implements NU7 (undefined): refused", "reject /does not implement NU7/", /does not implement NU7/.test(g ?? ""), g); }
  { const S = await newSwap("nu7-branch", { paramsOver: { zec_branch: 0x77190ad9 } }); const st = doSetup(S); zec(["genesis", ...S.d()]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]); const g = zecGate(S);
    R.rec("params agreed for NU7 but the node is still on NU6.3: refused", "reject /branch/", /branch/.test(g ?? ""), g);
    R.rec("swap_id binds zec_branch (NU7 transcript differs from NU6.3 transcript)", "accept", st.alice.ok && st.alice.swap_id !== undefined); }
  // a swap whose sweep straddles activation (simulated without the blackout, to show the rebuild path works)
  { const S = await start("nu7-cross", R);
    const tip = zec(["status", ...S.d()]).tip;
    const ch = JSON.parse(fs.readFileSync(path.join(S.dir, "chain.json"))); ch.nu7_height = tip + 3; fs.writeFileSync(path.join(S.dir, "chain.json"), JSON.stringify(ch));
    const a = leHex(secret(S, "alice")), b = leHex(secret(S, "bob"));
    const pre = zec(["sweep", ...S.d("party=alice", `other_share=${b}`, `out=${S.dir}/pre.tx`)]);
    R.rec("Alice's sweep built pre-NU7 carries expiry capped at nu7_height − 1", "accept", pre.info.expiry_height === tip + 2, `expiry ${pre.info.expiry_height}, nu7 ${tip + 3}`);
    zec(["mine", ...S.d("n=3")]);
    const s1 = zec(["submit", ...S.d(`tx=${S.dir}/pre.tx`)], true);
    R.rec("after activation the NU6.3-signed sweep is rejected", "reject /wrong consensus branch|TxExpired/", /wrong consensus branch|TxExpired/.test(s1.reason ?? ""), s1.reason);
    const post = zec(["sweep", ...S.d("party=alice", `other_share=${b}`, `out=${S.dir}/post.tx`)]); const s2 = zec(["submit", ...S.d(`tx=${S.dir}/post.tx`)], true);
    R.rec("rebuilt + re-signed under NU7 (+120 expiry): accepted", "accept", s2.accepted === true && s2.branch === "Nu7" && post.info.expiry_height === tip + 4 + 120, `${s2.branch} expiry ${post.info.expiry_height}`); void a;
    return { R, S }; }
}

// ---------- step 6: Cardano congestion (R3-H2) ----------
async function congestionCases() {
  const R = new Results("congestion"); console.log("== R3-H2 (two-step): spam before the Commit — abort only; spam before the Reveal — Bob's gate holds, no deadline");
  { const S = await start("cg-hold", R); S.L.setSpam(true);
    const r1 = await bobCommit(S, R);
    R.rec("mempool full of spam: Bob's Commit is not admitted (no secret in it anyway)", "accept", !r1.settled && /MempoolFull/.test(r1.why ?? ""), r1.why);
    await S.L.untilMs(S.LAST + 1000); const r2 = await bobRedeem(S, R, secret(S, "bob"));
    R.rec("spam lasts past LAST_COMMIT: Bob does not commit any more", "reject /past LAST/", /past LAST/.test(r2.refused ?? ""), r2.refused);
    R.rec("b never appeared in any mempool or block", "accept", !secretInMempool(S, secret(S, "bob")));
    const spent = S.L.spam.adaSpent; S.L.setSpam(false);
    const rf = await aliceRefund(S, R, secret(S, "alice"));
    R.rec("attacker stops; Alice refunds (escrow still Open K blocks after T1; reveals a)", "accept", rf.settled, rf.why ?? rf.refused);
    const sw = sweep(S, R, "bob", [`other_share=${leHex(secret(S, "alice"))}`], "Sweep (Bob, a+b)");
    R.rec("Bob recovers his ZEC with a: nobody loses principal (griefing only)", "accept", sw.accepted === true, sw.reason);
    R.rec(`attacker's spam cost for this hold: ${spent.toFixed(1)} ADA (≈ $${(spent * FEED().adaUsd).toFixed(2)}) — 4.38 ADA per full block`, "observe", spent > 0); }
  { const S = await start("cg-reveal-hold", R); const bobX = secret(S, "bob");
    const c = await bobCommit(S, R); S.L.setSpam(true);
    const r1 = await bobReveal(S, R, bobX);
    R.rec("Commit settled, then the mempool fills: Bob's reveal gate HOLDS b (before T3 − M)", "reject /^HOLD: mempool fill/", c.settled && /^HOLD: mempool fill/.test(r1.refused ?? ""), r1.refused);
    await S.L.untilMs(S.T2 + 60_000); S.L.setSpam(false);
    const r2 = await bobReveal(S, R, bobX);
    R.rec("spam stops after T2 (all old deadlines gone): Bob reveals and settles; nothing was at risk meanwhile", "accept", r2.settled, r2.refused ?? r2.why);
    const { sw } = await aliceTakesZec(S, R); R.rec("Alice sweeps the ZEC", "accept", sw.accepted === true, sw.reason);
    return { R, S }; }
}
async function congestion2Cases() {
  const R = new Results("congestion2"); console.log("== R3-H2: spam AFTER the Reveal is admitted: FIFO, and there is no deadline anyway");
  { const S = await start("cg-fifo", R); const c = await bobCommit(S, R);
    const hook = async (S2, cur, i) => { if (i === 0) S2.L.setSpam(true, { behind: true }); };   // attacker floods the instant b is seen
    S.L.spam = { on: false, ahead: Math.floor(0.49 * S.L.mempoolCap()), blocks: 0, adaSpent: 0 };   // 49% pre-fill passes the gate
    const r = await bobReveal(S, R, secret(S, "bob"), { hook });
    R.rec("Bob reveals behind a 49% pre-fill; attacker then floods: the Reveal still settles", "accept", c.settled && r.settled, r.why ?? r.refused);
    const spent = S.L.spam.adaSpent; S.L.setSpam(false);
    const fa = await aliceRefund(S, R, secret(S, "alice"), { at: Math.max(S.T1, S.L.now()) }).catch(e => ({ settled: false, why: e.message })); R.rec("Alice's Refund is refused by her own gate (escrow not Open)", "reject /not Open/", !fa.settled && /not Open/.test(fa.refused ?? ""), fa.why ?? fa.refused);
    R.rec(`spam spent ${spent.toFixed(1)} ADA for nothing (and the escrow ended Claimed→spent by Bob)`, "accept", spent > 0 && !claimedLive(S) && !escrowLive(S), spent);
    return { R, S }; }
}
async function congestion3Cases() {
  const R = new Results("congestion3"); console.log("== R3-H2 / review4 F1 re-run: producers censor Bob's admitted REVEAL past T1 and T2 — now SAFE");
  { const S = await start("cg-bribe", R); const bobX = secret(S, "bob"), aliceX = secret(S, "alice");
    const c = await bobCommit(S, R);
    S.L.censor = (p) => /^reveal/.test(p.label) && S.L.now() < S.T2 + 120_000;   // every producer excludes Bob's Reveal (bribed) until after T2
    let sw = { reason: "hook not reached" };
    const hook = async (S2, cur, i) => { if (i !== 1) return;   // during censorship (Reveal pending, before T2)
      const tk = await aliceTakesZecPeek(S).catch(() => ({ b: null }));
      sw = tk.b !== null ? sweep(S, R, "alice", [`other_share=${tk.bHex}`], "Sweep (Alice, a+b) during censorship") : { reason: "no b" };
      await S.L.untilMs(Math.max(S.T1, S.L.now()));
      await mustFail(R, "during censorship, past T1: Alice's Refund{a} on the Claimed UTxO (the step-6 congestion3 theft): script rejects", SCRIPT_FAIL, async () => asideFrom(S, /^reveal/, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.T1, null, S.claimed), true), S.A, "cheat_refund_claimed")));
      await mustFail(R, "Alice's Refund{a} on the (spent) Open escrow: ledger rejects", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.T1), true), S.A, "cheat_refund_open")); };
    const r = await bobReveal(S, R, bobX, { maxBlocks: 80, hook });
    R.rec("Alice read b from the censored Reveal and sweeps the ZEC (her side of the trade)", "observe", sw.accepted === true, sw.reason);
    R.rec("the censored Reveal settles once censorship lifts after T2: Bob gets the ADA — congestion3 is no longer a loss", "accept", c.settled && r.settled, r.why ?? `settled ${(S.L.now() - S.T2) / 1000} s after T2`);
    S.L.censor = null; return { R, S }; }
}
// ---------- step 8: refund timing (replaces LAST_REFUND): the Notice has NO deadline; the reveal must be ≤ t4 − M ----------
async function lateRefundCases() {
  const R = new Results("laterefund"); console.log("== step 8: no refund deadline before Notice; RefundReveal only ≤ t4 − M; Bob's Notice only from T2");
  { const S = await start("lr", R, { go: false });
    const g = bobNoticeGate({ now: S.T2 - 1000, T2: S.T2, escrowOpen: true });
    R.rec("Bob's wallet refuses a Notice before T2", "reject /before T2/", /before T2/.test(g ?? ""), g);
    const rf = await aliceRefund(S, R, secret(S, "alice"), { at: S.T2 + 300_000 });
    R.rec("Alice starts her refund LATE (T2 + 300 s, Bob silent, no Notice yet): Notice + RefundReveal settle — no deadline on starting", "accept", rf.settled, rf.refused ?? rf.why);
    R.rec("the Notice was Alice's own; t4 − (Notice upper) = the tail exactly", "accept", rf.notice.by?.startsWith("notice") && S.t4 - (S.L.zeroTime + Number(CML.Transaction.from_cbor_hex(S.L.log.find(t => t.hash === S.noticeHash).txHex).body().ttl()) * 1000) === TAIL); }
  { const S = await start("lr-late-reveal", R, { go: false });
    const n = await aliceNotice(S, R); await S.L.untilMs(S.t4 - M + 20_000);
    const r = await aliceRefundReveal(S, R, secret(S, "alice"));
    R.rec("Alice's wallet refuses to reveal a after t4 − M (she lost track of time): a stays secret", "reject /past t4/", n.settled && /past t4/.test(r.refused ?? "") && !secretInMempool(S, secret(S, "alice")), r.refused);
    const f = await bobForfeit(S, R);
    R.rec("so Bob Forfeits at t4 (as if Alice were silent); the ZEC stays locked — the accepted 'Alice silent' outcome", "accept", f.settled, f.refused); }
  return { R };
}
async function refscriptCases() {
  const R = new Results("refscript"); console.log("== R3-L1: lock output with a reference script");
  const S = await newSwap("refscript"); doSetup(S);
  if (S.L.now() !== S.tSetup) throw new Error("time moved"); S.swapId = swapIdOf(S, "alice");
  const lucid = await as(S, S.A);
  const tx = await lucid.newTx().pay.ToContract(S.scriptAddr, { kind: "inline", value: datumOf(S) }, { lovelace: ADA_LOCK }, SCRIPT).complete();
  const r = await S.L.submit((await tx.sign.withWallet().complete()).toCBOR(), "lock+refscript"); S.lockHash = r.txHash; await S.L.awaitBlock(1 + K);
  S.escrow = (await S.L.em.getUtxos(S.scriptAddr)).find(u => u.txHash === r.txHash);
  const why = bobChecksLock(S);
  R.rec("canonical datum + a reference script on the lock output: Bob refuses to fund", "reject /reference script/", /reference script/.test(why ?? ""), why);
  return { R, S };
}
async function premiumCases() {
  const R = new Results("premium"); console.log("== review4 F2: the option premium is REMOVED (code, spec, tests)");
  const src = fs.readFileSync(new URL(import.meta.url).pathname, "utf8"), pol = fs.readFileSync(path.join(ROOT, "ada/policy7.mjs"), "utf8") + fs.readFileSync(path.join(ROOT, "ada/policy8.mjs"), "utf8");
  const hit = (t) => new RegExp(["prem" + "iumGate", "prem" + "iumPaidUsd", "prem" + "iumConfs", "P6\\.prem" + "ium", "prem" + "ium:\\s*\\{"].join("|")).test(t);
  R.rec("no premium gate, premium parameter or premium payment in e2e4.mjs, policy7.mjs or policy8.mjs", "accept", !hit(src) && !hit(pol));
  R.rec("policy7/policy8 export no premium symbol", "accept", ![...Object.keys(await import("./policy7.mjs")), ...Object.keys(await import("./policy8.mjs"))].some(k => /premium/i.test(k)));
  { const S = await newSwap("nopremium"); const st = doSetup(S); R.rec("a swap with no premium payment at all is accepted by both wallets", "accept", st.alice.ok && st.bob.ok, st.alice.reason ?? st.bob.reason); }
  return { R };
}
async function zecNodeCases() {
  const R = new Results("zecnode"); console.log("== Zcash sim node: NU6.3/NU7 consensus rules (zec/neg_tests.sh, fresh keys)");
  const w = path.join(RUNS, `zecnode-${Date.now()}`);
  try { execFileSync("bash", [path.join(ROOT, "zec/neg_tests.sh"), w], { encoding: "utf8", maxBuffer: 1 << 26 }); } catch (e) { /* summary below */ }
  for (const l of fs.readFileSync(path.join(w, "results.jsonl"), "utf8").trim().split("\n")) { const j = JSON.parse(l); R.rec(j.test, j.want, j.ok, j.ok ? "" : j.out); }
  return { R };
}


// ======================= step 8: griefing, refund-trap fork, censorship of both refund steps, races =======================
const aliceSeesB = (S) => viewOf(S, "alice").otherShare();   // step 11 (W-1): Alice's own view; b only if b·G1 = B_c (either redeemer encoding)
// A bribed producer can include ANY valid tx regardless of what other mempools hold (conflicting censored txs set aside).
async function asideFrom8(S, re, fn) { const keep = S.L.pending.filter(p => re.test(p.label)); S.L.pending = S.L.pending.filter(p => !re.test(p.label));
  try { return await fn(); } finally { const now = new Set(S.L.pending.map(p => p.hash)); S.L.pending = S.L.pending.filter(p => !keep.some(k => [...k.inputs].some(i => p.inputs.has(i)))).concat(keep.filter(k => !now.has(k.hash))); } }
// a colluding producer DISCARDS the matching pending txs for good (unlike asideFrom8, which restores them)
const discard = (S, re) => { S.L.pending = S.L.pending.filter(p => !re.test(p.label)); };
const zecBal = (S, who) => zec(["balance", ...S.d(`party=${who}`)]).unspent_zats;

async function stallEscape() {
  const R = new Results("g8_stall_escape"); console.log("== step 8 griefing (e2e): Bob commits, stalls all the way to T3, Alice Escapes");
  const S = await start("g8-stall", R); const aliceX = secret(S, "alice"), bobX = secret(S, "bob");
  const aliceAda0 = await lovelaceAt(S, S.A.address);
  const c = await bobCommit(S, R); R.rec("Bob's Commit settles before T1, then Bob goes silent (no Reveal)", "accept", c.settled, c.why);
  await S.L.untilMs(S.T1 + 1000);
  const ng = await aliceNotice(S, R, { at: S.L.now() }); R.rec("Alice's wallet refuses a Notice: the escrow is Claimed, not Open", "reject /not Open/", /not Open/.test(ng.refused ?? ""), ng.refused);
  await mustFail(R, "a forced Notice on the Claimed UTxO: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, noticeTx(S, S.L.now(), { utxo: S.claimed }), true), S.A, "cheat_notice_claimed"));
  await mustFail(R, "RefundReveal{a} on the Claimed UTxO: script rejects (a is never needed)", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.L.now(), null, S.claimed), true), S.A, "cheat_refund_claimed"));
  await S.L.untilMs(S.T2 + 1000);
  await mustFail(R, "Bob's Notice from T2 on the Claimed UTxO: script rejects (no Forfeit path out of Claimed)", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, noticeTx(S, S.L.now(), { utxo: S.claimed, signer: S.B }), true), S.B, "cheat_bob_notice_claimed"));
  await S.L.untilMs(S.T3 - 30_000);
  const eg0 = escapeGate({ now: S.L.now(), T3: S.T3, claimed: true, sawB: aliceSeesB(S) !== null });
  R.rec("Alice's Escape gate refuses before T3", "reject /before T3/", /before T3/.test(eg0 ?? ""), eg0);
  await mustFail(R, "Escape 30 s before T3: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.A, escapeTx(S, S.L.now()), true), S.A, "cheat_escape_early"));
  await S.L.untilMs(S.T3);
  const eg = escapeGate({ now: S.L.now(), T3: S.T3, claimed: !!S.L.entry(S.claimed.txHash + S.claimed.outputIndex), sawB: aliceSeesB(S) !== null });
  R.rec("at T3: Alice's Escape gate passes (Claimed, b never seen)", "accept", eg === null, eg);
  await refreshParams(S); const e = await signSubmit(S, await build(S, S.A, escapeTx(S, S.T3)), S.A, "escape"); await S.L.awaitBlock(K);
  cardanoCost(R, "Escape (Alice, at T3, no secret)", e);
  R.rec("Alice's Escape settles at T3: ADA back to Alice", "accept", S.L.confirmations(e.txHash) >= K);
  R.rec("a was never broadcast during the whole stall", "accept", !secretInMempool(S, aliceX));
  await mustFail(R, "Bob cannot take his ZEC back (no a)", NODE_SIG, () => sweep(S, R, "bob", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_bob_one_share"));
  await mustFail(R, "Bob's late Reveal after the Escape: input already spent", BAD_INPUTS, async () => signSubmit(S, await build(S, S.B, revealTx(S, bobX), true), S.B, "reveal_late"));
  const aliceAda = await lovelaceAt(S, S.A.address);
  R.rec(`final: Alice has her ADA back (net fees ${(Number(aliceAda0 - aliceAda) / 1e6).toFixed(3)} ADA); her cost was the T3 − T1 wait (real 7 days)`, "accept", aliceAda > aliceAda0 - 1_000_000n);
  R.rec("final: Bob's ZEC stays at the joint key — stalling costs the staller his whole side (dominated strategy)", "accept", zec(["watch", ...S.d("party=bob", `amount=${ZEC_AMT}`, "min_depth=1")], true).status === "funded_ok");
  return { R, S };
}

// Refund-trap fork: an adversarial producer holds Bob's (valid, pre-T1) Commit and later publishes a competing fork that
// branches BEFORE T1 and includes it, orphaning Alice's Notice (and her RefundReveal, if she already sent one).
async function refundTrap() {
  const R = new Results("g8_refund_trap"); console.log("== step 8: refund-trap FORK test — Commit in a competing pre-T1 fork vs Alice's Notice/RefundReveal");
  const forkSlot = (S) => { let sl = S.L.slotOf(S.T1) - 2; while (S.L.blocks.some(b => b.slot === sl)) sl -= 1; return sl; };
  const depthAfter = (S, sl) => S.L.blocks.filter(b => b.slot > sl).length;
  const heldCommit = async (S) => { await S.L.untilMs(S.T1 - 60_000); await refreshParams(S); const t = await build(S, S.B, commitTx(S, S.goSig));
    return (await t.sign.withPrivateKey(S.B.privateKey).complete()).toCBOR(); };   // signed, sent ONLY to the adversarial producer
  { // CONTROL: Alice breaks the K-confirmation rule and reveals a after 1 confirmation of her Notice
    const S = await start("g8-trap-ctl", R); const aliceX = secret(S, "alice"), bobX = secret(S, "bob");
    const hex = await heldCommit(S); await S.L.untilMs(S.T1);
    await refreshParams(S); const n = await signSubmit(S, await build(S, S.A, noticeTx(S, S.T1)), S.A, "notice#1"); await S.L.awaitBlock(1);
    const o = await ownRefunding(S); S.refunding = o?.u;
    const rr = await signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.L.now() - 1000)), S.A, "refundreveal_early"); await S.L.awaitBlock(1);
    const nc = S.L.confirmations(n.txHash); const sl = forkSlot(S); const d = depthAfter(S, sl); const orphan = await S.L.fork(d, sl, [hex], ["commit_fork"]); await S.L.awaitBlock(K);
    const cm = S.L.log.find(t => t.label === "commit_fork");
    R.rec(`fork of depth ${d} (Notice had ${nc} < K = ${K} confirmations) branching before T1 includes the held Commit; Notice and RefundReveal are orphaned and dropped`, "observe", !!cm && S.L.status(n.txHash) === "dropped" && S.L.status(rr.txHash) === "dropped", `orphaned [${orphan.join(", ")}]`);
    S.commitHash = cm?.hash; S.claimed = await ownClaimed(S);
    const a = refundA(S); const swB = sweep(S, R, "bob", [`other_share=${leHex(a ?? 0n)}`], "Sweep (Bob, a+b, after fork)");
    const rv = await bobReveal(S, R, bobX, { ignoreRule: true });
    const swA = (await aliceTakesZec(S, R, "Sweep (Alice, late)")).sw;
    R.rec("CONTROL (rule broken: a revealed on a 1-conf Notice): Bob sweeps the ZEC with a AND takes the ADA with Reveal{b} → Alice loses → the K-conf rule is necessary", "accept (expected loss)", a === aliceX && swB.accepted === true && rv.settled && swA.accepted !== true, `${swA.reason ?? ""}`.slice(0, 120)); }
  { // RULE: Alice waits for K confirmations of her Notice before revealing; the same fork hits while the Notice has 1 conf
    const S = await start("g8-trap", R); const aliceX = secret(S, "alice"), bobX = secret(S, "bob");
    const hex = await heldCommit(S); let forked = null;
    const hook = async (S2, cur, i) => { if (!forked && cur && S.L.confirmations(cur.txHash) === 1) { const sl = forkSlot(S); const d = depthAfter(S, sl); forked = { d, orphan: await S.L.fork(d, sl, [hex], ["commit_fork"]) }; } };
    const n = await aliceNotice(S, R, { hook });
    R.rec(`the same fork (depth ${forked?.d}) arrives while Alice's Notice has 1 < K confirmations`, "observe", !!forked, forked?.orphan?.join(", "));
    R.rec("Alice's Notice procedure ends WITHOUT revealing a (escrow spent by the Commit in the winning fork)", "accept", !n.settled && /Commit won/.test(n.why ?? "") && !secretInMempool(S, aliceX), n.why);
    S.commitHash = S.L.log.find(t => t.label === "commit_fork")?.hash; await S.L.awaitBlock(K);
    const rv = await bobReveal(S, R, bobX, { ignoreRule: false });
    R.rec("the swap simply completes: Bob's Commit (now K deep) → Reveal{b} settles", "accept", rv.settled, rv.refused ?? rv.why);
    const { sw } = await aliceTakesZec(S, R); R.rec("Alice sweeps the ZEC with b: nobody loses", "accept", sw.accepted === true, sw.reason);
    R.rec(`the fork used here was ${forked?.d} block(s) deep and Alice's Notice had < K confirmations when it hit (deeper-than-K forks: see r9_fork_multi)`, "accept", !!forked && forked.d >= 1); }
  return { R };
}

async function refundCensored() {
  const R = new Results("g8_refund_censored"); console.log("== step 8: Refund censored (was the step-7 open hole: censoring Alice's refund until Punish). Now safe.");
  { const S = await start("g8-rc", R, { go: false }); const aliceX = secret(S, "alice");
    S.L.censor = (p) => /^notice/.test(p.label) && S.L.now() < S.T2 + 600_000;
    const n = await aliceNotice(S, R, { maxBlocks: 120, hook: async () => {
      if (S.L.now() >= S.T2 + 60_000 && !S._probed) { S._probed = true;
        await mustFail(R, "while Alice's Notice is censored past T2: Bob cannot Commit (script)", SCRIPT_FAIL, async () => asideFrom8(S, /^notice/, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig ?? "00".repeat(64), { upper: S.L.now() + 60_000 }), true), S.B, "cheat_commit_late")));
        await mustFail(R, "… nor Forfeit the Open escrow (script)", SCRIPT_FAIL, async () => asideFrom8(S, /^notice/, async () => signSubmit(S, await build(S, S.B, forfeitTx(S, S.L.now(), null, S.escrow), true), S.B, "cheat_forfeit_open"))); } } });
    S.L.censor = null;
    R.rec(`Alice's Notice censored from T1 to T2 + 600 s (rebuilt ${n.builds.length}× as each TTL lapsed) then settles: no deadline was missed`, "accept", n.settled && S.L.now() > S.T2 + 600_000, n.why);
    const rv = await aliceRefundReveal(S, R, aliceX); R.rec("Alice reveals a and gets her ADA", "accept", rv.settled, rv.refused ?? rv.why);
    const sw = sweep(S, R, "bob", [`other_share=${leHex(refundA(S))}`], "Sweep (Bob, a+b)"); R.rec("Bob gets his ZEC back: censorship cost only time", "accept", sw.accepted === true, sw.reason); }
  { const S = await start("g8-rc-bob", R, { go: false }); const aliceX = secret(S, "alice");
    S.L.censor = (p) => /^notice/.test(p.label) && S.L.now() < S.T3 + 600_000;   // Alice's Notice censored for a very long time
    const n = await aliceNotice(S, R, { maxBlocks: 40, hook: async () => {
      if (S.L.now() >= S.T2 && !S._bob) { S._bob = true;   // a producer colluding with Bob drops Alice's Notice and includes Bob's
        discard(S, /^notice/); await refreshParams(S); await signSubmit(S, await build(S, S.B, noticeTx(S, S.T2, { signer: S.B })), S.B, "bobnotice#1"); } } });
    R.rec("Alice's Notice censored past T2; Bob's own Notice is included instead → Alice accepts the Refunding state it creates (same datum rule)", "accept", n.settled && /^bobnotice/.test(n.by ?? ""), n.why ?? n.by);
    const rv = await aliceRefundReveal(S, R, aliceX);
    R.rec(`Alice reveals a long before t4 (t4 − now = ${((S.t4 - S.L.now()) / 1000).toFixed(0)} s ≈ the full tail): ADA back`, "accept", rv.settled, rv.refused ?? rv.why);
    const f = await bobForfeit(S, R); R.rec("honest Bob's Forfeit gate refuses after seeing a (he sweeps his ZEC instead)", "reject /a was seen|not in the Refunding/", /a was seen|not in the Refunding/.test(f.refused ?? ""), f.refused);
    S.L.censor = null; }
  return { R };
}

async function bothStepsCensored() {
  const R = new Results("g8_censor_both"); console.log("== step 8: censorship of BOTH refund steps (Notice, then RefundReveal{a})");
  { const S = await start("g8-cb", R, { go: false }); const aliceX = secret(S, "alice");
    S.L.censor = (p) => /^notice/.test(p.label) && S.L.now() < S.T1 + 300_000;
    const n = await aliceNotice(S, R, { maxBlocks: 80 });
    R.rec("Notice censored 300 s, then settles", "accept", n.settled, n.why);
    const lift = S.t4 - 2 * M; S.L.censor = (p) => /^refundreveal/.test(p.label) && S.L.now() < lift;
    const rv = await aliceRefundReveal(S, R, aliceX, { maxBlocks: 200, hook: async () => {
      if (S.L.now() >= S.t4 - 3 * M && !S._p) { S._p = true; const f = forfeitGate({ now: S.L.now(), t4: S.t4, refunding: true, sawA: refundA(S) !== null });
        R.rec("while the RefundReveal is censored: honest Bob's Forfeit gate refuses (before t4, and a seen)", "reject", f !== null, f);
        await mustFail(R, "… and a forced Forfeit before t4 fails in the script", SCRIPT_FAIL, async () => asideFrom8(S, /^refundreveal/, async () => signSubmit(S, await build(S, S.B, forfeitTx(S, S.L.now()), true), S.B, "cheat_forfeit_early"))); } } });
    R.rec(`RefundReveal censored for ${((lift - S.L.log.find(t => t.hash === S.noticeHash).slot * 1000 - S.L.zeroTime) / 1000).toFixed(0)} s (most of the tail) then settles before t4: Alice safe`, "accept", rv.settled && S.L.now() < S.t4, rv.why);
    S.L.censor = null; }
  { const S = await start("g8-cb-ctl", R, { go: false }); const aliceX = secret(S, "alice");
    const n = await aliceNotice(S, R);
    S.L.censor = (p) => /^refundreveal/.test(p.label);   // ~100% of stake censors a for the WHOLE tail
    const rv = await aliceRefundReveal(S, R, aliceX, { maxBlocks: Math.ceil((S.t4 - S.L.now()) / BLOCK) + 2 });
    R.rec("CONTROL: RefundReveal censored for the whole tail (real 7 days)", "observe", n.settled && !rv.settled, rv.why);
    let ok, why; try { discard(S, /^refundreveal/); await refreshParams(S); const f = await signSubmit(S, await build(S, S.B, forfeitTx(S, S.t4)), S.B, "forfeit"); await S.L.awaitBlock(K); ok = S.L.confirmations(f.txHash) >= K; } catch (e) { ok = false; why = e.message; }
    const sw = sweep(S, R, "bob", [`other_share=${leHex(refundA(S) ?? 0n)}`], "Sweep (Bob, a from mempool)");
    R.rec("CONTROL (residual R-1): a colluding Bob Forfeits at t4 AND sweeps the ZEC with a from the mempool → Alice loses → the only residual is ~100% stake censorship for the whole tail", "accept (expected loss)", ok && sw.accepted === true, why);
    S.L.censor = null; }
  return { R };
}

async function aliceStalls() {
  const R = new Results("g8_alice_stalls"); console.log("== step 8 griefing: Alice Notices, then never reveals a → Bob Forfeits at t4");
  const S = await start("g8-as", R, { go: false });
  const n = await aliceNotice(S, R); R.rec("Alice's Notice settles; she then goes silent", "accept", n.settled, n.why);
  await S.L.untilMs(S.t4 - 60_000);
  const f0 = forfeitGate({ now: S.L.now(), t4: S.t4, refunding: true, sawA: false }); R.rec("Bob's Forfeit gate refuses before t4", "reject /before t4/", /before t4/.test(f0 ?? ""), f0);
  await mustFail(R, "Forfeit 60 s before t4: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, forfeitTx(S, S.L.now()), true), S.B, "cheat_forfeit_early"));
  await mustFail(R, "a third party Forfeits at t4 (not Bob): script rejects", SCRIPT_FAIL, async () => { await S.L.untilMs(S.t4); return signSubmit(S, await build(S, S.A, forfeitTx(S, S.t4, S.A), true), S.A, "cheat_forfeit_alice"); });
  const f = await bobForfeit(S, R); if (f.txHash) cardanoCost(R, "Forfeit (Bob, at t4)", f);
  R.rec("Bob's Forfeit settles at t4: ADA to Bob", "accept", f.settled, f.refused);
  R.rec(`Bob's total wait = t4 − T1 = ${((S.t4 - S.T1) / 1000).toFixed(0)} s (sim; real ≈ Notice + 7 d): equals TAIL + Notice TTL bound`, "accept", S.t4 - S.T1 >= TAIL && S.t4 - S.T1 <= TAIL + NOTICE_RANGE_MAX, S.t4 - S.T1);
  R.rec("final: ZEC stays at the joint key (Alice stalled after her own Notice — same outcome as the old Punish)", "accept", zec(["watch", ...S.d("party=bob", `amount=${ZEC_AMT}`, "min_depth=1")], true).status === "funded_ok" && !secretInMempool(S, secret(S, "alice")));
  return { R, S };
}

async function commitNoticeRace() {
  const R = new Results("g8_race"); console.log("== step 8: Commit-vs-Notice races near T1 (the two are disjoint in time: Commit upper ≤ T1 − 1 s, Notice lower ≥ T1)");
  { const S = await start("g8-race-held", R); const aliceX = secret(S, "alice"), bobX = secret(S, "bob");
    S.L.censor = (p) => /^commit/.test(p.label) && S.L.now() < S.T1;
    const c = await bobCommit(S, R); R.rec("Bob's Commit is held by producers until T1 (still pending at T1)", "observe", !c.settled, c.why);
    const rb = await bobReveal(S, R, bobX); R.rec("Bob's wallet refuses to reveal b (Commit not settled)", "reject /not settled/", /not settled/.test(rb.refused ?? ""), rb.refused);
    S.L.censor = null;
    const n = await aliceNotice(S, R, { at: S.T1 });
    R.rec("Alice's Notice at T1 first meets a mempool conflict, then the stale Commit is dropped (outside validity) and the Notice settles", "accept", n.settled && S.L.status(c.cur.txHash) === "dropped" && /Outside/.test(S.L.dropReason(c.cur.txHash) ?? ""), S.L.dropReason(c.cur.txHash));
    const rv = await aliceRefundReveal(S, R, aliceX); const sw = sweep(S, R, "bob", [`other_share=${leHex(refundA(S))}`], "Sweep (Bob, a+b)");
    R.rec("refund completes and Bob takes his ZEC back; b never broadcast", "accept", rv.settled && sw.accepted === true && !secretInMempool(S, bobX)); }
  { const S = await start("g8-race-commit", R); const aliceX = secret(S, "alice");
    await S.L.untilMs(S.LAST - 40_000); const c = await bobCommit(S, R);
    R.rec("Bob's last-moment Commit settles just before T1", "accept", c.settled, c.why ?? c.refused ?? `${(S.T1 - S.L.now()) / 1000} s to T1`);
    const g = await aliceNotice(S, R, { at: Math.max(S.T1, S.L.now()) }); R.rec("Alice's Notice gate refuses (escrow Claimed)", "reject /not Open/", /not Open/.test(g.refused ?? ""), g.refused);
    await mustFail(R, "a forced Notice spending the (now spent) Open escrow: ledger rejects", BAD_INPUTS, async () => signSubmit(S, await build(S, S.A, noticeTx(S, S.L.now(), { utxo: S.escrow }), true), S.A, "cheat_notice_spent"));
    const rv = await bobReveal(S, R, secret(S, "bob")); const { sw } = await aliceTakesZec(S, R);
    R.rec("swap completes normally", "accept", rv.settled && sw.accepted === true && !secretInMempool(S, aliceX)); }
  return { R };
}

// ======================= review4 two-phase scenario groups (tp_*), ported to escrow v0.7 =======================
async function tpHappy() {
  const R = new Results("tp_happy"); console.log("== review4 two-phase: happy path (Commit, then Reveal; Alice sweeps with b from the Reveal)");
  const S = await start("tp-happy", R); const bobX = secret(S, "bob"), aliceX = secret(S, "alice");
  const c = await bobCommit(S, R); R.rec("Bob's Commit (go_sig, no secret) settles before T1", "accept", c.settled, c.why);
  R.rec("Commit carried no secret: neither a nor b appears in any broadcast redeemer", "accept", !secretInMempool(S, bobX) && !secretInMempool(S, aliceX));
  const u = S.claimed; R.rec("Claimed UTxO at the same script address with the same value and phase=1 datum (t4 = 0)", "accept", u && BigInt(u.assets.lovelace) === ADA_LOCK && u.datum === datumOf(S, { phase: 1n }));
  await mustFail(R, "Alice tries RefundReveal{a} on the Claimed UTxO at T1: script rejects", SCRIPT_FAIL, async () => { await S.L.untilMs(S.T1); return signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.T1, null, u), true), S.A, "cheat_refund_claimed"); });
  const r = await bobReveal(S, R, bobX); R.rec("Bob's Reveal{b} settles (after T1: no deadline)", "accept", r.settled, r.refused ?? r.why);
  const b = aliceSeesB(S); R.rec("Alice reads b from the Reveal", "accept", b === bobX);
  const sw = sweep(S, R, "alice", [`other_share=${leHex(b)}`], "Sweep (Alice, a+b)"); R.rec("Alice sweeps the ZEC with a+b", "accept", sw.accepted === true, sw.reason);
  R.rec(`Bob holds the ADA (+${Number(await lovelaceAt(S, S.B.address)) / 1e6} ADA balance)`, "accept", (await lovelaceAt(S, S.B.address)) > ADA_LOCK);
  return { R, S };
}
async function tpCensorCommit() {
  const R = new Results("tp_censor_commit"); console.log("== review4 two-phase: producers censor Bob's COMMIT until T1");
  const S = await start("tp-cc", R); const bobX = secret(S, "bob"), aliceX = secret(S, "alice");
  S.L.censor = (p) => /^commit/.test(p.label) && S.L.now() < S.T1 + 120_000;
  const c = await bobCommit(S, R); R.rec("Commit censored past T1: not included", "observe", !c.settled, c.why);
  S.L.censor = null; await S.L.awaitBlock(1);
  R.rec("b was NEVER broadcast (Bob does not reveal before Commit settles)", "accept", !secretInMempool(S, bobX), "");
  const rf = await aliceRefund(S, R, aliceX, { at: Math.max(S.T1, S.L.now()) }); R.rec("Alice refunds her ADA (Notice, then a)", "accept", rf.settled, rf.refused ?? rf.why);
  await mustFail(R, "Alice cannot sweep the ZEC (she never learned b)", NODE_SIG, () => sweep(S, R, "alice", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_alice_one_share"));
  const a = refundA(S);
  const sw = sweep(S, R, "bob", [`other_share=${leHex(a)}`], "Sweep (Bob, a+b, takes ZEC back)"); R.rec("Bob takes his ZEC back with a: censorship cost only liveness, no theft", "accept", sw.accepted === true, sw.reason);
  return { R, S };
}
async function tpCensorReveal() {
  const R = new Results("tp_censor_reveal"); console.log("== review4 two-phase: producers censor Bob's REVEAL (b in the mempool) past T1 and T2");
  const S = await start("tp-cr", R); const bobX = secret(S, "bob"), aliceX = secret(S, "alice");
  const c = await bobCommit(S, R); R.rec("Commit settles", "accept", c.settled, c.why);
  const lift = S.T2 + 600_000;
  S.L.censor = (p) => /^reveal/.test(p.label) && S.L.now() < lift;
  const u = S.claimed; const tx = await build(S, S.B, revealTx(S, bobX)); const rv = await signSubmit(S, tx, S.B, "reveal");
  await S.L.awaitBlock(2);
  const b = aliceSeesB(S); R.rec("Alice reads b from the censored Reveal in the mempool", "observe", b === bobX);
  const sw = sweep(S, R, "alice", [`other_share=${leHex(b)}`], "Sweep (Alice, a+b)"); R.rec("Alice sweeps the ZEC (her side of the trade)", "accept", sw.accepted === true, sw.reason);
  await S.L.untilMs(S.T1);
  await mustFail(R, "Alice tries RefundReveal{a} at T1 on the Claimed UTxO: script rejects", SCRIPT_FAIL, async () => asideFrom8(S, /^reveal/, async () => signSubmit(S, await build(S, S.A, refundTx(S, aliceX, S.T1, null, u), true), S.A, "cheat_refund_claimed")));
  await mustFail(R, "Alice tries a Notice at T1 on the Claimed UTxO: script rejects", SCRIPT_FAIL, async () => asideFrom8(S, /^reveal/, async () => signSubmit(S, await build(S, S.A, noticeTx(S, S.L.now(), { utxo: u }), true), S.A, "cheat_notice_claimed")));
  await S.L.untilMs(S.T2);
  await mustFail(R, "Alice tries Escape at T2 (< T3): script rejects", SCRIPT_FAIL, async () => asideFrom8(S, /^reveal/, async () => signSubmit(S, await build(S, S.A, escapeTx(S, S.T2, { utxo: u }), true), S.A, "cheat_escape_early")));
  for (let i = 0; i < 80 && S.L.confirmations(rv.txHash) < K; i++) await S.L.awaitBlock(1);
  R.rec("censorship lifted after T2: the SAME Reveal is still valid and settles; Bob gets the ADA", "accept", S.L.confirmations(rv.txHash) >= K, `settled ${(S.L.now() - S.T2) / 1000} s after T2`);
  return { R, S };
}
async function tpCensorToT3() {
  const R = new Results("tp_censor_to_t3"); console.log("== review4 two-phase: CONTROL — residual: censor the Reveal for the WHOLE window up to T3");
  const S = await start("tp-t3", R); const bobX = secret(S, "bob");
  const c = await bobCommit(S, R); R.rec("Commit settles", "accept", c.settled, c.why);
  S.L.censor = (p) => /^reveal/.test(p.label) && S.L.now() < S.T3 + 600_000;
  const u = S.claimed; const tx = await build(S, S.B, revealTx(S, bobX)); await signSubmit(S, tx, S.B, "reveal");
  await S.L.awaitBlock(2); const b = aliceSeesB(S); sweep(S, R, "alice", [`other_share=${leHex(b)}`], "Sweep (Alice, a+b)");
  await S.L.untilMs(S.T3);
  let ok = true, why; try { S.L.pending = S.L.pending.filter(p => !/^reveal/.test(p.label));
    const r = await signSubmit(S, await build(S, S.A, escapeTx(S, S.T3, { utxo: u })), S.A, "escape"); await S.L.awaitBlock(K + 1); ok = S.L.confirmations(r.txHash) >= K; } catch (e) { ok = false; why = e.message; }
  R.rec(`CONTROL: only censorship lasting the whole T3 window (sim ${(S.T3 - S.T1) / 60000} min; real ≥ 7 days) lets Alice escape with the ADA too`, "observe", ok, why);
  S.L.censor = null; return { R, S };
}
async function tpCommitRollback() {
  const R = new Results("tp_commit_rollback"); console.log("== review4 two-phase: Commit included, then rolled back after T1 (cannot re-enter)");
  const S = await start("tp-rb", R); const bobX = secret(S, "bob"), aliceX = secret(S, "alice");
  await S.L.untilMs(S.T1 - 25_000);
  const t = await build(S, S.B, commitTx(S, S.goSig)); const cm = await signSubmit(S, t, S.B, "commit#late");
  await S.L.awaitBlock(1); const inc = S.L.confirmations(cm.txHash);
  await S.L.untilMs(S.T1 + 1000); const n = S.L.confirmations(cm.txHash); S.L.rollback(n);
  await S.L.awaitBlock(1);
  R.rec("Commit was included, then orphaned after T1 and dropped on re-validation (outside validity interval)", "observe", inc > 0 && S.L.status(cm.txHash) === "dropped", S.L.dropReason(cm.txHash));
  S.commitHash = cm.txHash; const rv = await bobReveal(S, R, bobX, { maxBlocks: 1 });
  R.rec("Bob's wallet refuses to reveal b (Commit not settled)", "accept", /not settled/.test(rv.refused ?? ""), rv.refused);
  const rf = await aliceRefund(S, R, aliceX, { at: S.L.now() }); R.rec("Alice refunds (Notice, then a)", "accept", rf.settled, rf.refused ?? rf.why);
  const a = refundA(S);
  const sw = sweep(S, R, "bob", [`other_share=${leHex(a)}`], "Sweep (Bob, a+b)"); R.rec("Bob recovers his ZEC: no loss", "accept", sw.accepted === true, sw.reason);
  return { R, S };
}
async function tpBobSilent() {
  const R = new Results("tp_bob_silent"); console.log("== review4 two-phase: Bob commits and never reveals → Alice escapes at T3 WITHOUT revealing a");
  const S = await start("tp-silent", R); const aliceX = secret(S, "alice"), bobX = secret(S, "bob");
  const c = await bobCommit(S, R); R.rec("Commit settles", "accept", c.settled, c.why);
  const u = S.claimed; await S.L.untilMs(S.T3);
  const t = await build(S, S.A, escapeTx(S, S.T3, { utxo: u })); const r = await signSubmit(S, t, S.A, "escape"); await S.L.awaitBlock(K + 1);
  R.rec("Alice's Escape (no secret) settles at T3: ADA back to Alice", "accept", S.L.confirmations(r.txHash) >= K);
  R.rec("a was never broadcast", "accept", !secretInMempool(S, aliceX));
  await mustFail(R, "Bob cannot recover his ZEC (he never learned a)", NODE_SIG, () => sweep(S, R, "bob", ["cheat=one_share", `other_share=${leHex(0n)}`], "cheat_bob_one_share"));
  await mustFail(R, "Bob's late Reveal after the Escape: input already spent", BAD_INPUTS, async () => signSubmit(S, await build(S, S.B, revealTx(S, bobX, { utxo: u }), true), S.B, "reveal_late"));
  return { R, S };
}
async function tpCommitCheats() {
  const R = new Results("tp_commit_cheats"); console.log("== review4 two-phase: Commit continuing-output attacks on the strict ledger");
  const S = await start("tp-cheat", R);
  await mustFail(R, "Commit whose output keeps phase=0 (re-openable): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { out: datumOf(S, { phase: 0n }) }), true), S.B, "cheat_commit_phase0"));
  await mustFail(R, "Commit whose output moves T3 to T1 (early escape): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { out: datumOf(S, { phase: 1n, t3: BigInt(S.T1) }) }), true), S.B, "cheat_commit_t3"));
  await mustFail(R, "Commit whose output jumps to phase=2 Refunding with t4 set (Bob-made Refunding): script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { out: datumOf(S, { phase: 2n, t4: BigInt(S.T1) }) }), true), S.B, "cheat_commit_refunding"));
  await mustFail(R, "Commit with an upper bound after T1: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, S.goSig, { upper: S.T1 + 60_000 }), true), S.B, "cheat_commit_late"));
  await mustFail(R, "Commit with a go_sig over another outref: script rejects", SCRIPT_FAIL, async () => signSubmit(S, await build(S, S.B, commitTx(S, goSign(S.go.sk, goMsg(goFields(S, S.escrow, { index: 1 })))), true), S.B, "cheat_commit_gosig"));
  const c = await bobCommit(S, R); R.rec("positive control: honest Commit settles", "accept", c.settled, c.why);
  return { R, S };
}

const which = process.argv[2] || "all";
// ===================== step 9 groups (review5 fixes) =====================
// R5-H1 port: the SAME attack as review5 r5_hold_to_t3 (Bob's direct-reach probe degraded → "unknown"; the attacker then
// buys a short censorship window of the same length review5 used, 860 s = M + 600 s + 20 s), against the bounded HOLD.
const R5_CENSOR_BUDGET = 860_000;
async function r9HoldToT3() {
  const R = new Results("r9_hold_to_t3"); console.log("== step 9 (R5-H1 port): HOLD capped → the short-censorship double-take FAILS");
  const S = await start("r9-hold", R); const bobX = secret(S, "bob");
  const c = await bobCommit(S, R); R.rec("Commit settles (K deep)", "accept", c.settled, c.why);
  S.directStake = undefined;   // attacker degrades Bob's direct-submission probe → "unknown"
  let holds = 0, firstGo = null, firstG = null;
  while (S.L.now() < S.T3 + 60_000) { const g = revealGate9({ commitConfs: S.L.confirmations(S.commitHash), K, commitSettledAt: S.commitSettledAt, mempoolFill: S.L.mempoolFill(), directStake: S.directStake, now: bobNow(S), T3: S.T3, M, holdCapMs: HOLD_CAP, lateCutoffMs: LATE_CUTOFF });
    if (g === null || /^GO-/.test(g)) { firstGo = S.L.now(); firstG = g; break; } if (/^HOLD/.test(g)) holds++; await S.L.awaitBlock(1); }
  R.rec(`"unknown" probe HOLDs only ${holds} blocks, then GO-CAP ≤ hold cap (${HOLD_CAP / 1000} s) after the Commit settled — ${((S.T3 - firstGo) / 1000).toFixed(0)} s before T3`, "accept",
    firstGo !== null && /^GO-CAP/.test(firstG ?? "") && firstGo - S.commitSettledAt <= HOLD_CAP + BLOCK && S.T3 - firstGo > LATE_CUTOFF, firstG);
  const censorFrom = S.L.now(); S.L.censor = (p) => /^reveal/.test(p.label) && S.L.now() < censorFrom + R5_CENSOR_BUDGET;
  const r = await bobReveal(S, R, bobX, { maxBlocks: 200 });
  const b = aliceSeesB(S); const swA = b !== null ? sweep(S, R, "alice", [`other_share=${leHex(b)}`], "Sweep (Alice, a+b)") : { reason: "no b" };
  R.rec(`attacker censors Bob's Reveal for the same ${R5_CENSOR_BUDGET / 1000} s budget review5 used: the Reveal still settles BEFORE T3`, "accept", r.settled === true && r.at < S.T3, r.why ?? r.refused);
  R.rec("Alice sweeps the ZEC with b (normal completion)", "accept", swA.accepted === true, swA.reason);
  await S.L.untilMs(S.T3);
  let esc = false, why; try { const t = await build(S, S.A, escapeTx(S, S.T3), true); const e = await signSubmit(S, t, S.A, "escape_attempt"); await S.L.awaitBlock(K + 1); esc = S.L.confirmations(e.txHash) >= K; } catch (e) { why = e.message; }
  R.rec("ATTACK FAILS: Alice's Escape at T3 cannot spend the escrow (already spent by Bob's Reveal) → Bob keeps the ADA", "reject", !esc && !claimedLive(S), String(why ?? "escape confirmed!").slice(0, 120));
  R.rec(`real-profile scale: censorship needed ≥ tail − hold cap − settle ≈ ${((P9.real.tailMs - P9.real.holdCapMs) / 86400e3).toFixed(2)} days (was ≈ 55 min)`, "accept", P9.real.tailMs - P9.real.holdCapMs > 6.9 * 86400e3);
  S.L.censor = null; return { R, S };
}
// HOLD conditions persisting all the way to T3 (the test review5 said was missing).
async function r9HoldRunsToT3() {
  const R = new Results("r9_hold_runs_to_t3"); console.log("== step 9: HOLD conditions persist until T3 — cap, cutoff and race alarm");
  const sweepGate = (settled, T3, cap, cut, Mx, step, inputs) => { const out = []; for (let now = settled; now <= T3 + 60_000; now += step) out.push([now, revealGate9({ commitConfs: K, K, commitSettledAt: settled, now, T3, M: Mx, holdCapMs: cap, lateCutoffMs: cut, ...inputs })]); return out; };
  for (const [nm, inp] of [["probe unknown", { mempoolFill: 0.1, directStake: undefined }], ["mempool 100% (spam)", { mempoolFill: 1, directStake: 1 }], ["mempool fill unknown", { mempoolFill: NaN, directStake: 1 }]]) {
    const s = sweepGate(0, TAIL, HOLD_CAP, LATE_CUTOFF, M, 5_000, inp);
    const lastHold = Math.max(...s.filter(([, g]) => /^HOLD/.test(g ?? "")).map(([t]) => t));
    const states = new Set(s.map(([, g]) => (g ?? "GO").split(":")[0]));
    R.rec(`sim profile, ${nm} from Commit to T3: HOLD only within the cap (last HOLD at ${lastHold / 1000} s < ${HOLD_CAP / 1000} s); then GO-CAP → GO-LATE → GO-RACE; never a silent go or a REFUSE`, "accept",
      lastHold < HOLD_CAP && ["HOLD", "GO-CAP", "GO-LATE", "GO-RACE"].every(x => states.has(x)) && !states.has("REFUSE") && !states.has("GO"), [...states].join(","));
    const r = sweepGate(0, P9.real.tailMs, P9.real.holdCapMs, P9.real.lateCutoffMs, 54.9 * 60e3, 60_000, inp);
    const lh = Math.max(...r.filter(([, g]) => /^HOLD/.test(g ?? "")).map(([t]) => t)), fg = r.find(([, g]) => /^GO/.test(g ?? ""))[0];
    R.rec(`real profile, ${nm}: last HOLD at ${(lh / 60e3).toFixed(0)} min, first broadcast at ${(fg / 60e3).toFixed(0)} min after settle (≤ 90 min; ${((P9.real.tailMs - fg) / 86400e3).toFixed(2)} d before T3)`, "accept", lh < P9.real.holdCapMs && fg <= P9.real.holdCapMs);
  }
  { const g = revealGate9({ commitConfs: K, K, commitSettledAt: undefined, now: 1, T3: 10, M: 1, holdCapMs: 1, lateCutoffMs: 1 }); R.rec("unknown time/config inputs: treated as cap reached (GO-CAP), not hold-forever", "accept", /^GO-CAP/.test(g ?? ""), g); }
  { const g = revealGate9({ commitConfs: K - 1, K, commitSettledAt: 0, now: 1e9, T3: 1e9 + 1, M: 1, holdCapMs: 1, lateCutoffMs: 1 }); R.rec("Commit not K deep: still REFUSE (the cap never overrides the settlement rule)", "reject /not settled/", /not settled/.test(g ?? ""), g); }
  { R.rec("config: hold cap > 10 % of tail refused", "reject /hold cap/", /hold cap/.test(revealParamsCheck({ tailMs: TAIL, holdCapMs: 0.2 * TAIL, lateCutoffMs: LATE_CUTOFF, M }) ?? ""));
    R.rec("real config (90 min, 2 d, M 54.9 min, tail 7 d) passes the check", "accept", revealParamsCheck({ tailMs: P9.real.tailMs, holdCapMs: P9.real.holdCapMs, lateCutoffMs: P9.real.lateCutoffMs, M: 54.9 * 60e3 }) === null); }
  { // e2e: adversarial spam ON from the moment the Commit settles until after T3; Bob retries each block
    const S = await start("r9-spam", R); const bobX = secret(S, "bob");
    const c = await bobCommit(S, R); S.L.setSpam(true); let r, tries = 0;
    while (S.L.now() < S.T3) { r = await bobReveal(S, R, bobX, { maxBlocks: 60 }); if (!r.refused) break; tries++; await S.L.awaitBlock(1); }
    R.rec(`spam held until T3: Bob HOLDs ${tries} times, then broadcasts at the cap over the direct channel; Reveal settles before T3`, "accept", c.settled && r?.settled === true && r.at < S.T3 && /^GO-CAP/.test(S.revealAlarm ?? "") && r.builds[0] && S.L.seen.find(t => t.hash === r.builds[0].txHash).slot * 1000 + S.L.zeroTime - S.commitSettledAt <= HOLD_CAP + 2 * BLOCK, `${S.revealAlarm?.slice(0, 60)}`);
    const { sw } = await aliceTakesZec(S, R); R.rec("Alice sweeps with b; nobody loses", "accept", sw.accepted === true, sw.reason); S.L.setSpam(false); }
  { // e2e: Bob offline after his Commit until past the cutoff → GO-LATE alarm; then until T3 − M → GO-RACE
    const S = await start("r9-late", R); const bobX = secret(S, "bob"); const c = await bobCommit(S, R);
    await S.L.untilMs(S.T3 - M + 10_000 - DRIFT); const r = await bobReveal(S, R, bobX);
    R.rec("Bob returns after T3 − M: gate says GO-RACE (alarm), reveals anyway; with no censorship it settles", "accept", c.settled && /^GO-RACE/.test(S.revealAlarm ?? "") && r.settled === true, S.revealAlarm?.slice(0, 80));
    const g = revealGate9({ commitConfs: K, K, commitSettledAt: S.commitSettledAt, now: S.T3 - LATE_CUTOFF + 1000, T3: S.T3, M, holdCapMs: HOLD_CAP, lateCutoffMs: LATE_CUTOFF, mempoolFill: 0, directStake: 1 });
    R.rec("between cutoff and T3 − M (even with good conditions): GO-LATE alarm, never silent (L1)", "accept", /^GO-LATE/.test(g ?? ""), g);
    return { R, S }; }
}
// R5-M1 port: the look-alike Refunding UTxO (plain payment to the script with the perfect datum and value).
async function r9FakeRefunding() {
  const R = new Results("r9_fake_refunding"); console.log("== step 9 (R5-M1 port): FAKE Refunding UTxO is refused by provenance");
  const S = await start("r9-fake", R); const aliceX = secret(S, "alice");
  const ttl = S.L.now() + 100_000; const lucid = await as(S, S.B);
  const fake = await lucid.newTx().pay.ToContract(S.scriptAddr, { kind: "inline", value: refundingDatum(S, ttl) }, { lovelace: BigInt(S.escrow.assets.lovelace) }).validTo(ttl).complete();
  const fr = await signSubmit(S, fake, S.B, "plainpay");   // label deliberately neutral: the wallet no longer reads labels
  await S.L.awaitBlock(K + 1);
  S.L.censor = (p) => /^notice#/.test(p.label);
  const n = await aliceNotice(S, R, { maxBlocks: 6 });
  R.rec("Alice's Notice procedure does NOT treat the look-alike as her settled Notice", "reject", !n.settled && S.noticeHash !== fr.txHash, n.why ?? n.refused);
  R.rec("…the refusal names the provenance check (creating tx did not spend her lock outref)", "accept", (S.provenanceRefusals ?? []).some(w => /did not spend my lock outref/.test(w)), (S.provenanceRefusals ?? [])[0]);
  const rr = await aliceRefundReveal(S, R, aliceX, { maxBlocks: 6 });
  R.rec("RefundReveal gate refuses: a is NOT published while the real escrow is Open", "reject /Notice not settled|Refunding/", !!rr.refused && !secretInMempool(S, aliceX), rr.refused);
  S.L.censor = null;
  const n2 = await aliceNotice(S, R, { at: S.L.now() }); const rr2 = n2.settled ? await aliceRefundReveal(S, R, aliceX) : { settled: false };
  R.rec("censorship ends: her REAL Notice settles and RefundReveal spends the real escrow (look-alike ignored)", "accept", n2.settled && rr2.settled && S.refunding.txHash !== fr.txHash, n2.why ?? rr2.refused);
  // unit probes on the decoded creating tx: Notice that spends a DIFFERENT outref; Notice with two script outputs
  const base = { refund: { txHash: "aa", outputIndex: 0, address: S.scriptAddr, datum: "d", assets: { lovelace: 5n } }, lock: { txHash: "11", outputIndex: 0 }, scriptAddr: S.scriptAddr, expectedDatum: "d", lovelace: 5n, confs: K, K };
  R.rec("probe: creating tx spends another escrow's outref → refused", "reject /lock outref/", /lock outref/.test(refundProvenance9({ ...base, creating: { inputs: [{ txHash: "22", index: 0 }], scriptRedeemers: [{ txHash: "22", index: 0, constr: 2 }], scriptOutputs: [0] } }) ?? ""));
  R.rec("probe: lock spent with a non-Notice redeemer → refused", "reject /redeemer Notice/", /redeemer Notice/.test(refundProvenance9({ ...base, creating: { inputs: [{ txHash: "11", index: 0 }], scriptRedeemers: [{ txHash: "11", index: 0, tag: 0 }], scriptOutputs: [0] } }) ?? ""));
  R.rec("probe: two script outputs (not the single continuing output) → refused", "reject /continuing output/", /continuing output/.test(refundProvenance9({ ...base, creating: { inputs: [{ txHash: "11", index: 0 }], scriptRedeemers: [{ txHash: "11", index: 0, constr: 2 }], scriptOutputs: [0, 1] } }) ?? ""));
  R.rec("probe: correct lineage → accepted", "accept", refundProvenance9({ ...base, creating: { inputs: [{ txHash: "11", index: 0 }], scriptRedeemers: [{ txHash: "11", index: 0, constr: 2 }], scriptOutputs: [0] } }) === null);
  return { R, S };
}
// R5-M2: era / branch / spacing / version / EOS from the node; R5-M3: Z from price
async function r9Era() {
  const R = new Results("r9_era"); console.log("== step 9 (R5-M2/M3/L2): era from the node, price-driven Z, EOS");
  const post = ["nu7_height=100", "start_height=4100"];   // well past the post-activation blackout
  { const S = await newSwap("r9-era-mis"); doSetup(S); zec(["genesis", ...S.d()]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]); S.configEra = "nu7"; const g = zecGate(S);
    R.rec("N1/N2: chain pre-NU7 but config says era nu7 → refused (era comes from the node)", "reject /disagrees with the node/", /disagrees with the node/.test(g ?? ""), g); }
  { const S = await newSwap("r9-era-ok", { paramsOver: { zec_branch: 0x77190ad9 } }); doSetup(S); zec(["genesis", ...S.d(...post)]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`, "spacing=25")]); const g = zecGate(S);
    R.rec("post-NU7 node (branch 0x77190AD9, 25 s): era derived = nu7, spacing 25 s, Zebra 7.0.0: allowed", "accept", g === null && S.nodeEra?.era === "nu7" && S.nodeEra.spacingS === 25, g);
    S.configEra = "now"; const g2 = zecGate(S); R.rec("same node, config mislabelled 'now' → refused", "reject /disagrees/", /disagrees/.test(g2 ?? ""), g2); S.configEra = undefined;
    S.configSpacingS = 75; const g3 = zecGate(S); R.rec("N4: stale config spacing 75 s after NU7 → refused", "reject /spacing/", /spacing 75 s disagrees/.test(g3 ?? ""), g3); S.configSpacingS = undefined;
    zec(["mine", ...S.d(`n=${ZEC_HISTORY}`, "spacing=75")]); const g4 = zecGate(S); R.rec("N4: measured 75 s on a 25 s chain (> 37.5 s) → refused (nominal from the era, not config)", "reject /measured block spacing/", /measured block spacing 75/.test(g4 ?? ""), g4);
    zec(["mine", ...S.d(`n=${ZEC_HISTORY}`, "spacing=25")]);
    S.nodeMeta = { version: "6.2.2" }; const g5 = zecGate(S); R.rec("node reports Zebra 6.2.2 → refused (< 7.0.0)", "reject /Zebra 6.2.2/", /Zebra 6.2.2/.test(g5 ?? ""), g5);
    S.nodeMeta = { version: undefined }; const g6 = zecGate(S); R.rec("node version unknown → refused", "reject /version unknown/", /version unknown/.test(g6 ?? ""), g6);
    const tip = zec(["status", ...S.d()]).tip; S.nodeMeta = { version: "7.0.0", eos: tip + 10_000 }; const g7 = zecGate(S);
    R.rec("L2: Zebra end-of-support height before T3 + 24 h → refused (upgrade first)", "reject /end-of-support/", /end-of-support/.test(g7 ?? ""), g7);
    S.nodeMeta = { version: "7.0.0", eos: null }; const g8 = zecGate(S); R.rec("L2: EOS height unknown → refused", "reject /end-of-support height unknown/", /end-of-support height unknown/.test(g8 ?? ""), g8);
    S.nodeMeta = { version: "7.1.0" }; const g9 = zecGate(S); R.rec("Zebra 7.1.0 with far EOS: allowed", "accept", g9 === null, g9); }
  { const S = await newSwap("r9-era-br"); doSetup(S); zec(["genesis", ...S.d(...post)]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`, "spacing=25")]); const g = zecGate(S);
    R.rec("post-NU7 node but agreed zec_branch NU6.3 → refused", "reject /zec_branch/", /zec_branch/.test(g ?? ""), g); }
  const nodeNu7 = nodeEra9({ tip: 4200, nu7_height: 100, branch_next_id: 0x77190ad9, nominal_spacing_s: 25 }), nodeNow = nodeEra9({ tip: 50, nu7_height: 100, branch_next_id: 0x37a5165b, nominal_spacing_s: 75 });
  R.rec("nodeEra9: unknown branch / missing NU7 height → refused", "reject", !!nodeEra9({ tip: 1, nu7_height: undefined, branch_next_id: 1 }).refuse && !!nodeEra9({ tip: 200, nu7_height: 100, branch_next_id: 0x37a5165b }).refuse);
  R.rec("nodeEra9: testnet node reporting a NU7 height ≠ ZIP 259 (4,465,026) → refused", "reject /ZIP 259/", /ZIP 259/.test(nodeEra9({ tip: 4_500_000, nu7_height: 4_400_000, branch_next_id: 0x77190ad9, network: "testnet" }, { network: "testnet" }).refuse ?? ""));
  const usdAmt = (usd, zp) => ({ lovelace: 0n, zats: Math.round(usd / zp * 1e8) });
  const vb = (o) => valueCap9({ kDepth: 15, tier: "v1", now: Date.now(), ...o });
  { const feed = { ...FEED(), zecUsd: 900 };
    const v = vb({ ...usdAmt(13_500, 900), zDepth: 69, node: nodeNu7, feed }); R.rec("N2: $13.5k at ZEC $900, Z=69, era nu7 from node → refused (economic Z = 72)", "reject /economic 2V/", /economic 2V\/\(R·P\) 72/.test(v ?? ""), v);
    const v2 = vb({ ...usdAmt(13_500, 900), zDepth: 72, node: nodeNu7, feed }); R.rec("…same swap at Z=72: allowed", "accept", v2 === null, v2);
    const v3 = vb({ ...usdAmt(1000, 1254.54), zDepth: 62, node: nodeNu7, feed: FEED() }); R.rec("N1: Z=62 post-NU7 (needs 69 for ε=1e-3 at 5 % stales) → refused", "reject /< 69/", /Z=62 < 69/.test(v3 ?? ""), v3);
    const v4 = vb({ ...usdAmt(1000, 1254.54), zDepth: 62, node: nodeNow, feed: FEED() }); R.rec("pre-NU7 era (from node): Z=62 suffices at 2 % stales", "accept", v4 === null, v4);
    const v5 = vb({ ...usdAmt(1000, 1254.54), zDepth: 69, node: { refuse: "REFUSE: x" }, feed: FEED() }); R.rec("node era unavailable → value cap refuses", "reject", !!v5, v5); }
  for (const [p, want] of [[500, 144], [800, 90], [1043, 70], [1254.54, 69]]) { const z = zNeeded9({ usd: 15_000, zecUsd: p, era: "nu7", tier: "v1", q: 0.33 });
    R.rec(`M3: v1 $15k at ZEC $${p}: Z = max(69, ⌈2V/(R·P)⌉) = ${z.z}`, "accept", z.z === want, JSON.stringify(z)); }
  { const z = zNeeded9({ usd: 500, zecUsd: 1254.54, era: "nu7", tier: "rehearsal", q: 0.33 }); R.rec(`M3: rehearsal $500 post-NU7: Z = ${z.z} (floor 30)`, "accept", z.z === 30, JSON.stringify(z)); }
  return { R };
}
// L5: a multi-block fork that reorganises Alice's Notice at K−1 and at K confirmations
async function r9ForkMulti() {
  const R = new Results("r9_fork_multi"); console.log("== step 9 (R5-L5): multi-block forks at K−1 and K");
  const heldCommit = async (S) => { await S.L.untilMs(S.T1 - 60_000); await refreshParams(S); const t = await build(S, S.B, commitTx(S, S.goSig)); return (await t.sign.withPrivateKey(S.B.privateKey).complete()).toCBOR(); };
  const forkSlot = (S) => { let sl = S.L.slotOf(S.T1) - 2; while (S.L.blocks.some(b => b.slot === sl)) sl -= 1; return sl; };
  for (const at of [K - 1, K]) {
    const S = await start(`r9-fork${at}`, R); const aliceX = secret(S, "alice"); const hex = await heldCommit(S);
    let forked = null, revealedBefore = null;
    const hook = async (S2, cur, i) => { const o = await ownRefunding(S2); if (!forked && o && S2.L.confirmations(o.hash) === at) { revealedBefore = secretInMempool(S2, aliceX); const sl = forkSlot(S2); const d = S2.L.blocks.filter(b => b.slot > sl).length; forked = { d, orphan: await S2.L.fork(d, sl, [hex], ["commit_fork"]) }; } };
    if (at === K - 1) {
      const n = await aliceNotice(S, R, { hook });
      R.rec(`fork of ${forked?.d} blocks (> 1) replaces the chain while Alice's Notice has ${at} = K−1 confirmations`, "accept", !!forked && forked.d >= 2, forked?.orphan?.join(","));
      R.rec("K−1: Alice had NOT revealed a and never does (Commit won the fork) → no loss", "accept", revealedBefore === false && !n.settled && !secretInMempool(S, aliceX), n.why);
    } else {
      const n = await aliceNotice(S, R); const rr = await aliceRefundReveal(S, R, aliceX, { hook: async (S2) => { if (!forked) { revealedBefore = secretInMempool(S2, aliceX); const sl = forkSlot(S2); const d = S2.L.blocks.filter(b => b.slot > sl).length; forked = { d, orphan: await S2.L.fork(d, sl, [hex], ["commit_fork"]) }; } } });
      const cm = S.L.log.find(t => t.label === "commit_fork");
      R.rec(`K: Notice settled (K deep), a broadcast; then a fork of ${forked?.d} blocks (> K = ${K}) branching before T1 lands Bob's held Commit`, "accept", n.settled && revealedBefore === true && !!cm && forked.d > K, forked?.orphan?.join(","));
      R.rec("residual R-2 demonstrated: only a reorg DEEPER than K can turn a revealed a into a loss (real K = 15 on Cardano ≈ settlement assumption)", "accept", forked.d > K && refundA(S) === aliceX);
    }
  }
  return { R };
}
// L4: min-ADA so every lock can always Notice (the Refunding datum is 8 bytes larger)
async function r9MinAda() {
  const R = new Results("r9_minada"); console.log("== step 9 (R5-L4): min-ADA lock rule");
  const S = await newSwap("r9-minada"); doSetup(S); S.swapId = swapIdOf(S); const open = datumOf(S).length / 2, refd = refundingDatum(S, S.T1 + 3600e3).length / 2;
  R.rec(`Refunding datum is ${refd - open} bytes larger than the Open datum`, "accept", refd > open, `${open} → ${refd}`);
  const need = (160 + 57 + refd + 10) * 4310 + 2_000_000;
  R.rec("lock at exactly the Open-datum min-ADA → refused by W.1", "reject /minADA/", /minADA/.test(minAdaLock9({ lovelace: (160 + 57 + open) * 4310, refundingDatumBytes: refd }) ?? ""));
  R.rec(`lock ≥ minADA(Refunding) + 2 ADA margin (${(need / 1e6).toFixed(2)} ADA) → accepted; 1000 ADA lock accepted`, "accept", minAdaLock9({ lovelace: need, refundingDatumBytes: refd }) === null && minAdaLock9({ lovelace: ADA_LOCK, refundingDatumBytes: refd }) === null);
  R.rec("datum size unknown → refused", "reject", !!minAdaLock9({ lovelace: ADA_LOCK, refundingDatumBytes: undefined }));
  return { R };
}

// step 10 (audit A2): a wallet clock that is not on a slot boundary. Before the fix the Notice datum used the raw ms upper
// bound while the ledger floors it to a slot, so the script rejected Alice's (and Bob's) Notice outright.
async function r10Unaligned() {
  const R = new Results("r10_unaligned"); console.log("== step 10 (audit A2): Notice built from a clock that is not on a slot boundary");
  const S = await start("r10-unaligned", R);
  const aliceX = secret(S, "alice");
  await S.L.untilMs(S.T1 + 5000);
  const from = S.L.now() + 437;   // real wall clocks are not slot-aligned
  let r; try { r = await signSubmit(S, await build(S, S.A, noticeTx(S, from)), S.A, "notice_unaligned"); } catch (e) { r = { rejected: true, reason: e.message }; }
  R.rec("Notice built from an unaligned clock is admitted (datum t4 = the on-chain upper bound + tail)", "accept", r && !r.rejected, r?.reason);
  await S.L.awaitBlock(K + 1);
  const o = await ownRefunding(S);
  R.rec("Alice's provenance check recognises it as her own Refunding UTxO, K deep", "accept", !!o && S.L.confirmations(o.hash) >= K, (S.provenanceRefusals ?? []).join(" | "));
  if (o) { const rr = await aliceRefundReveal(S, R, aliceX); R.rec("…and her RefundReveal{a} settles", "accept", rr.settled, rr.why ?? rr.refused); }
  return { R, S };
}

// step 10 (review 6 R6-M2): a Reveal{b} / RefundReveal{a} whose redeemers are Conway map-encoded must still be seen by every
// watcher that pulls a secret out of a tx (before: only the legacy array was read, so the secret went unnoticed).
function mapRedeemerTx(outref, constr, fields) {
  const ins = CML.TransactionInputList.new(); ins.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(outref.txHash), BigInt(outref.outputIndex)));
  const outs = CML.TransactionOutputList.new(); outs.add(CML.TransactionOutput.new(CML.Address.from_bech32(SCRIPT_ADDR_ANY()), CML.Value.from_coin(2_000_000n)));
  const m = CML.MapRedeemerKeyToRedeemerVal.new();
  m.insert(CML.RedeemerKey.new(CML.RedeemerTag.Spend, 0n), CML.RedeemerVal.new(CML.PlutusData.from_cbor_hex(Data.to(new Constr(constr, fields))), CML.ExUnits.new(1_000_000n, 500_000_000n)));
  const ws = CML.TransactionWitnessSet.new(); ws.set_redeemers(CML.Redeemers.new_map_redeemer_key_to_redeemer_val(m));
  return CML.Transaction.new(CML.TransactionBody.new(ins, outs, 300_000n), ws, true, undefined).to_cbor_hex();
}
const SCRIPT_ADDR_ANY = () => validatorToAddress("Custom", SCRIPT);
async function r10Review6() {
  const R = new Results("r10_review6"); console.log("== step 10 (review 6): map-encoded redeemers in the secret watchers (R6-M2); policy9 gates wired in (R6-M3)");
  { const S = await newSwap("r10-r6-map"); doSetup(S);   // step 11 (W-1): the watchers accept only the swap's REAL shares, so the test now reveals those
    const claimed = { txHash: "c1".repeat(32), outputIndex: 0 }, refunding = { txHash: "c2".repeat(32), outputIndex: 0 };
    const b = secret(S, "bob"), a = secret(S, "alice");
    const extra = [{ txHex: mapRedeemerTx(claimed, 1, [b]), label: "reveal_map", hash: "r6m2-reveal" }, { txHex: mapRedeemerTx(refunding, 3, [a]), label: "refund_reveal_map", hash: "r6m2-refund" }];
    S.L.seen.push(...extra);
    try {
      R.rec("Reveal{b} with map-encoded redeemers: Alice's watcher (aliceSeesB) extracts b", "accept", aliceSeesB(S) === b, aliceSeesB(S));
      R.rec("RefundReveal{a} with map-encoded redeemers: Bob's watcher (refundA) extracts a", "accept", refundA(S) === a, refundA(S));
      R.rec("mempool secret scan (secretInMempool) sees b and a in map-encoded txs", "accept", secretInMempool(S, b) && secretInMempool(S, a));
      const sp = S.L.spendingRedeemer(claimed.txHash, claimed.outputIndex);
      R.rec("ledger watcher (spendingRedeemer) decodes the map-encoded Reveal{b} on the Claimed outref", "accept", sp?.redeemer?.index === 1 && sp.redeemer.fields[0] === b, sp && Data.to(sp.redeemer));
    } finally { S.L.seen = S.L.seen.filter(t => !extra.includes(t)); }
  }
  { const S = await newSwap("r10-r6-blackout"); const P = rd(path.join(S.dir, "params.json"));
    const H = P7.blackoutH * 3600e3, now = Date.now();
    const at = now + (P.t2 - P.t0) + T0_OFF + H + Math.round((P.t3 - P.t2) / 2);   // after the old window end (T2 + margin), before T3 + margin
    P7upgrades = [{ name: "Cardano hard fork (test, between T2 and T3)", atMs: at }]; const u = paramsCheck(P); P7upgrades = undefined;
    R.rec("an upgrade scheduled between T2 and T3 (+ margin) is inside the blackout: refused at setup", "reject /upgrade blackout/", /upgrade blackout/.test(u ?? ""), u);
    P7upgrades = [{ name: "far upgrade", atMs: now + (P.t3 - P.t0) + T0_OFF + H + 3600e3 }]; const u2 = paramsCheck(P); P7upgrades = undefined;
    R.rec("control: an upgrade after T3 + margin: accepted", "accept", u2 === null, u2); }
  { const S = await newSwap("r10-r6-cap9"); doSetup(S); zec(["genesis", ...S.d()]); zec(["mine", ...S.d(`n=${ZEC_HISTORY}`)]);
    const ok = zecGate(S); R.rec("Bob's Zcash gate with the honest feed: allowed (control)", "accept", ok === null, ok);
    P7feed = { ...FEED(), zecUsd: FEED().zecUsd * 30 }; const g = zecGate(S); P7feed = undefined;
    R.rec(`Bob's Zcash gate re-runs the value cap with the node's era (${S.nodeEra?.era}): an over-cap swap is refused before he funds ZEC`, "reject /REFUSE: .*(cap|Z=)/", /REFUSE: .*(cap|Z=)/.test(g ?? ""), g); }
  { const S = await newSwap("r10-r6-minada"); doSetup(S); await lock(S, R); await S.L.awaitBlock(K);
    R.rec("control: Bob accepts the honest 1000 ADA lock", "accept", bobChecksLock(S) === null, bobChecksLock(S));
    const small = 1_500_000, pf = path.join(S.dir, "params.json"), P = rd(pf);
    fs.writeFileSync(pf, JSON.stringify({ ...P, lovelace: small }, null, 1)); S.escrow = { ...S.escrow, assets: { lovelace: BigInt(small) } };
    const bad = bobChecksLock(S); R.rec("a lock below minADA(Refunding datum) + margin (agreed at 1.5 ADA): Bob refuses to fund (W.1)", "reject /minADA/", /minADA/.test(bad ?? ""), bad); }
  return { R };
}

// step 11 (Nov 9 assessment W-1, W-2): the secret watchers must ignore Reveal-/RefundReveal-shaped redeemers whose integer is
// not the counterparty's share (x·G1 ≠ the datum point), and the ledger watcher must pair redeemers with inputs in SORTED order.
function twoSpendTx(first, second, r1, r2) {   // body lists `first` before `second`; redeemer indexes follow the ledger's sorted order
  const ins = CML.TransactionInputList.new(); for (const o of [first, second]) ins.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(o.txHash), BigInt(o.outputIndex)));
  const outs = CML.TransactionOutputList.new(); outs.add(CML.TransactionOutput.new(CML.Address.from_bech32(SCRIPT_ADDR_ANY()), CML.Value.from_coin(2_000_000n)));
  const sorted = [first, second].slice().sort((p, q) => p.txHash < q.txHash ? -1 : p.txHash > q.txHash ? 1 : p.outputIndex - q.outputIndex);
  const m = CML.MapRedeemerKeyToRedeemerVal.new();
  for (const [o, r] of [[first, r1], [second, r2]]) m.insert(CML.RedeemerKey.new(CML.RedeemerTag.Spend, BigInt(sorted.indexOf(o))), CML.RedeemerVal.new(CML.PlutusData.from_cbor_hex(Data.to(r)), CML.ExUnits.new(1_000_000n, 500_000_000n)));
  const ws = CML.TransactionWitnessSet.new(); ws.set_redeemers(CML.Redeemers.new_map_redeemer_key_to_redeemer_val(m));
  return CML.Transaction.new(CML.TransactionBody.new(ins, outs, 300_000n), ws, true, undefined).to_cbor_hex();
}
async function r11Decoy() {
  const R = new Results("r11_decoy"); console.log("== step 11 (assessment W-1/W-2): decoy secrets cannot block Escape/Forfeit or hide the real secret; redeemers pair with sorted inputs");
  const other = (h) => ({ txHash: h.repeat(32), outputIndex: 0 });
  { const S = await start("r11-escape", R);
    const c = await bobCommit(S, R); R.rec("Bob's Commit settles, then Bob stalls (no Reveal)", "accept", c.settled, c.why);
    await S.L.untilMs(S.T3 - 60_000);
    S.L.seen.push({ txHex: mapRedeemerTx(other("d0"), 1, [12345n]), label: "decoy_reveal", hash: "r11-decoy-b" });   // Reveal-shaped, any script, junk integer
    R.rec("W-1: a Reveal-shaped redeemer with a junk integer (12345·G1 ≠ B_c) is NOT taken as b", "accept", aliceSeesB(S) === null, String(aliceSeesB(S)));
    await S.L.untilMs(S.T3);
    const eg = escapeGate({ now: S.L.now(), T3: S.T3, claimed: !!S.L.entry(S.claimed.txHash + S.claimed.outputIndex), sawB: aliceSeesB(S) !== null });
    R.rec("W-1: at T3 Alice's Escape gate still passes despite the decoy", "accept", eg === null, eg);
    await refreshParams(S); const e = await signSubmit(S, await build(S, S.A, escapeTx(S, S.T3)), S.A, "escape"); await S.L.awaitBlock(K);
    R.rec("…and her Escape settles: ADA back to Alice", "accept", S.L.confirmations(e.txHash) >= K); }
  { const S = await start("r11-reveal", R); const bobX = secret(S, "bob");
    const c = await bobCommit(S, R); R.rec("Bob's Commit settles", "accept", c.settled, c.why);
    S.L.seen.push({ txHex: mapRedeemerTx(other("d2"), 1, [777n]), label: "decoy_reveal", hash: "r11-decoy-b2" });   // decoy is seen BEFORE the real Reveal
    const r = await bobReveal(S, R, bobX); R.rec("Bob's real Reveal{b} settles after the decoy was broadcast", "accept", r.settled, r.refused ?? r.why);
    R.rec("W-1: Alice's watcher skips the decoy and returns the real b", "accept", aliceSeesB(S) === bobX, String(aliceSeesB(S)));
    const sw = sweep(S, R, "alice", [`other_share=${leHex(aliceSeesB(S) ?? 0n)}`], "Sweep (Alice, a+b, decoy present)"); R.rec("…and she sweeps the ZEC with it", "accept", sw.accepted === true, sw.reason); }
  { const S = await start("r11-forfeit", R, { go: false });
    const n = await aliceNotice(S, R); R.rec("Alice's Notice settles; she then stalls", "accept", n.settled, n.why);
    S.L.seen.push({ txHex: mapRedeemerTx(other("d1"), 3, [777n]), label: "decoy_refund_reveal", hash: "r11-decoy-a" });
    R.rec("W-1: a RefundReveal-shaped redeemer with a junk integer (777·G1 ≠ A_c) is NOT taken as a", "accept", refundA(S) === null, String(refundA(S)));
    await S.L.untilMs(S.t4);
    const f = await bobForfeit(S, R); R.rec("W-1: at t4 Bob's Forfeit still goes through despite the decoy", "accept", f.settled, f.refused); }
  { const S = await newSwap("r11-w2");
    const lo = other("01"), hi = other("fe");   // body order: hi first, lo second; sorted order: lo (index 0), hi (index 1)
    S.L.seen.push({ txHex: twoSpendTx(hi, lo, new Constr(1, [1111n]), new Constr(5, [])), label: "two_spends", hash: "r11-w2" });
    const a = S.L.spendingRedeemer(hi.txHash, 0), b = S.L.spendingRedeemer(lo.txHash, 0);
    R.rec("W-2: spendingRedeemer returns each input's OWN redeemer when the body order differs from the sorted order", "accept", a?.redeemer?.index === 1 && a.redeemer.fields[0] === 1111n && b?.redeemer?.index === 5, `${a && Data.to(a.redeemer)} / ${b && Data.to(b.redeemer)}`);
    const stray = { txHex: mapRedeemerTx(other("aa"), 1, [5n]).replace("aa".repeat(32), "ab".repeat(32)), label: "x", hash: "r11-w2b" };   // control: single input, single redeemer still found
    S.L.seen.push(stray); const c2 = S.L.spendingRedeemer("ab".repeat(32), 0);
    R.rec("control: a single-input spend still decodes", "accept", c2?.redeemer?.index === 1 && c2.redeemer.fields[0] === 5n, c2 && Data.to(c2.redeemer)); }
  return { R };
}

const all = { l1: l1Cases, happy, refund, punish, setup: setupCheats, c1fee: () => c1("fee"), c1cost: () => c1("costmodel"), c2, c3, rbredeem: rbRedeem, rbrefund: rbRefund, zreorg: zReorg, zexpiry: zExpiry, gomsg: goCases, f1: f1Cases, hostage, f2: gokeyCases, timing: timingCases, seenhex: seenhexCases, cap: capCases, nu7: async () => { PIN_NU63 = true; try { return await nu7Cases(); } finally { PIN_NU63 = false; } }, congestion: congestionCases, congestion2: congestion2Cases, congestion3: congestion3Cases, laterefund: lateRefundCases, refscript: refscriptCases, premium: premiumCases, zecnode: zecNodeCases, g8_stall_escape: stallEscape, g8_refund_trap: refundTrap, g8_refund_censored: refundCensored, g8_censor_both: bothStepsCensored, g8_alice_stalls: aliceStalls, g8_race: commitNoticeRace, tp_happy: tpHappy, tp_censor_commit: tpCensorCommit, tp_censor_reveal: tpCensorReveal, tp_censor_to_t3: tpCensorToT3, tp_commit_rollback: tpCommitRollback, tp_bob_silent: tpBobSilent, tp_commit_cheats: tpCommitCheats, r9_hold_to_t3: r9HoldToT3, r9_hold_runs_to_t3: r9HoldRunsToT3, r9_fake_refunding: r9FakeRefunding, r9_era: async () => { PIN_NU63 = true; try { return await r9Era(); } finally { PIN_NU63 = false; } }, r9_fork_multi: r9ForkMulti, r9_minada: r9MinAda, r10_unaligned: r10Unaligned, r10_review6: r10Review6, r11_decoy: r11Decoy };
const out = {}; const t0 = Date.now();
for (const [k, f] of Object.entries(all)) {
  if (which !== "all" && which !== k) continue;
  let R, S;
  try { ({ R, S } = await f()); } catch (e) { console.log(`== ${k}: CRASH ${e.stack}`); out[k] = { pass: false, crash: String(e.stack) }; continue; }
  out[k] = { pass: R.pass, checks: R.checks, costs: R.costs, events: S?.L.events, dropped: S?.L.dropped, rejected_cardano: S?.L.rejected.length, run_dir: S?.dir };
  console.log(`== ${k}: ${R.pass ? "PASS" : "FAIL"} (${R.checks.filter(c => c.ok).length}/${R.checks.length} checks)`);
}
out.elapsed_s = (Date.now() - t0) / 1000;
out.params = { BLOCK, D, K, S_SET, DA, E, M, MC, ZDEPTH, T0_OFF, T1_OFF, T2_OFF, T3_OFF, LAST_OFF, TAIL, NOTICE_TTL, REAL_SWAP_S, ZEC_BRANCH, PROFILE, SCRIPT_HASH, script_bytes: SCRIPT.script.length / 2 };
fs.mkdirSync(path.join(ROOT, "results"), { recursive: true });
const f = path.join(ROOT, "results", `e2e9-${which}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(f, JSON.stringify(out, (k, v) => typeof v === "bigint" ? Number(v) : v, 2));
console.log("results:", f, "elapsed", out.elapsed_s, "s");
// step 11 (CI): a failed or crashed group fails the process, so a workflow cannot report green on a red run.
if (Object.keys(all).some(k => out[k] && out[k].pass !== true)) process.exit(1);
