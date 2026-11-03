# Independent review of zeUTXO v6 (ckpt-0230-final)

**Reviewer role:** second independent pass after v5 findings.  
**Snapshot reviewed:** `<BOX_HOME>/zeutxo-backups/ckpt-0230-final.tgz` extracted to `/workspace/zeutxo-review2-scratch/` only. Live author trees (v7/NU7 work) were not touched.  
**Supplemental extract (disclosed):** `ckpt-0230-final.tgz` ships docs + `e2e6/` (core6, gen, mutants, report) but **does not include** `aiken/lib/zrelay/*` or the FROST adaptor sources. Those were taken from the earlier backup `<BOX_HOME>/zeutxo-backups/ckpt-0228-v6-reviewfixes.tgz` into `/workspace/zeutxo-review2-scratch/supp0228/` and used only under the scratch runner. Decisions-log D-54 exists only in the final checkpoint; otherwise the two trees match for the contracts under review.  
**Harness:** scratch project `/workspace/zeutxo-review2-scratch/run/` (stdlib from first-review `t1`, lib from supp0228, generator helpers from first-review snap, stub for the live redpallas binary). Emulator / `aiken check` only. No nodes, network txs, real keys, outside messages, or GitHub.  
**Tags:** **[M]** = measured this pass; **[M-author]** = author's measurement, not re-measured; **[E]** = estimate / model; **[W]** = web, not chain-verified.

---

## Plain-English verdict

v6 honestly closes the v5 Critical C-1 (Equihash index bound) and largely closes the *form* of C-2 that the author advertised (parallel lanes + burns). H-1's Zcash script change is sound *in the finite model the author wrote*. H-2's Arm/grace path is real and stops the *specific* v5 "Release from Pending after a frivolous stall" path.

**v6 is still not fund-safe.** Two new Critical/High issues in the lane/checkpoint design let an attacker mint a **permanent fake checkpoint** for ~250 ADA of burn, then use ProveR/ProveC against it. Separately, Propose6 binds `since` to the attacker's chosen validity **upper** bound, so one future-dated queue head stalls the whole relay for tens of hours with the bond refunded. That breaks the D-50 / D-53 economic bounds the morning summary still cites (526k / 28k / 18.5 h / 26.6 h). Until lane names are unique per Propose, remints of existing names are forbidden, and `since` is forced to wall-clock (lower / tight interval), **do not treat custody or "≥1 honest watcher within 6.5 h" as holding**.

---

## Fix-verification table (scope a)

| Issue | Author's v6 claim | Re-run / variant | Closed? |
|---|---|---|---|
| **C-1** Equihash `ProveLeaf` / `prove_index_order` | `0 ≤ p < 512` + 1487-byte header | Author's `s29`/`s30`/`s31` still **pass as fail-tests** in the 81/81 scratch check **[M]**. Fixed `equihash.ak` in supp0228 matches the intended guards. Mutant `preC1_lib` flips those two regressions **[M-author]**. | **Yes** for the known exploit. |
| **C-2** lanes + burns + ~526k lockout | 4 lanes; Open never touches anchor; kill_fee / drop_fee / retained 225 | `s15` forged-lane fail **[M]**; two same-slot Opens **[M-author]**; C2 structural check empty **[M]** via generator. Burn accounting on Kill/drop/LClose balances in core6 **[M]** (code read). 526k is arithmetic on the author's own model **[E]**, not measured on-chain. | **Form of C-2: yes.** **Economic claim: bypassed** by NEW-C1 (collision) — no need to censor all lanes if Finalize can ignore the open one. |
| **H-1** 2-of-2 X + dual-held pre-signed R | No Bob-alone Xprime | `h1_model.py` re-run: `old` Bob-alone unprovable = True; `new` unprovable = []; `PASS` True **[M]**. Spec/adaptor text match. **Not** exercised against Zcash consensus. | **Model: yes. Real Zcash: untested** (author already says so). Residual: late-mined R vs Arm (see NEW-H3). |
| **H-2** Arm + rel_height + 6 h grace | No Release from Pending after stall | `s65`/`s66`/`s68`/`s70` fail as intended; `s69`/`s71` Arm then Release **[M]**. Mutants H2_* flip **[M-author]**. | **v5 path: closed.** **Residual High** if R is late / relay stalled past grace (NEW-H3). |
| **M-2** Bob verifies escrow | Off-chain before Claim | Generator checks rogue script hash / min_conf / r_com **[M]** (`plan_rv` offchain flags true). On-chain settle6 still does not re-check Alice's lock fields. | **As claimed (off-chain only).** |
| **M-3** Session binding | `session_id = BLAKE2b("zeutxo_adp_sessn", …)`; one session; single-use nonce | Code in `supp0228/.../frost_adaptor.rs` implements the state machine; unit assertions cover Busy / AlreadyAnswered / ParamsChanged / leak demo **[M]** (code read; binary not rebuilt this pass). Cross-protocol ROS still argued, not proven. | **Prototype: yes.** Production wallet integration still open. |

