# zeUTXO v8: independent review 4 (adversarial)

Reviewer: independent (not the author). Date: Mon Nov 2, 2026 (America/New_York, ET).
Object: snapshot `<BOX_HOME>/zeutxo-backups/ckpt-0500-v8-final.tgz` (read-only), extracted to
`/workspace/zeutxo-review4-scratch/`. Contracts: `zeutxo-step1-relay-cost/e2e8/core8.ak` (via `e2e8_template.ak`).
Rules kept: box and Aiken emulator only. No nodes, network txs, wallets, real keys, GitHub or outside messages. No author directory or snapshot file was modified. Reviewer 3's exploits were copied to `rv3copy/` and not changed.
Marks: **[M]** = measured in the Aiken emulator (`aiken check`); **[E]** = estimated (code reading, or the author's own
`report8.py` tx-size formula). The emulator does not enforce ledger rules (tx size, address encoding, value
conservation), so every ledger-level claim below is [E].

## Verdict

**v8 is NOT sound enough for a testnet phase.** The NEW-C1′/H1′ token-lineage fixes hold against every variant I tried. However, v8 has two new **permanent relay-freeze** paths that are cheap and need no race in their simplest form. Both come from key-hash fields that the scripts take from the attacker without checking their length (`LOpen.challenger`, `Propose6.owner`). Several exits must pay `VerificationKey(field)`, and a real ledger cannot encode such an output when the field is not 28 bytes, so those exits become unreachable. A frozen relay pushes settlement onto the t_fb fallbacks, and that reopens Bob-steals-from-offline-Alice [E].

The fix is small: require `bytearray.length(x) == 28` for `challenger` in LOpen and `owner` in Propose6, and preferably also bound the dispute output's value (only ADA + the thread token) and add `reference_script == None`. It still needs a re-run of the chain and the mutants, plus a short re-review before testnet. The process gap matters too: the only guard against forged dispute tokens (`O_mint_exact_whole_tx`) was an untested surviving mutant, and the log calls it defence in depth.

## Summary by severity

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| RV4-C1 | **Critical** | `LOpen.challenger` length is unchecked. A dispute whose challenger is not 28 B can never be resolved as a challenger win, because Kill6 and the orphan path must pay `VerificationKey(challenger)`. (a) When the attacker controls whether the proposer reveals (he is the proposer, or the proposer is offline), the lane stays `open ≥ 1` forever, and the entry can't finalize, be killed or be dropped: a **permanent relay freeze** for ~1,250 ADA. (b) Against an honest online proposer: a 3,640-B challenger plus ~4.9 KB of junk tokens in the dispute value still fits LOpen (~14.8 KB) but pushes the proposer's mandatory RevealA to ~18.0 KB, over 16,384 B. The reveal becomes impossible and the freeze follows, for ~250 ADA. | [M] script level: rv4_01a/c/d/e/f/g/h/i. [E] ledger: tx size, address encoding |
| RV4-C2 | **Critical** | `Propose6.owner` length is unchecked (`owner = #""` accepted). Finalize must pay bond_p to `VerificationKey(owner)`, so a valid-header entry with a malformed owner reaches the head and **can never finalize**. Drops and Kill6 of any earlier entry must refund it, so they are blocked too. The relay freezes permanently for 1,000 ADA unless someone disputes that entry within its W_c, and the documented watcher policy disputes only invalid headers. | [M] rv4_04a/b/c/d/e. [E] ledger encoding |
| RV4-H1 | High (process / doc) | `O_mint_exact_whole_tx` is the **only** barrier to minting arbitrary dispute-policy tokens: `lane6.mint` returns True for any tx with an LOpen lane input and checks no names. Without this line, an attacker mints `thread_name(fake_src, A.id, hh)` next to an honest LOpen and kills live honest entry A mid-window, the rv3_02 theft. D-68's "the lane minting policy itself only allows LOpen/LResolve-shaped mints, so this is defence in depth" is false. The check is present in v8, so this is not a live hole, but it had no test. | [M] rv4_02a (fails in v8, passes under the mutant), rv4_02b (forged dispute with a correctly named token kills A in v8) |
| RV4-M1 | Medium | The D-50/D-60 bound "maximum griefing stall per entry W_c + 2τ ≈ 18.5 h (18.67 h), independent of the griefer's budget" is false in v8 (C1, C2). Even with the undocumented counter-strategy in §1.5, the stall is unbounded and costs the attacker ~250 ADA per W_c cycle, cheaper than the D-60 paid stall (1,000 ADA per 6.67 h). | [E] |
| RV4-M2 | Medium (incentive; partly known, s105) | Two Opens on one hh plus phase-free ProveDup/ProveOrder let a fraudster's own sybil open first and Kill its own fraud entry. Fraud then costs only kill_fee + fees (the bond_p comes back via the sybil), and the honest watcher gets only its orphan refund. No wrong winner against a valid header was found. | [E] code reading; consistent with author s105 |
| RV4-L1 | Low | The dispute output's value (junk tokens up to maxValueSize) and its `reference_script` are unchecked. Junk value alone leaves RevealA at ~14.3 KB (≈2 KB margin), but it is the amplifier in C1(b). | [E] |
| RV4-L2 | Low | Opening a dispute on a killed or dropped entry's lane delays LClose (lane_min griefing; bounded by W_c). | [E] |
| RV4-L3 | Low (doc) | "12 survivors, all layered duplicates, none faked" (D-68) is true for 11 of them, not for `O_mint_exact_whole_tx` (H1). For `D_own_thread_token` and `D_one_dispute_input` the duplicate is absent in Reveal-only txs; this is harmless (§3). | [M] mut4 |

