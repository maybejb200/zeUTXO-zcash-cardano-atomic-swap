# zeUTXO path 1 — step 7 memo (two-step escrow, no premium, fail-closed gates)
Simulator only, on the box. No real chain, testnet, node, wallet or network transaction. Fresh throwaway keys only.
Times are ET. Work ran Tue Nov 3, 1:00 AM to 1:34 AM ET (times taken from file and log mtimes). Weekly usage: 39.1% at the start, 46.6% at 1:30 AM ET.

## 1. Bottom line
The two-step claim escrow is in place and passes the full simulator rerun. The review4 F1 theft (censoring Bob's redeem past T2) no longer works, because the secret b is only revealed after a secret-free Commit has already turned off Alice's Refund.
One honest-loss path remains, and it is the mirror image of F1. Producers censor Alice's Refund, which carries a, until after T2. Bob reads a, sweeps the ZEC, then Punishes. I have written this up rather than patched it (decisions D22(d)).

## 2. Review4 findings
| Finding | Status |
|---|---|
| F1 Reveal censorship → theft | FIXED by v0.6: Commit (no secret) → Reveal (no deadline) → Escape at T1+7 d. Rerun congestion3: safe. |
| F2 premium | REMOVED from code, spec and tests. Alice's free option is now unpriced (0.664%). |
| F3 cap on constant prices | FIXED: the cap uses live feed prices. A ×30 price is refused. A missing, NaN, negative, stale or future feed is refused. |
| F4 spacing fallback / short window | FIXED: at least 48 measured blocks are required, with no nominal fallback. NU7 support must be stated explicitly. |
| F5 other upgrades | FIXED: a generic upgrade-blackout gate; a missing list is refused. |
| F6 "3,613 blocks" label | FIXED: the value is now computed by nu7BlackoutBlocks. |
| F7 memo timestamps | FIXED: they now come from mtimes. |
| F8 test vectors as CI | Open: part of the rehearsal plan. |

## 3. Tests (fresh keys)
| Suite | Result |
|---|---|
| e2e3 simulator, 28 groups (adapted from step 6's 360 checks) | 413 checks: 412/413 on the first full run. The 1 failure was a test-ordering bug in congestion3; after the fix, congestion3 passed 9/9 on rerun. |
| aiken check (review4's 25 + 22 ported + 5 new) | 52/52 |
| Mutation testing | 17/17 mutants killed |
| gates7_test (16 review4 probes + 18 new + 8 positive controls) | 42/42 safe |
| pok_isolated | 10/10 |
| zec node negative tests | 30/30 |
| review4's 70 tp scenario checks | NOT folded in (gap, see selfcheck.md) |
| New griefing groups (stall→Escape, refund-trap fork, Refund-censorship CONTROL) | NOT written (gap) |

## 4. Timing (real v1, 37.5 s gate profile, minutes after setup)
- Go deadline T0 = 144.7.
- Bob's last Commit = 149.7. T1 = 179.6 (step 6: 204.6).
- Alice may start a Refund at 192.1 and must have it out by 197.1. T2 = 252.1 (step 6: 264.6).
- If Bob commits and then stalls, Alice can Escape at T1 + 7 days. Her capital is locked about 7.1 days, which costs about $14 on a $15k swap.
- Bob's free option from go to T1 = 34.9 min ≈ 0.33%. After he commits, his option is 0.

## 5. Costs (simulator, mainnet params)
- Lock: 0.178 ADA.
- Commit: 0.295 ADA (2,674 B; 0.94% mem, 1.78% steps).
- Reveal: 0.273 ADA (2,292 B).
- Bob now pays two transactions, about 0.57 ADA in total.
- ZEC fund and sweep: 10,000 zats each.
- Script: 1,880 B, hash 13a3c6e0…

## 6. Prior-art check (Rapidash, He-HTLC, DEMBA)
- **Censoring or bribing against the Commit near T1:** abort only, and no principal is lost.
- **Censoring the Reveal:** stealing needs every producer to censor for 7 days. There is no burn path like Rapidash's, so collusion of Alice plus ~100% of stake is a stated residual.
- **Censoring the Refund until T2:** this is a real honest-loss path, needing all producers for about 55 min. It is exactly what Rapidash's two-step refund defends against. See D22.

## 7. Open
- The Refund-censorship residual.
- The tp_* tests and griefing groups not written.
- spec.md not yet rewritten for v0.6.
- No independent review.
- No real Zebra/Ironwood validation.

## 8. $500 testnet rehearsal: outline only, NOT executed
1. Own Zebra node on testnet. Validate use_qsk and the Ironwood sweep for real (R3-M2 own-node dry run).
2. Run the F8 vectors as CI against that node.
3. Cardano preprod: deploy the v0.6 script and run happy, refund, punish, Commit→Escape (with T3 shortened by a rehearsal-only parameter) and the Commit-rollback controls.
4. Fresh throwaway keys from faucets only. Budget ≤ $500 of test-value equivalent, rehearsal tier, Z=10 at 75 s.
5. Pass if every simulator expectation reproduces and the cost is within 20% of the simulator figures.
6. Stop on any unexpected acceptance, any loss of funds, or a node/consensus mismatch.

Running nodes or sending any testnet transaction needs John's separate explicit go-ahead.

## 9. Changed files (step7/)
- ada/onchain/validators/escrow.ak (v0.6)
- ada/policy7.mjs (new)
- ada/e2e3.mjs
- ada/nodecheck.mjs
- zec/src/main.rs (v5 domains, t3, window, spacing=)
- zec/neg_tests.sh
- model/step7_model.py (new)
- tests/gates7_test.mjs (new)
- decisions.md (D14–D22)
- selfcheck.md
- memo.md
- progress.md
- results/*

## 10. The one decision for John
Should I adopt the symmetric two-step refund (RefundIntent with no secret, which turns off Commit and Punish, followed by RefundReveal{a} with no deadline, with a Bob fallback after 7 days)?
It closes the last known honest-loss path. The cost is a third Cardano transaction on the refund path and a second 7-day griefing tail. My recommendation is yes, before any testnet rehearsal.
