# Independent review of zeUTXO v7 (ckpt-0355-v7-final-depth990)

**Reviewer role:** third independent pass (adversarial; not the author).  
**Snapshot reviewed:** `<BOX_HOME>/zeutxo-backups/ckpt-0355-v7-final-depth990.tgz` extracted only under `/workspace/zeutxo-review3-scratch/`. Author live trees (including `/workspace/zeutxo-step1-relay-cost`) were not modified.  
**Harness:** `/workspace/zeutxo-review3-scratch/run/aiken` (stdlib v4.0.0 + aiken.toml copied from the prior review2 harness; `lib/zrelay` and contracts from the v7 snapshot). Exploit module: `validators/e2e7_rv3.ak` built by `rv3/build.py` from the snapshot’s `e2e7_run_main.ak` plus `rv3/rv3_hand.ak`.  
**Scope:** emulator / `aiken check` only. No nodes, network txs, wallets, real keys, GitHub, or outside messages. Public ZIP 218 was read read-only.  
**Tags:** **[M]** measured this pass; **[M-author]** author’s numbers not re-measured; **[E]** reasoning / arithmetic; **[W]** public web (ZIP), not chain-verified.  
**Clock:** America/New_York (ET). Review finished ~4:06 AM ET, Mon Nov 2, 2026.

---

## Plain-English verdict

v7 **does** close the three review-2 holes it claimed to close (NEW-C1 one-shot ids, NEW-H2 `since`/max_skew, NEW-H3 R expiry + 21 h grace + R′). The author’s regressions for those three, plus the depth-990 S7 path and the RevealA/B split, re-ran cleanly as a baseline: **103/103** on the snapshot’s `e2e7_run_main` **[M]**. NU7 difficulty rules in `header_c7.ak` match ZIP 218 on the points checked (activation predicate, W∈{17,102}, spacing, Testnet 450 s **strict** gap, MeanTarget/ActualTimespan shape) **[W+E]**; the author’s claim of matching real Testnet/Mainnet nBits was **not** re-measured against live RPC this pass.

**v7 is still not fund-safe.** A new Critical in the dispute-thread minting policy lets an attacker mint two dispute UTxOs for the **same** header hash `hh`, resolve them in one tx while burning only one token, and **exfiltrate** the leftover thread token. With that token the attacker can mint a forged dispute at the dispute script and (a) **Kill any live queue entry** (honest or fraudulent), pocketing `bond_c_forged + bond_p − kill_fee` (~750 ADA profit when `bond_c_forged = 2 ADA`), and/or (b) **zero** a lane’s `open` counter while an honest dispute is still pending, then Finalize a fraud checkpoint. Measured end-to-end in the emulator **[M]**. Until dispute thread names are unique per Open (or mint/burn is per-input, not whole-tx), the lane/checkpoint story and every economic bound that assumes “honest Open blocks Finalize” are void.

**Bottom line for testnet:** **No.** Emulator testnet drills that assume custody or “≥1 honest watcher within W_c” are not justified. Fix the dispute-token uniqueness / burn-accounting bug, re-run the RV3 suite (and review-2’s s86) as regressions, then reconsider Phase R/T.

---

## Fix-verification table (review-2 → v7)

