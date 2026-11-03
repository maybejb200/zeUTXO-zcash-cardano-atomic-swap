# zeUTXO v10 — Independent Adversarial Review (review 6)
Reviewer: independent (not author). Date: 2026-11-02 (ET). Scope: extends10 MMR, Rollback6, INVARIANTS cross-check.
Scratch: /workspace/zeutxo-review6-scratch (fresh extract of ckpt-1016-v10-final.tgz). Emulator/off-chain only.
Legend: [M] measured (test run), [E] estimated (code reading).

## Progress log
- 10:18 ET created file; snapshot extracted.
- 10:20 ET read INVARIANTS.md, SELF_REVIEW.md, D-77..D-83, core10.ak Propose6/Finalize6/Rollback6/extends10/ckpt_summary/settle6.
  Initial reading notes: extends10 fold logic looks structurally right (carry10 merges only when bit s of c is set, blk10 picks the largest aligned block); Rollback6's D-82 gate relies on "a rolled-back canonical never equals a checkpoint datum".
- 10:22 ET params from gen_e2e10.py: W_c 6.5 h, tau 6 h, g_d 1 h, max_queue 8, drop_fee 250, kill_fee 900, bond_p 1000 ADA. accept_c7 time rule: time > MTP and time <= MTP + 5400 s (no wall-clock bound).

## Findings

