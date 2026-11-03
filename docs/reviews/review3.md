# zeUTXO path 1: independent adversarial review #3 (spec v0.4 / step 5)

Reviewer: Grok Bot (independent of the step-5 author). Date: 2026-11-02 (America/New_York).
Scope: step5/ (spec v0.4, memo, escrow.ak, e2e3.mjs, gomsg/nodecheck/valuecap/ledger, zec sim) plus review1/review2 statuses.
I ran everything on the box only, against a copy in `review3/work/`. step5/ was not modified. I used fresh emulator keys only, no network transactions, and web reads only.

## Verdict at a glance

| Area | Verdict |
|---|---|
| **Overall: go ahead and write the $500 testnet rehearsal plan?** | **FAIL.** The Zcash leg as built can't be carried out on mainnet or testnet since NU6.3 (R3-C1). |
| F1 datum byte-exact check | **PASS**, with one small gap (R3-L1: a reference script on the lock output is accepted) |
| F2 strict signature path | **PASS in design and sim.** The real-world B.3 step (own-node dry run, submit only there) is still unbuilt and is the actual safeguard. |
| Timing model (99.9%, R = 5 min, T0/T1/T2) | **PASS on arithmetic. FAIL on adversarial assumptions:** NU7 transition (R3-H1) and Cardano congestion (R3-H2). |
| Value-cap model ($15k at Z = 60) | **FAIL as specified.** Only 2 blocks of margin at its own ε. A realistic stale rate alone breaks it, and coalitions and recent single-pool peaks are ignored (R3-H3). |
| Privacy of new items (swap id, go message, datum) | **PASS on the Cardano side** (metadata caveats). **Must be redone for the Zcash side**, because the pool changed (Orchard → Ironwood). |
| Test integrity (269 checks + strict checker) | **The rerun reproduces, but it gives no assurance about the real Zcash chain.** The sim enforces NU6.2 rules. |

Rerun: `review3/rerun-all.log`: **269/269 pass, 0 fail, 20 groups, 373 s** (copy of step5, fresh emulator keys). Reproducing them does not make them relevant to the real chain (R3-C1).

---

## CRITICAL

### R3-C1. Since NU6.3, Orchard is withdrawal-only. Bob's funding tx and Alice's sweep are both consensus-invalid, on mainnet and on testnet.

ZIP 258 (NU6.3) has been active since mainnet height 3,428,143 (July 2026) and testnet height 4,134,000. For every transaction, regardless of version:
- "Every Orchard-pool Action MUST be created with cross-address transfers disabled (`enableCrossAddress` = 0). … enforced by the Action circuit verifying key … applies … to Orchard-pool Actions in version 5 transactions as well as version 6."
- "No new value may enter the Orchard pool: v^OrchardPoolBalance ≥ 0."
- Also: "zcashd will not implement the consensus changes for NU6.3", so Zebra is the only full validator.

What the design does (step5/zec/src/main.rs):
- `BRANCH = BranchId::Nu6_2` and `TxVersion::V5` are used for building, sighash and node verification (lines 41, 145, 415).
- **Fund** (line 370): Bob spends his wallet Orchard note and pays the *new joint address* `addr_j`. That is a cross-address Orchard transfer, so it is invalid. Funding it from transparent or Sapling would make `valueBalanceOrchard < 0`, which is also invalid.
- **Sweep** (line 557): spends the joint note to Alice's address. Also cross-address, so also invalid.
- The proof is built with orchard 0.15.5's verifying key. Post-NU6.3 nodes select a different VK (the one with the enableCrossAddress bit). So even an otherwise-valid tx would fail verification.
- The simulated node enforces none of these rules (no cross-address, pool-balance or Ironwood logic).

Reproduction: `review3/tests/nu63_check.sh` → `nu63_check.out.txt`. It shows BRANCH = Nu6_2, V5, a fund to `addr_j`, a sweep to `to`, and "NONE" for NU6.3 rules. There's nothing to run on-chain: by consensus, neither transaction can ever be mined.

Impact:
- The protocol can't complete. If Bob somehow made a valid-looking funding tx, it would never confirm, so this is liveness, not theft.
- Every Zcash-side test result (fund, sweep, adaptor sweep, reorg, expiry, Z-depth checks) was validated against superseded rules.
- The rehearsal plan can't be written for this construction, because testnet runs NU6.3 too.

