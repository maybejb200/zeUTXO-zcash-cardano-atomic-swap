// review2 T-ED1: does the "identity-R" Ed25519 signature verify under (a) Node/OpenSSL (Bob's off-chain goVerify),
// (b) Lucid's local UPLC evaluator builtin (tested end-to-end in adv2.mjs), (c) libsodium (what cardano-node's
// Plutus builtin verifyEd25519Signature uses)? Fresh throwaway key generated here, never stored.
import crypto from "crypto";
import { createRequire } from "module";
const require = createRequire("/workspace/zeutxo-path1/step2/ada/node_modules/");
const sodium = require("libsodium-wrappers-sumo"); await sodium.ready;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const le = (b) => BigInt("0x" + Buffer.from(b).reverse().toString("hex"));
const toLe = (n, len = 32) => Buffer.from(n.toString(16).padStart(len * 2, "0"), "hex").reverse();
export function identityRSign(seed32, msg) {
  const h = crypto.createHash("sha512").update(seed32).digest();
  const a = Buffer.from(h.subarray(0, 32)); a[0] &= 248; a[31] &= 127; a[31] |= 64;
  const sk = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed32]), format: "der", type: "pkcs8" });
  const A = crypto.createPublicKey(sk).export({ format: "der", type: "spki" }).subarray(-32);
  const R = Buffer.alloc(32); R[0] = 1;                     // encoding of the identity point (small order)
  const k = le(crypto.createHash("sha512").update(Buffer.concat([R, A, msg])).digest()) % L;
  const S = (k * le(a)) % L;
  return { vk: A.toString("hex"), sig: Buffer.concat([R, toLe(S)]).toString("hex"), sk };
}
const nodeVerify = (vk, msg, sig) => crypto.verify(null, msg, crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(vk, "hex")]), format: "der", type: "spki" }), Buffer.from(sig, "hex"));
const sodiumVerify = (vk, msg, sig) => sodium.crypto_sign_verify_detached(Buffer.from(sig, "hex"), msg, Buffer.from(vk, "hex"));
if (import.meta.url === `file://${process.argv[1]}`) {
  const msg = crypto.randomBytes(129);
  const seed = crypto.randomBytes(32);
  const { vk, sig, sk } = identityRSign(seed, msg);
  const honest = crypto.sign(null, msg, sk).toString("hex");
  const out = {
    honest_sig: { node_openssl: nodeVerify(vk, msg, honest), libsodium: sodiumVerify(vk, msg, honest) },
    identityR_sig: { sig_prefix: sig.slice(0, 16), node_openssl: nodeVerify(vk, msg, sig), libsodium: sodiumVerify(vk, msg, sig) },
    vk, msg: msg.toString("hex"), sig, libsodium_version: sodium.sodium_version_string(),
  };
  console.log(JSON.stringify(out, null, 1));
}
