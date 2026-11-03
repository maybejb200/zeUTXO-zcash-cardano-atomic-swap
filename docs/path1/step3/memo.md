# zeUTXO path 1, step 3: review fixes and rerun (simulator only)
Mon Nov 2, 2026, 8:28 to 9:05 PM ET (about 37 min). Everything ran on the box: a simulated Zcash node and a local Cardano emulator. No real chains,
testnets, wallets or funds were used. All keys were freshly generated and thrown away.

## What changed, in one paragraph
In step 2, Alice approved Bob's claim by co-signing **one exact Cardano transaction**. The review showed the danger. If the
network's fee or cost settings changed after Bob's claim had revealed his secret, that one transaction became invalid. Bob could not
rebuild it, and Alice could take both coins. Now Alice signs a short **"go" message** that names this one escrow: its address,
amount, deadline, swap id and network. The Cardano contract checks that message itself, so Bob can rebuild his claim as many times
as he needs until the deadline. Because Alice no longer signs any transaction, Bob also can't slip one of her coins into
something she signs. I also widened the deadlines so they allow for Cardano blocks being undone (rollbacks) and for one fee change,
and made Alice re-check the Zcash deposit on the live chain right before she says "go".

## Results: every scenario was rerun with fresh keys (167/167 checks pass)
| Scenario | What it shows | Result |
|---|---|---|
| (a) Happy path | Swap completes; 17 cheats rejected, each with the expected error | **PASS** 30/30 |
| (b) Refund | Bob doesn't claim; Alice refunds, Bob recovers his ZEC; 8 cheats rejected | **PASS** 19/19 |
| (c) Punish | Alice silent; Bob takes the ADA after T2 (accepted trade-off) | **PASS** 13/13 |
| Setup cheats | Bad DLEQ proofs, wrong datum, wrong go key, network or swap id, unsettled lock, short or shallow ZEC, late or bad "go" | **PASS** 15/15 |
| **C-1 fee change** (review's Critical) | Alice reads Bob's secret from the mempool and takes the ZEC. Fees double, so Bob's claim is dropped. **Bob rebuilds with the same "go" and still gets the ADA** | **PASS** 10/10. The attack no longer hurts Bob |
| C-1 cost-model change | Same, with a contract cost-setting change | **PASS** 10/10 |
| C2 expired tx | A tx held past its deadline is now dropped, not confirmed | **PASS** 8/8 |
| C3 Alice's coins | Bob's claim that also spends Alice's coin is rejected (her signature doesn't exist) | **PASS** 8/8 |
| Cardano rollback of the claim | 2 blocks undone. The claim goes back to the queue and re-confirms before T1 | **PASS** 13/13 |
| Cardano rollback + fee change on the refund | Alice's refund is dropped, rebuilt, rolled back, and still final before T2 | **PASS** 13/13 |
| Zcash reorg / double-spend | Bob's deposit is undone and he spends the coins elsewhere. Alice's live re-check refuses "go"; she refunds safely | **PASS** 8/8 |
| Zcash expiry | Transactions now carry expiry = height+40. Expired and expiry-0 transactions are rejected | **PASS** 4/4 |
| Go-message attacks | Replay from another swap, wrong network, wrong domain, wrong deadline, altered signature, front-runner: all rejected | **PASS** 16/16 |
| *Controls (rule deliberately broken)* | *Bob first claims 40 s before T1, or Alice refunds 30 s before T2. A rollback then makes that party lose* | *Loss happens as expected. This shows the new margins are necessary* |

**Timing model.** I rebuilt the timing model with rollbacks, one fee change and Zcash reorgs. With the new rule: 0 losses for an
honest party across 7 configurations and all honest/cheating combinations. Each weaker rule I tried produced losses. That covers the
old co-sign design, a margin for inclusion only, a margin that ignores fee changes, too short a T2, a shallow "go", and Bob funding
before the lock is final.

## Review findings: status
| Finding | Status |
|---|---|
| C-1 Bob loses after a fee/cost change | **Fixed and verified** (go message, tests c1fee and c1cost) |
| C2 sim confirms expired txs | **Fixed and verified** |
| C3 Bob can slip Alice's coin into her signed tx | **Fixed by design and verified** (Alice signs no tx) |
| H-1 margin ignores rollbacks | **Fixed and verified.** New rule, model and rollback tests |
| H-2 Zcash depth from a saved file | **Fixed and verified.** Live re-check, reorg and double-spend tests |
| M-1 address compare, M-2 PastHorizon, L-3 go-deadline drift | **No longer apply** (Alice signs no tx; the go deadline is T0 in both code and spec) |
| M-3 expiry 0 | **Fixed** (height+40). Other wallet fingerprints (anchor depth, padding) are **open** |
| M-4 setup channel privacy | **Spec requirement added** (encrypted and authenticated). Not implemented in the sim |
| M-6 simulator gaps | **Fixed.** Block-time re-checks, rollbacks, reorgs, fee/cost changes, exact-error negatives, exact escrow check. Multi-asset support was added but not exercised |
| M-5 counterparty keeps the viewing key | **Open** (privacy after the swap, not funds) |
| L-1 DLEQ proof replay across swaps | **Open** (small fix for the next step) |

## New costs (mainnet fee settings)
| Transaction | Size | Fee | Compute used |
|---|---|---|---|
| Cardano claim (Redeem) | 1,699 B (was 1,326) | 0.256 ADA (was 0.232) | ~2.7% of a tx's budget |
| Redeem rebuilt after fees doubled | 1,699 B | 0.431 ADA | same |
| Refund | 1,631 B | 0.245 ADA | ~2.0% |
| Punish | 1,595 B | 0.233 ADA | ~0.7% |
| Contract | 1,214 B (was 779 B) | | |
| Zcash deposit and sweep | 9,165 B each | 0.0001 ZEC | ~0.8 s to prove |

## Still open
L-1, M-5, other Zcash privacy fingerprints, and an encrypted setup channel in real code. The rule budgets **one** fee change per
window; two would need longer windows. All of the self-review is my own work: see `selfcheck.md`, which is clearly labelled not
independent. It found no new way for an honest party to lose funds. It did add one requirement: Bob's wallet must test-run his claim
before broadcasting it. Nothing has touched a real chain.

## Recommended next step
An independent review of spec v0.2 (`spec.md`) and the go-message contract, plus the small L-1 fix, before any testnet planning.

## The one decision for you
**How long to wait for "final" on the real chains.** This sets how long each swap takes.
- **Practical option:** wait about 15 Cardano blocks (~5 min) and about 10 Zcash blocks (~12 min). The whole swap fits in roughly 1–2 hours.
  Finality here is probabilistic, as with exchanges.
- **Conservative option:** wait for Cardano's full guaranteed finality (~12 hours). Each swap then keeps the ADA locked for about a day or more.

I recommend the practical option, with depths set from measured chain data.

Files: `spec.md`, `decisions.md`, `selfcheck.md`, `progress.md`, `results/FINAL_e2e3-all.json`, `model/model3_*.txt`.
