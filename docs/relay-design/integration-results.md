# Integration results (overnight run, after phases 1–3)

**Labels:**
- **[M]** = measured on the box.
- **[E]** = estimate.

**Rules followed:** fresh test keys only, emulator / unit ScriptContext only, nothing submitted.

## I1: settle-v1 escrow wired to the relay anchor, a real Zcash block, and a BIP-340 adaptor signature: PASS
Mon Nov 2, ~12:40 AM ET.

**Files:**
- `zeutxo-step1-relay-cost/integration/settle_template.ak` (validator source);
- `integration/gen_settle_tests.py`, which writes `aiken/validators/settle.ak` (the validator plus 17 tests);
- `integration/settle_measurements.tsv`.

**Test inputs:**
- Canonical anchor state: 10 real mainnet headers on top of the pre-NU7 tip, taken from the step-1 vectors.
- The real block is **3,538,812** (10 txs):
  - its tx #9 stands in for the Zcash claim **C**;
  - its tx #1 stands in for the refund **R**.
- The signature is a fresh BIP-340 adaptor signature for the escrow outref. It is pre-verified, completed, and *t* is extracted.

**Results:** 17/17 tests behave as expected: 7 positive passes and 10 expected failures [M]. ExUnits are measured on a unit ScriptContext, so they are slightly below a full tx.

| Test | Result | Mem | CPU |
|---|---|---|---|
| Claim (adaptor sig) → Pending | pass | 156,930 (0.95%) | 102.4M (1.0%) |
| CoopRelease (Alice signs) → Bob | pass | 128,516 | 40.1M |
| Release after pending → Bob | pass | 127,350 | 40.3M |
| **ProveC, real block** → Bob | pass | **514,548 (3.1%)** | **168.9M (1.7%)** |
| **ProveR from Pending** → Alice (fixes H2) | pass | 515,650 (3.1%) | 169.2M (1.7%) |
| Fallback after t_fb → Alice | pass | 130,810 | 41.7M |

**Rejected as expected:**
- a claim after T_A;
- a claim whose continuing datum shortens the pending window;
- a second claim from Pending;
- a CoopRelease signed by Bob;
- a Release before release_at;
- ProveC with the wrong salt;
- ProveC using R's txid;
- ProveR with too few confirmations;
- ProveR paying Bob;
- Fallback from Pending;
- Fallback before t_fb.

**Fee estimate for a ProveC/ProveR tx [E]:**
- Size: about 1.9 KB (header 1,487 B + paths) plus the script as a reference input.
- Fee: about 0.155 + 44·1,900 + 0.0577·515k + 0.0000721·169M ≈ **0.28 ADA**, plus the reference-script fee.

**Caveat:** `min_conf` is scaled down to the 5 confirmations available in the 10-header canonical. Production uses 330 (D-02). The check itself is identical.

---

## I2: anchor2 + dispute2 (pipeline queue, Open, Resolve). Checkpoint Nov 2, 12:40 AM ET

**Verdict: PASS (unit ScriptContext scope).** All 23 of 23 tests behave as expected: 10 positive tests pass, and all 13 negative tests (`fail` tests) are rejected.

**Files:**
- `zeutxo-step1-relay-cost/integration/anchor2_template.ak` (validators)
- `integration/gen_anchor2_tests.py` (generates `aiken/validators/anchor2.ak`)
- `integration/anchor2_measurements.tsv`
- `integration/extract_tests.py`

**Inputs:**
- Real post-NU7 headers: canonical tip 3,538,892; batch A = 3,538,893..900; batch B = 3,538,901..908.
- Disputed header: real block 3,538,896, which is leaf 4 of batch A's root.
- Fork candidate: a synthetic hash `0xfe…` with chainwork = tip_B + 1 (synthetic, labelled as such).

**Script sizes [M] (`aiken build`):**
- anchor2: 4,534 B
- dispute2: 11,677 B
- settle: 2,836 B

All three are meant to be used as reference scripts.

### Execution units [M]

These come from test execution, so they include the cost of constructing the test's context. Treat them as upper bounds.