Fix (redesign, then re-audit):
- Port the Zcash leg to the **Ironwood pool**: v6 transactions (ZIP 229), branch ID 0x37A5165B, Ironwood anchors, note plaintext lead byte 0x03, and ZIP 2005 key derivation.
- ZIP 2005 permits ak from "any suitably secure method" (e.g. a FROST-style DKG) via the `use_qsk` path, so the ak = A_p + B_p split key can survive. But both parties must privately agree on a shared `sk`, from which nk and qsk/qk are derived. Consequences:
  - Both parties hold qsk. That breaks the "post-quantum recoverability" property of the joint note for the counterparty, so document it.
  - The nk/rivk commit-reveal must be re-derived from the agreed sk, and the setup transcript and DLEQ binding re-specified.
  - The y-sign normalisation of ak must satisfy Ironwood's ak encoding rule.
- Re-implement the sim against Zebra's NU6.3/NU7 rules, or a librustzcash version with Ironwood. Rerun all groups. Re-audit the adaptor-on-RedPallas path with the Ironwood circuit/VK.
- Anonymity set: Orchard now holds ~7% of shielded value versus ~83% in Ironwood, and every Orchard action is now a withdrawal or same-address change. Staying in Orchard would also be a strong fingerprint.

---

## HIGH

### R3-H1. NU7 transition is not handled. The timing and the cap assume steady-state 25 s blocks.