| Issue | Author claim (D-58..D-64 / morning summary) | This pass | Closed? |
|---|---|---|---|
| **NEW-C1** one-shot `entry_id` / lane names | Finalize via stale F1 lanes fails; re-propose gets fresh id | Baseline `s108_neg_s86_…` is a fail-test (accepted as fail); `s102` re-propose present **[M]** (103/103). Code: `entry_id(own_ref)`, `lane_name(id‖k)`, `lanes_idle` requires `ld.id == e.id` at lane script **[M]** code read. | **Yes** for the published s86 shape. **Bypassed** by NEW-C1′ below (no remint needed). |
| **NEW-H2** `since = lower`, `max_skew` | Future/back-dated Propose and long-interval Open/Reveal fail | `s92`/`s93`/`s28`/`s32`/`s98`/`s103` fail-tests in baseline **[M]**. Propose/LOpen/RevealA/RevealB all gate `upper−lower ≤ max_skew` **[M]** code. | **Yes.** |
| **NEW-H3** R `nExpiryHeight`, grace 21 h, R′ | R at expiry provable at Arm ckpt; grace ≥ stall | `s78`–`s80` S6 path in baseline **[M]**. Spec §12 documents R′ **[M]** doc. Grace formula in `timing7.py` matches D-60 **[E]**. | **Yes** for the late-R/Arm race *as modelled*. Residuals: Zebra “expiring soon” not verified **[W]**; R′ is off-chain policy only. |
| **NEW-M1** Reveal split | RevealA/B under 80% tx size; HalfRevealed Timeout → challenger | Baseline `s35` wrong-half fail, `s110` HalfRevealed Timeout orphan **[M]**. `equihash7.reveal_join` requires `v8_l == v8_r` **[M]** code. | **Liveness: yes.** Abuse: see Reveal section (no wrong-winner found beyond the Critical). |
| **Depth 990** (D-64) | Equal work to 330 pre-NU7; S7 ProveR 966 fail / 990 pass | `s82`–`s84` in baseline **[M]**. `required_conf` off-chain policy only; settle enforces datum `min_conf` **[M]** code. | **Policy sound [E].** Emulator check yes **[M]**. |
| **NU7 header_c7** | Matches ZIP 218; real headers | Predicate `c >= nu7_height`, W/spacing switch, min-diff `time−t0 > 450` → `pow_limit`, Tip3 102-deep queues **[M]** code vs ZIP 218 **[W]**. Author 281/281 / 215/215 **[M-author]** not re-run. | **Plausible; residual** (params, min-diff data gap, Tip3 init trust). |

Baseline this pass: **`aiken check -m e2e7_run_main.{..}` → 103 checks, 0 errors [M]** (~40 s).

---

## Ranked findings

### NEW-C1′ — Critical — Dispute thread token not unique → leak → Kill any entry / fake checkpoint

**Where:** `lane6` LOpen mints `[(hh, 1)]` with name = header hash only; LResolve requires whole-tx mint `[(hh, −1)]` (not “burn exactly the input’s token”); `dispute6` Kill/LResolve paths trust any input at the dispute script that holds qty 1 of `(lane_hash, hh)`.

**Exploit (measured):**

1. **RV3-0** Open a second dispute on the **same** `hh` on another lane of the same entry → accepted **[M]** (`rv3_00_second_open_same_hh_on_lane1` pass). Two UTxOs now hold the same thread name.
2. **RV3-1** Resolve both in one tx (Timeout after honest Reveal, proposer-win path). Each LResolve checks `mint == [(hh,−1)]` for the **entire** tx → one burn satisfies both; the second token is paid to the attacker’s wallet **[M]** (`rv3_01_…_leaks_dispute_token` pass).
3. **RV3-2** Attacker sends a forged dispute UTxO (phase `Opened`, `deadline = 0`, `challenger = attacker`, `entry_id` of honest entry A) carrying the leaked token, co-spends Kill6 + Timeout + LResolve on a zero-open lane → **honest entry A is dropped mid-window**; attacker receives `pot + bond_p − kill_fee` (752 ADA with pot = 2 ADA); O1’s 1,000 ADA bond is seized; later entry B is refunded; lane `open` goes to **−1** (no underflow guard) **[M]** (`rv3_02_…_attacker_profits_750` pass).
4. **RV3-3** Same token, forged “proposer won” (`Revealed`, deadline 0) against a lane with a **pending honest dispute** (`open = 1`) → lane zeroes to `open = 0` without touching the real dispute **[M]** (`rv3_03_…` pass).
5. **RV3-5** Author’s own `s107` Finalize of fraud F2 (which correctly fails with `open = 1`) **passes** after the zeroing in (4) **[M]** (`rv3_05_finalize_fraud_F2_after_forged_lane_zeroing` pass) → permanent fake checkpoint.

**Control:** forged dispute **without** the thread token is rejected **[M]** (`rv3_04_…` fail-test pass).