| Test | Result | Mem | CPU |
|---|---|---|---|
| a2_propose_first | pass | 1,485,031 | 421.3M |
| a2_propose_second_descends | pass | 1,504,695 | 436.7M |
| a2_propose_fork_replace_refunds | pass | 1,550,455 | 446.0M |
| a2_finalize_head | pass | 221,630 | 88.5M |
| a2_open_dispute_real_header | pass | 308,412 | 125.2M |
| a2_resolve_challenger_won_drops_and_refunds | pass | 359,971 | 127.9M |
| a2_resolve_proposer_won_resets_window | pass | 305,126 | 118.3M |
| a2_resolve_opened_timeout_challenger_won | pass | 293,191 | 105.3M |
| a2_resolve_orphan_unchanged | pass | 262,941 | 94.7M |
| d2_timeout_with_anchor_cospend | pass | 165,909 | 52.2M |

**Negative tests (all rejected as expected):**
- propose not heavier;
- propose not descending;
- fork replace without refunding dropped bonds;
- fork replace that drops a disputed entry;
- finalize early;
- finalize a disputed entry;
- open after W_c;
- open with deadline < upper + τ;
- open without the challenger bond;
- challenger-won without refunds;
- proposer-won result claimed as challenger-won;
- resolve without the dispute input;
- dispute2 timeout without the anchor co-spend.

**All figures are against the limits of 14M mem and 10B CPU per tx.** The worst case, Propose at 1.55M mem, is 11% of the mem limit and 4.5% of the CPU limit.

**Fee estimate for Propose [E]:** about 0.155 + 44·~3,000 B + 0.0577·1.55M + 0.0000721·446M + 15·4,534 (reference script) ≈ **0.48 ADA**.

**Fee estimate for Open or Resolve [E]:** ≈ 0.25–0.45 ADA, including dispute2's reference-script fee of 15·11,677 B ≈ 0.175 ADA.

### Bugs found and fixed during I2
- The generator assumed batch hashes were stored oldest-first. It now looks up the leaf index.
- Aiken's `redeemers` map needs `Data` values, so I added a `to_data` upcast helper in the generated tests.

### Not covered by I2
- MMR accumulator and branch rolling/pruning (D-08). These are still not prototyped.
- Chained multi-tx simulation. These are single-tx unit contexts.
- The full Equihash leaf check inside dispute2 `Prove` under adversarial inputs. Phase 1's measurements cover it; I2 only covers dispute2's payout gating.

---
## I3 — Chained end-to-end emulator run (checkpoint Mon Nov 2, ~12:56 AM ET)

**Verdict: PASS — 31/31 steps as expected** (27 Aiken tests: 18 positive txs pass, 9 script-level negatives fail as intended; 2 ledger-level rejects in the Python emulator ledger). All numbers [M] = measured by `aiken check`/emulator, [E] = estimate.

Files: `zeutxo-step1-relay-cost/e2e/` — `head.ak`, `core.ak` (anchor3 / dispute3 / settle3), `assemble.py` → `e2e_template.ak` (662 lines), `ledger.py` (UTxO emulator: input existence/already-spent, validity interval vs clock, lovelace + token conservation incl. mint, key witnesses, flat 0.5 ADA fee), `gen_e2e.py` → `aiken/validators/e2e_run.ak` (27 chained tests, each tx's outputs fed forward as next tx's inputs) + `plan.json`, `e2e_measurements.tsv`, `report.py` → `results.json`, `mutants.py` + `mutant_f2.tsv` / `mutant_f4.tsv`.

Script sizes [M] (`aiken build`): anchor3 5,188 B · dispute3 12,012 B · settle3 2,982 B · branch_v2e 3,208 B.

Chain: register batch A (real Zcash headers 3538893–900) → register B (901–908) → propose A, B → swap S1 adaptor happy path (Bob claims with adaptor-completed sig; Alice extracts t off-chain → opens Zcash side) → S2 cooperative-timeout path → dispute D1 on B (zero-leaf fraudulent reveal by O2 → ProveLeaf + Resolve2, challenger wins, B dropped) → re-propose B → dispute D2 on A (honest reveal → timeout resolve, proposer wins, window reset D-12) → finalize A, B (canonical 3538908) → fallback swaps: S2 ADA refunded to Alice via relay-proven Zcash **refund** (ProveR), S3 ADA paid to Bob via relay-proven Zcash **claim** (ProveC, inclusion proof against finalized header).

Negatives (all rejected as intended): challenger reveals garbage (F4) · finalize before window · ProveLeaf without anchor co-spend · timeout before deadline · resolve of attacker-forged dispute UTxO (F2) · Bob claims S3 after T_A · ProveR before finalization · finalize after window reset · ProveC with wrong commitment · [ledger] stale (already-spent) anchor reference · [ledger] Bob Release on S2 after ProveR (double spend).

