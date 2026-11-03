# ZEUTXO v10 report: redesign after review 5 (RV5-C1)

**FINAL** (Mon Nov 2, 2026, ~10:05 AM ET). All times are America/New_York (ET). [M] = measured in the emulator or Aiken this session; [E] = estimate or paper argument.
Scope: box and emulator only. No nodes, no network transactions, no wallets, no real keys, no GitHub, no outside messages. GGLori was not touched.

## Verdict: PASS on the four emulator criteria, conditional: the review was done by the same agent, not an independent one

| Criterion | Result |
|---|---|
| 1. INVARIANTS.md complete | **Met.** e2e10/INVARIANTS.md: assumptions A1–A6; Q, I1–I7; tokens T1–T5; well-formedness W; liveness L1–L5; settlement S1–S5; re-derivation of the v6–v9 Criticals. The addendum covers D-79..D-83 (I1', I1'', S5). |
| 2. Fuzzer clean over N runs | **Met on the fixed core.** 48 batches / 14,400 adversarial cases in total, with 17 violations, **all from the first two campaigns on the pre-fix core**. All are triaged: F1 → D-79, sink outputs → D-81, branch deposit (F2) benign → oracle exemption. After the fixes: **26 batches / 7,800 cases, 0 violations [M]** (seeds 1200–1208, 2200–2208, 1300–1301, 2300–2301). Rollback6 itself was fuzzed (16 redeemer mutations, 13 accepted honest-equivalent cases, 0 violations). Seeds and op/ctor coverage are in e2e10/fuzz/batch_*.json. |
| 3. All prior exploits fail | **Met.** Regression + RV5 port: **149/149 as expected [M]** (rv3, rv4 port and hand tests, the wf negatives, the RV5-C1 exploits with honest controls, the v10 extension/payout negatives). Both full chains **137/137 as expected on Mainnet and Testnet data [M]**, including the v6 s78/s83/s86 replays and 16 new D-80/D-82/SR-H1 steps. |
| 4. Self-review: no open Critical or High | **Met, with a caveat.** The review found one High (SR-H1, below), now fixed and regression-tested. The remaining findings are Medium/Low and accepted (e2e10/SELF_REVIEW.md). **The same agent that wrote v10 did this review**, as a structured non-author pass; no independent reviewer was available. Earlier history: each of reviews 2–5 found a Critical the author had missed. So this PASS is **not** a substitute for review 6. |

Mutants ([M], e2e10/mutants10.json; see the caveat):
- 59 guards mutated: 32 killed + RB_jmax, RB_fee, RB_ckpt_D82 and RB_tip_leaf killed on re-run.
- Survivors:
  - 15 are the known v9 layered guards.
  - The rest are new guards covered by another check: EXT_height_gt/popcount/opeak_len/ext_elem_len/count_gt/n_ge_1 (all implied by `bag` + the exact `ext_fold`), RB_extension/cpeaks_bag/queue_empty (each covered by another Rollback6 check; s137 non-empty queue still rejected by another guard). Iso re-run: RB_tip_leaf **killed** (s123) [M], and SINK_exact_D81 (covered by the fuzz oracle, which flagged it before the fix and 0 times after; there is no hand regression).
- WF_A7: harness pattern error, not run.

Sizes and memory [M]:
- Propose: 19.5 % mem, 2,787–2,921 B.
- Rollback6: 4.9–5.5 % mem, 2,294–2,370 B.
- Max mem per tx unchanged from v9: register 88.8 % main / 90.7 % test.
- ext length ≤ 5 (main) / 6 (test).

## What changed in v10 (D-77..D-83, in /workspace/zeutxo-decisions-log.md)
- **D-77 (RV5-C1, Critical).** `extends10` is an inductive append-only MMR extension.
  - The base peaks are bound by bag + popcount. The `ext` blocks must fold exactly to the candidate peaks.
  - So no Propose can rewrite a leaf ≤ prev_height. Disputes cover exactly (prev_height, height].
- **D-78.** Fuzzer, regression, port and mutant infrastructure. Paid stall re-derived: **≈ 22.7k ADA per 7 days [E]**. The free stall is still 18.67 h [E].
- **D-79 (fuzz F1, Low).** Payouts must be ADA-only with no reference script.
- **D-80 (SR-H1, High, liveness; also in v9).** New `Rollback6`.
- **D-81 (fuzz, Low).** Sink outputs must be exact: no stake part (so burned ADA can't be staked by the attacker), ADA only, no reference script.
- **D-82 (self-review of D-80).** A rollback must cite the canonical's own checkpoint, whose datum must match exactly. That allows at most one rollback per finalized tip, so the canonical is never more than 24 leaves below the latest checkpoint. This removes chained deep rollbacks.
- **D-83 (settlement vs rolled-back checkpoints).** Harmless; no code change [E].
  - Checkpoints are immutable, never spent, and fully PoW-valid (I6). Rollback can't remove one.
  - A proof against a rolled-back checkpoint counts at most 24 stale blocks. The real-chain depth is therefore ≥ **306 / 966**, not 330/990, which A3 already covers.
  - Requiring a canonical-lineage checkpoint was rejected: settlement would have to read the contended anchor, and in-flight proofs would break.
  - Rule: min_conf ≥ A3 depth + rollback_max.

## SR-H1: a valid but stale tip froze the relay for good (fixed by D-80/D-82)

The attack:
1. Propose an entry that ends in a real orphaned block. It has valid PoW, so it can't be disputed.
2. Behind it, add a young fake entry with inflated chainwork, held "not idle" by self-disputes.
3. No drop is possible, so the stale tip finalizes. Append-only history then means no honest branch can ever be added.

Cost: about 900 ADA [E]. No theft, but every swap falls back to t_fb.

The fix:
- With an empty queue, `Rollback6` moves the canonical back by j ≤ 24 leaves to a proven ancestor.
- The caller supplies the canonical peaks, the ancestor peaks plus an extension proof, an opening of the ancestor's tip leaf, and the canonical's exact checkpoint ref. It also burns drop_fee.
- Chainwork is not lowered.

Tests on both nets [M]:
- Must fail:
  - freeze: a forked branch below the stale tip without a rollback;
  - no fee;
  - wrong ancestor hash;
  - wrong canonical peaks;
  - j inconsistent with the ancestor;
  - j = 25 with a valid proof;
  - lowered chainwork;
  - forged ancestor peaks;
  - wrong checkpoint ref;
  - a second consecutive rollback;
  - a rollback with a non-empty queue;
  - re-proposing the old tip (not heavier).
- Must pass:
  - an attacker rolls back an honest fresh tip (by design: it costs 250 ADA and the checkpoint UTxO stays live [M]);
  - recovery: a forked branch proposed on the rolled-back canonical.

## Blocked / not done
- **There was no independent review.** The same agent did the self-review. Review 6 by a separate reviewer remains the gate before anything goes on chain. v7–v9 must not be deployed.
- O1–O4 got no paper analysis this run (out of budget).
- D-83 is a paper argument only. A ProveR against a rolled-back checkpoint was not run as a test (no open swap remains at that point in the chain).
- The emulator cannot mine a real stale block. The "stale" region is a stand-in: an honest region plus a forked branch.
- There is no hand regression for the sink output rule (D-81); only the fuzz oracle covers it.
- Mutant harness: WF_A7 hit a pattern error.

## Decision for John
**Accept permissionless `Rollback6` (D-80/D-82), or replace it with k-buried checkpoints?**
- `Rollback6`, as built and tested:
  - Anyone can undo the newest ≤ 24 unconfirmed-by-queue headers for 250 ADA. That is griefing only; settlement depth effectively drops by 24 (D-83).
  - The change is small.
- k-buried checkpoints:
  - Finalize only certifies a header k deep inside its own entry. Nothing is ever rolled back, and no griefing action exists.
  - It is a larger redesign: new Finalize proofs and re-tuned settlement tests, about one more full cycle.
- Recommendation: keep Rollback6 for review 6, and have the reviewer judge both.

## Cycle log
- 08:24 ET: interim report written. D-80 and D-81 implemented; chains are re-running.
- 08:36 ET: both chains 130/130 as expected [M], including 8 new D-80 steps (Rollback6 4.9% mem, 2,294 B [M]). Regression + port 149/149 [M] on the D-80/D-81 core. Checkpoint saved; mutants started.
- 09:13 ET: fuzz campaign on the D-80/D-81 core: 10 batches × 300 cases, 0 violations so far [M]. Mutants 26/~60 done; survivors so far match the v9 layered-guard survivors. SELF_REVIEW.md and the INVARIANTS addendum written. ckpt-0912.
- 09:15 ET: added (c) tests to both chains: SR-H1 freeze regression (a fork below the stale tip can't be proposed without Rollback), j=25 with a valid proof, lowered chainwork, forged ancestor peaks, and an attacker rolling back an honest fresh tip (allowed by design; the rolled-back checkpoint UTxO stays live: offchain check true [M]). Chains re-running.
- 09:17 ET: D-82 added (a rollback needs the exact checkpoint of the canonical, so rollbacks can't be chained). New negatives: a second consecutive rollback, and a wrong checkpoint ref. Chains re-running.
- 09:29 ET: fuzz campaign on the D-80/D-81 core (pre-D-82): seeds 1200–1208 (main) and 2200–2208 (test) = 18 batches, 5,400 cases, 946 accepted, **0 violations** [M]. Rollback6 redeemer mutated 16× (red.Rollback6). The SR-H1 regression was rewritten (the stand-in branch must differ in the rolled-back region); chains re-running.
- 09:48 ET: **both chains 137/137 as expected [M]** on the D-80..D-82 core. All (c) tests pass as intended: SR-H1 freeze negative + recovery, j=25 with a valid proof, lowered chainwork, forged ancestor peaks, wrong checkpoint ref, second consecutive rollback (D-82), non-empty queue, attacker rollback of an honest fresh tip (allowed; 5.5% mem, 2,370 B [M]). Mutants (59, on the D-80 core): 32 killed, 26 survivors = 15 known v9 layered guards + 11 new layered guards (EXT_*, RB_*, SINK); 1 harness error (WF_A7).
- 09:49 ET: regression + port 149/149 [M] on the D-82 core. Started: RB/SINK mutant re-run on the final run file, and a final fuzz campaign (seeds 1300–1303 / 2300–2303).
- 10:03 ET: FINAL verdict written (PASS on the emulator criteria; same-agent review caveat). D-83 logged.
- 10:11 ET: iso mutant re-run: RB_tip_leaf killed (s123), RB_queue_empty survived (covered by another check).
- 1016 ET: final chains re-confirmed; final checkpoint ckpt-1016-v10-final.tgz. STOP.

## FINAL VERDICT after independent review 6 (10:31 AM ET): FAIL
Review 6 (zeutxo-independent-review-v10.md) found **RV6-C1 (Critical) [M]**: a chain of fork entries with valid PoW can't be killed, and a young entry behind them blocks every drop, so the queue never empties and Rollback6 can never run. The attacker's fork becomes canonical for good, at the cost of about one fork block per 6.5 h plus fees, with bonds refunded. Possible theft via a fake burial on the fork [E]. Also RV6-H1: the D-83 24-block bound isn't enforced. Medium: header time has no real-time bound. `extends10` (the RV5-C1 fix) verified sound [M], 33,411 exhaustive cases.
Root cause: fork choice is tied to queue order and age, not to heaviest total work. Fix direction for v11: a real fork tree in which any branch with more cumulative work displaces a lighter one regardless of age (Binocular-style), header times bounded by the Cardano validity interval, and Rollback6 removed. Judged fixable (it is the standard optimistic-relay design), not a fundamental impossibility.
