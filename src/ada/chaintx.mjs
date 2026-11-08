// zeUTXO path 1 — chain-facing helpers used by the wallet (extracted from e2e9.mjs so they can be unit-tested).
// slotCfg = { zeroTime, zeroSlot, slotLength } exactly as Lucid's SLOT_CONFIG_NETWORK (Preprod: zeroSlot 86400).
import { Data } from "@lucid-evolution/lucid";
export { CML, Data, Constr } from "@lucid-evolution/lucid";   // re-exported for the step 10 tests

/** POSIX ms of the start of `slot` (what the ledger hands the script for a validity bound). */
export function slotToMs(slot, slotCfg) {
  return slotCfg.zeroTime + Number(slot) * slotCfg.slotLength;
}

/** Validity window of a Notice built at `from` with a TTL of `ttlMs`: { from, hi }. `hi` goes into the datum as t4 − tail. */
export function noticeWindow(from, ttlMs, slotCfg) {
  return { from, hi: from + ttlMs };
}

/** Decode the tx that created a UTxO: inputs (as listed), Spend redeemers keyed by the outref they spend (canonical input
 *  order), and the indices of outputs at `scriptAddr`. `constr` = the redeemer's constructor index (Notice = 2). */
export function decodeCreating(tx, scriptAddr) {
  const b = tx.body(), ins = []; for (let i = 0; i < b.inputs().len(); i++) { const x = b.inputs().get(i); ins.push({ txHash: x.transaction_id().to_hex(), index: Number(x.index()) }); }
  const sorted = [...ins].sort((p, q) => p.txHash < q.txHash ? -1 : p.txHash > q.txHash ? 1 : p.index - q.index);
  const reds = tx.witness_set().redeemers()?.as_arr_legacy_redeemer(), scriptRedeemers = [];
  for (let k = 0; k < (reds?.len() ?? 0); k++) { const r = reds.get(k); if (r.tag() !== 0) continue; const d = Data.from(r.data().to_cbor_hex()); const at = sorted[Number(r.index())]; if (at) scriptRedeemers.push({ ...at, tag: d.index }); }
  const scriptOutputs = []; for (let i = 0; i < b.outputs().len(); i++) if (b.outputs().get(i).address().to_bech32() === scriptAddr) scriptOutputs.push(i);
  return { inputs: ins, scriptRedeemers, scriptOutputs };
}
