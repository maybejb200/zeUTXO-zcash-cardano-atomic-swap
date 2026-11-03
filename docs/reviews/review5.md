# zeUTXO step 8: adversarial review 5

Reviewer: review5 (separate adversarial pass), Nov 3 2026, ET. Scope: step8 spec v0.6, escrow v0.7 (`escrow.ak`), the wallet gates (`policy7.mjs`, `policy8.mjs`), the e2e4 simulator, the timing model (`step8_model.*`), D23–D34, plus a read-only check of the NU7 claims in the rehearsal research.
How it was done: box simulator only. step1–8, review1–4 and rehearsal/ are untouched; all work is on copies in `review5/sim`. Every key is a fresh throwaway; I read no old witnesses or nonces. There were no network transactions.

## Verdict: CONDITIONAL PASS

I found no on-chain bug that lets either party steal. The escrow script held against every bundling, datum and validity-interval attack I tried. One wallet-policy design flaw is **High**. Bob's "fail-closed" Reveal HOLD can push b into the last hour before T3. At that point a censor needs only about 55 minutes of censorship to take both legs, where the design assumes 7 days. This must be fixed before the testnet rehearsal. Three Medium items should also be fixed before the rehearsal.

## Tests added (all in the simulator)

| Suite | Result |
|---|---|
| `tests/r5_escrow_tests.ak`, added to a copy of `escrow.ak` | `aiken check`: **76/76 pass** (71 original + 5 new: r5_a1…a5). See `results/aiken_r5.txt` |
| `tests/e2e5_groups.mjs` → `sim/ada/e2e5.mjs r5_hold_to_t3` | **17/17**: attack reproduced (theft of the honest party), plus a control |
| `e2e5.mjs r5_fake_refunding` (run with `R5_BOB_RICH=1`) | **9/9**: attack reproduced (a revealed on a non-escrow UTxO) |
| `tests/gates5_test.mjs` | 12 probes: **2 safe, 10 findings** (H1, H2, N1–N5, P1, T1, MA). See `results/gates5_test.*` |

## Findings

### HIGH

**R5-H1: the Reveal HOLD runs out at T3 − M, which reopens cheap censorship theft.**
*Plain English.* Bob's wallet waits ("HOLD") to reveal b while the Cardano mempool is more than 50% full or while it can't measure how much stake would include his tx. That wait only ends M (55 min) before T3. If the condition lasts that long, b goes out in the last hour. Alice can watch the mempool, take b, and sweep the ZEC. If Bob's Reveal is then kept out of blocks for about 55 minutes, Alice Escapes at T3 and takes back the ADA as well. The 7-day tail was meant to make censorship cost 7 days. With the HOLD, it costs less than an hour.
*Triggers.* All of these are cheap or free for the attacker: an eclipse or DoS of Bob's node or relays (the probe returns "unknown", which HOLDs), a broken stake probe, organic congestion, or paid spam of about 4.4 ADA per block (about $25k/week; free if congestion is organic).
*Evidence.*
- `r5_hold_to_t3` (17/17): directStake was unknown, so the gate held for 62 blocks. The first allowed broadcast came 260 s before T3 (M = 240 s). A 600 s censorship of Bob's Reveal then let Alice read b, sweep the ZEC and Escape the ADA. The honest Bob lost both legs. CONTROL: with the same censorship window, a Bob who reveals right after his Commit settles is safe.
- Gate probe H1 at the real profile: the hold lasted 6.96 days and the first allowed reveal came 54 min before T3.
*Fix.*
- Bound the HOLD to a short time after the Commit settles (for example ≤ 1–2 h, at most a small fraction of the tail). After that, broadcast b over every channel available: own relays, third-party submit APIs and several SPO endpoints.
- Treat "probe unknown" as "broadcast after the cap", never as "wait".
- Add a hard late-reveal cutoff (for example T3 − 2 days). Past it, the wallet alarms and still reveals, and the expected loss is shown as tail-limited.
- Add an e2e test that runs the HOLD all the way to T3. The current HOLD test only spams until T2.

### MEDIUM