Baseline: author's chain regenerated in scratch → **81 checks, 0 failures** including the 12 reviewer exploit/control steps (see below) **[M]**.

---

## Ranked findings (scope b)

### NEW-C1 — Critical — Lane-name collision → Finalize past an open dispute → permanent fake checkpoint

**Where:** `core6.ak` `lane_name` = `blake2b(tip ‖ owner ‖ since(8) ‖ k)`; Propose6 remints those names whenever the same `(tip, owner, since)` is proposed again; `lanes_idle` / `lane_k_idle` accept **any** reference input holding qty 1 of that name with `open == 0`; Finalize6 does not bind lane UTxOs to the *current* Propose mint.

**Exploit sketch (measured end-to-end in emulator):**
1. Propose fraud tip F1 with chosen `since = S` (can be future — see NEW-H2). Cost: bond_p locked.
2. Self-open + Reveal junk + ProveLeaf via sock-puppet → Kill6. Burn **kill_fee = 250 ADA**. Old lane UTxOs remain, `open = 0`, same names.
3. Re-Propose the **same** tip/owner/since. Mint succeeds; total supply of each lane name becomes 2. New lanes sit in the live entry.
4. Honest watcher Opens on the new copy (e.g. on the fake intermediate hash) inside the nominal window.
5. Finalize6 references the **stale idle** copies → `lanes_idle` true → fake Summary3 checkpoint minted to the unspendable sink.
6. Watcher's dispute times out into the **orphan** path (entry no longer live) → bond_c refund only; entry not killed.

**Evidence [M]:** scratch tests in `e2e6_rv.ak` / `plan_rv.json`:
- `s82_rv_H1_repropose_same_tip_owner_since_mints_duplicate_lane_names` pass  
- `s85_rv_H1_control_finalize_with_new_lanes_fails_open_dispute` pass (fail-test)  
- `s86_rv_H1_EXPLOIT_finalize_fraud_with_stale_duplicate_lanes` **pass** (exploit accepted by validators)  
- `s87_…_orphan_refund_only` pass  
- offchain `RV_H1_fraud_checkpoint_permanent = true`

Full suite: **81/81 pass** including exploit **[M]**.

**Impact:** Attacker gets a permanent, token-backed checkpoint for a forged branch. Settle6 ProveR/ProveC only check checkpoint token + MMR inclusion against that Summary3 — so a party can be paid the ADA escrow against a fake Zcash history (both-assets / wrong-payee path depending on which commitment is forged). Effective honest challenge window after a self-kill cycle collapses toward `W_c + g_d − τ` relative to `since` (and can be scheduled via NEW-H2).

**Fix:** Make lane token names unique per Propose (include anchor input `OutputReference` or a monotonic counter committed in the entry). Forbid reminting an existing name (supply ≤ 1 forever, or burn-on-kill of all lane tokens). Prefer binding Finalize to lane UTxOs whose datum `since`/`tip` match **and** whose creating tx is the live Propose (e.g. thread token carries Propose out-ref).

---

### NEW-H2 — High (Critical when combined with NEW-C1) — Future-dated `since` stalls the relay nearly for free

