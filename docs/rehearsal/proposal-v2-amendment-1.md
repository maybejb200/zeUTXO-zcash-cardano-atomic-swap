# Rehearsal proposal v2, amendment 1 (Nov 8, 2026): approved by John (3-hour tail)

This amendment changes one approved setting in `proposal-v2.md`. Nothing else in v2 changes.

## Why
The Nov 8 audit (finding A1) found that the published 2-hour rehearsal settings fail the wallet's own reveal-timing check
(`revealParamsCheck` in `src/ada/policy9.mjs`). The check needs a late cutoff ≥ M and hold cap + cutoff + M < tail.
With M = 54.9 min, a 2-hour tail needs a cutoff of at least 54.9 min and a cap plus cutoff below 65.1 min. The published
values (cap 12 min, cutoff 34 min) are refused by the wallet, and they put the GO-RACE alarm (T3 − 55 min) before GO-LATE
(T3 − 34 min). A 2-hour tail can pass only with a cap of at most about 10 min and a cutoff of about 55 min, which leaves
6 seconds of slack and makes GO-LATE and GO-RACE fire at almost the same moment. (Correction, Nov 8: an earlier version of
this note and the audit said no 2-hour setting passes. That was wrong.)

The smallest tail that passes at all is just over 2·M ≈ 110 min, with a near-zero hold cap. Any tail between that and
3 h works if the cap and cutoff are chosen to fit, e.g. 2.5 h with cap 15 min and cutoff 60 min (20 min of slack).
3 h was chosen because it leaves 47 min of slack in case the rehearsal measures slower blocks and M has to grow.

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

## Status
Approved by John on Nov 8, 2026 ("Go with 3"), after the 2 h, 2.5 h and 3 h options above were laid out. The rehearsal uses
the 3-hour tail, 18-minute hold cap and T3 − 60 min late cutoff.
