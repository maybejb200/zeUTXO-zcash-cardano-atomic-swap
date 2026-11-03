// zeUTXO path 1 step 3 — Alice's "go" message (replaces the step-2 co-signature over one exact tx).
// msg = "zeUTXO/path1/go/v1" ‖ network_id(1) ‖ swap_id(32) ‖ script_hash(28) ‖ escrow_txid(32) ‖ escrow_index(2 BE)
//       ‖ escrow_lovelace(8 BE) ‖ T1_ms(8 BE). Signed with a fresh, single-purpose Ed25519 key (alice_go_vk in the datum).
import crypto from "crypto";
export const GO_DOMAIN = Buffer.from("zeUTXO/path1/go/v1");
const be = (n, len) => { let h = BigInt(n).toString(16).padStart(len * 2, "0"); if (h.length > len * 2) throw new Error("int too big"); return Buffer.from(h, "hex"); };
export function goMsg({ networkId, swapId, scriptHash, txId, index, lovelace, t1, domain = GO_DOMAIN }) {
  const parts = [domain, be(networkId, 1), Buffer.from(swapId, "hex"), Buffer.from(scriptHash, "hex"), Buffer.from(txId, "hex"), be(index, 2), be(lovelace, 8), be(t1, 8)];
  if (Buffer.from(swapId, "hex").length !== 32 || Buffer.from(scriptHash, "hex").length !== 28 || Buffer.from(txId, "hex").length !== 32) throw new Error("bad field length");
  return Buffer.concat(parts);
}
export function goKeygen() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const vk = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  return { vk, sk: privateKey };
}
export const goSign = (sk, msg) => crypto.sign(null, msg, sk).toString("hex");
export const goVerify = (vkHex, msg, sigHex) => {
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(vkHex, "hex")]);
  return crypto.verify(null, msg, crypto.createPublicKey({ key: der, format: "der", type: "spki" }), Buffer.from(sigHex, "hex"));
};

// ---------------- step 5 (F2): strict Ed25519, spec v0.4 §G ----------------
// Strict = what cardano-node's verifyEd25519Signature builtin does (libsodium crypto_sign_verify_detached):
// A and R canonical (y < p), A and R not of small order, S < ℓ, cofactorless equation [S]B = R + [k]A checked by
// re-encoding. Bob's pre-broadcast check (goVerifyBob) is SEPARATE from the ledger's (ledgerEd25519 in nodecheck.mjs):
// it applies the explicit checks below AND requires agreement of two independent implementations (libsodium and
// Node/OpenSSL). Neither uses the UPLC builtin of the local evaluator (which is laxer — review2 F2).
import { createRequire } from "module";
const require_ = createRequire(import.meta.url);
const sodium = require_("libsodium-wrappers-sumo"); await sodium.ready;
const P25519 = (1n << 255n) - 19n, ELL = (1n << 252n) + 27742317777372353535851937790883648493n;
const leInt = (b) => BigInt("0x" + (Buffer.from(b).reverse().toString("hex") || "00"));
const isCanonicalPoint = (b) => b.length === 32 && (leInt(b) & ((1n << 255n) - 1n)) < P25519;
// identity + the 7 other small-order points' canonical encodings are rejected by sodium's is_valid_point, but we name them explicitly.
export function goKeyCheck(vkHex) {
  if (typeof vkHex !== "string" || !/^[0-9a-f]{64}$/.test(vkHex)) return "go key must be 32 bytes as lowercase hex";
  const b = Buffer.from(vkHex, "hex");
  if (!isCanonicalPoint(b)) return "go key is a non-canonical encoding (y ≥ p)";
  if (vkHex === "01" + "00".repeat(31)) return "go key is the identity point";
  if (!sodium.crypto_core_ed25519_is_valid_point(b)) return "go key is small-order, not on the curve, or not in the prime-order subgroup";
  return null;
}
export function sigShapeCheck(sigHex) {
  if (typeof sigHex !== "string" || !/^[0-9a-f]{128}$/.test(sigHex)) return "go_sig must be 64 bytes as lowercase hex";
  const s = Buffer.from(sigHex, "hex"), R = s.subarray(0, 32), S = s.subarray(32);
  if (leInt(S) >= ELL) return "go_sig S ≥ ℓ (non-canonical / malleated)";
  if (!isCanonicalPoint(R)) return "go_sig R is a non-canonical encoding";
  if (!sodium.crypto_core_ed25519_is_valid_point(R)) return "go_sig R is small-order or not in the prime-order subgroup";
  return null;
}
export const sodiumVerify = (vkHex, msg, sigHex) => { try { return sodium.crypto_sign_verify_detached(Buffer.from(sigHex, "hex"), msg, Buffer.from(vkHex, "hex")); } catch { return false; } };
const opensslVerify = (vkHex, msg, sigHex) => { try { return goVerify(vkHex, msg, sigHex); } catch { return false; } };
/** Bob's pre-broadcast check. Returns null if OK, else the specific reason. */
export function goVerifyBob(vkHex, msg, sigHex) {
  const k = goKeyCheck(vkHex); if (k) return k;
  const s = sigShapeCheck(sigHex); if (s) return s;
  const a = sodiumVerify(vkHex, msg, sigHex), b = opensslVerify(vkHex, msg, sigHex);
  if (a !== b) return `go_sig: implementations disagree (libsodium ${a}, OpenSSL ${b}) — refuse`;
  if (!a) return "go_sig does not verify for this escrow";
  return null;
}