### RV6-C1 — Relay capture by an unkillable valid-PoW fork entry; Rollback6 is never reachable (Critical: liveness [E, code-level certain]; theft [E])
**Code facts (core10.ak):**
1. Propose6 appends only after `last_summary(canonical, kept)`; dropping needs `list.all(dropped, lower >= e.since + w_c && lanes_idle)` (l.574-577). One *young* entry anywhere in the dropped suffix blocks every drop.
2. Chainwork is compared only with the relay's own queue tail (l.569), never with the real Zcash tip.
3. Kill6 needs a challenger win, i.e. an invalid header. A valid-PoW stale/fork header can never be killed (I4).
4. Rollback6 needs `ad.queue == []` (l.628).
**Attack.** Let the honest tail be X[t]. The attacker mines one fork block Y[t+1] on X[t] (valid PoW, same target as the honest sibling, so `chainwork > C(X[t])`), Extend3s it and Proposes it. Every later Propose must extend Y. Before Y1's entry turns W_c old, the attacker Proposes Y2 = Y1 + 1 more fork block, and so on, one entry per < 6.5 h. Then:
- No honest drop is possible, because the dropped suffix always contains a young attacker entry.
- No Kill is possible, because the headers are valid.
- No Rollback is possible, because the queue is never empty. The attacker keeps ≥ 2 entries queued, so Finalize of the head never empties it, and Finalize+Propose can also be chained in one block.
- The attacker's entries finalize every W_c + g_d, so the canonical walks down the fork.
The honest relayer can only ever extend Y, and it has no Y blocks. Once the fork is more than 24 blocks past the fork point, even a later empty-queue moment does not help, because Rollback6 reaches back at most 24 leaves (D-82: once per checkpoint, each time from the new tip). The relay is permanently captured.
This is exactly SR-H1 (D-80) with the "young fake entry" replaced by a "young *valid* fork entry". SR-M1 priced the blocker at 900 ADA per cycle (kill_fee), which assumes the blocker is killable. A valid fork block is not killable, so the stall costs fees plus one fork block per ~6.5 h, and bond_p comes back at Finalize.
**Escalation to theft [E].** Once captured, the attacker is the only extender. accept_c7 bounds the time only relative to MTP (`time <= mtp_tip + 5400`, header_c7.ak l.128), not to wall clock. So fork timestamps can be warped forward, and the DAA lowers fork difficulty block by block (the attacker only needs `chainwork > tail`, i.e. any positive work). With cheap fork blocks the attacker:
- (a) buries any 32-B txid (the relay checks only the tx-merkle path, not the tx) at depth ≥ 330/990 in a finalized fork checkpoint, so ProveC/ProveR pay out for never-mined txs (S1/S4 broken); and/or
- (b) reaches `rel_height` on the fork, so Arm → Release pays Bob while Alice's real-chain R can't be proven (S2 broken).
**Why INVARIANTS miss it.** L4 ("an honest relayer can always Propose a heavier honest branch eventually … old idle entries are dropped") is false: the drop precondition can be kept false forever by valid entries. A3 (no adversary out-mines honest Zcash) does not apply, because the relay never compares against the honest chain; the attacker only has to out-work its *own* previous entry.
**Fix direction.** Allow a heavier proposal to drop entries regardless of age when it forks below them (compare against the dropped entries' chainwork, not age); or allow drop of a non-head young entry when a heavier sibling exists; and bound header time to the Cardano validity interval (wall-clock), so fork difficulty cannot be time-warped.
**Evidence for RV6-C1.** The building blocks are measured by the author's own emulator steps in this snapshot (reg10_results.tsv, all "pass" = rejected as expected):
- `s57_neg_C2_drop_entry_younger_than_W_c`: a heavier honest branch cannot drop a young valid entry.
- `s137_neg_D80_rollback_with_nonempty_queue`
- `s132_neg_SRH1_freeze_fork_below_stale_tip_without_rollback`: an honest fork below the canonical tip can't be proposed.
**Measured end to end [M] (10:30 ET).** A copy of the harness in /workspace/zeutxo-review6-scratch/full ran gen_e2e10.py plus a new RV6 chain (appended after the author's D-80 section) and `aiken check` on NET=main: 143/143 checks pass, 0 errors.
Changes to the copy: O1 and O2 genesis funds were raised to 50k ADA. Header-validity stand-in: like the author's SR-H1 test, the fork header is emulated with `fake_at`, because the anchor rules never check PoW.
| step | result | mem / cpu |
|---|---|---|
| s139 RV6_01 attacker fork entry Y1 on the honest tail (accepted) | pass | 2.73 M / 0.86 B |
| s141 neg_RV6_02 honest heavier branch cannot drop young Y1 | rejected ✓ | 2.01 M / 0.56 B |
| s143 RV6_03 attacker renews with Y2 before Y1 ages | pass | 2.79 M / 0.88 B |
| s144 neg_RV6_04 honest cannot drop *aged* Y1 because young Y2 is behind it | rejected ✓ | 2.74 M / 0.79 B |
| s145 neg_RV6_05 honest cannot keep Y1 and drop only Y2 (must extend fork) | rejected ✓ | 2.02 M / 0.56 B |
| s147 RV6_06 attacker renews with Y3 | pass | 2.82 M / 0.89 B |
| s148 RV6_07 Finalize honest entry; s149 RV6_08 Finalize **attacker fork Y1 → canonical** | pass | ~1.1 M / 0.37 B |
| s150 neg_RV6_09 honest Rollback6 blocked (queue non-empty) | rejected ✓ | 0.23 M / 0.07 B |
| s151 neg_RV6_10 honest branch can't be proposed on the fork canonical | rejected ✓ | 2.08 M / 0.58 B |
Off-chain model: canonical is the fork Y1 and the queue still holds 2 attacker entries. The cycle repeats indefinitely at one fork block per < 6.5 h, with bond_p refunded at every Finalize.
(Not separately proven: that s144 fails *only* on the age clause. By construction H1 is heavier than Y2, the lanes are idle, drop_fee is paid and extends10 from tRF holds, so the age clause is the only one left. A positive control was not run.)
Liveness capture: **Critical [M]**. Theft escalation: Critical-if-cost-is-low [E, medium confidence]; it depends on fork-mining cost under time-warp, which I did not simulate.

### (1) extends10 append-only: holds [M offchain port + E]
- I ported `extends10/ext_fold/blk10/carry10` and `mmr.ak` (`node/carry/bag`) to Python: rv6/ext_check.py.
  - Exhaustive over all 1 ≤ n < m ≤ 259 (33,411 pairs): every honest extension is accepted.
  - Truncated ext, extra ext and an empty extension (m == n) are all rejected.
  - 3,000 random rewrite/insert-below-n forgeries and every "rewrite leaf n−1 (= prev_height)" case for m < 200: 0 accepted.
- Reasoning: blk10 always picks an aligned block (c % s == 0). carry10 merges only when bit s of c is set, so the newest peak has exactly size s and is the left child. Each step yields the canonical MMR of c+s leaves, so the final peaks force every old peak to be an internal node at its own position.
  - Peak count is pinned by popcount(n), with 32-B peaks and bag == root.
  - Empty extension: blocked by `cm.count > n` and `cand.height > base.height`.
  - Off-by-ones are consistent: Propose n = base.height − base + 1, matching LOpen `base+i > prev_height`; Rollback n = m − j, with new height c.height − j and root = bag(apeaks).
- No finding. Residual: binding relies on node inputs (64 B) differing from leaf preimages (leaf_c over 172 B). Fine under A2.

### RV6-H1 — D-83 "≤ 24 stale blocks counted" is not enforced by any check (High as a claim; folds into C1) [E]
- Nothing on-chain bounds the stale (non-main-chain) suffix of a checkpoint. Rollback6 limits how far the *canonical* can move back (24), not how many fork blocks get finalized.
- A fork entry needs only `chainwork > queue tail` (the relay's own tail), and it can't be killed or (per C1) dropped. So the stale suffix of a finalized checkpoint is bounded only by how many fork blocks the attacker mines. With MTP-relative timestamps (`time <= mtp_tip + 5400`) and DAA easing, the per-block cost of those fork blocks falls.
- Re-extending a stale branch after a rollback: Rollback keeps chainwork, so re-proposing the *same* blocks fails (author's s-neg_D80_repropose test, [M-author]). But the attacker simply appends ≥ 1 new fork block per cycle; the rollback is not even needed.
- So "effective depth ≥ min_conf − 24 = 306/966" has no code basis. The "Rule: min_conf ≥ A3 depth + rollback_max" mixes up the canonical rollback bound with the fork length.
- A3 does not save it, because the relay never compares against the honest Zcash tip.

### Rollback6 races / griefing (Low) [E]
- Rollback vs Finalize/Propose: they spend the same anchor UTxO, so there is no double effect; the loser rebuilds.
  - An attacker can grief each empty-queue moment for 250 ADA. The honest relayer must then re-propose with chainwork > the old tip, which needs ≥ 1 new Zcash block. Low (= SR-L1).
- Chained rollbacks: D-82 holds. A rolled-back canonical {ahash, h−j, C, aroot} can never equal a checkpoint datum: aroot binds all leaves (prefix bits included), so chainwork(A) < C is fixed. Each further rollback needs a new Finalize, so the canonical never sits more than 24 below the latest checkpoint.
- Swaps mid-settlement: settle6 reads only checkpoints (ckpt_summary checks the anchor-policy token named ckpt_name(datum.hash)), never the anchor, so a rollback cannot invalidate an in-flight ProveC/ProveR/Arm. Not a finding, apart from C1's capture case.
- Info: ckpt_summary does not check that the checkpoint sits at the sink address. This is harmless because ckpt tokens are minted only by Finalize, exactly at the sink, and the sink is unspendable.
- 10:31 ET RV6-C1 emulator chain run (above).

### (3) INVARIANTS.md checks that do not exist as named (Low / Info) [M grep]
- **I4** names `prove_dup` / `prove_order`. These don't exist; the code has `equihash.prove_index_dup` / `prove_index_order` (core10 l.980/986). Naming only.
- **I6** says "Linkage, time, bits and target of every leaf are checked when it is appended (`accept_c7`)". `accept_c7` lives in lib/zrelay/header_c7.ak, not in core10.ak.
  - Its time check is only `mtp_tip < time <= mtp_tip + 5400` (l.127-128). There is **no wall-clock bound**.
  - The "time" in the invariant is therefore weaker than readers will assume, and this is what enables the time-warp amplifier in RV6-C1. **Medium [E].**
- **L4** ("an honest relayer can always Propose a heavier honest branch eventually … old idle entries are dropped") names no check, and it is false: RV6-C1 [M].
- **L3/SR-M1** ("each fake costs ≈ 900 ADA") assumes the blocker is killable. A valid fork entry is not, so no kill_fee is ever paid: RV6-C1 [M].
- **D-83/I1''**: "≤ 24 stale blocks counted" has no enforcing check (RV6-H1).
- **WF-K0, WF-S0**: off-chain checks, correctly labelled as off-chain. No on-chain counterpart is expected.
- All the other named checks exist in core10.ak or the template branch section: `extends10`, `blk10`, `carry10`, `lanes_created`, `lanes_idle`, `index_where`, `entry_live`, `burns_own`, `lane_resolves`, `reveal_binds/half/join`, `prove_leaf`, `open >= 1`, `dd.lane == nm`, `dd.entry_id == ld.id`, `upper <= ld.since + w_c`, the `max_skew` tight intervals, WF-A1/A6/L1/B1-B4, `ckpt_summary == c` (D-82), `cand.chainwork >` the tail, and `m.count == height − base + 1` (Extend3).

## Summary by severity
- **Critical — RV6-C1 [M]:** permanent relay capture. Young *valid-PoW* fork entries renewed every < W_c can't be killed or dropped, and they keep the queue non-empty, so Rollback6 (the D-80 fix) is never reachable. The attacker's fork finalizes as canonical, and honest branches can never be proposed again.
  - Cost: fees plus about one fork block per 6.5 h.
  - Escalation to settlement theft (bury an arbitrary txid at depth ≥ 330/990 on the captured fork, or Arm past rel_height so Bob Releases while Alice's real R is unprovable) is [E], made cheaper by MTP-only timestamps (no wall-clock bound) that let the fork's difficulty be time-warped down.
- **High — RV6-H1 [E]:** D-83's "at most 24 stale blocks counted / effective depth 306/966" has no code basis. The stale suffix of a checkpoint is bounded only by attacker fork mining, not by rollback_max. Re-extending a stale branch needs only ≥ 1 new fork block per cycle; the rollback is not even needed. A3 does not apply, because the relay compares only against its own tail.
- **Medium [E]:** accept_c7 has no wall-clock bound on header time (only `<= MTP + 5400`). This is the time-warp amplifier, and INVARIANTS I6 overstates it as "time … checked".
- **Low:** rollback griefing of each empty-queue moment for 250 ADA (= SR-L1). Naming mismatch prove_dup/prove_order. ckpt_summary does not check the sink address (harmless today).
- **Holds:** extends10 append-only [M offchain exhaustive port + E]: no rewrite or insert at or below prev_height, and correct empty, extra and truncated ext handling with no off-by-ones. D-82 chained-rollback bound [E]. Rollback can't invalidate in-flight settlement proofs [E].

**Verdict: v10 does NOT hold up.** extends10 is sound, but the D-80/D-82/D-83 rollback design is defeated by unkillable young valid-fork entries. This is a measured Critical (permanent relay capture, with a plausible path to settlement theft), so this is the fifth review in a row to find a Critical.