**Where:** Propose6 sets `Entry6.since = upper` from the tx validity interval (`core6.ak` Propose6). Drop needs `lower ≥ since + w_c`; Finalize needs `lower ≥ since + w_c + g_d`. Cardano allows choosing `upper` hours ahead **[E]** (~36 h stability-horizon class figure; exact Conway bound not re-fetched).

**Evidence [M]:**
- `s78_rv_H2_propose_fraud_F1_with_since_30h_in_future` pass (Propose with `upper = now + 30 h` accepted).
- `s83_rv_H2_finalize_at_propose_plus_8_5h_fails_since_future_dated` pass as fail-test (Finalize at Propose+8.5 h still rejected — clock starts at future `since`, not at Propose).

**Impact:** One future-dated entry at queue head blocks canonical advancement until `since + 7.5 h`. Bond_p is refunded on Finalize/Kill — capital lock, not a burn. This **invalidates** the D-50 M-1 bound (~28k ADA / 7 d of *burned* bond cycles) and the D-53 "max stall 18.5 h / Arm delay 26.6 h" assumptions whenever the attacker can choose `since`. Combined with NEW-C1, the attacker can place `since` just far enough that the honest Open lands, then Finalize via stale lanes before Kill can help.

**Fix:** Require `since = lower` (or `since ∈ [lower, lower + δ]` with δ ≈ one slot / few minutes) and `upper − lower ≤ δ`. Reject Propose if `upper` is beyond a small skew of wall time as seen by `lower`.

---

### NEW-H3 — High — H-2 residual: late R + relay stall → Bob Arms and Releases; Alice loses both

**Where:** settle6 Arm / Release; R has `nLockTime = L_R` but adaptor-spec still allows `nExpiryHeight = 0` (no expiry). Grace = 6 h ≪ author max dispute stall 18.5 h and ≪ NEW-H2 stall.

**Sketch:** Bob withholds cooperation so C never lands. R is mined late (Alice offline, or Bob races). After `rel_height` exists, Bob Arms. Alice must land ProveR inside the 6 h grace with a checkpoint ≥ `h_R + 330`. Bob (or a friend) stalls the relay with future-dated Propose (NEW-H2, ~free) or honest-looking disputes (≤18.5 h, 225 ADA). Grace expires → Release pays Bob ADA while Bob also holds/controls the ZEC path via R already spent or still holdable. Symmetric grief: Alice can be forced into Fallback/ReleaseRelayDead under NU7 liveness failure (see below).

**Evidence:** Logic + D-53 numbers **[E]**; Arm/Release negatives confirm the happy path only **[M]**. No end-to-end late-R test in e2e6.

**Fix:** Set R `nExpiryHeight = L_R + D_mine` (or a short ladder of pre-signed height-locked refunds); require grace ≥ worst-case stall after NEW-H2 is fixed; or make ReleaseProveR-only until `t_fb` with no Bob Release from Armed unless Alice's ProveR window is longer than any stall.

---

### NEW-M1 — Medium — Reveal ≈ 97.4% of max tx size (liveness)

**Claim:** Reveal ≈ 15,957 B = 97.4% of 16,384 **[M-author]** (`report6.txt` lines for honest/fraudulent reveal). Scratch did not re-serialize txs.  
**Impact:** Little headroom for collateral, extra ref scripts, or fee variance — honest Reveal can fail to fit / relay. Author already flags split / reference-script layout.  
**Fix:** Split Reveal (root first, leaves in follow-ups) or reference-script the dispute validator and shrink the inline blob.

---

### NEW-M2 — Medium — Mutant survivors are "redundant" only under incomplete tests

**Survivors [M-author]:** `C2_lane_thread_token` (delete input-token expect) and `L2_header_len` (delete 1487 check) flip nothing in the 69-test suite.  
**Assessment:** Author's redundancy argument for `L2_header_len` (wrong length → wrong leaf) is plausible. For `C2_lane_thread_token`, author notes the double-satisfaction merge was **not** tested. NEW-C1 shows name-level reasoning about "token implies honest lane" is unsafe when supply > 1. Treat the explicit checks as **load-bearing**, keep them, and add a mutant/negative that merges a forged lane UTxO with a real spend.  
**Not a new Critical by itself** once NEW-C1 is fixed and supply is capped.

