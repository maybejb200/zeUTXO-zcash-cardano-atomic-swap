// review2 T-ED2: weak go keys chosen by Alice. Which verifiers accept a signature under a small-order / non-canonical go_vk?
import crypto from "crypto"; import { createRequire } from "module";
const require = createRequire("/workspace/zeutxo-path1/step2/ada/node_modules/");
const sodium = require("libsodium-wrappers-sumo"); await sodium.ready;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const le = (b) => BigInt("0x" + Buffer.from(b).reverse().toString("hex"));
const toLe = (n) => Buffer.from(n.toString(16).padStart(64, "0"), "hex").reverse();
const nodeV = (A, m, s) => { try { return crypto.verify(null, m, crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), A]), format: "der", type: "spki" }), s); } catch (e) { return "throw:" + e.message.slice(0, 40); } };
const sodV = (A, m, s) => { try { return sodium.crypto_sign_verify_detached(s, m, A); } catch (e) { return "throw"; } };
// small-order points (standard list, e.g. from libsodium's blocklist / ZIP-215 test vectors)
const SMALL = {
  identity: "0100000000000000000000000000000000000000000000000000000000000000",
  order2: "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  order4: "0000000000000000000000000000000000000000000000000000000000000000",
  order8a: "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  order8b: "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  noncanon_identity: "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", // y = p+1 ≡ 1
};
const msg = crypto.randomBytes(129);
const out = {};
for (const [name, hx] of Object.entries(SMALL)) {
  const A = Buffer.from(hx, "hex");
  // For A of small order, [k]A is in the torsion subgroup. Try R = [r]B + T for each torsion T... simplest universal forgery:
  // if [k]A = identity (true whenever 8 | k or A = identity), then (R=[r]B, S=r) verifies cofactorless. Grind r until 8 | k (or k*A = id).
  let res = null;
  for (let t = 0; t < 400 && !res; t++) {
    const r = le(crypto.randomBytes(64)) % L;
    const R = Buffer.from(sodium.crypto_scalarmult_ed25519_base_noclamp(toLe(r)));
    const k = le(crypto.createHash("sha512").update(Buffer.concat([R, A, msg])).digest()) % L;
    if (name === "identity" || name === "noncanon_identity" || k % 8n === 0n) res = { tries: t + 1, sig: Buffer.concat([R, toLe(r)]) };
  }
  out[name] = res ? { node_openssl: nodeV(A, msg, res.sig), libsodium: sodV(A, msg, res.sig), tries: res.tries, sig: res.sig.toString("hex"), vk: hx } : "no candidate";
}
out.msg = msg.toString("hex");
console.log(JSON.stringify(out, null, 1));
