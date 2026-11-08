// zeUTXO path 1 — chain-facing helpers used by the wallet (extracted from e2e9.mjs so they can be unit-tested).
// slotCfg = { zeroTime, zeroSlot, slotLength } exactly as Lucid's SLOT_CONFIG_NETWORK (Preprod: zeroSlot 86400).
import { Data } from "@lucid-evolution/lucid";
export { CML, Data, Constr } from "@lucid-evolution/lucid";   // re-exported for the step 10 tests

/** POSIX ms of the start of `slot` (what the ledger hands the script for a validity bound). */
export function slotToMs(slot, slotCfg) {
  return slotCfg.zeroTime + (Number(slot) - slotCfg.zeroSlot) * slotCfg.slotLength;   // step 10 (audit A2): zeroSlot (86400 on preprod)
}
/** Lower validity bound: round UP to a slot start, so the ledger's floor never moves it below `ms` (lower ≥ T checks). */
export function validFromMs(ms, slotCfg) {
  const off = ms - slotCfg.zeroTime; return slotCfg.zeroTime + Math.ceil(off / slotCfg.slotLength) * slotCfg.slotLength;
}
/** Lower validity bound for a tx sent at `from` that the script requires to be ≥ `minLo` (T1, T2, T3 or t4; may be undefined).
 *  Normally the current slot start (floor: admissible now). If flooring would drop it below `minLo` (minLo not on a slot
 *  boundary, and from is in minLo's slot), use the next slot start instead; the wallet then submits from that slot on.
 *  If from < minLo the caller is early on purpose (negative tests): leave it, the script must reject. */
export function lowerBoundMs(from, minLo, slotCfg) {
  const f = validToMs(from, slotCfg);
  if (Number.isFinite(minLo) && from >= minLo && f < minLo) return validFromMs(minLo, slotCfg);
  return f;
}
/** Upper validity bound: round DOWN to a slot start, i.e. exactly the value the script will see. */
export function validToMs(ms, slotCfg) {
  const off = ms - slotCfg.zeroTime; return slotCfg.zeroTime + Math.floor(off / slotCfg.slotLength) * slotCfg.slotLength;
}

/** Validity window of a Notice built at `from` with a TTL of `ttlMs`: { from, hi }. `hi` goes into the datum as t4 − tail. */
export function noticeWindow(from, ttlMs, slotCfg, minLo) {
  // step 10 (audit A2): the script computes t4 from the upper bound AS THE LEDGER SEES IT (slot start), so the datum must use the
  // same slot-aligned value; the lower bound is the current slot start, or the next one if that would break "lower ≥ T1/T2" (lowerBoundMs).
  const lo = lowerBoundMs(from, minLo, slotCfg);
  return { from: lo, hi: validToMs(lo + ttlMs, slotCfg) };
}

/** Decode the tx that created a UTxO: inputs (as listed), Spend redeemers keyed by the outref they spend (canonical input
 *  order), and the indices of outputs at `scriptAddr`. `constr` = the redeemer's constructor index (Notice = 2); this is not the
 *  ledger's redeemer "tag" (purpose: Spend = 0), which is filtered on above. */
export function decodeCreating(tx, scriptAddr) {
  const b = tx.body(), ins = []; for (let i = 0; i < b.inputs().len(); i++) { const x = b.inputs().get(i); ins.push({ txHash: x.transaction_id().to_hex(), index: Number(x.index()) }); }
  const sorted = [...ins].sort((p, q) => p.txHash < q.txHash ? -1 : p.txHash > q.txHash ? 1 : p.index - q.index);
  // step 10 (audit A3): Conway txs may carry redeemers as a legacy array OR as a map; to_flat_format() reads both.
  const reds = tx.witness_set().redeemers()?.to_flat_format(), scriptRedeemers = [];
  for (let k = 0; k < (reds?.len() ?? 0); k++) { const r = reds.get(k); if (r.tag() !== 0 /* Spend */) continue; const d = Data.from(r.data().to_cbor_hex()); const at = sorted[Number(r.index())]; if (at) scriptRedeemers.push({ ...at, constr: d.index }); }
  const scriptOutputs = []; for (let i = 0; i < b.outputs().len(); i++) if (b.outputs().get(i).address().to_bech32() === scriptAddr) scriptOutputs.push(i);
  return { inputs: ins, scriptRedeemers, scriptOutputs };
}