---

### NEW-M3 — Medium — NU7 parameterization gap (time-sensitive)

**D-54 [W]:** NU7 testnet live; mainnet height **3,543,405**. Web check this pass: ZIP 259 / Zebra 7.0.0 / Zakura 1.7.0 agree on height 3,543,405 and 25 s spacing **[W]**; calendar ETA ~Nov 5–6 2026 UTC **[W]**. Relay still uses pre-NU7 DAA (W=17, 75 s) **[M]** in gen params.  
**Impact:** After activation, honest headers fail the relay → M-1 / ReleaseRelayDead / Fallback economics become the safety story — unsafe under NEW-H2. Author correctly flags this as prerequisite for testnet/mainnet.

---

### Looks closed / OK under this pass

- **C-1 library fix** (above).  
- **Kill / drop / LClose burn tagging** (`PayTag` n=-1 sink) consistent in generator + validator **[M]** code read.  
- **Dispute thread token** unique per LOpen (`hh`); burn on LResolve **[M]**.  
- **Checkpoints** at unspendable sink, token `ckpt‖tip`, Prove* requires token — immutable as designed **[M]**; danger is *what* gets checkpointed (NEW-C1), not spendability.  
- **Double-satisfaction** of dispute+lane cospend: negatives without lane cospend fail **[M]**.  
- **H-1 model** PASS **[M]**.  
- **M-3 session machine** present and asserted in Rust sources **[M]** code read.

---

## Doc claims (scope c)

| Claim (morning-summary / D-50–53) | Assessment |
|---|---|
| C-1 fixed; reviewer exploit fails | **True [M]** |
| C-2: 4 lanes; Open ≠ anchor; ~526k to censor window | Mechanics **true [M]**; 526k **[E]** arithmetic OK **if** censorship is required. NEW-C1 means censorship is **not** required to land a fake checkpoint. Trust table line "censoring disputes costs ≈526k" is **misleading post-v6**. |
| H-1 2-of-2 + dual R; model PASS | **True [M]** for the model; regtest still missing |
| H-2 Arm + 6 h grace; v5 Release path dead | **True [M]** for that path; residual NEW-H3 |
| Max stall 18.5 h; M-1 ≈28k ADA/7d; Arm delay ≈26.6 h+D | **Broken by NEW-H2** (and NEW-C1). Figures assume `since ≈ Propose time` and burn-per-round economics. |
| Reveal 97.4% | Plausible **[M-author]**; keep as open liveness risk |
| 10/12 mutants; 2 redundant | **[M-author]**; redundancy claim incomplete (NEW-M2) |
| NU7 ≈ Nov 5 @ 3,543,405 | Height **confirmed by ZIP/Zebra [W]**; date is estimate |
| "Custody: nobody if H-1 holds" | **Overstated** until NEW-C1/H2/H3 closed and H-1 hits real Zcash consensus |
| M-2/M-3 as in D-52 | Match code **[M]**; limits correctly caveated by author |

---

## Suggested fix order (for v7)

1. Unique lane ids + no remint of existing names; Finalize binds live lanes only.  
2. `since := lower` with tight validity interval.  
3. Recompute stall / Arm / grace / `t_fb` after (1)+(2); extend grace or refund ladder for late R.  
4. NU7 DAA + spacing in branch/relay.  
5. Reveal split before any public dispute drill.  
6. Keep explicit mutant-covered guards; add double-satisfaction / supply≤1 tests.

---

## Artifacts produced this pass

- `/workspace/zeutxo-review2-scratch/` — final + supp0228 extracts (read-only intent).  
- `/workspace/zeutxo-review2-scratch/run/` — harness, `e2e6/gen_e2e6_rv.py`, `e2e6/rv_exploits.py`, `aiken/validators/e2e6_rv.ak`, `e2e6/plan_rv.json`.  
- Aiken: **81/81** on `e2e6_rv` including exploit `s86` **[M]**.  
- This file: `/workspace/zeutxo-independent-review-v6.md`.

*End of review.*
