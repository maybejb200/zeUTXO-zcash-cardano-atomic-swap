// Fresh throwaway Ed25519 test vectors for the Aiken unit tests (printed, pasted into escrow.ak). Never reused elsewhere.
import { goMsg, goKeygen, goSign } from "./gomsg.mjs";
import crypto from "crypto";
const k = goKeygen(), k2 = goKeygen();
const base = { networkId: 0, swapId: "5a".repeat(32), scriptHash: "5c".repeat(28), txId: "00".repeat(31) + "01", index: 0, lovelace: 1000000000, t1: 1800000000000 };
const v = {
  go_vk: k.vk, other_vk: k2.vk,
  sig_ok: goSign(k.sk, goMsg(base)),
  sig_other_outref: goSign(k.sk, goMsg({ ...base, txId: "00".repeat(31) + "02" })),
  sig_other_swap: goSign(k.sk, goMsg({ ...base, swapId: "5b".repeat(32) })),
  sig_other_net: goSign(k.sk, goMsg({ ...base, networkId: 1 })),
  sig_other_domain: goSign(k.sk, goMsg({ ...base, domain: Buffer.from("zeUTXO/path1/go/v0") })),
  sig_other_amount: goSign(k.sk, goMsg({ ...base, lovelace: 999000000 })),
  sig_other_key: goSign(k2.sk, goMsg(base)),
  msg_hex: goMsg(base).toString("hex"),
};
console.log(JSON.stringify(v, null, 1));