**R5-M1: RefundReveal provenance is checked by datum, value and a label, not by "the Notice spent my lock outref".**
*Plain English.* Before Alice reveals a, she should be sure the Refunding UTxO really is her escrow after her Notice. Bob can make a plain payment to the script address with a perfect-looking Refunding datum and the full value. The simulator wallet accepted it as "my Notice settled" and revealed a while the real escrow was still Open. The spec's W.7 ("never reveal a on any other UTxO") does not say how to check this. The simulator checks it with `/^(notice|bobnotice)/.test(tx.label)`, a label that a real chain does not have. `refundRevealGate` only takes a bare `datumOk` boolean.
*Impact.* The fake costs Bob V. With Alice's real Notice censored, though, he gets a and also keeps the right to Commit/Reveal or to wait. Combined with stale wallet state during a Claimed phase, this can become a free unwind. It is mostly unprofitable, but it breaks an invariant.
*Evidence.* `r5_fake_refunding` 9/9; probe P1.
*Fix.* In W.7, require all of the following before revealing a:
- the Refunding UTxO's creating tx has the lock outref (or the Claimed UTxO that Bob's Notice spent) among its inputs, with redeemer Notice;
- that tx is ≥ K deep;
- the Notice lineage is followed back to the lock outref that Bob verified at funding.
Pass the outref chain to `refundRevealGate` instead of a boolean. Add the fake-UTxO test to the suite.

**R5-M2: NU7 era and block spacing are asserted by the caller, so a configuration slip fails open.**
*Plain English.* `valueCap7` trusts an `era` string, and `nu7Gate7` trusts a `nominalSpacing` number. Neither is read from the node.
- If a post-NU7 swap is labelled "now", the wallet accepts Z=62 instead of 69 (probe N1).
- The same mislabel makes the wallet count the block reward as 1.25 ZEC instead of 1.25/3, so the economic bound is three times too high. A $13.5k swap at a ZEC price of $900 passes when it should be refused (N2).
- With a stale nominal spacing of 75 s after NU7, the wallet accepts a measured spacing of 100 s (four times slower than the 25 s target) (N4).
With mainnet NU7 days away, this is exactly the kind of slip that will happen.
*Fix.*
- Derive the era from the node: tip ≥ `nu7_height` (3,543,405 on mainnet, 4,465,026 on testnet) and consensus branch 0x77190AD9. Derive the nominal spacing from the era.
- Refuse if they disagree with any value supplied in config.

**R5-M3: the rehearsal profile and timing model are out of date for post-NU7 testnet.**
*Plain English.*
- `step8_model.json` still has the rehearsal at Z=10 with 75 s Zcash blocks and a 112.5 s gate spacing. Testnet has been post-NU7 since height 4,465,026 (Oct 4), with 25 s blocks.
- The spec's `zec_branch` is 0x37A5165B, which is NU6.3 (pre-NU7).
- The gate code itself is right: the post-NU7 floor is Z ≥ 30 (probe N7 refuses Z=10).
- The v1 timing model hard-codes Z=69. That is enough for $15k only if ZEC ≥ about $1,043 (0.5 × 69 × 0.4167 ZEC × price). Below that the gate correctly refuses, but the model's T0/T1 would then be wrong for the Z actually needed: 90 at $800, 144 at $500 (N3).
*Fix.*
- Regenerate the rehearsal profile: K=15, Z ≥ 30 at 25 s (a 37.5 s gate spacing), branch 0x77190AD9, Zebra ≥ 7.0.0, v5/v6 transactions only (v4 is rejected after NU7, ZIP 2003).
- Have the model compute Z = max(minZ, economic Z at the feed price) and derive T0…T3 from it, or cap the value at the price.

### LOW

**R5-L1: T3 race.** Once T3 has passed, both Reveal and Escape are valid (Aiken r5_a1), and `revealGate` returns null ("go"), which is probe H2. If Bob is that late, b goes into a race Alice can win by sweeping. *Fix:* the gate should refuse or loudly warn at ≥ T3 − M. This is covered by the cutoff in H1.

**R5-L2: the NU7 blackout and upgrade window do not cover the 7-day tail.** `swapSeconds` = T2 + 24 h (100,026 s). A swap that starts about 4.5 days before activation is allowed, and its tail then crosses NU7 (probe N5). This is liveness only: sweeps have no deadline, and the note's depth is already final. Still, the post-NU7 sweep then needs NU7 transaction formats and branch id. Separately, **Zebra 7.0.0 has an 8-week support window** (released Oct 22, so it halts around mid-December). A tail that crosses that date needs the node upgraded first. *Fix:* set swapSeconds = T3 + margin, and add "node end-of-support height > T3 + margin" to the gate.

**R5-L3: removing Punish makes stalls free.** Bob can sit until T3 − M, and Alice can sit until t4 − M, at no cost. With Alice absent, Bob's refund now takes about 7.2 days instead of hours. This is accepted economics (D29), but John should know that every abandoned swap locks capital for a week. *Fix:* document it, and optionally limit the number of concurrent swaps per counterparty.