**Cost to attacker [E]:** one frivolous Open (lose 225 ADA to the lane) + fees, **or** wait for any natural double-Open on the same `hh` (two watchers, or watcher + sock-puppet). Profit on Kill ≈ 750 ADA + denial of honest relay progress / theft via fake ProveR/ProveC against the checkpoint.

**Impact:** Breaks C-2 / D-50 custody story, NEW-C1’s “lanes_idle is meaningful,” Finalize safety, and every stall/cost bound that assumes an open dispute blocks Finalize. Symmetric grief: kill honest entries forever (freeze / force Fallback/ReleaseRelayDead).

**Fix sketch:** (1) dispute thread name = `blake2b(entry_id ‖ k ‖ hh ‖ open_nonce)` or include the lane out-ref so names are unique per LOpen; (2) LResolve must burn **the specific input’s** token (or require mint map to burn qty equal to the number of resolving disputes for that name); (3) reject LOpen if `hh` already has a live thread; (4) `open` must stay ≥ 0; (5) Kill6/LResolve should refuse `open ≤ 0` on the cospent lane unless the dispute was the one that incremented it (stronger binding).

**Repro:** `/workspace/zeutxo-review3-scratch/rv3/` — `python3 build.py` then `cd ../run/aiken && aiken check -m e2e7_rv3.{..}`. Results: `rv3/rv3_results.tsv` (6/6 pass including exploit) **[M]**.

---

### NEW-H1′ — High (absorbed into Critical path) — `ProveDup` / `ProveOrder` / `Timeout` ignore phase consistency with token authenticity

**Where:** `dispute6` ProveDup/ProveOrder do not require `Revealed`; Timeout only checks `lower > deadline`. Combined with a leaked token, any phase/deadline the attacker writes is enforceable.

**Evidence:** RV3-2 uses `Opened` + `deadline = 0` + Timeout at `now = 5_000_000` ms **[M]**. Code read confirms no phase gate on ProveDup/ProveOrder **[M]**.

**Impact:** Lowers the bar for the Critical (no need to wait for a real deadline). Even without a leak, ProveDup/ProveOrder without Reveal is a latent dispute-game footgun for future changes.

**Fix:** Require `Revealed` for ProveLeaf/Dup/Order; require authentic Open→… lineage (thread token commits to phase transitions, or dispute datum is only updatable by proposer-signed Reveal*).

---

### NEW-M1′ — Medium — RevealA/B half state: stall only, no wrong-winner found beyond Critical

**Checked [M+E]:**
- Timeout in `HalfRevealed` → challenger win (`challenger_won`, baseline `s110`) **[M]**.
- RevealB with a non-colliding right half fails (`s35`) **[M]**; `reveal_join` demands `v8_l == v8_r` **[M]** code.
- RevealA/B require proposer signature and tight interval; deadline unchanged on A, refreshed on B — worst stall still ≤ open_deadline + τ ≈ prior bound **[E]**.
- Challenger cannot complete RevealB (no proposer sig). Proposer cannot “mix” two honest halves of different headers past level-9 **[M]** (author negative + join check).

**Residual:** Proposer can RevealA then go offline → challenger Timeout wins (correct). No separate theft path from the split itself once the Critical is fixed. Tx-size claims RevealA 56.7% / RevealB 48.0% **[M-author]** not re-serialized this pass.

---

### NEW-M2′ — Medium — NU7 / Tip3 residual risks (not theft by themselves)

| Point | Assessment |
|---|---|
| Activation `c >= nu7_height` | Matches ZIP 218 `IsNU7Activated` **[W]**. |
| W 17→102, spacing 75→25, AWT 1275/2550 | Match ZIP 218 **[W]**; code switches on **candidate** height **[M]**. |
| Testnet min-diff gap `> 450` → `pow_limit` | Match ZIP 218 (strict) **[W+M]** code. **No real min-diff block** in author’s data (author admits) — synthetic only. |
| `Params7` as validator params | Wrong `nu7_height` / `pow_limit` → honest headers rejected → liveness failure → Fallback/ReleaseRelayDead economics. Parameter trust is explicit, not hidden. |
| Tip3 genesis / 102-deep init | Not re-audited for hand-crafted tip corruption; Propose still requires heavier chainwork + descent proof, disputes catch fake Equihash. Residual: corrupted history that still satisfies local DAA could bias work until disputed **[E]**. |
| Author “bits always enforced” vs v6 | Claim plausible **[M]** code (`bits_encode` every step). |

