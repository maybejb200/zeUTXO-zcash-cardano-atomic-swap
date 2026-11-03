# zeUTXO status — Mon Nov 2, 10:35 AM ET
**Verdict: FAIL.** v10 fixed review 5's Critical (verified), but independent review 6 found a new Critical: valid fork blocks can capture the relay for good. Next step: v11, a heaviest-work fork tree (see zeutxo-v10-report.md, final section). Weekly usage is spent; resets 6:37 PM ET.

# ZEUTXO: morning summary for John (Mon Nov 2, 2026, updated ~5:55 AM ET, covers v7 + v8 + v9)

**Goal:** a private ZEC↔ADA swap where nobody has to be trusted.
**Where it ran:** box only, in an emulator or as local unit tests. Nothing was sent to any chain. No nodes, no wallets, no real keys, no GitHub pushes, no messages. GGLori was not touched.
**Labels:** [M] = measured, [E] = estimate, [W] = from a web page, not verified. Earlier summaries are backed up at <BOX_HOME>/zeutxo-backups/zeutxo-morning-summary.md.0223-v6, .0354-v7 and .0500-v8.

## v10 update (~10:05 AM ET): read this first
- **Verdict: PASS on the four emulator criteria, conditional.** The adversarial self-review was done by the same agent, so it is not independent. Full report: /workspace/zeutxo-v10-report.md.
- **RV5-C1 (Critical) is fixed by D-77,** an inductive append-only MMR extension (`extends10`). Every RV5 exploit now fails, and the honest controls pass [M].
- **The self-review found SR-H1 (High, liveness, also in v9):** a valid-but-stale tip could freeze the relay permanently for about 900 ADA. It is fixed by `Rollback6` (D-80) and the checkpoint binding (D-82): at most 24 leaves, an empty queue only, 250 ADA burned, and chainwork is never lowered.
- **The fuzzer found two Lows:** payouts that carry a reference script or tokens (D-79), and sinks that carry a stake part or reference script (D-81). Both are fixed.
- **D-83 (paper):** a proof against a rolled-back checkpoint counts at most 24 stale blocks. The effective depth is 306/966, which A3 covers.
- **Results [M]:**
  - both chains 137/137;
  - regression + RV5 port 149/149;
  - fuzz: 7,800 cases on the fixed core, 0 violations (14,400 in total; every earlier violation is triaged);
  - mutants: new survivors are all guards covered by another check.
  - Paid stall ≈ 22.7k ADA per 7 days [E].
- **Not done:** an independent review 6 (still the gate), the O1–O4 analysis, and a test-level D-83 check.
- **Decision for you:** keep permissionless `Rollback6`, or switch to k-buried checkpoints? The second is cleaner but costs about one more full cycle.

## Most important first
- **Review 4 (of v8) found two Criticals, so v8 is not sound.** Both came from attacker-supplied bytes that a contract stored and later had to pay to:
  - RV4-C1: the dispute challenger.
  - RV4-C2: the relay-entry owner.
  If either is not a real 28-byte key hash, no payout to it can be encoded, the dispute or entry can never close, and the relay freezes for about 1,000–1,250 ADA. In variant C1(b), junk tokens push a mandatory reveal tx over the size limit.
  Review 4 also found:
  - H1: the exact-mint check had no test.
  - M1: the "bounded stall" claims in D-50/D-60 were therefore false.
  - M2: a fraudster's sockpuppet could kill its own fraud cheaply.
- **This is the fourth review in a row to find a Critical**, and the second from trusting attacker data. So v9 does not just patch the two fields. It **sweeps every datum field, redeemer field and output** in all the contracts. Each one gets:
  - a stated invariant;
  - an on-chain check, or a written reason why none is needed;
  - a negative test.
  The table is in e2e9/wellformedness.md. The main rules:
  - Payees must be 28 B, both when they are stored and when they are paid.
  - Every script output a contract creates must be exact: no stake part, ADA plus exactly the expected token, no reference script.
