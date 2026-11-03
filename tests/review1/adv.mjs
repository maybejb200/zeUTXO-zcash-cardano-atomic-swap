// review1 adversarial tests on the step-2 simulator (SIMULATOR ONLY, fresh throwaway keys, no network).
import { CML, Data, generateEmulatorAccountFromPrivateKey } from "@lucid-evolution/lucid";
import * as L from "./e2e_lib.mjs";
import fs from "fs"; import path from "path";
const { zec, leHex, leToBig, pkhOf, rd, Results, mustFail, start, build, redeemTx, refundTx, aliceGoSign, signSubmit, sweep, lovelaceAt } = L;

// b as an outside observer sees it: decode the Redeem redeemer from the raw tx CBOR (mempool view, no ledger help)
function shareFromTxCbor(hex) {
  const tx = CML.Transaction.from_cbor_hex(hex); const reds = tx.witness_set().redeemers();
  const leg = reds.as_arr_legacy_redeemer(); const d = Data.from(leg.get(0).data().to_cbor_hex()); return d.fields[0];
}
async function signedHex(S, txb, acct, extraW) { let sb = extraW ? txb.assemble([extraW]) : txb; sb = sb.sign.withPrivateKey(acct.privateKey); return (await sb.complete()).toCBOR(); }

// C1: Bob follows every rule (go-sig obtained, broadcast with > Δ to spare). Before inclusion, the ledger's protocol
// parameters change (epoch boundary: fee param or PlutusV3 cost model). Bob's body is pinned by Alice's go-sig, so he
// cannot rebuild it. b is already public. Does honest Bob lose?
async function c1(variant) {
  const R = new Results(`C1-${variant}`); console.log(`== C1 (${variant}): exogenous invalidation of the go-signed Redeem after b is public`);
  const S = await start(`adv-c1-${variant}`, R);
  const bobX = leToBig(rd(path.join(S.dir, "bob/secret.json")).x);
  const t = await build(S, S.B, redeemTx(S, bobX));
  const g = aliceGoSign(S, t.toTransaction().body().to_cbor_hex());
  R.rec("Alice go-signs (honest policy)", "accept", !!g.witness, g.refused);
  R.rec("Bob's broadcast rule holds (now+Δ ≤ T1−1s)", "accept", S.L.now() + L.DELTA <= S.T1 - 1000, `${(S.T1 - S.L.now()) / 1000}s before T1`);
  const hex = await signedHex(S, t, S.B, g.witness);
  const bPublic = shareFromTxCbor(hex); // anyone relaying / any mempool peer now has b
  R.rec("b is readable from the broadcast tx bytes alone", "accept", bPublic === bobX);
  // epoch boundary: parameter update takes effect while the tx is pending
  if (variant === "fee") S.L.pp = { ...S.L.pp, minFeeA: S.L.pp.minFeeA + 1 };
  else { const cm = S.L.pp.costModels.PlutusV3.slice(); cm[0] = cm[0] + 1; S.L.pp = { ...S.L.pp, costModels: { ...S.L.pp.costModels, PlutusV3: cm } }; }
  S.L.em.protocolParameters = S.L.pp; await S.lucid.switchProvider(S.L.em); S.L.costModelsBytes = (await import("@lucid-evolution/lucid")).createCostModels(S.L.pp.costModels).to_cbor_bytes(); // wallets build with the new params too
  let rej = null; try { await S.L.submit(hex, "redeem_after_param_change"); } catch (e) { rej = e.message; }
  R.rec("pending Redeem is invalid under the new parameters (node drops it)", "reject", rej !== null, rej);
  // Malicious-but-rational Alice: sweeps the ZEC with b seen in the mempool, refuses any new go-sig, refunds at T1.
  const sw = sweep(S, R, "alice", [`other_share=${leHex(bPublic)}`], "adv_alice_sweep_mempool_b");
  R.rec("Alice sweeps the ZEC with b taken from the dropped tx", "accept", !!sw.accepted, sw.reason);
  S.L.awaitSlot(S.L.slotOf(S.T1) - S.L.slot());
  const rt = await build(S, S.A, refundTx(S, leToBig(rd(path.join(S.dir, "alice/secret.json")).x), S.T1));
  let rr = null; try { rr = await signSubmit(S, R, rt, S.A, "adv_alice_refund"); } catch (e) { rr = { err: e.message }; }
  R.rec("Alice also Refunds her ADA at T1", "accept", !!rr?.txHash, rr?.err); S.L.awaitBlock(1);
  const aliceAda = await lovelaceAt(S, S.A.address); const az = zec(["balance", ...S.d("party=alice")]); const bz = zec(["balance", ...S.d("party=bob")]);
  const bobAda = await lovelaceAt(S, S.B.address);
  R.rec("OUTCOME: honest Bob lost his ZEC and got no ADA", "accept", az.unspent_zats > 0 && aliceAda > 1_990_000_000n && bobAda < 301_000_000n,
    `Alice: ${Number(aliceAda) / 1e6} ADA + ${az.unspent_zats} zats; Bob: ${Number(bobAda) / 1e6} ADA + ${bz.unspent_zats} zats (his change only)`);
  return R;
}