---

### NEW-M3′ — Medium — Depth 990 / timing claims

- Equal-work argument (330×3) is sound under constant hashrate **[E]**; ZIP 218 also notes confirmation counts vs wall-clock are a product choice **[W]**.
- `timing7.json` arithmetic recomputed: `stall = max(7.5, 6.5+12+1/6) = 18.667…`, grace 21 ≥ 20.67, Bob wait ≈ 1+6.875+0.5+18.67+21 ≈ **48.0 h** with conf=990 **[E]** (matches author).
- Paid stall ≈ 168/6.67×1000 ≈ **25.2k ADA / 7 d** **[E]** — **void under NEW-C1′** (attacker need not pay bond_p cycles to land a fake checkpoint or kill honest entries).
- Grace 21 h still depends on “lanes_idle means a real open dispute”; Critical breaks that.

---

### NEW-L1′ — Low — Doc / claim overstatements

| Claim | Assessment |
|---|---|
| Morning summary: “All three [NEW-C1/H2/H3] are fixed” | **True for those CVEs**; **incomplete** — new Critical remains. Summary correctly says “v7 itself has not been reviewed.” |
| “Custody: nobody if H-1 holds” (older docs) | Still overstated; H-1 untested on Zcash consensus; Critical breaks relay settlement. |
| Integration results “105/105” vs checkpoint “110/110” / this pass “103 script checks” | Counting drift across commits; this snapshot’s `e2e7_run_main` = **103 tests [M]**. Prefer the checkpoint under review. |
| Spec §12 still shows “≈ 43.5 h” in one bullet while D-64 says 48.0 h | Stale line in adaptor spec (last bullet under §12) **[M]** doc — overstated wait is the smaller number (harmless direction), but inconsistent. |
| Mutant “17/20 caught; 3 redundant” | **[M-author]**; Critical is outside that suite (no mutant deletes “unique hh”). |

---

## RevealA/B abuse checklist (focus item 2)

| Abuse | Result |
|---|---|
| Stall after RevealA | Challenger Timeout wins **[M]** — OK |
| Mix halves of two headers | Level-9 join fails **[M]** — OK |
| Challenger forges RevealB | Needs proposer sig — blocked **[M]** code |
| Wrong winner via HalfRevealed | Not found beyond using Critical forged Timeout **[M]** |
| Deadline games with max_skew | Bounded by NEW-H2 **[M]** |

---

## Artifacts

- Scratch extract: `/workspace/zeutxo-review3-scratch/zeutxo-step1-relay-cost/` (from ckpt-0355).  
- Harness: `/workspace/zeutxo-review3-scratch/run/aiken/`.  
- Exploits: `/workspace/zeutxo-review3-scratch/rv3/` (`rv3_hand.ak`, `build.py`, `rv3_results.tsv`, `README.md`).  
- Baseline: `/tmp/rv3_base.json` (103/103); exploits: `/tmp/rv3.json` (6/6).  
- This file: `/workspace/zeutxo-independent-review-v7.md`.

---

## Suggested fix order before any testnet phase

1. **Unique dispute thread names + correct burn accounting** (closes NEW-C1′); add RV3-0…5 as regressions; keep `open ≥ 0`.  
2. Phase-gate Prove* ; bind Kill to a lane that actually opened that dispute.  
3. Re-derive stall / paid-stall / grace **after** (1).  
4. Keep NEW-H2/H3/R′/990 as-is; fill min-diff real-header gap when data exists.  
5. External review of v7+fix before Phase T.

---

## Verdict

**Is v7 sound enough to justify a testnet phase?** **No.** Prior Criticals are fixed, but a new, cheaper Critical lets an attacker mint fake checkpoints and kill honest relay entries after leaking a non-unique dispute thread token (~225 ADA or less). Emulator-only testnet work that assumes fund safety or honest-watcher finality is not justified until that is closed and re-reviewed.

*End of review.*