- **v9 results (emulator, pending re-review; D-70..D-76):**
  - Both full chains pass: 117/117 steps on Mainnet and on Testnet data [M].
  - The regression module gives 69/69 as expected [M]. All of the reviewer's exploits that worked on v8 now fail, and the exact-mint check has its own regressions.
  - Mutants: 28 of 43 caught [M], including the exact-mint check. The 15 survivors are layered duplicates, plus 4 length checks that a proof already enforces.
  - Worst-case RevealA is 9,080 B [E], a 7.3 KB margin.
  - Max mem per tx is 88.8 % / 90.7 % [M].
- **M2 decision (D-72):** the contract can't tell a sockpuppet from an honest watcher, so any watcher reward is also a self-kill discount. I cut the reward to 100 ADA (kill_fee 250 → 900 ADA). A fraud attempt now costs at least 900 ADA however it dies [E]. Safety (no fake checkpoint against one honest watcher) never depended on this.
- **v9 is unreviewed.** A fifth review is the gate before anything goes on chain. v7 and v8 must not be deployed.
- **Zcash NU7 (25 s blocks) is live on testnet. Mainnet activation is at block 3,543,405, ETA ≈ Thu Nov 5 ~9 PM ET [E].** The default confirmation depth after NU7 is 990 blocks (D-64).

## Earlier: review 3 (of v7) → v8
- Review 3 found Critical NEW-C1′: dispute tokens were named only by the header hash, so a token could be leaked and a dispute forged.
- v8 derives a unique token name per Open, requires an exact mint and burn, and allows one dispute per tx (D-65..D-69). All of review 3's exploits still fail in v9 [M].

## v8 mutants, corrected
D-68 said all 12 v8 survivors were harmless duplicates. That was wrong for the exact-mint check in LOpen: it was the only guard and had no test (RV4-H1). In v9 it is caught by rv4_02a/02c (D-74/D-75).

## What changed in v7, and how it was checked
| Item | Fix | Evidence |
|---|---|---|
| NU7 relay (D-56/57) | NU7 difficulty rule: 25 s spacing, 102-block window, testnet min-difficulty rule, branch id 0x77190AD9. Batch drops from 34 to 24 headers per tx so it fits the memory limit | Mainnet data (pre-NU7) and testnet data crossing NU7: 110/110 ledger steps as expected [M]. Peak tx memory 88.6% / 90.5% of the limit [M]. A real min-difficulty (gap > 450 s) testnet block is **not** in the tested data |
| NEW-C1, critical (D-58) | Each relay entry gets a one-shot id from the anchor UTxO it spends. Lane tokens are named from that id, so they can never recur | The reviewer's attack, replayed, fails [M] |
| NEW-H2, high (D-59) | Timestamps come from the validity lower bound, and every deadline-setting tx must have an interval ≤ 10 min. Future-dating is gone | Future-dated and back-dated negatives fail [M]. Each check is caught by its mutant [M] |
| NEW-H3, high (D-60) | The Zcash refund R now carries an expiry height (L_R + 144 blocks ≈ 1 h), so R can only be mined early. Grace is derived from the worst-case stall instead of picked: **21 h** (6 h before). A backup refund R′ has a late lock and no expiry | R mined at its expiry height is provable with the Arm checkpoint [M]. Grace ≥ 20.67 h needed [E] |
| NEW-M1, Reveal size (D-61) | Reveal is split into two txs, each carrying 6,400 B of leaves. A timeout between the two halves is a win for the challenger | Honest and dishonest reveals behave as intended. The level-9 join is caught by its mutant [M] |
| NEW-M2, mutants (D-62) | 20 mutants. 17 caught, including the v6 survivor C2_lane_thread_token | One test was failing for the wrong reason (a generator bug). I fixed it and added a targeted test [M]. 3 redundant checks survive; the reasons are in D-62 |

## New timing (all [E], from e2e7/timing7.json)
- **Max free stall of one honest relay entry: 18.67 h.** Grace is 21 h. A paid stall costs ≈ 25.2k ADA per 7 days. **These were false in v6–v8 because of RV4-C1/C2 (a permanent freeze was possible). With the v9 fix they hold again, pending re-review (D-74).**
- **Confirmation depth (D-64):**
  - The cost of a reorg or rented-hashrate attack scales with the work redone. After NU7, 330 blocks carry only 1/3 of the work (≈ 2.3 h of hashrate), and 330 is below Zebra's new 600-block reorg limit.
  - The default is now **990 blocks after NU7 (≈ 6.9 h)**, which is equal work to the old 330. It is also deeper than Zebra's limit, so nodes would refuse a reorg that deep anyway. 330 stays for pre-NU7 heights.
  - No contract change was needed, because min_conf is already a per-swap field. New swap S7 at min_conf 990: proving R at 966 confirmations is rejected, and at exactly 990 it is accepted [M].
