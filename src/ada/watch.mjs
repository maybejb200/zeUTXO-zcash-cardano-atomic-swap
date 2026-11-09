// zeUTXO path 1 — secret watchers (step 11, Nov 9 2026 assessment findings W-1 and W-2). Wallet-side; the escrow is unchanged.
//
// W-1: a watcher must never treat an integer as the counterparty's share just because it sits in a Reveal{b}- or
//      RefundReveal{a}-shaped redeemer. Anyone can broadcast such a redeemer on any script. The one test that matters is the
//      escrow's own: 0 < x < 2^252 and x·G1 = the point in the datum (B_c for b, A_c for a). An x that passes IS the share,
//      wherever it was seen, so no outref bookkeeping is needed; an x that fails is ignored and counts as "not seen".
// W-2: a Spend redeemer's index refers to the ledger's SORTED input order, not the order the body lists the inputs in.
import { bls12_381 } from "@noble/curves/bls12-381";
import { CML, Data } from "@lucid-evolution/lucid";
import { txRedeemers } from "./chaintx.mjs";

/** The escrow's share bound (escrow.ak share_bound): shares are < 2^252, valid in both scalar fields. */
export const SHARE_BOUND = 1n << 252n;
export const REVEAL = 1, REFUND_REVEAL = 3;   // redeemer constructors that carry a share (escrow.ak Action)

/** True iff x is the discrete log of `pointHex` (48-byte compressed BLS12-381 G1, as in the datum). Fails closed. */
export function shareMatches(x, pointHex) {
  try {
    if (typeof x !== "bigint" || x <= 0n || x >= SHARE_BOUND) return false;
    if (typeof pointHex !== "string" || !/^[0-9a-fA-F]{96}$/.test(pointHex)) return false;
    return Buffer.from(bls12_381.G1.ProjectivePoint.BASE.multiply(x).toRawBytes(true)).toString("hex") === pointHex.toLowerCase();
  } catch { return false; }
}

const asTx = (t) => typeof t === "string" ? CML.Transaction.from_cbor_hex(t) : t;
const cmp = (p, q) => p.txHash < q.txHash ? -1 : p.txHash > q.txHash ? 1 : p.outputIndex - q.outputIndex;

/** The inputs of `tx` in the ledger's canonical (sorted) order, as { txHash, outputIndex }. */
export function sortedInputs(tx) {
  const ins = asTx(tx).body().inputs(), out = [];
  for (let i = 0; i < ins.len(); i++) out.push({ txHash: ins.get(i).transaction_id().to_hex(), outputIndex: Number(ins.get(i).index()) });
  return out.sort(cmp);
}

/** W-2: the decoded Spend redeemer with which `tx` spends `outref`; null if tx does not spend it or carries no redeemer
 *  for it (never "the first redeemer in the tx"). */
export function spendRedeemer(tx, outref) {
  const t = asTx(tx), i = sortedInputs(t).findIndex(x => x.txHash === outref.txHash && x.outputIndex === Number(outref.outputIndex));
  if (i < 0) return null;
  const r = txRedeemers(t).find(r => r.tag === 0 && r.index === i);
  if (!r) return null;
  try { return Data.from(r.cborHex); } catch { return null; }
}

/** W-1: the counterparty's share revealed in any of `txs` (hex strings or { txHex }), or null. `constr` = REVEAL (Alice looks
 *  for b) or REFUND_REVEAL (Bob looks for a); `pointHex` = the datum point it must open (B_c / A_c). Decoys are skipped, so
 *  they can neither hide a later genuine reveal nor make the caller believe a secret was seen. */
export function revealedShare(txs, constr, pointHex) {
  for (const t of txs) {
    let reds; try { reds = txRedeemers(asTx(typeof t === "string" ? t : t.txHex)); } catch { continue; }
    for (const r of reds) {
      if (r.tag !== 0) continue;
      let d; try { d = Data.from(r.cborHex); } catch { continue; }
      if (d?.index !== constr || d.fields?.length !== 1) continue;
      if (shareMatches(d.fields[0], pointHex)) return d.fields[0];
    }
  }
  return null;
}