Differential (fix disabled, identical tests) [M]: with F2 removed only `s20_neg_resolve_forged_dispute_utxo` flips to accepted (exploit works); with F4 removed only `s10_neg_challenger_reveals_garbage` flips. All other 26 tests unchanged → each fix is load-bearing and the negatives fail for the intended reason.

Per-tx budget [M] (% of 14M mem / 10B CPU; units include literal construction in tests → upper bounds), size/fee [E] (fee = 155,381 + 44·size + script units + 15·refscript bytes):

| tx | mem % | CPU % | size B [E] | fee ADA [E] |
|---|---|---|---|---|
| register (8 headers) | 48.7–48.8 | 25.1 | 14,456 | 1.414 |
| propose | 10.7–10.9 | 4.3–4.4 | 1,978–2,636 | 0.44–0.47 |
| adaptor claim | 1.1 | 1.0 | 949 | 0.258 |
| coop release | 1.0 | 0.5 | 730 | 0.243 |
| open dispute | 3.3–3.4 | 1.8–1.9 | 4,585 | 0.48 |
| reveal (512 leaves) | 70.6 | 38.7 | 14,328 | 1.816 |
| ProveLeaf + Resolve2 | 33.4 | 44.3 | 3,939 | 1.176 |
| timeout resolve | 4.4 | 2.4 | 2,870 | 0.593 |
| finalize | 1.7 | 0.9–1.0 | 1,385–2,043 | 0.32–0.34 |
| ProveR / ProveC | 3.7 | 1.7 | ~2,480 | 0.35 |

Final emulator state [M]: canonical 3538908, queue empty; O1 +250 (won D2 bond_c) −40 branch deposits −fees; O2 −1,000 (lost bond on fraud); CH +1,000 net on D1, −250 on D2, 1,250 stranded in its own forged UTxO; Alice S2 refunded; Bob received S1 + S3. Value conserved across all 20 txs. Off-chain checks all True (DLEQ Pallas↔secp valid, preverify S1–S3, t extraction, t opens T_p, RedPallas presig/complete/wrong-t-rejected/refund-valid).

Fixes found while building I3 (implemented in anchor3/dispute3/settle3): **F1** PayTag inline datum on every payout (double satisfaction) · **F2** dispute thread token minted on Open2, required+burned on Resolve2 · **F3** dispute payouts require the co-spent anchor redeemer `Resolve2{dispute_ref == own_ref}` · **F4** Reveal signed by proposer · **F5** payout split decided only by anchor3 (value-conserving) · settle3 reads `Anchor2Datum.canonical` (closes v1 gap).

Caveats: min_conf scaled to 8 (production 330; logic identical, only the number differs); Zcash C/R txids are stand-ins taken from real blocks (not real swap txs); fraud is simulated by a zero-leaf reveal because a fake header with valid sha256d linkage cannot be produced; emulator fee is flat; register tx at 14.5 KB is within 16,384 B but leaves ~1.9 KB headroom → 8 headers/tx kept (9 would be ~15.95 KB [E], too tight).

---
## I4 — MMR accumulator + branch pruning/rolling (checkpoint Mon Nov 2, ~1:05 AM ET)

**Verdict: PASS — 28/28 tests as expected** (`aiken check -m mmr_relay`, 17 positive, 11 negative). [M] measured, [E] estimate.

Files: `zeutxo-step1-relay-cost/aiken/lib/zrelay/mmr.ak` (append / bag / verify), `mmr/mmr_template.ak` (branch_v3 validator: Extend3 + Burn mint, Prune spend; `summary_of`, `descends`, `settle_check`), `mmr/gen_mmr.py` → `aiken/validators/mmr_relay.ak` + `mmr/plan.json`, `mmr/mmr_measurements.tsv`, `mmr/minutxo.py` → `minutxo.json`, `mmr/report.py` → `mmr/results.json`.

Design: leaf i = sha256d(header at height base+i); peaks stored newest-first (append = binary-counter carry); node = blake2b_256(l‖r). Branch datum keeps the full peak list (≤22 peaks for ≤4.2M headers); anchor summaries keep only `mmr_root = blake2b(peaks)` (32 B instead of 16 batch roots) — peaks are passed in the redeemer and checked against it. `verify` binds the exact height: 0 ≤ i < count, path length == peak height, peak chosen from count's bits, local index < 2^h.