// C2: does the simulator ever let a submitted tx fail to confirm? (Emulator.awaitBlock moves mempool->ledger without re-checking TTL)
async function c2() {
  const R = new Results("C2"); console.log("== C2: emulator confirms a Redeem whose TTL expired while pending");
  const S = await start("adv-c2", R);
  const bobX = leToBig(rd(path.join(S.dir, "bob/secret.json")).x);
  const up = S.L.now() + 2000;
  const t = await build(S, S.B, redeemTx(S, bobX, { upper: up }));
  const g = aliceGoSign(S, t.toTransaction().body().to_cbor_hex());
  const r = await signSubmit(S, R, t, S.B, "short_ttl_redeem", g.witness);
  const ttlSlot = S.L.slotOf(up);
  S.L.awaitSlot(10); S.L.awaitBlock(1);
  const still = (await S.L.lucid?.utxosAt?.(S.scriptAddr)) ?? (await S.L.em.getUtxos(S.scriptAddr));
  R.rec("tx accepted to mempool at submit", "accept", !!r.txHash, `submit slot ${S.L.log.at(-1).slot}, ttl slot ${ttlSlot}`);
  R.rec("SIM GAP: block made at slot > ttl still includes it (a real node would drop it)", "accept", still.length === 0 && S.L.slot() > ttlSlot, `now slot ${S.L.slot()}, escrow UTxOs left ${still.length}`);
  return R;
}

// C3: Alice's go-sign policy compares full address strings. A UTxO under Alice's SAME payment key at a different
// address (base address with a stake part) is not recognised, so Bob can sweep it inside the go-signed Redeem.
async function c3() {
  const R = new Results("C3"); console.log("== C3: go-sign policy misses Alice's key at another address form");
  const S = await start("adv-c3", R);
  const bobX = leToBig(rd(path.join(S.dir, "bob/secret.json")).x);
  const base = CML.BaseAddress.new(0, CML.Credential.new_pub_key(CML.Ed25519KeyHash.from_hex(pkhOf(S.A))), CML.Credential.new_pub_key(CML.Ed25519KeyHash.from_hex(pkhOf(S.B)))).to_address().to_bech32(undefined);
  const lucid = await L.as(S, S.A);
  const ptx = await lucid.newTx().pay.ToAddress(base, { lovelace: 50_000_000n }).complete();
  await S.L.submit((await ptx.sign.withWallet().complete()).toCBOR(), "alice_to_own_base_addr"); S.L.awaitBlock(1);
  const aU = (await S.L.em.getUtxos(base))[0];
  R.rec("Alice holds 50 ADA at a base address under her go-sig payment key", "accept", !!aU, base.slice(0, 30));
  const t = await build(S, S.B, (tx) => redeemTx(S, bobX)(tx).collectFrom([aU]));
  const g = aliceGoSign(S, t.toTransaction().body().to_cbor_hex());
  R.rec("POLICY GAP: Alice's checker go-signs a body that spends her own UTxO", "accept", !!g.witness, g.refused);
  let r = null; try { r = await signSubmit(S, R, t, S.B, "redeem_plus_alice_utxo", g.witness); } catch (e) { r = { err: e.message }; }
  S.L.awaitBlock(1); const left = await S.L.em.getUtxos(base);
  R.rec("OUTCOME: Bob's Redeem lands and also takes Alice's 50 ADA", "accept", !!r?.txHash && left.length === 0, r?.err);
  return R;
}

const out = {}; const which = process.argv[2] || "all";
for (const [k, f] of Object.entries({ c1fee: () => c1("fee"), c1costmodel: () => c1("costmodel"), c2, c3 })) {
  if (which !== "all" && which !== k) continue;
  try { const R = await f(); out[k] = { pass: R.pass, checks: R.checks }; console.log(`== ${k}: ${R.pass ? "REPRODUCED" : "NOT reproduced"}`); }
  catch (e) { out[k] = { error: String(e.stack ?? e) }; console.log(`== ${k}: ERROR ${e.stack ?? e}`); }
}
fs.writeFileSync(path.join(L.ROOT, `adv-results-${which}.json`), JSON.stringify(out, (k, v) => typeof v === "bigint" ? Number(v) : v, 2));
