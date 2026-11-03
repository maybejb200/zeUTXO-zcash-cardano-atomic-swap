// zeUTXO path 1 step 3 — stricter simulated Cardano ledger around Lucid's Emulator. SIMULATOR ONLY.
// The Lucid Emulator checks signatures, required signers, UTxO existence and (loosely) the validity
// interval, but does NOT run Plutus scripts or check fees/value. This wrapper adds those checks so a
// transaction is accepted only if a real node's phase-1 + phase-2 rules (as far as we model them) pass.
import { Emulator, CML, createCostModels, getAddressDetails, PROTOCOL_PARAMETERS_DEFAULT, Data } from "@lucid-evolution/lucid";
import * as UPLC from "@lucid-evolution/uplc";
import fs from "fs";

export function mainnetParams(path = new URL("./mainnet_params_koios.json", import.meta.url)) {
  const kp = JSON.parse(fs.readFileSync(path));
  return { ...PROTOCOL_PARAMETERS_DEFAULT,
    minFeeA: Number(kp.txFeePerByte), minFeeB: Number(kp.txFeeFixed), maxTxSize: Number(kp.maxTxSize), coinsPerUtxoByte: BigInt(kp.utxoCostPerByte),
    priceMem: Number(kp.executionUnitPrices.priceMemory), priceStep: Number(kp.executionUnitPrices.priceSteps), collateralPercentage: kp.collateralPercentage,
    maxTxExMem: BigInt(kp.maxTxExecutionUnits.memory), maxTxExSteps: BigInt(kp.maxTxExecutionUnits.steps),
    costModels: { ...PROTOCOL_PARAMETERS_DEFAULT.costModels, PlutusV3: kp.costModels.PlutusV3 } };
}