**R5-L4: min-ADA on Notice.** The Notice datum grows by 8 bytes (t4 changes from 0 to a 13-digit millisecond time), which adds 34,480 lovelace of min-ADA at 4,310 lovelace/byte. The value has to stay the same, so a lock at exactly min-ADA could never Notice. That is irrelevant at 1000 ADA, but W.1 should require lock value ≥ minADA(Refunding datum) + margin (probe MA).

**R5-L5: test quality.**
- Three e2e4 checks are constant `"observe", true` (probe T1).
- R13, N4 and N5 are source-grep checks, not behaviour tests.
- The HOLD test stops at T2, so it would never have found H1.
- The fork model is a single block deep.
- Wallet ownership and provenance (`ownRefunding`) relies on simulator labels.
*Fix:* replace the constants with real assertions, add the two review5 e2e groups, add a multi-block fork that is reorganised at both K−1 and K, and derive provenance from inputs.

**R5-L6: timing correlation** (known, L-5 in the earlier reviews): still present, nothing new.

### Checked and found sound
- Commit and Notice windows are disjoint (Commit before T1, Notice from T1).
- `n_in == 1` plus the exact continuing output blocks double satisfaction for Commit and Notice (r5_a2 and r5_a3 reject bundling).
- Bundling terminal actions across two escrows is harmless, because each needs its own beneficiary's signature (r5_a4).
- Bob's Notice can push t4 by at most 6 h (r5_a5).
- t4 ≥ inclusion + full tail. There is no re-Notice.
- Every redeemer needs the actor's signature, so there is no front-running by third parties.
- D33 (relaxed T2) is liveness only and is sound. D34 (Alice accepts Bob's Notice) is bounded by the TTL of the creating tx.
- Rollbacks shallower than K are safe (sim). Deeper than K, and the case of about 100% stake censoring for 7 days (R-1), remain stated residuals.
- The mempool leaks b or a only after the matching state is K deep, which is the intended design. H1 is where that assumption breaks.

## NU7 check (read-only web, Nov 3 2026)
- **ZIP 259 / zips.z.cash:** NU7 branch id 0x77190AD9. Activation heights are testnet 4,465,026 (reached Oct 4 2026) and mainnet 3,543,405, which is expected around **Nov 5–6 2026**; the height decides, not the date. After activation, blocks are 25 s and v4 transactions are rejected (ZIP 2003). These match the rehearsal research.
- **Zebra:** 7.0.0 was released Oct 22 2026. It activates NU7 on mainnet, has an 8-week end-of-support halt and upgrades the database from v28 to v29. 7.1.0-alpha.0 came out Oct 30. The maximum reorg is 1000 blocks (about 6.9 h at 25 s), far above Z.
- **Step 8 consistency:**
  - The blackout is correct for the activation. It refuses v1 swaps from roughly 4.5 days before NU7 (pre 1,152 + swap 4,003 blocks, counted conservatively) to 24 h after (3,456 blocks at 25 s) (probe N6). In practice, no v1 mainnet swap until about Nov 6–7.
  - K=15 on Cardano is unaffected by NU7.
  - The post-NU7 Zcash floors (30 for the rehearsal, 69 for v1 via minZ with stale 0.05) are correct in code.
  - Three things are not yet correct. The era and spacing are trusted, not derived (M2). The rehearsal profile and spec `zec_branch` are still pre-NU7 (M3). Z=69 only covers $15k at ZEC ≥ about $1,043 (M3).

## Fix before the testnet rehearsal
1. Bound the Reveal HOLD and add a late-reveal cutoff (H1, L1). Add the hold-to-T3 test.
2. Check RefundReveal provenance through the Notice tx's inputs back to the lock outref (M1).
3. Derive the era, branch and spacing from the node (M2).
4. Regenerate the rehearsal profile for post-NU7 testnet: K=15, Z≥30 at 25 s, branch 0x77190AD9, Zebra ≥ 7.0.0, v5+ transactions. Have the model compute Z from price (M3).
5. Extend the blackout and upgrade window to T3 + margin, including Zebra's end-of-support height (L2). Add the W.1 min-ADA rule (L4). Remove the constant-true tests (L5).

## Summary for John
The on-chain escrow is solid: I couldn't break it. The real problem is in Bob's wallet. Its "be careful, wait for a quiet mempool" rule can make Bob wait almost the whole 7 days before revealing his secret. Then anyone who can block his transaction for just one hour can let Alice take both coins. Cap that wait at an hour or two, and the 7-day protection works as intended. Two smaller fixes are also needed:
- Alice's wallet must check that the "refund" coin really came from her own escrow, not just that it looks right.
- With Zcash's NU7 upgrade landing this week, the wallet must read the network era from the node rather than from settings. The rehearsal settings also need updating for the new 25-second blocks.
Fix those, and step 8 is ready for the testnet rehearsal.
