# Equihash dispute process and min-UTxO reclaim for the optimistic Zcash→Cardano relay
Mon Nov 2, 2026, ~12:25 AM ET. This is phase 1 of the overnight run.

**Labels used throughout:**
- **[M]** = measured on the box: `aiken check`, or `aiken tx simulate` on unsigned, never-submitted transactions.
- **[E]** = estimate.
- **[D]** = design decision; the logged ones are in `zeutxo-decisions-log.md`.

Code lives in `/workspace/zeutxo-step1-relay-cost/`:
- `aiken/lib/zrelay/equihash.ak`
- `aiken/validators/dispute.ak`
- `aiken/lib/zrelay/groth16_cost.ak`
- `dispute/` (Python reference, generators, simulated txs, `fees.txt`)

## Verdict: PASS (design and core prototype)
A **two-move "reveal, then one-leaf proof" game** replaces both the naive on-chain Equihash check and a 9-round binary bisection:
- **Proposer's move (`Reveal`):** one tx, **13,748 B**, **59.6% memory, 38.6% CPU, 1.78 ADA [M]**.
- **Challenger's move (`ProveLeaf`):** one tx, **2,262 B**, **24.9% memory, 42.2% CPU, 0.97 ADA [M]**.
- **Whole dispute:** about 3–4 txs and under ~4 ADA in fees [M + E for Open]. It lasts at most 2τ = 12 h after it is opened.
- **Sound against any forged Equihash solution** as long as one honest watcher acts within D = 6 h.
- **No trusted setup and no heavy prover needed.**

## 1. Facts this rests on [M]
- I wrote a Python reference verifier (`dispute/equihash_ref.py`) that expresses Equihash as the game sees it:
  - **Leaf value:** leaf p is the 25-byte half of BLAKE2b-400 (personalisation `ZcashPoW`, n=200, k=9) over header140 ‖ le32(i/2), where i = index[p].
  - **Internal nodes:** each internal node is the XOR of its two children.
  - **Collision rule:** a level-j node needs at least 20·j leading zero bits, and the root (level 9) must be all zero.
  - **Index rules:** the left subtree's first index must be less than the right's, and all 512 indices must be distinct.
- **Accepts 20/20 real mainnet headers** (3,538,780 onward).
- Aiken `index_at` and `leaf_value` match Python. 9/9 Equihash unit tests pass.
- **One BLAKE2b compression:** 2,058,686 mem / 2,082,873,031 CPU (12.5% / 20.8% of the per-tx limit). Plutus's `blake2b_256` builtin can't take Zcash's personalisation or 50-byte output.
- **Fake-header cost** (Equihash skipped, SHA256d only): about 2.24×10^12 hashes ≈ 2^41 per header at bits `1b7da58e`.
  - **Correction (Nov 2, review H-3, D-53):** 2^41 is *not* a security barrier. It is about 220 s on one GPU [E]. Fake headers are stopped by Equihash disputes (bonds), not by this per-header PoW.

## 2. Options compared
| Option | On-chain txs per dispute | Rounds / latency | Per-step cost | Setup / prover | Verdict |
|---|---|---|---|---|---|
| A. Full Equihash on chain (non-interactive) | ~129–257 [E] | 1 move, but ~129–257 txs must land inside the window (≥ 2 txs per Cardano block at the 20B block CPU limit, so ≥ ~65–130 blocks) | 513 compressions ≈ 1.07×10^12 CPU [E from M] | none | Too heavy and fragile under congestion |
| B. Binary bisection over the XOR tree | 9 proposer reveals + 9 challenger picks + 1 leaf check ≈ 19 | 18 alternating moves × τ = 6 h ⇒ up to **108 h** | each move tiny; leaf check 42% CPU [M] | none | Sound, but too slow at D = 6 h |
| **C. Reveal + one-leaf proof (chosen)** | **Open + Reveal + ProveLeaf (or Timeout) = 3–4** | **2 moves ⇒ ≤ 2τ = 12 h** | Reveal 59.6% mem / 38.6% CPU; ProveLeaf 24.9% / 42.2% [M] | none | **Chosen** |
| D. Single Groth16 proof on BLS12-381 | Open + one proof-response tx | 1 move (≤ τ) | verifier **7,357 mem / 2,126,607,228 CPU (21.3%)** [M], measured on a Groth16-*shaped* instance whose pairing equation holds but which proves no circuit | circuit-specific **trusted setup**, plus proving R1's ~26.65M-constraint circuit (box can't: 15 GB RAM, ~2 GB free) | Optional later upgrade; trust in the setup conflicts with the trustless goal unless it comes from a multi-party ceremony |