No theft of a *funded swap* or *fake checkpoint* path was found in the v8 code as shipped. The theft risk enters
indirectly through C1/C2 (relay death → t_fb fallbacks, §1.6).

## Repro

```
cd /workspace/zeutxo-review4-scratch/rv4 && ./run.sh            # ~25 s: build + 21 emulator checks + size estimates
./run.sh --mutants                                              # + author's 15 mutant strings on the rv4 module (~5 min)
```
- `rv4/build.py` builds `run/aiken/validators/e2e8_rv4.ak` from three parts: the v8 template (unchanged), the author's rv3 helper fns (from `e2e8/rv3_v8_hand.ak`), tests derived from the author's chain tests (s03, s29, s33, s59) **by literal text substitution**, and `rv4/rv4_hand.ak`.
- Results: `rv4/rv4_results.tsv`, `rv4/rv4_aiken_check.json` (**21 checks, 0 errors**; every expect-pass passes, every `fail` test fails), `rv4/size4.json`, `rv4/mut4_results.json`.
- Aiken: `/workspace/tools/aiken-x86_64-unknown-linux-musl/aiken`, stdlib v4.0.0 (the same harness as review 3; `lib/zrelay` is identical to the author's).

| Test | Expect | Result | What it shows |
|---|---|---|---|
| rv4_01a | pass | pass [M] | s29 LOpen (honest header, live entry A) with a 7,500-B challenger is accepted |
| rv4_01b / 01b0 | pass | pass [M] | s33 RevealA on that dispute passes the script; baseline s33 the same (5.21M mem) |
| rv4_01c | pass | pass [M] | Timeout(Opened) + Kill6 + LResolve on a 7,500-B-challenger dispute: the **only** accepted tx pays `VerificationKey(<7,500 B>)` |
| rv4_01d | fail | fails [M] | the same Kill paying any well-formed 28-B key is rejected |
| rv4_01e | fail | fails [M] | a proposer-win LResolve (comp to proposer) on the Opened dispute is rejected: Timeout in Opened is a challenger win |
| rv4_01f | pass | pass [M] | LOpen with a 3,640-B challenger + 138 junk tokens (value CBOR 4,935 B ≤ 5,000) |
| rv4_01g | pass | pass [M] | RevealA on that dispute passes the script (script cost unchanged: ~5.06M mem net of construction, see CTRL rows) |
| rv4_01h / 01i | pass / fail | pass / fails [M] | variant (a): challenger = `#""`, Kill only with `VerificationKey(#"")`; well-formed payee rejected |
| rv4_02a | fail | fails in v8 [M]; **passes under `O_mint_exact_whole_tx`** [M] | s29 LOpen that also mints X = thread_name(fake src, A.id, hh) to the attacker |
| rv4_02b | pass | pass [M] | a forged dispute (attacker-written datum, deadline 0) holding a token named X kills live honest A mid-window, paying the attacker 752 ADA |
| rv4_03a | fail | fails in v8 [M]; passes under `D_own_thread_token` [M] | RevealA on a tokenless forged dispute (harmless, §3) |
| rv4_04a | pass | pass [M] | s03 Propose with `owner = #""` is accepted |
| rv4_04b / 04c | pass / fail | pass / fails [M] | Kill of A when the next entry B has owner `#""`: only accepted with a refund to `VerificationKey(#"")` |
| rv4_04d / 04e | pass / fail | pass / fails [M] | s59 Finalize of A with owner `#""`: only accepted with bond_p to `VerificationKey(#"")` |
| *_CTRL_construct_only | pass | pass [M] | same tx literal, validators not run: separates test-side value construction from script cost |

Each expect-fail test differs from its passing twin only in the single payee, so it fails for the intended reason. The emulator gives no trace for `False` results, so the pairs serve as the differential. For rv4_02a the reason is pinned by the mutant flip.

## 1. RV4-C1: unchecked `challenger` → unresolvable dispute → permanent freeze (Critical)

### 1.1 Mechanism (code)
- `lane6` LOpen (core8.ak l.602–640) copies `challenger` from the redeemer into the dispute datum. Its type is `VerificationKeyHash`, but **no length check** is done. The other LOpen checks (prefix 140 B, hh 32 B, MMR, window, exact mint, bond) all pass for a valid header.
- Every challenger-win exit pays it through `pays_tagged(self, dd.challenger, …)` (l.218–234), which requires an output with `payment_credential == VerificationKey(pkh)`:
  - live entry: `anchor6` Kill6 (l.527), which LResolve requires (l.664–669);
  - orphan (entry no longer live): LResolve (l.675).
- A Shelley address's key-hash credential is exactly 28 bytes, so no real tx can contain an output whose ScriptContext credential has another length [E, ledger CDDL]. These exits are therefore unsatisfiable on a real ledger. The emulator accepts such an `Output`, and rv4_01c/01h show it is the *only* output the scripts accept.
- The only other exit is a proposer win: Timeout in phase Revealed (l.680, comp to the proposer). That needs RevealA + RevealB, which need `extra_signatories ∋ dd.proposer` (l.773/797).
- ProveLeaf/ProveDup/ProveOrder cannot succeed against a valid header.
- While the lane has `open ≥ 1`:
  - Finalize is blocked (`lanes_idle`).
  - Kill6 of this entry pays this dispute's challenger, so it is unsatisfiable through this dispute.
  - Drops need idle lanes.
  
  The entry, and with it the whole queue, since only the head finalizes, stays stuck forever **unless another, well-formed dispute on the same entry is resolved as a challenger win** (§1.5).

### 1.2 Variant (a): no size trick, ~1,250 ADA, permanent [M script / E ledger]
1. The attacker Proposes a **valid** extension (owner = his key; bond_p 1,000 ADA).
2. In the last slots of the window (`upper = since + W_c`, the latest any LOpen can be), he LOpens on his own entry with `challenger = #""` (bond_c 250 ADA). He never reveals.
3. After the deadline the dispute can only resolve as a challenger win, which is unpayable. No new LOpen is possible (window closed), and watchers had no reason to dispute a valid header.

Result: the head can never finalize, so no checkpoint is ever minted again. The same applies to an honest proposer who is merely **offline**: any third party can do step 2 on their entry. In the intended design that would cost the proposer bond_p and the relay continues; here it freezes the relay.

### 1.3 Variant (b): honest, online proposer, ~250 ADA [M script / E size]
The challenger appears twice in LOpen (redeemer + output datum) but only once in RevealA (output datum). Junk native tokens in the dispute value (attacker-minted, one policy) appear once in each. RevealA must re-emit the exact value and datum. The author's own `report8.py` formula (`rv4/size4.py`, unchanged) gives:

| tx | size [E] | limit |
|---|---|---|
| s29 LOpen baseline / s33 RevealA baseline | 2,332 / 9,333 | 16,384 |
| LOpen, challenger 7,500 B (rv4_01a) | 18,023 | too big; a pure-challenger attack does **not** fit |
| **LOpen, challenger 3,640 B + 138 junk tokens (rv4_01f)** | **14,779** (1,605 B spare) | fits |
| **RevealA on that dispute (rv4_01g)** | **17,988** (1,604 B over) | **cannot be submitted** |

The junk is counted at its exact CBOR size (4,862 B), not by the text formula. The dispute value is 4,935 B CBOR, below maxValueSize 5,000.

The margins (±1.6 KB) are symmetric, which absorbs the formula's error [E]. An exact CBOR build was not done, since no serializer is used in this harness; it is the first thing to confirm after the fix. Script budgets are not the blocker: net of test-side construction, LOpen ≈ 0.52M mem and RevealA ≈ 5.06M mem (baseline 5.12M) [M]. Attacker cost: bond_c 250 ADA (locked forever) + fees + a free junk mint. Min-UTxO of the ~9 KB dispute output is ≈ 40 ADA, already covered by the bond.

### 1.4 Impact
- No checkpoint is ever finalized again. **This contradicts D-50(b) and D-60's "maximum griefing stall … independent of the griefer's budget".**
- Settlement then relies on the t_fb paths (see §1.6).

### 1.5 Counter-strategy (partial, undocumented) [E]
Kill6 (l.508–538) does not look at other lanes, so a *second, well-formed* dispute on the same entry that times out (the proposer withholds its own reveal) can Kill the entry. The frozen dispute is then stuck on the orphan path, which is harmless, and the queue moves.
- The proposer, or any watcher, must have that second dispute open before the window closes, since the attacker opens in the last slots.
- Because `deadline = upper + τ`, a defensive self-dispute opened in the last τ of every window keeps the option.
- Cost to the defender per attack: kill_fee 250 ADA, plus the honest entry is lost and must be re-proposed (a new W_c).

This turns the permanent freeze into an unbounded stall at ≈ 250 ADA per round for the attacker (RV4-M1). It is not in the spec, and it requires racing the attacker's last-slot open (Cardano mempool visibility of ≤ max_skew = 10 min). Not a fix.

### 1.6 Settlement consequence [E]
With the relay frozen, Bob cannot Arm and Alice cannot ProveR against a checkpoint that does not exist. Pending swaps fall to ReleaseRelayDead (Pending after t_fb → Bob) or Fallback (Locked → Alice). Bob, who has claimed, then broadcasts his Zcash refund R; Alice cannot prove it, and Bob takes the ADA through ReleaseRelayDead. This is the theft that the relay-liveness assumption behind D-40/D-60 was meant to exclude. The cost is the C1/C2 attack, independent of swap size.

### 1.7 Fix
In LOpen: `bytearray.length(challenger) == 28`. For defence in depth, also bound the dispute output: its value is exactly lovelace + the thread token (`dict.to_pairs` over policies has length 2), and `reference_script == None`. Then re-measure RevealA with a maximal datum.

## 2. RV4-C2: unchecked `Propose6.owner` (Critical)
- Propose6 (l.427–446) copies `owner` from the redeemer into the entry with no length check. rv4_04a: `owner = #""` is accepted [M].
- Finalize pays `pays_tagged(self, e.owner, bond_p, …)` (l.486). rv4_04d/04e: with owner `#""` the only accepted Finalize pays `VerificationKey(#"")` [M], so it is unsatisfiable on a real ledger [E].
- Drops refund `e.owner` (l.291, `refunds_ok`), and so does Kill6 of any *earlier* entry (rv4_04b/04c [M]). LClose pays `ld.owner` lane_min (l.690).
- Reveal needs `extra_signatories ∋ owner` (l.773/797), which a malformed owner can never satisfy, so every dispute against it is a challenger win.

Attack: propose a **valid** header extension with `owner = #""` (1,000 ADA). Watchers see a valid header and do not dispute. After W_c the entry reaches the head and can never finalize, and nothing behind it can drop it, so the relay freezes permanently.
- Escape [E]: anyone who opens a dispute on it inside W_c wins by Timeout and Kills it (≈ 1,000 ADA profit). That works only if watchers know to dispute malformed-owner entries; the spec does not say so.
- Interaction: placing the malformed entry M right after a fraud entry F means F cannot be Killed (Kill6 must refund M) until M is Killed first. F also cannot Finalize while its challenger's lane is open, so this is a freeze, not a fake checkpoint [E].

Fix: `bytearray.length(owner) == 28` in Propose6. Audit every other `VerificationKeyHash` taken from a redeemer, for example settle6 `pkh_a`/`pkh_b` at creation (not reviewed in depth here; those are each party's own risk).

## 3. Focus 1: do the NEW-C1′/H1′ fixes hold? (yes, as shipped)
Variants tried (code reading [E], backed by mutant runs [M]):
- **Several scripts / several LOpens in one tx.** Each LOpen requires `tokens(mint, lane_hash) == [(own tn, 1)]`, so two LOpens (different names) or LOpen + LResolve (`[(tn_r, −1)]`) in one tx are contradictory. Kill6 + LResolve + dispute6 are bound to one dispute (`one dispute input`, exact burn).
- **Moving tokens between scripts.** Thread tokens leave a dispute UTxO only by being burned (all dispute6 exits burn the own token, and the exact burn is checked in the lane). RevealA/B re-emit the same value to the same address. An extra token that an attacker adds to a dispute output (L1) is not a thread token of any lineage.
- **Minting under other redeemers.**
  - `lane6.mint` is True whenever *any* lane input has LOpen/LResolve, so the name discipline rests entirely on LOpen's exact mint and LResolve's exact burn.
  - `anchor6.mint` (l.544–) allows burns always; mints only through Propose6/Finalize6, which check every output.
  - No path mints a lane-policy token with a non-derived name **as long as `O_mint_exact_whole_tx` stays** (H1).
- **Finalize / Kill / drop paths.** Finalize needs `lanes_idle` and mints exactly `[(ckpt_name, 1)]`. Kill6 requires the token on the dispute input and `challenger_won`. Drops require idle lanes. No path accepts a forged dispute without a validly named token.
- **Double satisfaction across lane, anchor and dispute.** Payments are tagged `PayTag{src, n}` with src = the dispute or anchor outref, so one output cannot serve two scripts. The exact burn of one name allows one resolution per tx.
- **The untested exact mint in Open.** It is the single point that makes the fix hold: rv4_02a + rv4_02b [M] reconstruct the full rv3_02 kill with this one line removed. It must have a regression test (rv4_02a is one).

## 4. Focus 2: the 12 surviving mutants
`rv4/mut4.py` applies the author's 15 replacement strings from `e2e8/mutants8.py` to the rv4 module (`mut4_results.json` [M]).

| Mutant | Run without its duplicate? | rv4 flip | Assessment |
|---|---|---|---|
| **O_mint_exact_whole_tx** | **Yes**: any LOpen tx; no other script checks lane-policy mint names | rv4_02a | **Real gap (H1)**: Critical if regressed. Add rv4_02a to the suite |
| D_own_thread_token | Yes: a RevealA/RevealB tx spends only the dispute (no lane/anchor) | rv4_03a | Harmless: a tokenless "dispute" can be revealed but never resolved or used (every resolution burns or checks the token) |
| D_one_dispute_input | Yes, in Reveal-only txs | – | Harmless: each Reveal needs its own continuing output with the same value+datum, and src is unique, so no double satisfaction |
| D_burns_own, L_dispute_token, L_whole_tx_burn, L_one_dispute_input, K_thread_token, K+D, BOTH_one_dispute_input, ALL_three_token_checks | No: every resolving tx runs dispute6 + lane6 (lane_resolves is mandatory; Kill6 co-spends the dispute) | – (and rv3 ports) | Truly duplicated, as the author says |
| L_entry_id | No (bound through `dd.lane == nm`, nm = lane_name(id‖k)) | – | Duplicated |
| Caught: O_name_is_hh_v7, BOTH_exact_burn, L_open_ge_1 | – | rv4_01a also flips under O_name_is_hh_v7 (name changes) | OK |

## 5. Focus 3: the two design choices
- **Two Opens on one hh.** With unique names (src-derived), the threads are independent; no leak or wrong-winner abuse found [E]. Side effects:
  - (i) The sybil front-run in M2. A fraudster opens first via a sockpuppet and ProveDup/ProveOrder-kills his own fraud entry immediately, recovering bond_p minus kill_fee. Honest watchers who opened later get only their orphan refund. Fraud is cheaper (≈ 250 ADA instead of 1,000) and watching less profitable. The safety property (fraud never finalizes) is intact.
  - (ii) Several C1-style frozen disputes can be stacked; that changes nothing.
  - (iii) The multi-open rule is also what makes the §1.5 counter-strategy possible.
- **ProveDup/ProveOrder without a reveal.** They prove a property of the header committed by hh (MMR-verified at LOpen). Against a valid header they cannot succeed (Zcash index rules match: distinct indices, left-first < right-first per level). D-67's argument holds [E]. No wrong-winner path found.

## 6. Doc claims that are overstated
1. D-68: "the lane minting policy itself only allows LOpen/LResolve-shaped mints, so this is defence in depth". False (H1). The policy checks only that an LOpen/LResolve lane input exists.
2. D-68: "Survivors (12), all layered duplicates, none faked". 11 of 12 (L3).
3. D-50(b) / D-60: maximum griefing stall "W_c + 2τ … independent of the griefer's budget" and "free stall = 18.67 h". False under C1/C2 (permanent, or unbounded at ~250 ADA per cycle).
4. D-50: "Honest watchers only lose bonds when they dispute a valid header". Still true. But watchers also *need* to dispute some valid headers (malformed-owner entries, C2), and possibly pre-emptively their own (C1 §1.5); that is not specified.
5. The morning summary presents v8 as fixing review 3 with chains 117/117 [M]. True for what was tested, but the chain has no adversarial field-shape tests (lengths, junk value).

## 7. Recommendations before testnet
1. 28-byte checks on every key-hash taken from a redeemer: LOpen.challenger, Propose6.owner, and audit settle6/branch fields.
2. Bound the dispute output: exact value (lovelace + thread token), `reference_script == None`. Recompute RevealA's worst-case size with an exact CBOR builder.
3. Add rv4_02a (extra lane-policy mint in LOpen) and C1/C2 negatives to the suite. Re-run mutants; `O_mint_exact_whole_tx` must be caught.
4. Correct D-50/D-60/D-68. State the watcher policy for odd-but-valid entries if any remain.
5. Short re-review of the patched v8 before Phase T.

## 8. Limits of this review
- Ledger-level facts (tx size, 28-B key-hash encoding, maxValueSize) are [E]. Sizes use the author's estimator, not exact CBOR.
- In s59-derived tests the entry id was not recomputed for owner `#""`. Finalize does not recompute it, and a real Propose would derive a consistent id.
- settle6 and branch registration were only skimmed.
- `mut4_results.json` was produced before tests rv4_01f–01i and rv4_04d/04e were added; none of the author's mutants touches field lengths.
- Time spent ≈ 75 min.