Test data: synthetic pre-history (leaves 0..3,538,779, ~3.5M blake2b leaves built off-chain in ~4 s) + **real Zcash headers 3538780–3538924** appended exactly as production would; 4 chained real 8-header extensions (count 3,538,925, 18 peaks).

| measurement [M] | mem % | CPU % |
|---|---|---|
| extend 8 headers (branch_v3, real headers) | 47.8–48.1 | 24.6–24.7 |
| (I3 v2 register, for comparison) | 48.7–48.8 | 25.1 |
| MMR append 8 leaves alone | 0.94 | 0.48 |
| bag 18 peaks | 0.34 | 0.14 |
| settle_check real header conf 143 (beyond v2's 128-header window), path 7 | 1.79 | 0.84 |
| settle_check conf 400, min_conf **330**, path 8 | 1.67 | 0.77 |
| settle_check worst case path 21 (height 1,000,000) | 3.38 | 1.53 |
| descent check (Propose) path 4 | 0.90 | 0.40 |
| prune one branch UTxO | 1.32 | 0.58 |
| prune, one of 30 inputs in a tx (upper bound, literal building included) | 5.41 | 2.08 |
| rolling: extend + prune old UTxO in one tx | 49.19 | 25.26 |

Negatives rejected [M]: extension with a wrong MMR · second positive mint in Extend3 · settle with index inflated by 2^h · index ≥ count · too few confirmations · forged peaks (bag mismatch) · truncated path · descent of a foreign tip · prune too recent (P−1) · prune by non-owner · prune without burning the token · Burn redeemer with a positive mint.

**Key finding (F6, real bug in v2/settle3/I3):** `header.merkle_verify` ignores index bits above the path length, and settle3 computes `conf = canonical.height − (end_height − hindex)` from the unbound `hindex`. Tests `f6_v2_merkle_verify_accepts_index_plus_8` / `_plus_8000` **pass** = an attacker can claim arbitrary confirmations for a 1-conf Zcash tx (reorg double-spend against ProveC/ProveR). Also: with 16 batch roots × 8 headers v2 can only prove headers ≤128 deep, so the required 330 confirmations were **unreachable** in v2 (I3 used min_conf 8). The MMR verify fixes both (negative `neg_settle_index_inflated` rejected; conf 400 / 2.5M proven).

Sizes/fees: branch_v3 script 3,925 B [M] (v2 3,208). Branch UTxO TxOut [M, exact CBOR]: W17 v2 1,115 B → 5.50 ADA min-UTxO; v3 (22 peaks) 1,229 B → 5.99 ADA. W102: v2 1,967 B → 9.17 ADA; v3 2,081 B → 9.66 ADA. Extend fee ≈ 1.38 ADA (W17) / 1.41 ADA (W102) [E]; rolling adds ≈ 0.021 ADA [E]; batch prune ≤22 inputs/tx [E, conservative], ≈ 1.35 ADA per batch.

**Locked ADA [E from measured sizes]** (P = prune depth below canonical):

| scenario | no pruning (grows forever) | rolling, P=660 (chosen) | rolling, P=336 | prune every 6 h, P=660 | prune daily, P=660 |
|---|---|---|---|---|---|
| mainnet 75 s (144 batches/day) | 862 ADA/day (v2: 791) | **≈ 503 ADA steady, ≈ 0/day net** | ≈ 257 | ≈ 712 | ≈ 1,359 |
| post-NU7 25 s params used in tests (432/day) | 4,173 ADA/day (v2: 3,960) | **≈ 811 ADA steady** | ≈ 415 | ≈ 1,845 | ≈ 4,974 |

Relay running fees (not locked, spent): ≈ 198 ADA/day at 75 s, ≈ 610 ADA/day at 25 s [E]; rolling adds ≈ 3–9 ADA/day. Earlier "< ~150 ADA steady" estimate is NOT met at a safe prune depth; 250–500 ADA (75 s) is the measured-size figure.

Caveats / not done: MMR is prototyped as a standalone module — anchor3/dispute3/settle3 still use batch roots (porting to Summary3 is the next chunk); pre-history leaves are synthetic (production would start from a trusted checkpoint, count=1); fork UTxOs are pruned by their owner only; prune batch limit is an upper-bound estimate from test literals.

## I5 — adversarial self-review (checkpoint ~1:12 AM ET) — PASS (review done; 2 critical findings fixed or scoped)
- FROST 2-of-2 RedPallas (reddsa 0.5.2 frost, rerandomized, EvenY) simulation PASS [M], run1/run2 ALL_OK.
- F7 DLEQ missing-PoK theft: exploit works on v1 [M]; dleq2 rejects it, honest valid [M]; 66.6 s for the demo [M].
- Nonce reuse: key recovery demonstrated for BIP-340 presig and RedPallas share [M] → D-33.
- F6 (from I4) and F8 (minor) recorded; griefing→Fallback bounded with D-29/D-35 (design, not implemented).
- Full table: /workspace/zeutxo-self-review.md. Decisions D-28..D-35.

## Chunk item 1 — v4 port (MMR into anchor/dispute/settle, F8, D-36) and I3 re-run at 330 conf — PASS 41/41 steps, 37/37 Aiken checks [M]
Files: zeutxo-step1-relay-cost/e2e4/{core4.ak, assemble4.py, mmrpy.py, gen_e2e4.py, plan.json, e2e4_measurements.tsv, report4.py, results.json, mutants4.py, mutants4.json}, aiken/validators/e2e4_run.ak.
Script sizes [M, aiken build]: anchor4 5,604 B (v3 5,188), dispute4 12,088 (12,012), settle4 3,237 (2,982), branch_v3 3,984.
Key per-tx [M mem%/cpu% of 14M/10B; size, fee E]: register 8 hdr 48.2/24.8 (14.5 KB, 1.42 ADA); propose 10.8–10.9/4.1–4.2 (0.40); open 4.3–4.6/2.0–2.1 (0.45); reveal 70.6/38.7 (1.82); ProveLeaf+resolve 33.5/44.2 (1.14); timeout-resolve 4.5/2.2 (0.53); finalize 1.8/0.8 (0.30); ProveR/ProveC at conf 416/466 with min 330: 3.3/1.5 (0.38); Fallback 1.0/0.5 (0.24).
Negatives all rejected: F8 wrong entry, F6 inflated index (in Open4 and in ProveR), garbage reveal by challenger (F4), early finalize, finalize with open disputes, open after fixed window, no anchor co-spend (F3), forged dispute UTxO (F2), claim after T_A, timeout before deadline, block not yet canonical, real block with conf < 330, wrong commitment, stale anchor ref (ledger), double spend (ledger), Fallback before t_fb.
Differential mutants [M]: removing F8 → only neg_F8 flips; removing the fixed window → only neg_open_after_fixed_window; removing open==0 → only neg_finalize_with_open_disputes; removing the 330 depth check → only neg_conf_below_330 (the F6 inflated-index proof still fails: the MMR binding alone stops it).
Off-chain in the same run: dleq2 proof valid; malicious (σ≠0) dleq2 rejected by Alice before she locks; adaptor extract + Orchard completion all true.
Caveat: the ≥330-deep Zcash txs (R of S2, C of S3) sit in crafted single-tx headers in the synthetic pre-history (only 145 real headers on the box); S4 uses a REAL tx in real header batch A to show the depth check rejects it.

## Nov 2 chunk, item 2: swap on dleq2 (~1:28 AM ET) — PASS [M]
- swap_e2e.py (dleq2) full swap suite: all checks pass; tampered PoK rejected; F7 exploit proof rejected inside the swap; dleq_attack ALL_OK. Vectors: zeutxo-adaptor-proto/vectors_v2.json.

## Nov 2 chunk, item 3: FROST-DKG adaptor sim (~1:30 AM ET) — PASS [M]
- Code: zeutxo-adaptor-proto/frost_2of2/src/bin/frost_adaptor.rs (reddsa 0.5.2 FROST, pasta_curves 0.5, offline build 18 s). Output: zeutxo-adaptor-proto/frost_adaptor_run.txt. 4 runs with fresh randomness, ALL_OK each time.
- Checks (all true): DKG rejects a swapped proof of knowledge; both parties get the same group key; shares match the published verifying shares; Lagrange (2, −1) rebuilds ak; rk equals reddsa randomize(); nonce commitments open; Alice pre-verifies Bob's share and catches a tampered one; pre-signature alone, Bob alone + t, wrong t, and wrong message are all rejected by the Orchard SpendAuth verifier; completed claim signature is valid; refund signed by unmodified library FROST rerandomized signing is valid; rogue-key demo: Bob alone signs under the old plain-sum key (shows why the DKG is needed).
- Not done: no Orchard bundle/proof, no network, no external review.

## Nov 2 chunk, item 4: compressed headers (re-created and re-run ~1:45 AM ET after the rollback, D-47) — PASS [M]
- Code: aiken/lib/zrelay/header_c.ak (accept_c, leaf_c, reveal_binds, header_leaf), mmr/branch_c_template.ak (branch_c), compress/gen_c.py → aiken/validators/compress_relay.ak; compress/c_measurements.tsv; compress/report_c.py → compress/results_c.json.
- 16/16 as expected [M]. Mainnet params W=17, 75 s, real headers from 3538808.
| k headers | mem | CPU | fits 14M | size [E] | fee [E] | ADA/day [E] | locked, rolling P=660 [E] |
|---|---|---|---|---|---|---|---|
| 17 | 44.9% | 20.6% | yes | 4,302 B | 0.925 | 62.7 | 239 |
| 34 | 85.7% | 39.4% | yes | 6,733 B | 1.497 | 50.7 | 126 |
| 51 | 127.1% | 58.5% | no | — | — | — | — |
- Script branch_c 4,624 B [M]. Negatives rejected: wrong MMR, first prev ≠ parent tip, last hash above target, time ≤ MTP, reveal cannot bind a fake hash, settle with wrong header, descends with wrong prefix. fraud_c_fake_intermediate_hash_accepted_on_chain passes on chain BY DESIGN (caught by dispute; see item 1 of the next chunk for the end-to-end version).

## Chunk 2, item 1: v5 = compressed headers in the dispute contracts (~1:55 AM ET) — PASS [M] (superseded by v6 for C-1)
- 49/49 steps, 45/45 Aiken checks (e2e5/results.json, e2e5/e2e5_measurements.tsv). Canonical ends at 3538875 (two 34-header compressed registers on mainnet params). S2 ProveR at 468 conf, S3 ProveC at 518 conf, S4 rejected below 330 and inflated-index (F6) rejected.
- New: fraud branch with a fake intermediate hash is caught end to end (open on (prefix, fake hash) → reveal cannot bind → Timeout drops entry); neg_open_prefix_with_real_hash_not_in_fraud_entry; neg_proposer_reveal_wrong_solution; neg_honest_B_cannot_displace_equal_work_fraud_entry; neg_finalize_B_before_its_window; orphan ProveLeaf path.
- Costs [M mem/CPU, E size/fee]: register 34 hdr 87.4% / 40.1%, 6.5 kB, 1.51 ADA; Reveal 70.7% / 38.8%, **15.9 kB (near the 16,384 B limit)**, 1.89 ADA; Open 5.0%, Propose 6.0%, Timeout 4.7%, ProveLeaf (orphan) 33.2%/44.1%.

## Chunk 2, items 1+2 + review fixes: v6 = lanes, paid spends, checkpoints, Arm (~2:28 AM ET) — PASS [M], with caveats
- Files: zeutxo-step1-relay-cost/e2e6/{core6.ak, assemble6.py, gen_e2e6.py, report6.py, report6.txt, results.json, e2e6_measurements.tsv, mutants6.py, mutants6.json, reviewer_t1_rerun/}; aiken/validators/e2e6_run.ak; integration/h1_model.py(.json); zeutxo-adaptor-proto/frost_2of2 run3_m3.txt.
- Chain at 330 conf, mainnet params, 34-header compressed registers: **74/74 ledger steps, 69/69 script checks as expected** [M]. 5 swaps: S1 coop, S2 ProveR (conf 434, via checkpoint), S3 ProveC (conf 518), S4 shallow → Fallback, S5 Arm → Release after grace.
- Reviewer exploits as regressions (must fail; all fail) [M]: C-1 p+512 / p+1024 against honest D2 (s29/s30); reviewer t1 tests re-run with the fixed lib (exploit tests fail, controls pass); C-2 forged lane (s15), young drop (s43), drop without fee (s49), kill without fee (s36), finalize omitting a lane (s46), close of a live entry (s57); H-2 arm before release_at (s65), release without Arm (s66), arm below rel_height (s68), release before grace (s70); forged checkpoint (s59); M-4 finalize inside g_d (s50); M-2 three rogue escrows (off-chain). H-1 is a spec change plus a model (no Zcash script engine on the box).
- Mutants: 10/12 killed [M]; the 2 survivors are redundant guards (D-50).
- Heaviest [M]: register 87.4 % mem; Reveal 70.8 % mem, **tx ≈ 15,957 B (97.4 % of limit) [E]**.
- Not done or not proven: no real Zcash/Cardano node or ledger (emulator only); the cost figures in D-50/D-53 are [E] under a "wins every race, SPOs honest" model; M-3 cross-protocol safety is argued, not proven; Reveal needs a split before real use.

## v7 (Mon Nov 2, ~2:45–3:15 AM ET): NU7 relay + second-review fixes + Reveal split — emulator only
Files: zeutxo-step1-relay-cost/nu7/ (sources, data, ref7.py, net7.py, gen_lib7.py), aiken/lib/zrelay/header_c7.ak, equihash7.ak, e2e7/ (core7.ak, assemble7.py, gen_e2e7.py, run7.sh, report7.py, timing7.py, mutants7.py). v6 files untouched.
| Check | Result |
|---|---|
| NU7 rules vs real headers (Python model) | Testnet 281/281 bits exact across activation 4,465,026; Mainnet 215/215; PoW + links 100 % [M] |
| NU7 lib tests (Aiken) | 15/15 as expected (6 positives incl. a 51-header batch crossing activation, 9 negatives) [M] |
| v7 chain, Mainnet data (pre-NU7) | 105/105 ledger steps, 98/98 script checks as expected [M] at ~3:15 AM ET (*superseded: the reviewed v7 snapshot after D-62/D-64 is 110/110 ledger steps = 103 script checks + 7 ledger-only steps [M]; review 3 NEW-L1′ count drift*) |
| v7 chain, Testnet data (batch crosses NU7) | 105/105, 98/98 [M] at ~3:15 AM ET (*superseded: 110/110, 103 checks*) |
| Heaviest tx | register 24 headers: 88.6 % mem Mainnet / 90.5 % Testnet [M] |
| Reveal (split) | RevealA 9,296 B (56.7 %) / RevealB 7,859 B (48.0 %) [E]; 36.8 % mem each [M] (v6: 15,990 B, 97.6 %) |
| Review-2 regressions | s78 future-dated Propose fails; back-dated Propose fails; long-interval Open / RevealA / RevealB fail; s86 stale-lane Finalize fails; re-proposed entry gets a fresh id (off-chain check); M-2 forged twin lane merged with the real lane fails; late R at expiry height provable with the Arm checkpoint at exactly 330 conf [M] |
| Scripts (aiken build, unapplied) | anchor6 6,432 B, lane6 4,814 B, dispute6 12,693 B, settle6 3,633 B, branch_c7 5,220 B [M] |
| Fees | register ≈ 1.48–1.50 ADA, RevealA ≈ 1.20, RevealB ≈ 1.13 ADA [E]; relay post-NU7 ≈ 144 tx/day ≈ 216 ADA/day [E] |
| Timing (timing7.json) | max free stall/entry 18.67 h; grace 21 h; paid stall ≈ 25.2k ADA / 7 d; Bob's worst free wait ≈ 43.5 h [E] at 330 conf (*superseded by D-64: ≈ 48.0 h at 990*) |
Mutation results: see D-62 / e2e7/mutants7.json.

### v7 update (~3:52 AM ET Nov 2): depth 990 post-NU7 (D-64) and mutants (D-62)
| Item | Result |
|---|---|
| v7 chain, Mainnet data (pre-NU7) | 110/110 ledger steps as expected; 103 of them are script checks (= the 103/103 review 3 re-ran) [M] |
| v7 chain, Testnet data (batch crosses NU7) | 110/110 as expected [M] |
| New S7 (min_conf 990) | Arm at rel_height; ProveR at 966 conf rejected; ProveR via the Arm checkpoint at exactly 990 conf accepted (3.5% mem) [M] |
| New neg_NH2_lopen_validity_interval_1h_gt_max_skew | rejected [M]; generator bug fixed (override deadline), so neg_H2_open_long_validity_interval now fails for the intended reason |
| Max mem per tx | 88.6% (main), 90.5% (test) — unchanged [M] |
| Mutants (20) | 17 caught (NH2_skew_open after the fix), 3 kept survivors with rationale (D-62) [M] |
| Bob's worst free wait L_R → Release | ≈ 48.0 h with 990 conf (≈ 43.5 h if 330) [E] |

## v8 (Mon Nov 2, ~4:10–4:52 AM ET): fix for review 3 (NEW-C1′ Critical, NEW-H1′ High) — emulator only, pending re-review
Review 3 found v7 **not sound**: dispute thread tokens were named only by hh, so a double resolve could leak a token and forge disputes (Kill6 of a live honest entry, ≈ 750 ADA profit; or a fraud checkpoint Finalized). v8 (e2e8/, D-65..D-69): thread name = blake2b_256("dsp" ‖ spent lane outref ‖ entry_id ‖ hh), derived from the datum; exactly one minted per LOpen; every resolving tx burns exactly its own token (whole-tx mint check); one dispute input per tx; every dispute transition requires the authentic token; LResolve needs open ≥ 1. v7 files unchanged.
| Check | Result |
|---|---|
| v8 chain, Mainnet data | 117/117 ledger steps as expected (109 script checks) [M] |
| v8 chain, Testnet data (crosses NU7) | 117/117 (109 script checks) [M] |
| Review-3 exploits rv3_00..05 as regressions | all fail as required (chain: neg_rv3_00, 00b, 01, 01b, 03, 05; hand: rv3_01, 02, 02b, 03, 04) [M] |
| New rv3_06 (single resolve, token not burned) / control 06c | fails / passes [M] |
| Mutants (15) | caught 3 (O_name_is_hh_v7, BOTH_exact_burn, L_open_ge_1); 12 layered survivors with reasons (D-68) [M] |
| Max mem per tx | 88.6 % main / 90.5 % test (register; unchanged) [M] |
| Dispute txs | LOpen 2,299 B [E], 4.8 % mem; RevealA 9,333 B [E], 37.3 %; RevealB 7,896 B [E], 37.3 % [M] |
| Scripts (aiken build) | anchor6 6,511 B, lane6 5,063 B, dispute6 13,184 B, settle6 3,633 B, branch_c7 5,220 B [M] |
| Count note (NEW-L1′) | v7 = 110 ledger steps = 103 script checks (what review 3 re-ran) + 7 ledger-only; v8 = 117 = 109 + 8 |

## v9 (Mon Nov 2, ~5:25–5:55 AM ET): fix for review 4 (RV4-C1, RV4-C2 Critical; H1; M1; M2; L1–L3) — emulator only, pending re-review
Review 4 found **two Criticals in v8**. Both came from attacker-supplied bytes that a validator stored and later had to pay to: the challenger (C1) and the owner (C2). Either one could freeze the relay for about 1,000–1,250 ADA. v9 is a systematic well-formedness sweep: every builder-supplied field and every created output, with its invariant, where it is enforced, and a negative test. The table is in `zeutxo-step1-relay-cost/e2e9/wellformedness.md`; the decisions are D-70..D-76. v8 files are unchanged.

| Check | Result |
|---|---|
| Full chain, Mainnet data (`NET=main bash e2e9/run9.sh`) | **117/117 steps as expected** [M] |
| Full chain, Testnet data across NU7 (`NET=test`) | **117/117 steps as expected** [M] |
| Regression module e2e9_reg.ak: rv3 (7) + rv4 port (23, with 2 new exact-mint regressions) + 39 wf negatives | **69/69 as expected** [M]. Every v8-passing rv4 exploit now fails. rv4_02b is a documented unreachable precondition (02a/02c/02d pin it) |
| Mutants (43; reg + 53 must-fail chain steps) | 28 caught [M]. v8 set: 4/15, **O_mint_exact now caught** (H1). WF set: 24/28; the 4 survivors are "(also proof)" checks |
| Max mem per tx | register 88.8 % main / 90.7 % test [M] (v8 88.6 / 90.5) |
| RevealA worst case | **9,080 B [E, exact CBOR of a model]**, 7,304 B margin. v8 C1(b) parameters give 17,668 B (no longer admissible) |
| Script sizes (aiken build, unapplied) | anchor6 6,724 · lane6 5,301 · dispute6 13,455 · settle6 3,738 · branch_c7 5,407 B [M] |
| M2 | kill_fee 250 → 900 ADA, so a self-kill via a sybil still costs ≥ 900 ADA per fraud attempt [E]. The honest watcher's reward is 100 ADA (D-72) |

Repro: `cd zeutxo-step1-relay-cost && NET=main bash e2e9/run9.sh && python3 e2e9/build_reg9.py && (cd aiken && aiken check -m "e2e9_reg.{..}") && J=4 python3 e2e9/mutants9.py && python3 e2e9/reveal_worstcase.py`.