**Why C is sound.** In the `Reveal` tx, the contract re-checks every XOR and leading-zero rule over the 512 claimed leaves, then stores a Merkle root of them.
- If the real solution is invalid, any set of leaves that passes those rules must contain at least one leaf that differs from its true BLAKE2b value. Otherwise the true leaves would pass, making the solution valid.
- The challenger finds that leaf off-chain and proves it in one tx: a 9-sibling Merkle path plus 2 compressions.
- A proposer who can't produce consistent leaves can't `Reveal` at all, and loses on Timeout.
- Index-rule breaks (a duplicate index, or wrong ordering) are proven directly from the header in one cheap tx: 59k–69k mem [M].

## 3. Game rules (as prototyped in `validators/dispute.ak`)
**Datum fields:** `header_hash` (sha256d of the disputed header), `proposer`, `challenger`, `phase` (`Opened` or `Revealed{root}`), `deadline`, `tau`.

**Actions:**
| Action | Who | Phase / timing | Checks / effect | Measured [M] |
|---|---|---|---|---|
| `Reveal{leaves}` | proposer | `Opened`, upper bound ≤ deadline | 12,800-byte blob → tree rules → Merkle root; moves to `Revealed{root}`, deadline = upper bound + τ | as above |
| `ProveLeaf{header, p, leaf, path}` | challenger | `Revealed` | sha256d(header) = header_hash; leaf is in root; leaf ≠ true value; pays the pot to the challenger | as above |
| `ProveDup{header, a, b}` / `ProveOrder{header, j, a}` | challenger | any phase | index rule broken; pays the pot to the challenger | — |
| `Timeout` | anyone | lower bound > deadline | `Opened` → challenger wins; `Revealed` → proposer wins | 0.6% mem |

