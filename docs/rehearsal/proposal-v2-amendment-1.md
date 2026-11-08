# Rehearsal proposal v2, amendment 1 (Nov 8, 2026): needs John's re-approval

This amendment changes one approved setting in `proposal-v2.md`. Nothing else in v2 changes.

## Why
The Nov 8 audit (finding A1) found that the 2-hour refund tail cannot satisfy the wallet's own reveal-timing check
(`revealParamsCheck` in `src/ada/policy9.mjs`). The check needs a late cutoff ≥ M and hold cap + cutoff + M < tail.
With M = 54.9 min, a 2-hour tail would need a cutoff of at least 55 min and also a cap plus cutoff below 65.1 min, so
no cap value works. The published values (cap 12 min, cutoff 34 min) are refused by the wallet. They also put the
GO-RACE alarm (T3 − 55 min) before GO-LATE (T3 − 34 min).

## Change
| Setting | v2 | Amendment 1 |
|---|---|---|
| Refund tail (rehearsal-only `T3_MIN`) | 2 h | **3 h** |
| Bob reveal hold cap | 12 min | **18 min** (10% of the tail) |
| Late-reveal cutoff | T3 − 34 min | **T3 − 60 min** (≥ M) |
| T3 after setup | ≈ 239 min | ≈ 299 min |
| t4 (Alice Notices / Bob Notices) | ≈ 299 / 346 min | ≈ 359 / 406 min |

Source: `src/model/step9_model.py` → `results/step9/step9_model.json` (`rehearsal_nu7_K15_Z30_tail3h_min`), and
`P9.rehearsal` in `src/ada/policy9.mjs`. The test `tests/step10/fixes_test.mjs` (A1a–A1c) checks that all three agree and pass.
Each rehearsal swap still takes well under a day, so the Zebra end-of-support margin in v2 §3 is unaffected.

## Approval sentence change
In proposal-v2 §7, replace "Use a rehearsal-only 2-hour refund tail" with
"Use a rehearsal-only 3-hour refund tail (hold cap 18 min, late cutoff T3 − 60 min) per proposal-v2-amendment-1.md".