All v1 numbers assume "post-NU7". Problems:
1. **A swap that spans NU7 activation breaks.** Signatures commit to the consensus branch ID. A Zcash tx signed pre-activation that confirms post-activation (fund, or Alice's sweep made with b) is invalid. If Alice's sweep is the casualty, she must rebuild under the new branch before Bob's refund path opens, and the budgets don't include that.
2. **Difficulty-adjustment recovery.** After the 75 s → 25 s change, block times run long (roughly 30-57 s) for hours. Gamma check (`tests/model3.py`):

   | Block time | 99.9% time for Z = 60 | vs 68.8 min budget |
   |---|---|---|
   | 25 s | 36 min | OK |
   | 45 s | 65 min | Marginal |
   | 57 s | 82.5 min | **MISS** |

   A miss is a liveness failure (Alice withholds go past T0, then refunds), not theft. It is still a predictable failure window.
3. **Stale rate.** 25 s blocks raise the stale/orphan rate to an estimated 3-5%. That raises the attacker's effective share (see R3-H3).
4. **Un-upgraded nodes.** A party running a pre-NU7 node (or pre-NU6.3, and zcashd stops at NU6.2) can be fed a minority chain cheaply. The spec doesn't require a node version or branch-ID check.
5. **Wallet expiry.** Post-NU7 wallets default to an expiry delta of about 120 blocks. A hard-coded tip+40 becomes a fingerprint (C.1).

Fix:
- Blackout: no swap whose [setup, T2 + settle] window is within ±24 h of any Zcash or Cardano hard fork.
- Both wallets check their node version and the current branch ID at setup and again before each signature.
- Derive the ZEC budget from the *measured* recent block interval (fail closed if it's above 1.5× nominal).
- Make expiry follow the wallet default for the active era.

### R3-H2. Cardano deadline races assume benign inclusion. The mempool is FIFO, with no fee priority, and the secret is public once broadcast.

Bob's Redeem reveals b in the mempool. If it misses T1−1, Alice sweeps the ZEC with b *and* refunds the ADA. Symmetrically, Alice's Refund reveals a. If Bob's Punish lands first after T2, Bob gets the ADA and recovers his ZEC with a.

The node's mempool is FIFO, so paying more cannot buy priority (cardano.org, learncardano). When it's full, new transactions are refused (Cardano Blueprint). With current parameters (90,112 B body, 16,384 B tx, 44 lovelace/B + 155,381), keeping every block full costs about 4.8 ADA per block:
- **~$11 per 240 s sim window**
- **~$88 per 32.5 min real M window** (at ADA $0.188)

So an attacker can raise the probability that Bob's in-flight Redeem misses T1 for less than $100 per attempt, against a $15k prize. This isn't guaranteed: Bob's transaction still drains FIFO once a producer has it. But the D = 60 s / M budgets are sized for benign congestion, not an adversary. The timelock-bribery class (bribing SPOs to omit one transaction for M) applies too.

Fix:
- Size M for adversarial delay and state the assumption explicitly.
- Bob broadcasts Redeem only when his node's mempool is below ~50% capacity, and submits directly to several SPO submit endpoints as well as his own relay.
- Alice must not *start* a Refund broadcast after T2 − M (add a `LAST_REFUND` symmetric to LAST).
- Simulate an adversarial-spam ledger mode in the sim; today's `held` set models delay but not adversarial back-pressure.

### R3-H3. The value cap passes its own ε by only 2 blocks and ignores the main real-world risks.

`valuecap.mjs`: reversalP(0.35, 60) = 7.87e-4 against ε = 1e-3. The minimum Z for ε is 58. Sensitivity (`tests/model3.py`, plus valuecap's own functions with q changed):

| Assumption | P(Z = 60) | Z needed for ε = 1e-3 |
|---|---|---|
| q = 0.35 (memo) | 7.9e-4 | 58 |
| q_eff with 3% stale (NU7) | 1.4e-3 → **cap = 0** | 64 |
| q_eff with 5% stale | 2.1e-3 | 69 |
| q = 0.40 | 2.7e-2 | 133 |
| q = 0.478 (top-2 pools: ViaBTC + Foundry, recent shares) | ~0.6 | 511 |
| q ≥ 0.5 (top-3 ≈ 0.62; ViaBTC alone was ~68% in Feb 2026) | 1 | none |
| q = 0.35 with a 10-block pre-mined private lead (selfish-mining start; ~1,000 attempts, roughly cost-neutral for q > 1/3) | 1.5e-2 | — |

Other problems:
- **"½·Z·revenue" is not a cost to a pool that owns hashpower.** If the attack succeeds, the pool keeps its private-chain rewards. If it abandons early, it loses only a few blocks. The term caps value by a heuristic, not by what an attack costs.
- **ε is per swap.** With 100 swaps at 1e-3, P(at least one reversal) ≈ 9.5%. With 1,000 swaps, ≈ 63%. A policy for repeat counterparties is missing.
- **Cardano side:** Rosenfeld applied to Praos (α = 0.15, K = 15) is the wrong model (multi-leader and empty slots, Δ-delay forks). Use Gaži-Kiayias-Russell practical settlement bounds. K = 15 at 15% is likely fine, but it is unproven.
- **Inputs:**
  - $523/block = 0.41667 ZEC × $1,254.54 is arithmetically correct. ZEC was ~$1,190-1,270 in mid/late October 2026, so the price is reasonable for today.
  - 35% largest pool is right for today only.
  - Stale price or pool-share data are not fail-closed in code: the constants are hard-coded with `asOf`, and there is no check on their age.
  - A 40% ZEC price drop moves the cap at Z = 60 to $9.4k.

Fix:
- Use q_eff = q / (q + (1−q)(1−stale)) with stale ≥ 3% post-NU7.
- Use the **top-2 coalition share** (or 0.40, whichever is larger) as q for v1, or cap v1 lower.
- Make the cap depend on a pool-share feed and refuse when any single pool is above 35% or the top-2 are above 50%.
- Have the wallet refuse if the price or pool data are more than 24 h old.
- Add a lifetime-exposure counter per counterparty.
- With Z = 60, the honest statement is "safe against any single pool ≤ ~34% with ~3% stales". **Today's top-2 pools together could reverse a Z = 60 swap with probability ~0.6.**

---

## MEDIUM

### R3-M1. Free options and griefing are still asymmetric (review2 F9).
- Alice's option runs from Bob's funding until T0 (up to ~85 min in v1). At ~100% annualised ZEC volatility, an at-the-money option over 85 min is worth ≈ 0.4·σ·√t ≈ 0.5% of notional, about **$75 per $15k swap**, for free.
- Bob has a shorter option (from go until LAST).
- Alice can also delay her refund until near T2, locking Bob's ZEC for about 2.6 h at no cost to herself.

Fix: shorten T0 for v1, add an optional premium or deposit, and rate-limit counterparties who abort.

### R3-M2. B.3 (own-node dry run, submit only there) is the real F2 safeguard and it is not built.
- If Bob submits through a third-party API, a phase-2 failure of Redeem could happen after b has left his machine.
- The strict checker models the node with `libsodium-wrappers-sumo` 0.8.4 (JS/wasm). cardano-node uses the IntersectMBO libsodium fork through cardano-crypto-class. Byte-level agreement on edge cases (small-order R/A, non-canonical encodings, S ≥ ℓ) is assumed, not tested against the real builtin.

Fix: build B.3 first in the rehearsal plan. Add a vector test against a local cardano-node or the Plutus CEK builtin when that is allowed.

### R3-M3. The T2 Refund/Punish race (secret in the mempool).
After T2 both Refund and Punish are valid. A Refund pending at T2 hands a to Bob, who can then race Punish and keep both legs. Honest Alice is no worse off than if she never refunded, but the design should say so and add `LAST_REFUND = T2 − M` (see R3-H2).

---

## LOW

### R3-L1. The F1 check accepts a lock output carrying a reference script (REPRODUCED).
`review3/work/ada/adv3.mjs r3` → `tests/adv3-refscript.out.txt`: a lock with the canonical datum plus a 1,217-byte reference script → `bobChecksLock` returns **ACCEPTED**.

Impact:
- Conway charges reference-script bytes on *spent* inputs, so Alice can attach up to ~14 KB and make Bob's Redeem and Punish pricier (tiered, ≥ 15 lovelace/B, ≈ 0.2+ ADA).
- It fingerprints the swap.
- It is nonzero risk if a future era changes how ref scripts on inputs are handled.

Fix: B.1 must pin the whole output (address, value, inline datum bytes, **`scriptRef` = none**). Simplest is to compare the full serialized TxOut against Bob's canonical rebuild.

### R3-L2. Cardano hard forks.
- Slot length has been 1 s since Shelley, and T2 is far inside the 36 h safe zone (no PastHorizon).
- An intra-swap hard fork (protocol version is now [11,0]) can still change cost models or fees. M allows "one change"; the blackout in R3-H1 covers more.

### R3-L3. Other F1 sub-points (no new issue)
- Multiple lock UTxOs, or a second lock by Alice: harmless, because go binds one outref.
- Replacing or front-running the lock after K: only possible through an α-rollback (already in the K budget).
- Datum hash vs inline: hash is refused.
- Stake or pointer credentials: refused by the credential check plus full address equality.
- Multi-asset dust: refused (exact-lovelace check).
- Note: `bobChecksLock` checks the txHash but not the output *index* agreed. That's harmless, because go binds the outref and Alice's own signature picks it.

---

## Status of review1 findings
| ID | Status (review3) |
|---|---|
| C-1 pinned Redeem body | Fixed (go = message over outref). c1fee/c1cost pass in the rerun. |
| C2 sim confirms expired tx | Fixed (StrictLedger drops slot ≥ ttl). |
| C3 Alice's coins via go-sign policy | Fixed/moot. |
| H-1 Δ must include settlement | Fixed in rule. Adversarial inclusion is not modelled (R3-H2). |
| H-2 Zcash Z | Fixed in code. The model is still optimistic (R3-H3), and the Zcash leg is invalid post-NU6.3 (R3-C1). |
| M-1 address string compare | Moot. |
| M-2 PastHorizon/TTL | Fixed. |
| M-3 expiry = 0 | Fixed (tip+40). Becomes a fingerprint post-NU7 (R3-H1). |
| M-4 setup-channel confidentiality | Open, documented. A leaked transcript proves the link. |
| M-5 counterparty keeps FVK | Open, inherent. Under Ironwood both also hold qsk (R3-C1). |
| M-6 sim gaps | Partly fixed. **New gap: the sim enforces superseded Zcash consensus (R3-C1)** and has no adversarial congestion. |
| L-1 proof replay | Fixed (l1 21/21 in the rerun). |
| L-2 bounds | Holds. |
| L-3 go deadline drift | Fixed. |
| L-4 wording | Fine. |
| L-5 metadata | See privacy. |
| L-6 front-running | Holds in the sim. Real-chain FIFO adds R3-H2. |
| L-7 rogue key / malleability | Holds (PoK enforced). Must be redone for the Ironwood key derivation. |

## Status of review2 findings
| # | Status (review3) |
|---|---|
| F1 datum hostage | **Fixed.** The byte-exact canonical check works for every variant I tried, plus hash/stake/value. Gap: reference script (R3-L1). |
| F2 lax Ed25519 / go key | **Fixed in sim/design.** B.3 is unbuilt. Node-implementation equivalence is untested (R3-M2). |
| F3 mean-based budgets | Fixed (Gamma 99.9% verified at 25 s). Breaks during NU7 DAA recovery (R3-H1). |
| F4 slack / Bob's clock | Fixed (R = 5 min, drift 1 min). OK. |
| F5 vacuous go tests | Fixed (per the step-5 tests; not re-derived). |
| F6 value cap | **Implemented, but the model is unsound at the margin** (R3-H3). |
| F7 hex case | Fixed (seenhex group). |
| F8 tag / extra fields | Fixed by F1. |
| F9 free option | Inherent. Quantified at ~0.5% of notional (R3-M1). |
| F10 lock rollback | OK. |
| F11 1-slot bound gap | Holds, safe. |
| F12 PoK | Confirmed. Must be redone for Ironwood. |
| F13 rogue key | None on Orchard. Re-check under ZIP 2005 key derivation. |
| F14 encoding consistency | OK. The JS overlay re-implements the 129-byte message independently. |

## Timing-model verdict
- **Arithmetic is correct.** For steady-state 25 s blocks, the Gamma 99.9% quantiles and budget = max(2.5·mean, q99.9) check out. LAST = T1−1−M, T1 ≥ T0+1+M+R and T2 ≥ T1+M+1 are sound orderings. R = 5 min and drift = 1 min are reasonable.
- **Not sound for real conditions:** the NU7 transition (branch-ID invalidation, DAA recovery, stale rate) and adversarial Cardano inclusion. These are liveness failures, except R3-H2, which can turn into loss (b leaked, Redeem late).
- Required: hard-fork blackouts, measured block intervals, and an adversarial M.

## Value-cap verdict
- **FAIL as specified for v1** ($15k at Z = 60). It holds only for one pool at ≤ 35% with zero stales, and today's top-2 pools could reverse it with P ≈ 0.6.
- **Rehearsal tier:** $500 at Z = 10 with ε = 0.25 is acceptable *for testnet money only*. It is moot until R3-C1 is fixed.
- John's rule "depth ≥ max(58, 2·value/$523)" should become at least max(64, …) with stales, and should be paired with a live pool-share gate.

## Privacy verdict
- **Cardano side (swap id, go message, datum): PASS cryptographically.**
  - swap_id is a hash of the transcript. A_c, B_c, go_vk and the pkhs appear in the inline datum, but they don't link to Zcash without the setup transcript (M-4).
  - The go signature is made under a fresh one-time key.
  - The shared script hash makes every zeUTXO escrow recognisable. That is the anonymity set by design.
  - The tight time correlation between Cardano lock/redeem and Zcash fund/sweep heights still leaks.
- **Zcash side: must be redone.** The Orchard pool is withdrawal-only and small (~7% of shielded value), so any Orchard swap traffic would stand out. Ironwood v6 and the post-NU7 expiry convention change the fingerprint analysis.

## Test-integrity verdict
- The step-5 suite reproduces on a clean copy: 269/269 (`review3/rerun-all.log`, `work/results/e2e3-all-*.json`). I found no vacuous checks in the F1/F2/cap groups I read, and the strict overlay really is code-separate from Bob's check (its own message rebuild and its own libsodium instance).
- **But the 269 checks give no assurance about the real Zcash chain.** The sim validates NU6.2 rules that no longer apply. The strict checker is a *model* of cardano-node's builtin (same library family as Bob's check, not the node).
- The value-cap tests confirm the formula, not its inputs.

## Fixes, in order
1. **R3-C1:** port the Zcash leg to Ironwood (v6, ZIP 2005 `use_qsk` with agreed sk, new branch/VK). Rebuild the sim against Zebra NU6.3/NU7 rules. Re-audit the adaptor and DLEQ binding. Rerun everything.
2. R3-H1: hard-fork blackout (±24 h), node version and branch-ID checks, measured-interval budgets, era-appropriate expiry.
3. R3-H2: adversarial M, a mempool-saturation gate before Redeem, multi-SPO submission, `LAST_REFUND`, and a spam mode in the sim.
4. R3-H3: q_eff with stales, a coalition-aware q, a live pool-share and price gate (fail closed if older than 24 h), and a lifetime-exposure counter. Re-derive the v1 cap and Z.
5. R3-M2: build B.3 (own-node dry run, single submission path) before any rehearsal.
6. R3-L1: pin the full TxOut (no scriptRef).
7. R3-M1/M3: shorter T0, an optional premium, and documentation of the T2 race.

## Reproductions (all under review3/)
- `tests/nu63_check.sh` → `tests/nu63_check.out.txt` (R3-C1)
- `work/ada/adv3.mjs r3` → `tests/adv3-refscript.out.txt` (R3-L1)
- `tests/model3.py` → `tests/model3.out.txt` (R3-H1 Gamma, R3-H2 spam cost, R3-H3 sensitivity, compounding, pre-mining)
- `rerun-all.log`: full step-5 suite on a copy (`node e2e3.mjs all`)

## Sources (web, read 2026-11-02)
- ZIP 258 (NU6.3 deployment): https://zips.z.cash/zip-0258
- ZIP 2005 (Ironwood quantum recoverability)
- ZIP 218/259 (NU7)
- cardano.org fees page, learncardano.io fees, the Cardano Blueprint mempool page, cardanoscan protocol parameters
- Zcash mining-pool share statistics and the Cointelegraph report of ViaBTC at ~68% (Feb 2026), as gathered earlier in this review
