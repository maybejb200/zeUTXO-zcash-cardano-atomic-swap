# zeUTXO step 9: review 5 fixes + post-NU7 update (memo for John)

Tue Nov 3, 2026 (ET). Simulator only: no network transactions, nodes, faucets or wallets. Fresh throwaway keys only.
No GitHub, no outside messages. Step 1–8, review 1–5 and rehearsal/proposal.md were not modified.
**The on-chain escrow did not change** (v0.7, hash 0ed9e054…0087e0). Every fix is in the wallet logic (`ada/policy9.mjs`, `ada/e2e9.mjs`).

## Review 5 findings and status
| Finding | What was wrong | Fix | Status |
|---|---|---|---|
| **H1** (high) | Bob's wallet could hold his reveal indefinitely ("mempool busy"/unknown inputs). An attacker could keep it holding until T3, where Alice's Escape races it. | Hold at most **90 min** after Commit settles (≤10% of the tail); unknown inputs → broadcast; from **T3 − 2 d** broadcast with a warning; race alarm from T3 − M. | **Fixed.** review5's attack ported: it now fails (Reveal settles long before T3; Escape is rejected). |
| **M1** (medium) | Alice could be tricked into revealing `a` for a fake "refund" coin that only looked like her escrow. | Alice checks the tx that created the coin actually spent *her* lock, used the Notice redeemer, and that the coin is the escrow's single continuing output with exact datum and value. | **Fixed.** Fake coin refused; real refund still works. |
| **M2** (medium) | Era, branch and block spacing came from settings, not the node. | Read from the node; refuse on any mismatch or unknown; depth computed from the actual era. | **Fixed.** |
| **M3** (medium) | Settings were pre-NU7; Z was a hard-coded 69. | Post-NU7 settings (branch 0x77190AD9, height 3,543,405, 25 s blocks, v5+ txs, Zebra ≥ 7.0.0, rehearsal K15/Z30). Z now = max(security 69, 2V/(R·P), floor 30) from the live ZEC price. | **Fixed.** |
| L1 | Race at T3 can't be removed off-chain | Only reached if every earlier broadcast is censored; alarm + multi-channel | Known, documented |
| L2 | Blackout too short; Zebra end-of-support | Blackout = setup → T3 + 24 h; refuse if node EOS unknown or before T3 + 24 h | **Fixed** |
| L3 | Free stalls (up to ~7.2 d lock-up for fees only) | — | **Accepted** (D45) |
| L4 | A lock could be too small to refund | Min-ADA rule: lock ≥ minADA(refund output) + 2 ADA | **Fixed** |
| L5 | Always-true / grep-only tests | 3 constant-true checks made real; gates9 probes are behaviour tests; multi-block fork test added | **Mostly fixed** (gates8's R13 grep probe not converted) |
| L6 | Timing correlation links the two chains | — | **Known** (D46); the hold cap makes it slightly worse in busy periods |

**Block reward (for Z):** miners get 1.5625 ZEC × 80% = 1.25 ZEC per 75 s block today; NU7's 25 s blocks divide that by 3 → **0.4167 ZEC/block**.
Z needed for a $15k swap: ZEC $2000 → 69, $1254 → 69, $1043 → 70, $800 → 90, $500 → 144, $300 → 240. Rehearsal ($500 cap): 30 at any price.

## Tests (all on the box simulator, fresh keys)
| Suite | Result |
|---|---|
| Full end-to-end rerun (`e2e9 all`: all step 8 groups + 6 new step 9 groups) | **683/683** after one fix. The only failure was a step 8 test that matched the *old* HOLD message text; behaviour was correct; regex updated, group rerun 19/19. |
| New: hold-to-T3 attack (review5 port) | 11/11, attack fails |
| New: HOLD running to T3 | 24/24 |
| New: fake refund coin | 13/13, refused |
| New: era from node | 23/23 |
| New: multi-block forks | 14/14 (a fork deeper than K still loses, as designed) |
| New: min-ADA | 4/4 |
| Gate probes, review5 ported (gates9) | 13/13 safe (was 12 probes with findings) |
| Gate probes, step 8 (gates8) | 58/58 safe |
| Aiken on-chain tests | 71/71; with review5's 5 adversarial tests added: 76/76 |
| PoK isolation (Zcash side) | 10/10 |
| Mutation test | not rerun (script unchanged; step 8: 30/30 killed) |

## Timing and costs
- **Real v1 (post-NU7, slow-block gate):** T0 ≈ 2.4 h, T1 ≈ 3.0 h, T2 ≈ 3.8 h; 7-day tail. Worst-case lock-up 7.2 days. NU7 blackout per swap ≈ 8.2 days.
- **Rehearsal (K15/Z30, 2 h tail):** T1 ≈ 2.0 h, T3 ≈ 4.0 h, slowest path (silent Alice) ≈ 5.8 h.
- **Fees (simulated, unchanged from step 8):** Lock 0.178, Commit 0.320, Reveal 0.298, Notice 0.313, RefundReveal 0.299, Forfeit 0.288, Escape 0.288 ADA; ZEC fund or sweep 0.0001 ZEC.
- **Grok Bot usage:** 54.9% at start → 58.1% at the end of step 9 (weekly limit resets Mon Nov 9, 6:37 PM ET).

## Honest open risks
- Censorship by almost all Cardano stake for the whole window still defeats any off-chain rule (R-1/L1).
- A Cardano fork deeper than K after Commit can still lose funds (R-2, the meaning of K).
- Free stalls (L3) and timing correlation (L6) remain.
- Everything is simulator-only. The prebuilt simulated Zcash node couldn't be rebuilt offline, so its version and end-of-support come from a test wrapper, not from real Zebra.
- Zebra 7.0.0 support ends about **Dec 17, 2026**. The rehearsal must start by about Dec 10, or use a newer stable Zebra.
- review5 has not re-checked these fixes. That needs a sixth review.

## The one decision
**Recommended:** approve the testnet rehearsal per `rehearsal/proposal-v2.md`, ideally starting after the usage reset on Nov 9 and before Dec 10. The approval sentence is in proposal-v2 §7. The alternative is another independent review (review 6) of the step 9 fixes first. That is cheaper and catches logic errors, but it cannot test real Zebra.