**Not prototyped yet:** the `Open` step, which is a relay-anchor transition [E ≈ inclusion proof plus anchor spend ≈ 5–7% mem, ≈ 0.6 ADA]. It must:
- show the header is in the candidate (header bytes plus a Merkle path to the candidate's batch commitment);
- lock B_c;
- move B_p from the anchor into the dispute UTxO;
- mark the candidate disputed.

**Negative tests that FAIL as expected [M]:**
- inconsistent leaf blob rejected at `Reveal`;
- `ProveLeaf` against an honest header, both in a unit test and in simulation;
- `ProveLeaf` with a wrong Merkle path;
- `Timeout` before the deadline;
- `Reveal` after the deadline.

**Positive tests [M]:**
- honest `Reveal`;
- fraud caught: a forged solution with one index changed, where the proposer reveals consistent but false leaves;
- duplicate-index and ordering frauds caught;
- `Timeout` after `Reveal` pays the proposer.

**Simulated txs:** `dispute/txsim/*`.

## 4. Timing, bonds, liveness [D, rationale in the log]
- **Challenge window W_c = 6.5 h** after a candidate is proposed. That is D = 6 h for an honest watcher to get `Open` mined, plus 30 min for detection. Detection is milliseconds of off-chain Equihash per header plus reading Cardano. **D-06**
- **τ_reveal = τ_prove = D = 6 h.** Worst case after `Open` is 12 h, during which the disputed candidate can't finalize.
- **Bonds:** proposal bond **B_p = 1,000 ADA**, challenge bond **B_c = 250 ADA**. The winner takes both. **D-07**
  - **Is cheating ever profitable?** With at least one live honest watcher, a forged candidate never finalizes, so the attacker gains 0. Each attempt costs B_p plus the fake headers' SHA256d work: with "about 10^10 SHA256d/s per high-end GPU" [assumption, not looked up], that is ≈ 224 GPU-seconds per header [E]. Any B_p > 0 makes cheating unprofitable. **B_p is sized for the other two jobs: paying watchers and pricing griefing.**
  - **Paying watchers.** An honest challenger's worst-case cost is `Open` (~0.6 ADA [E]) + `ProveLeaf` (0.97 ADA [M]), about 1.6 ADA. With 10× fee headroom that is ~16 ADA, so B_p = 1,000 ADA is ~60× the cost: a strong watcher reward.
  - **Pricing griefing.** A forged candidate that out-weighs the honest chain delays finality by up to W_c + 12 h. 1,000 ADA per ~18 h of delay makes sustained griefing expensive. A fake challenger costs the honest proposer one `Reveal` (1.78 ADA [M]) plus up to τ of delay, and forfeits 250 ADA, about 140× the proposer's cost.
  - **Capital.** An honest relayer has ≤ ~8 pending proposals at once (see §5), so ≤ 8,000 ADA is bonded [E]. Tunable.
- **Liveness assumptions (all must hold for safety):**
  - at least one honest watcher online who can land a Cardano tx within D;
  - Cardano doesn't censor that watcher for more than D;
  - the headers are public (they are, in the branch-mint tx redeemers).
- **Liveness only (no loss of funds if these fail):** at least one honest relayer keeps extending the real chain. If none does, the relay stalls; swaps that rely on it fall back to their refund paths.

## 5. Anchor changes required [D, designed; not yet prototyped]
1. **Pipeline instead of one candidate.** The prototype's single candidate resets its timer on every heavier proposal, so a growing chain would never finalize. Replace it with a **queue of up to 8 pending entries**, each extending the previous one, each with its own W_c timer. A heavier *conflicting* fork may replace the queue from the fork point. A successful dispute against entry i drops entries i and later. Finality lag ≈ W_c + proposal cadence ≈ 7 h [E].
2. **Accumulator.** Replace "last 16 batch roots" with a **Merkle Mountain Range over batch roots** (≤ ~20 peaks) in branch and anchor state, so that:
   - inclusion and dispute proofs work at any depth;
   - "the candidate descends from canonical" is one MMR membership proof.

   Cost: ≤ ~20 sha256 per batch [E], negligible next to the ~6.4M memory per batch [M].
3. **Full window state stays in the anchor's canonical tip** (W=102 → ~1.9 KB datum [M size]). Any fork can then restart from canonical without old branch UTxOs, which makes pruning safe.

## 6. Reclaiming the ~4,000 ADA/day min-UTxO lockup [D, designed; not yet prototyped]
The lockup comes from 432 batches/day × ≈ 9.2 ADA [M+E, step 1], because branch UTxOs are never spent.
- **Rolling extension:** the owner of a branch tip *spends* it while extending (burning the old token, minting the new one), so each relayer keeps one rolling UTxO.
- **Reference extension** stays available for forks, but each new branch UTxO records an `owner`.
- **Reclaim:** anyone may spend a branch UTxO and burn its token once anchor canonical height ≥ tip height + K_prune. K_prune = queue depth in blocks + 1 day. The min-ADA goes to `owner`. Dead forks are handled the same way once canonical passes their height. This works because the anchor copies every state it needs at `Propose` time (§5.3), so nothing references old branch UTxOs.
- **Result [E]:** steady-state lock ≈ (active relayers + ≤ 8 queue entries) × ~9.2 ADA ≈ < 150 ADA total, instead of growing ~4,000 ADA/day.

## 7. Remaining gaps
| Gap | Status | Note |
|---|---|---|
| `Open` + anchor pause + pipeline queue + MMR | not prototyped | §3, §5 |
| `Reveal` at 59.6% memory | above the 50% comfort bar, under 100% | Fallback [E]: two-tx reveal, 256 leaves each with a half-tree check, plus a combine step |
| GPU hash-rate assumption | not measured | Only affects griefing cost, not soundness |
| Groth16 path | needs a trusted setup and a large prover | Kept only as a future option (step 3 direction) |
