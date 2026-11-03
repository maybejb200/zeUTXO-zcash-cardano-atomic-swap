# zeUTXO path 1, step 8: progress log (simulator only, box only)
Started Tue Nov 3, 2026, ~7:50 AM ET (John's approval: "Yes, add the two-step refund, finish the missing tests and spec, and rerun everything.").
Usage at start: 47.1% of weekly limit. Hard stop ~55%. Priority 1,2,4,6,5,3,7 (memo always).
- [x] S0 copied step7 -> step8 (7:54 AM ET). step7 results moved to results/_inherited_step7/. step1-7, review1-4 untouched.
- 08:05 AM ET: S1 contract v0.7 (71/71 aiken), mutate.py run, policy8 + gates8_test written; e2e4.mjs written (two-step refund, fork(), g8_* groups, tp_* ported). Next: debug e2e4 groups.
- 08:09 AM ET: e2e4 debugged per group (all g8_* pass), full run started 08:07 AM ET -> results/e2e4_all.log; step8_model.py done; spec.md v0.6 rewritten. usage 49.5% at 8:05.
- 08:35 AM ET: full e2e4 run done (593 checks, 2 stale expectations fixed + reruns pass); memo, selfcheck, D33-D34 written. Usage 51.2%. DONE.

## STEP 9 (started 9:18 AM ET, usage 54.9%)
- 9:18 AM: step9 copied from step8. policy9.mjs (H1 cap/cutoff, M1 provenance, M2 nodeEra9, M3 zNeeded9, L2 nu7Gate9+EOS, L4 minAda). e2e9.mjs = e2e4 + fixes + 6 r9 groups (all pass individually: 11+24+13+23+14+4). gates9_test 13/13 safe. Usage 56.3%.
- step 9 done: e2e9 all 683/683 (1 stale-regex fix, congestion rerun 19/19), gates9 13/13, gates8 58/58, aiken 71 (+r5 76), PoK 10/10. model step9_model.json. spec v0.7, D35–D46, memo, rehearsal/proposal-v2.md. Usage 58.1%.