export class StrictLedger {
  // Step 3 (review M-6/C2/H-1): txs go to a PENDING pool and are re-validated when a block is made, at the block's
  // slot and under the protocol parameters in force then; invalid ones are DROPPED (with the reason). Blocks every
  // 20 slots. Short rollbacks restore a snapshot and return the orphaned txs to the pool. Params can change mid-run.
  constructor(accounts, pp, { blockSlots = 20 } = {}) {
    this.pp = pp; this.blockSlots = blockSlots;
    this.em = new Emulator(accounts, pp);
    this.zeroTime = this.em.now();
    this.log = [];        // confirmed txs (explorer)
    this.seen = [];       // every tx ever broadcast (what a mempool watcher sees)
    this.pending = [];    // {hex, hash, label, inputs:Set}
    this.dropped = [];    // {hash,label,reason,slot}
    this.rejected = [];   // refused at admission
    this.blocks = [];     // {slot, txs:[{hash,label,hex,stats}], snap}
    this.held = new Set();// adversarial inclusion delay (bounded by the scenario, = D)
    // step 6 (R3-H2) adversarial-spam mode: FIFO mempool of capacity 2 x max block body (cardano-node default), no fee
    // priority. While spam is on, the attacker refills every freed byte, so ordinary submissions are refused (MempoolFull)
    // and nothing is relayed; a DIRECT submission to a producer (opts.direct) is admitted behind <= capacity bytes of spam.
    this.spam = null;     // {on, ahead (bytes queued before the next admitted tx), blocks, adaSpent}
    this.events = [];
    this.costModelsBytes = createCostModels(pp.costModels).to_cbor_bytes();
  }
  slot() { return this.em.slot; }
  now() { return this.em.now(); }
  slotOf(ms) { return Math.floor((ms - this.zeroTime) / 1000); }
  entry(outRef) { return this.em.ledger[outRef]; }   // confirmed state only
  resolve(input) {
    const ref = input.transaction_id().to_hex() + input.index().toString();
    const e = this.em.ledger[ref];
    if (!e || e.spent) throw new Error(`BadInputsUTxO: input ${ref} missing or spent`);
    return e.utxo;
  }
  utxoToCml(u) {
    const inp = CML.TransactionInput.new(CML.TransactionHash.from_hex(u.txHash), BigInt(u.outputIndex));
    const addr = CML.Address.from_bech32(u.address);
    // M-6: keep multi-assets (step 2 dropped them)
    const ma = CML.MultiAsset.new();
    for (const [unit, q] of Object.entries(u.assets)) { if (unit === "lovelace") continue;
      const pid = CML.ScriptHash.from_hex(unit.slice(0, 56)), an = CML.AssetName.from_raw_bytes(Buffer.from(unit.slice(56), "hex")); ma.set(pid, an, BigInt(q)); }
    const val = CML.Value.new(BigInt(u.assets.lovelace), ma);
    let out;
    if (u.datum) out = CML.TransactionOutput.new(addr, val, CML.DatumOption.new_datum(CML.PlutusData.from_cbor_hex(u.datum)));
    else out = CML.TransactionOutput.new(addr, val);
    return [inp, out];
  }
  _snap() { const c = {}; for (const [k, v] of Object.entries(this.em.ledger)) c[k] = { utxo: v.utxo, spent: v.spent }; return { ledger: c, datumTable: { ...this.em.datumTable } }; }
  _restore(s) { const c = {}; for (const [k, v] of Object.entries(s.ledger)) c[k] = { utxo: v.utxo, spent: v.spent }; this.em.ledger = c; this.em.datumTable = { ...s.datumTable }; this.em.mempool = {}; }
  _commitEm() { for (const [ref, { utxo, spent }] of Object.entries(this.em.mempool)) { this.em.ledger[ref] = { utxo, spent }; } for (const [ref, e] of Object.entries(this.em.ledger)) if (e.spent) delete this.em.ledger[ref]; this.em.mempool = {}; }
  static code(e) { const m = String(e.message ?? e);
    if (/^[A-Za-z]+(UTxO|UTXOW|Interval|Small|Match|Inputs|Failure|Collateral|Conserved)/.test(m)) return m;
    if (/Missing vkey witness/.test(m)) return "MissingVKeyWitnessesUTXOW: " + m;
    if (/Could not spend UTxO/.test(m)) return "BadInputsUTxO: " + m.replace(/\s+/g, " ");
    if (/Invalid vkey witness/.test(m)) return "InvalidWitnessesUTXOW: " + m;
    return m; }
  /** Apply on the Emulator (signatures, required signers, bookkeeping) at the current state; commit if `commit`. */
  async _apply(txHex, commit) {
    const snap = commit ? null : this._snap();
    try { const h = await this.em.submitTx(txHex); if (commit) this._commitEm(); return h; }
    catch (e) { if (!commit) this._restore(snap); else this.em.mempool = {}; throw new Error(StrictLedger.code(e)); }
    finally { if (!commit) this._restore(snap); }
  }
  _inputsOf(txHex) { const b = CML.Transaction.from_cbor_hex(txHex).body(); const s = new Set();
    for (let i = 0; i < b.inputs().len(); i++) { const x = b.inputs().get(i); s.add(x.transaction_id().to_hex() + x.index()); } return s; }
  /** Broadcast: admission check now; the tx then waits in the pool for a block. Returns {txHash, stats, pending:true}. */
  mempoolCap() { return 2 * (this.pp.maxBlockBodySize ?? 90112); }
  mempoolFill() { if (this.spam?.on) return 1; return Math.min(1, ((this.spam?.ahead ?? 0) + this.pending.reduce((a, p) => a + p.hex.length / 2, 0)) / this.mempoolCap()); }
  setSpam(on, { behind = false } = {}) { if (on) this.spam = behind && this.spam ? { ...this.spam, on: true } : behind ? { on: true, ahead: 0, blocks: 0, adaSpent: 0 } : { on: true, ahead: this.mempoolCap(), blocks: 0, adaSpent: 0 }; else if (this.spam) this.spam.on = false; this.events.push(`slot ${this.slot()}: SPAM ${on ? "ON" : "OFF"}`); }
  async submit(txHex, label = "", opts = {}) {
    try {
      if (this.spam?.on && !opts.direct) throw new Error("MempoolFull (adversarial spam: the node refuses and does not relay)");
      const inputs = this._inputsOf(txHex);
      for (const p of this.pending) for (const i of inputs) if (p.inputs.has(i)) throw new Error(`BadInputsUTxO (mempool conflict with pending '${p.label}')`);
      const stats = this._check(txHex, this.slot());
      const txHash = await this._apply(txHex, false);
      this.pending.push({ hex: txHex, hash: txHash, label, inputs, stats });
      this.seen.push({ label, txHex, hash: txHash, slot: this.slot() });
      return { txHash, stats, pending: true };
    } catch (e) {
      const reason = StrictLedger.code(e);
      this.rejected.push({ label, reason, slot: this.slot() });
      throw new Error(reason);
    }
  }
  /** Make one block at the current slot: re-validate every pending tx under the rules in force NOW. */
  async produceBlock() {
    const snap = this._snap(); const txs = []; const keep = [];
    let room = this.pp.maxBlockBodySize ?? 90112;
    if (this.spam && this.spam.ahead > 0) { const used = Math.min(room, this.spam.ahead); this.spam.ahead -= used; room -= used;
      this.spam.blocks += 1; this.spam.adaSpent += (used / 16384) * (44 * 16384 + 155381) / 1e6; }
    else if (this.spam?.on) { this.spam.blocks += 1; this.spam.adaSpent += (room / 16384) * (44 * 16384 + 155381) / 1e6; }   // spam fills what is left behind the real txs
    for (const p of this.pending) {
      if (this.held.has(p.hash) || this.censor?.(p)) { keep.push(p); continue; }
      const sz = p.hex.length / 2; if (sz > room) { keep.push(p); continue; } room -= sz;   // FIFO by bytes
      try { const stats = this._check(p.hex, this.slot()); await this._apply(p.hex, true);
        txs.push({ hash: p.hash, label: p.label, hex: p.hex, stats }); this.log.push({ label: p.label, txHex: p.hex, hash: p.hash, slot: this.slot(), stats }); }
      catch (e) { const reason = StrictLedger.code(e); this.dropped.push({ hash: p.hash, label: p.label, reason, slot: this.slot() }); this.events.push(`slot ${this.slot()}: DROPPED ${p.label}: ${reason.slice(0, 120)}`); }
    }
    this.pending = keep;
    this.blocks.push({ slot: this.slot(), txs, snap });
    if (this.blocks.length > 400) this.blocks[this.blocks.length - 401].snap = null;   // only short rollbacks are modelled
  }
  async advance(slots) { for (let i = 0; i < slots; i++) { this.em.slot += 1; this.em.time += 1000; this.em.blockHeight = Math.floor(this.em.slot / this.blockSlots); if (this.em.slot % this.blockSlots === 0) await this.produceBlock(); } }
  async awaitSlot(n) { await this.advance(n); }
  async awaitBlock(n = 1) { for (let i = 0; i < n; i++) await this.advance(this.blockSlots - (this.em.slot % this.blockSlots)); }
  async untilMs(ms) { const s = this.slotOf(ms); if (s > this.slot()) await this.advance(s - this.slot()); }
  /** Roll back the last n blocks (time does not go back). Orphaned txs return to the pool (front), unless dropOrphans. */
  rollback(n, { dropOrphans = false } = {}) {
    if (n > this.blocks.length || !this.blocks[this.blocks.length - n].snap) throw new Error("rollback too deep for the simulator");
    const gone = this.blocks.splice(this.blocks.length - n, n);
    this._restore(gone[0].snap);
    const orphan = gone.flatMap(b => b.txs);
    const hs = new Set(orphan.map(t => t.hash)); this.log = this.log.filter(t => !hs.has(t.hash));
    if (!dropOrphans) this.pending = orphan.map(t => ({ hex: t.hex, hash: t.hash, label: t.label, inputs: this._inputsOf(t.hex), stats: t.stats })).concat(this.pending);
    this.events.push(`slot ${this.slot()}: ROLLBACK ${n} block(s), orphaned [${orphan.map(t => t.label).join(", ")}]`);
    return orphan.map(t => t.label);
  }
  /** step 8 (refund-trap fork test): a COMPETING FORK. Drop the last n blocks, rewind the clock to `atSlot` (which must be
   *  after the last kept block), make one block there containing `include` (raw tx hexes an adversarial producer held,
   *  never seen by the honest mempools), then replay the clock back to where it was, producing ordinary blocks. Orphaned
   *  txs return to the pool and are re-validated (conflicting ones are DROPPED). Models a fork that wins by length. */
  async fork(n, atSlot, include = [], labels = []) {
    const back = this.em.slot;
    if (n > this.blocks.length || !this.blocks[this.blocks.length - n].snap) throw new Error("fork too deep for the simulator");
    const kept = this.blocks[this.blocks.length - n - 1]; if (kept && atSlot <= kept.slot) throw new Error("fork slot must follow the last kept block");
    const orphan = this.rollback(n, { dropOrphans: false });
    const pend = this.pending; this.pending = [];
    for (const [i, hex] of include.entries()) { const hash = CML.hash_transaction(CML.Transaction.from_cbor_hex(hex).body()).to_hex();
      this.pending.push({ hex, hash, label: labels[i] ?? "fork_tx", inputs: this._inputsOf(hex), stats: null }); this.seen.push({ label: labels[i] ?? "fork_tx", txHex: hex, hash, slot: atSlot }); }
    this.em.slot = atSlot; this.em.time = this.zeroTime + atSlot * 1000; this.em.blockHeight = Math.floor(atSlot / this.blockSlots);
    await this.produceBlock();
    this.pending = this.pending.concat(pend);
    this.events.push(`slot ${atSlot}: FORK block with [${labels.join(", ")}] replaces ${n} block(s) [${orphan.join(", ")}]`);
    if (back > atSlot) await this.advance(back - atSlot);
    return orphan;
  }
  /** Epoch boundary / governance: new protocol parameters take effect for every block from now on. */
  setParams(pp) { this.pp = pp; this.em.protocolParameters = pp; this.costModelsBytes = createCostModels(pp.costModels).to_cbor_bytes(); this.events.push(`slot ${this.slot()}: PARAM CHANGE`); }
  confirmations(hash) { const i = this.blocks.findIndex(b => b.txs.some(t => t.hash === hash)); return i < 0 ? 0 : this.blocks.length - i; }
  status(hash) { if (this.confirmations(hash)) return "confirmed"; if (this.pending.some(p => p.hash === hash)) return "pending"; if (this.dropped.some(d => d.hash === hash)) return "dropped"; return "unknown"; }
  dropReason(hash) { return [...this.dropped].reverse().find(d => d.hash === hash)?.reason; }
  /** All ledger rules we model, evaluated at `slot` against the CONFIRMED state + current params. */
  _check(txHex, slot) {
    const tx = CML.Transaction.from_cbor_hex(txHex);
    const body = tx.body(), ws = tx.witness_set();
    const bytes = tx.to_cbor_bytes();
    // ---- phase 1: validity interval (real ledger: lower <= slot < ttl) ----
    const lo = body.validity_interval_start(), ttl = body.ttl();
    if (lo !== undefined && BigInt(slot) < lo) throw new Error(`OutsideValidityInterval: slot ${slot} < validFrom ${lo}`);
    if (ttl !== undefined && BigInt(slot) >= ttl) throw new Error(`OutsideValidityInterval: slot ${slot} >= ttl ${ttl}`);
    if (bytes.length > this.pp.maxTxSize) throw new Error(`MaxTxSizeUTxO: tx too large ${bytes.length}`);
    // ---- phase 1: resolve inputs, value conservation ----
    const ins = []; let inSum = 0n;
    for (let i = 0; i < body.inputs().len(); i++) { const u = this.resolve(body.inputs().get(i)); ins.push(u); inSum += BigInt(u.assets.lovelace); }
    let outSum = 0n; for (let i = 0; i < body.outputs().len(); i++) outSum += body.outputs().get(i).amount().coin();
    const fee = body.fee();
    if (inSum !== outSum + fee) throw new Error(`ValueNotConserved: in ${inSum} != out ${outSum} + fee ${fee}`);
    // ---- phase 1: minimum fee ----
    const reds = ws.redeemers();
    let mem = 0n, steps = 0n; const declared = [];
    const legacy = reds?.as_arr_legacy_redeemer();
    const mapR = reds?.as_map_redeemer_key_to_redeemer_val();
    if (legacy) for (let i = 0; i < legacy.len(); i++) { const r = legacy.get(i); declared.push({ tag: r.tag(), index: r.index(), mem: r.ex_units().mem(), steps: r.ex_units().steps(), data: r.data().to_cbor_hex() }); }
    if (mapR) { const ks = mapR.keys(); for (let i = 0; i < ks.len(); i++) { const k = ks.get(i), v = mapR.get(k); declared.push({ tag: k.tag(), index: k.index(), mem: v.ex_units().mem(), steps: v.ex_units().steps(), data: v.data().to_cbor_hex() }); } }
    for (const d of declared) { mem += d.mem; steps += d.steps; }
    if (mem > this.pp.maxTxExMem || steps > this.pp.maxTxExSteps) throw new Error("ExUnitsTooBigUTxO");
    const sizeFee = BigInt(this.pp.minFeeA) * BigInt(bytes.length) + BigInt(this.pp.minFeeB);
    const exFee = BigInt(Math.ceil(Number(mem) * this.pp.priceMem + Number(steps) * this.pp.priceStep));
    if (fee < sizeFee + exFee) throw new Error(`FeeTooSmall: ${fee} < ${sizeFee + exFee}`);
    // ---- phase 1: scripts present -> collateral + script_data_hash ----
    if (declared.length) {
      const coll = body.collateral_inputs();
      if (!coll || coll.len() === 0) throw new Error("NoCollateralInputs");
      let cSum = 0n; for (let i = 0; i < coll.len(); i++) { const u = this.resolve(coll.get(i)); if (getAddressDetails(u.address).paymentCredential.type !== "Key") throw new Error("ScriptsNotPaidUTxO"); cSum += BigInt(u.assets.lovelace); }
      const cRet = body.collateral_return() ? body.collateral_return().amount().coin() : 0n;
      if ((cSum - cRet) * 100n < fee * BigInt(this.pp.collateralPercentage)) throw new Error("InsufficientCollateral");
      const langs = CML.LanguageList.new();
      if (ws.plutus_v1_scripts()?.len()) langs.add(CML.Language.PlutusV1);
      if (ws.plutus_v2_scripts()?.len()) langs.add(CML.Language.PlutusV2);
      if (ws.plutus_v3_scripts()?.len()) langs.add(CML.Language.PlutusV3);
      const sdh = CML.calc_script_data_hash(reds, ws.plutus_datums() ?? CML.PlutusDataList.new(), createCostModels(this.pp.costModels), langs);
      if (!body.script_data_hash() || !sdh || body.script_data_hash().to_hex() !== sdh.to_hex()) throw new Error("PPViewHashesDontMatch (script_data_hash)");
    }
    // ---- phase 2: run every script (real UPLC evaluation with the real tx context) ----
    let actual = [];
    if (declared.length) {
      const resolved = [];
      const seen = new Set();
      const add = (inp) => { const ref = inp.transaction_id().to_hex() + inp.index(); if (seen.has(ref)) return; seen.add(ref); resolved.push(this.utxoToCml(this.resolve(inp))); };
      for (let i = 0; i < body.inputs().len(); i++) add(body.inputs().get(i));
      const coll = body.collateral_inputs(); for (let i = 0; i < coll.len(); i++) add(coll.get(i));
      const refs = body.reference_inputs(); if (refs) for (let i = 0; i < refs.len(); i++) add(refs.get(i));
      let res;
      try {
        res = UPLC.eval_phase_two_raw(bytes, resolved.map(r => r[0].to_cbor_bytes()), resolved.map(r => r[1].to_cbor_bytes()),
          this.costModelsBytes, this.pp.maxTxExSteps, this.pp.maxTxExMem, BigInt(this.zeroTime), 0n, 1000);
      } catch (e) { throw new Error(`ScriptFailure (phase 2): ${String(e).replace(/\s+/g, " ").slice(0, 300)}`); }
      for (const b of res) { const r = CML.LegacyRedeemer.from_cbor_bytes(b); actual.push({ tag: r.tag(), index: r.index(), mem: r.ex_units().mem(), steps: r.ex_units().steps() }); }
      for (const a of actual) {
        const d = declared.find(x => x.tag === a.tag && x.index === a.index);
        if (!d || a.mem > d.mem || a.steps > d.steps) throw new Error(`ScriptFailure: budget exceeded (actual ${a.mem}/${a.steps} > declared ${d?.mem}/${d?.steps})`);
      }
    }
    // step 5 (F2): strict builtin overlay (emulates cardano-node's libsodium Ed25519 where the UPLC evaluator is lax)
    if (declared.length && this.overlay) this.overlay(tx, (inp) => this.resolve(inp));
    return { bytes: bytes.length, fee: Number(fee), declared: declared.map(d => ({ mem: Number(d.mem), steps: Number(d.steps) })),
      actual: actual.map(a => ({ mem: Number(a.mem), steps: Number(a.steps), memPct: +(100 * Number(a.mem) / Number(this.pp.maxTxExMem)).toFixed(3), stepsPct: +(100 * Number(a.steps) / Number(this.pp.maxTxExSteps)).toFixed(3) })) };
  }
  /** Watcher: redeemer of the first SEEN tx (mempool or chain) spending outRef — the adversary reads the mempool. */
  spendingRedeemer(txHash, outputIndex, { confirmedOnly = false } = {}) {
    for (const t of (confirmedOnly ? this.log : this.seen)) {
      const tx = CML.Transaction.from_cbor_hex(t.txHex); const ins = tx.body().inputs();
      for (let i = 0; i < ins.len(); i++) {
        if (ins.get(i).transaction_id().to_hex() === txHash && Number(ins.get(i).index()) === outputIndex) {
          const reds = tx.witness_set().redeemers(); const legacy = reds?.as_arr_legacy_redeemer();
          const all = []; if (legacy) for (let k = 0; k < legacy.len(); k++) all.push(legacy.get(k));
          const r = all.find(r => Number(r.index()) === i && r.tag() === 0) ?? all[0];
          return { tx: t, redeemer: Data.from(r.data().to_cbor_hex()) };
        }
      }
    }
    return null;
  }
}