- **Bob's worst free wait from the refund height to Release: ≈ 48.0 h with 990 confirmations** (≈ 43.5 h if you keep 330). This is still far below the fallback time.
- **Relay cost after NU7:** 3,456 headers/day means 144 register txs/day at ≈ 1.5 ADA each, so **≈ 216 ADA/day** [E]. That is about 4× the pre-NU7 figure.

## Still open / remaining gaps
- **v9 is unreviewed.** v7 had a Critical (review 3); v8 had two (review 4). The custom crypto and the dispute game are unaudited.
- **Nothing has run on a real node.** The H-1 fix (2-of-2 plus dual-held refund) and nExpiryHeight have never been tested against real Zcash consensus. The "nodes refuse txs within 3 blocks of expiry" rule comes from zcashd and is not verified for Zebra.
- **No real testnet min-difficulty block has been tested yet.** Memory headroom is about 9.3% (v9); if real data is heavier, the fallback is K = 20 headers per tx.
- **Liveness economics:** a staller who wins every race costs ≈ 25k ADA per 7 days [E]. Swaps must stay well below that, or the bonds must be scaled.
- **Mutant survivors (v9, D-75):** 11 layered duplicates from v8, plus 4 length checks that a proof already enforces. Each layer of the key-hash checks is exercised by a combined mutant.
- **Off-chain-only checks:** the settle escrow datum has no creation script, so Bob's exact check plus `settle_wf` (WF-S0) is the guard. A malformed escrow only harms Alice, who creates it.
- **Remaining review-4 Lows:** L2 (an Open on a dead entry's lane delays LClose, bounded by W_c) is not changed. L1 is fixed by WF-L6, and L3 by D-74.

## Decisions you need to make (plan: zeutxo-testnet-plan.md; nothing in it was run)
1. **Depth:** confirm 990 after NU7 (my recommendation), or allow 330 for small swaps. It is a per-swap parameter.
2. **An external re-review of v9** before any on-chain dispute drill (strongly recommended; v7 and v8 must not be deployed).
3. OK to build and run a **Zcash regtest node on the box**, with no network and no funds (Phase R), to test H-1 and the expiry against real consensus?
4. **Machine and faucets for Zcash testnet + Cardano preview** (Phase T): GGLori (needs a rule change) or a small VPS. Testnet is post-NU7, so the T-steps use 990 confirmations.
5. Accept the post-NU7 relay budget of ≈ 216 ADA/day [E].
6. **M2 parameters:** OK with kill_fee 900 ADA and a 100 ADA watcher reward (D-72)? Alternatives: 1,000 (no reward, maximum fraud cost) or 250 (the v8 value).

Details: zeutxo-decisions-log.md (D-56…D-76), zeutxo-integration-results.md (v7, v8, v9 sections), zeutxo-step2-adaptor-spec.md §12, zeutxo-testnet-plan.md §0b, zeutxo-step1-relay-cost/e2e7/, e2e8/, e2e9/ (wellformedness.md, reveal_worstcase.md).

## Update 6:15 AM ET: review 5 of v9 (zeutxo-independent-review-v9.md)
Verdict: NOT sound for testnet. **Critical RV5-C1 [M]:** `descends()` binds only the prior tip leaf, and disputes cannot target heights at or below `prev_height`. An attacker can Extend with a forged header (fake tx-merkle root) below the tip, finalize it, and then prove a Zcash tx that was never mined to steal the escrow; Equihash never runs on that leaf. Fix direction: an inductive MMR extension (each new checkpoint must commit to the old MMR plus only new, disputable headers) and/or a disputable full history. Also High H1: the adaptor-swap items O1-O4 (FROST hook, BIP-340 parity, cross-group DLEQ, fees) still need outside review. The review-4 freeze class is confirmed closed by the v9 sweep. Work stopped here to save the rest of this week's usage; v10 not started.
