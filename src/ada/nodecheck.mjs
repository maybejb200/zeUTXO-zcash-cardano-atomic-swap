// zeUTXO step 5 (F2): the simulator LEDGER's strict Ed25519 overlay. The local UPLC evaluator's verifyEd25519Signature
// is laxer than cardano-node's (libsodium) builtin (review2). After phase 2 succeeds, this overlay re-checks the one
// Ed25519 call our escrow makes on a Redeem — verify(go_vk, go_msg, go_sig) — with libsodium, exactly as the node's
// builtin would, and fails the tx if libsodium says false. It shares NO code with Bob's pre-broadcast check (gomsg.mjs
// goVerifyBob): its own libsodium instance, its own message rebuild from the tx + datum.
import { createRequire } from "module";
import { CML, Data } from "@lucid-evolution/lucid";
import { txRedeemers } from "./chaintx.mjs";
const require_ = createRequire(import.meta.url);
const sodium = require_("libsodium-wrappers-sumo"); await sodium.ready;
const DOMAIN = Buffer.from("zeUTXO/path1/go/v1");
const be = (n, len) => Buffer.from(BigInt(n).toString(16).padStart(len * 2, "0"), "hex");
export function ledgerEd25519(scriptHash) {
  return (tx, resolve) => {
    const body = tx.body(), ins = body.inputs();
    const reds = txRedeemers(tx); if (!reds.length) return;   // step 10 (review 6 R6-M2): legacy array or Conway map
    // ledger sorts inputs; redeemer index refers to sorted order
    const sorted = []; for (let i = 0; i < ins.len(); i++) sorted.push(ins.get(i));
    sorted.sort((a, b) => a.transaction_id().to_hex() === b.transaction_id().to_hex() ? Number(a.index()) - Number(b.index()) : (a.transaction_id().to_hex() < b.transaction_id().to_hex() ? -1 : 1));
    for (const r of reds) {
      if (r.tag !== 0) continue;
      const inp = sorted[r.index]; const u = resolve(inp); if (!u) continue;   // u = confirmed UTxO
      const pc = CML.Address.from_bech32(u.address).payment_cred(); if (!pc || pc.kind() !== 1 || pc.as_script().to_hex() !== scriptHash) continue;
      const red = Data.from(r.cborHex); if (!(red && red.index === 0)) continue;   // Commit only (step 7)
      if (!u.datum) continue;
      const d = Data.from(u.datum); const f = d.fields;
      if (typeof f?.[2] !== "string" || typeof f?.[3] !== "bigint" || typeof f?.[4] !== "string" || typeof f?.[7] !== "bigint") continue; // script itself fails such datums
      const msg = Buffer.concat([DOMAIN, be(f[3], 1), Buffer.from(f[4], "hex"), Buffer.from(scriptHash, "hex"), Buffer.from(inp.transaction_id().to_hex(), "hex"),
        be(inp.index(), 2), be(u.assets.lovelace, 8), be(f[7], 8)]);
      const sig = Buffer.from(red.fields[0] ?? "", "hex");   // step 7: Commit{go_sig} is field 0 (constructor 0)
      let ok = false; try { ok = sig.length === 64 && sodium.crypto_sign_verify_detached(sig, msg, Buffer.from(f[2], "hex")); } catch { ok = false; }
      if (!ok) throw new Error("ScriptFailure (phase 2, node Ed25519 builtin = libsodium): verifyEd25519Signature(go_vk, go_msg, go_sig) = False");
    }
  };
}
