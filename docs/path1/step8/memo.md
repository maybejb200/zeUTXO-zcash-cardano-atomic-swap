# zeUTXO step 8 — memo for John (3 Nov 2026, ET)
Everything here ran on the box simulator only. No testnet, mainnet, nodes, wallets, real transactions or messages.
Fresh throwaway keys every run. step1–7 and review1–4 untouched; all work is in step8/.

## What changed (plain English)
1. **The refund now has two steps, like the claim.** Before, Alice's refund itself carried her secret `a`. Producers could
   sit on it until Bob's Punish time, then let Bob take the ADA while he also read `a` and took his ZEC back. Now:
   - **Notice** (Alice, from T1): says "I'm refunding". It carries no secret. It locks out Bob's Commit for good and
     starts a 7-day clock (t4 = Notice + 7 days, written into the escrow).
   - **RefundReveal** (Alice): she reveals `a` and gets her ADA back. No deadline other than t4. Her wallet does it only
     once the Notice is 3 blocks deep (15 on mainnet), and never later than t4 − M.
   - **Forfeit** (Bob, after t4): he takes the ADA only if Alice never revealed.
2. **Punish is gone.** If Alice goes silent, Bob sends the Notice himself from T2, waits the 7 days, then Forfeits. So
   censoring Alice's refund can't make her miss a deadline any more. Her refund has no start deadline at all.
3. **Escrow contract v0.7.** 12 datum fields (new: t4), 6 actions, 2,445 bytes. The old one-step Refund and Punish are
   removed.
4. **Timing is shorter.** T2 only matters for Bob's liveness now, so it dropped from 252 to 227 min (v1 profile).
5. **Spec rewritten in full** (spec.md v0.6 = contract v0.7). The premium is still removed. Decisions D23–D34 are in
   decisions.md.

## Tests (all on the simulator)
| Suite | Result |
|---|---|
| Aiken contract unit tests | 71/71 pass |
| Mutation tests (deliberately broken contracts) | 30/30 caught |
| Wallet-gate probes (gates8_test) | 58/58 safe, 0 fail open |
| PoK isolation (Rust) | 10/10 |
| End-to-end, 41 groups (incl. Zcash node rules 30/30) | 593 checks: 591 passed on the full run. The 2 failures were out-of-date expectations in old tests (datum field count, old T2 rule). Fixed and both groups re-run: f1 24/24, timing 25/25 |
| New in step 8 | Bob stalls to T3 then Alice Escapes 19/19; refund-trap fork 17/17; refund censored 14/14; both refund steps censored 12/12; Alice stalls after Notice 10/10; Commit-vs-Notice race 18/18; refund 30/30; silent Alice (old punish) 14/14; refund rollbacks 14/14; refund timing 11/11 |
| review4 scenario groups ported | 7 groups, 72 checks, all pass |

The three missing griefing tests are done. (1) Bob stalls to T3: Alice escapes without ever revealing `a`, and Bob loses
his ZEC. (2) Refund-trap fork: a hidden pre-T1 Commit wins a fork. If Alice breaks the 3-block rule, she loses (CONTROL
shows the rule is needed). If she follows it, she never reveals `a` and the swap just completes. (3) Refund censored:
Alice's Notice was censored until well past T2, then went through, and nobody lost anything. That was a loss in step 7.

## Timing & costs (mainnet-style v1 profile, minutes after setup)
T0 144.7 · last Commit 149.7 · T1 179.6 · T2 227.1 · honest refund finished ≈ 249.5 · T3 ≈ 7.12 days.
Worst-case lockup for anyone ≈ 7.2 days, and it can happen at most once per swap. ≈ $14 capital cost on $15k.
Free options are unchanged: Alice 0.664 %, Bob 0.326 %.
Cardano fees (sim, mainnet params, ADA $0.188): Lock 0.178 · Commit 0.320 · Reveal 0.298 · Notice 0.313 ·
RefundReveal 0.299 · Forfeit 0.288 · Escape 0.288 ADA. All under $0.07 each. A refund now costs 2 txs (≈ 0.61 ADA ≈ $0.12).
Zcash: fund and sweep 10,000 zats each.

## Open risks (honest)
- **R-1 (residual):** if close to 100 % of Cardano stake censors a secret-carrying tx for the whole 7 days (Bob's Reveal
  before T3, or Alice's RefundReveal before t4), the colluding other party can take both legs. The CONTROL tests
  demonstrate this. There is no burn or deposit defence; I judged one not worth the added complexity.
- Forks deeper than K blocks are outside the model, the same assumption as before.
- **use_qsk / Ironwood key derivation has not been checked against real Zebra/zcashd.** Only our own simulator has
  checked it.
- **selfcheck.md is not independent.** I wrote both the code and the check. Nobody outside has reviewed contract v0.7.
- The simulator's fork model is simple: one competing block just before T1.

## The one decision you need to make next
**Commission a fifth, separate attack review of contract v0.7 and the two-step refund before the $500 testnet rehearsal.**
I recommend the review first, because the refund path is new and has had no independent review. I have started neither.
