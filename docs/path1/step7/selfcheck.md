# Step 7 self-check — NOT INDEPENDENT
Written by the same executor that wrote the code (Tue Nov 3, 2026, ~1:35 AM ET). Use it as a checklist for a real reviewer, not as a review.

| # | Claim | How checked | Result |
|---|---|---|---|
| 1 | Commit carries no secret; Refund disabled after Commit | happy: no a/b in any redeemer; Refund on spent Open → BadInputs; Refund{a} on Claimed → script fail (congestion3) | pass |
| 2 | Reveal has no deadline, so review4 F1 (censor Reveal past T2) is no longer theft | congestion3 rerun: Reveal censored until T2+120 s, settles after | pass |
| 3 | Late Commit rolled back after T1 costs nothing | rbredeem CONTROL1 | pass (no loss) |
| 4 | "Reveal only after Commit is K deep" is necessary | rbredeem CONTROL2 (rule broken → loss) | pass (expected loss shown) |
| 5 | Commit can't be front-run, replayed, or redirected | happy, gomsg (other signer, replay on Claimed, output to a key) | pass |
| 6 | Value cap follows live feed; all gates fail closed | gates7_test 42/42 (16 review4 probes), cap group 24/24 | pass |
| 7 | Premium fully removed | premium group 3/3, gates7 P1/P2 | pass |
| 8 | Contract | aiken check 52/52, mutation 17/17 killed | pass (run 1:04–1:08 AM ET) |

## Known gaps (honest)
- review4's 7 tp_* scenario groups (70 checks) were NOT folded into e2e3; their substance is covered by happy/refund/congestion3/rbredeem/gomsg, but not their exact checks.
- Dedicated griefing groups NOT written: Bob stalls to T3 then Alice Escapes (covered by aiken tests + escapeGate probes only, not end-to-end in the sim), refund-trap fork CONTROL, Refund-censorship-to-T2 CONTROL (the residual in decisions.md D22(d) is argued, not simulated).
- spec.md was not rewritten for v0.6; decisions.md D14–D22 is the current spec delta.
- Simulator only: Ironwood/use_qsk was never validated on a real Zebra node.
