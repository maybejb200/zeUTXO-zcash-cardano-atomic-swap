# zeUTXO path 1: go / no-go memo (Mon Nov 2, 2026)

## Verdict: GO
The Farcaster-style shielded swap holds up in this first step:
- ZEC sits in an Orchard note whose key is split between the two of us.
- ADA sits in one Cardano script with Redeem, Refund and Punish.
- No relay is needed.

Everything I tested passed. The model found no way for an honest party to lose money, as long as each party's transactions get mined within the agreed delay. Nothing here is on a real chain yet: every key is a fresh throwaway, and everything ran on the box.

## What was built (all under /workspace/zeutxo-path1/)
| Item | Result | Key numbers |
|---|---|---|
| 1. spec.md | done | One page. Covers keys, setup, the three Cardano branches, the Orchard handling and who learns what. |
| 2. State-model search (model/) | **PASS** | Bounded delay: 50 to 1,104 states per configuration, **0 honest losses**. Crash runs: 0 losses for any live honest party. A sweep of 676 timing configs (1.4M states) confirmed the exact timing rules. Unbounded delay: losses occur, but every one needs an honest party's critical tx to be stuck longer than the bound. |
| 3a. Orchard split-key signing (reddsa + the real orchard 0.15.5 crate) | **PASS** | 64 trials, 1,664/1,664 checks passed. Both sign cases of the joint key were exercised (32/32). The joint, solo and adaptor signatures all verify in reddsa and are accepted by orchard's own signing path, using the real α and rk taken from a real note spend. All bad-signature cases are rejected (pre-sig alone, one share, wrong sighash or α, no ỹ negation, and others), and the adaptor secret is recovered. |
| 3b. Cross-group DLEQ (Pallas ↔ BLS12-381) | **PASS** | The good proof is accepted. **All 26 malformed or cheating proofs are rejected.** 200/200 random honest proofs are accepted. Proof size 60.6 KB, prove 0.58 s, verify 0.49 s. |
| 3c. Aiken validator | **PASS** | Worst branch (Refund) uses **2.84% of tx CPU** (283.9M of 10B steps) and 0.43% of tx memory. That figure includes test-harness overhead (building the tx and computing A_c in-test), so it is conservative. Redeem uses 2.08% CPU and 0.49% memory. The crypto check alone uses 1.84% CPU, or 1.33% with the compress variant. All 12 negative cases fail as they should. Script size is 779 bytes. Budget source: mainnet maxTxExecutionUnits = 16.5M mem / 10B steps, current at epoch 665 (supercardano.com/params). Memory was raised from 14M in epoch 614. |

## Things the work caught (so they are not surprises later)
- **DLEQ needs its proofs of knowledge.**
  - Without them, a cheater can publish a "shifted" key share. That share passes every other check, but nobody can actually spend it.
  - My test showed the naive version accepts this attack. The full version, which follows Farcaster's design, rejects it.
  - This is now mandatory in the spec.
- **Alice's "go" signature is required.**
  - Without it, Bob could reveal his share and take the ADA before funding any ZEC. The model's mutant run demonstrates this loss.
- **Timing rules** (in units of the delay bound Δ):
  - Safe exactly when T2 − T1 ≥ Δ+1 (and T2 − Δ ≥ Δ+1).
  - Completes exactly when T0 ≥ 2Δ and T1 ≥ 3Δ+1.

## Honest-loss traces
- **Within the delay bound: none.** The stop rule was not triggered.
- **Outside the bound (liveness assumption):**
  - Example 1: Bob's Redeem is stuck in the mempool past T1. Alice has already seen his share, so she takes the ZEC and also refunds the ADA, and Bob loses.
  - Example 2: Alice's Refund is stuck past T2, so Bob's Punish wins and Alice loses.
  - These are the standard atomic-swap assumptions: critical transactions must land on time.
- **Crash case:** if Alice is offline between T1 and T2 and Bob is malicious, Bob punishes and Alice loses her ADA. That is by design (see the decision below).

## Open risks
1. **No Halo2 proof and no real Zcash transaction were built.** I used a stand-in sighash. The signing math is proven; the transaction assembly is not.
2. **The DLEQ code is my own and has not been audited.** It is 60 KB, which is fine because it is exchanged off-chain only.
3. **Δ must be set conservatively in real use**, covering mempool congestion and Cardano settlement. Zcash reorg depth Z is a separate assumption.
4. **No real-chain run yet**, not even on testnet.

## Recommended next step (about 1/2 week of usage, simulator only)
1. Build a real Orchard transaction, with a Halo2 proof and a ZIP-244 sighash, that spends from the joint key on a local mock tree.
2. Build real Cardano Redeem, Refund and Punish transactions in an emulator using the compiled script.
3. Script one end-to-end simulated swap for each of the three outcomes.

After that, a testnet run, which needs your explicit go-ahead because it involves wallets and testnet funds.

## The ONE decision you need to make
**Do you accept the Punish trade-off?**
- If the ADA holder (Alice) goes silent after Bob has funded the ZEC note, Bob does not get his ZEC back. He gets the ADA instead, and the ZEC stays locked forever.
- Put the other way, the ADA holder must be online during the window from T1 to T2.

Every fully trustless Orchard design I can see has this trade-off, because Orchard has no timelocks. If you accept it, path 1 is a GO to the next step. If you don't, Orchard can't deliver a fully trustless swap without a Zcash-side timelock, which would mean waiting for a protocol change.
