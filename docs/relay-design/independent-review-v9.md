# Independent adversarial review of zeUTXO v9

**Reviewer role:** independent (not the author). Emulator-only on the box.  
**Snapshot:** `<BOX_HOME>/zeutxo-backups/ckpt-0554-v9-final.tgz` → `/workspace/zeutxo-review5-scratch/`.  
**Date:** Mon Nov 2, 2026 ~6:50 AM America/New_York.  
**Prior art:** reviews v5–v8 each found ≥1 Critical; v8’s RV4-C1/C2 were unchecked payee lengths. v9’s well-formedness sweep and kill_fee=900 address that class. This review prioritised settle6 + branch/register + WF-table gaps + D-74 economics + adaptor-spec issues the emulator cannot catch.

**Verdict: NOT sound enough to justify a testnet phase.** One new Critical (measured end-to-end in the emulator) lets a relayer finalise a branch whose MMR contains a forged header that no watcher can dispute, then ProveR/ProveC a txid that was never mined and take the escrow. The v8 freezes are gone; the theft path is worse.

Exploits: `/workspace/zeutxo-review5-scratch/rv5/` (`rv5.ak`, `gen_c1.py`, `rv5_consts.ak`). Prior exploits copied read-only as `rv4_copy/`. Run: from a project that embeds `e2e9` template + `rv5.ak` tests, `aiken check -m "rv5.{..}"` → **10/10 as expected** (8 must-pass + 2 must-fail).

---

## Findings

### RV5-C1 — Undisputable forged MMR history → ProveR/ProveC of a never-mined txid (Critical) [M]

**Root cause (two checks that do not compose):**

1. **`descends()` / Propose6** only prove that the *previous tip leaf* sits in the candidate branch MMR:
   ```
   mmr.verify(leaf_c(anc_prefix, anc.hash), anc.height - base, path, cand.mmr.count, cand.mmr.peaks)
   ```
   Nothing binds leaves *below* that index to the honest history.

2. **LOpen** only allows challenges with `prev_height < base+i ≤ height` (the entry’s *new* segment). A forged leaf at an index ≤ `prev_height` is therefore **not openable**, even when it verifies against the entry MMR (control test).

**Compressed headers make forging cheap:** `accept_c7` / Extend3 check linkage, time, bits/target and `hash ≤ target`, but **not Equihash**. Equihash is deferred to the dispute game — which can never start on the forged leaf. The attacker only needs a SHA-256 preimage ≤ target (emulator used the min-difficulty / `pow_limit` rule; grind wall-clock ≈ 5 s for 10 headers). On mainnet difficulty the same attack costs about one block of SHA-256 grinding [E] and still never needs a valid Equihash solution for the forged header.

**Attack (Bob or a colluding relayer, or Alice after Claim):**

1. Honest entry E1 tips at height H with MMR of the real chain.
2. Attacker Extend3-s a branch that keeps the honest tip leaf at index H−base, but replaces some earlier leaf F (height ≤ H) with `leaf_c(F_prefix, HF)` where F’s merkle root commits to an arbitrary `txid_R` that was never mined, then reconnects with a forged prefix G whose `prev` is HF and whose declared hash equals the real next block. Measured: `rv5_c1a` / `rv5_c1a0` — Extend3 and `accept_c7` accept the batch; F’s forged leaf is in the resulting MMR.
3. Propose6 with `aprefix =` real E1 tip prefix and a `dpath` for index H−base. Measured: `rv5_c1b` (`descends` alone) and `rv5_c1c` (full Propose6 + mint) **pass**.
4. Watcher tries LOpen on F: rejected by `base+i > prev_height`. Measured: `rv5_c1d` must-fail passes; control `rv5_c1d_control` shows F *does* verify in the entry MMR.
5. After W_c+g_d with idle lanes, Finalize6 mints an immutable checkpoint whose `mmr_root` bags the forged peaks.
6. `ProveR`/`ProveC` with `InclusionProof6` on F: `header_leaf(F_full)` matches, tx-merkle proves `txid_R`. Escrow pays. Measured: `rv5_c1e` (ProveR → Alice), `rv5_c1f` (ProveC while Locked → Bob); control against an honest root fails (`rv5_c1g`).

**Theft variants:**

| Escrow phase | Redeemer | Who gets ADA | ZEC side |
|---|---|---|---|
| Locked | ProveC (fake C) | Bob | Alice never sees `t`; Bob later takes R′/R. Pure ADA theft. |
| Locked | ProveR (fake R) | Alice | Bob never claimed; Alice has no `t`. Pure ADA theft; Bob refunds ZEC via R′. |
| Pending (Bob claimed, `t` public) | ProveR (fake R) | Alice | Alice also completes real C with `t`. **Alice takes both ADA and ZEC.** |

`ProveC`/`ProveR` intentionally have **no phase gate** (fallback settlement). That is fine for real C/R and fatal once a forged leaf can reach a checkpoint.

**Why v9’s WF sweep does not touch this:** every field is well-typed and every output is exact. The invariant that is missing is semantic: *every MMR leaf under a finalised summary must be openable to Equihash challenge, or must be bound by an inductive extension of a previously finalised MMR*.

**Fix direction (not implemented):** e.g. (a) Propose must prove the candidate MMR *extends* the previous summary’s peaks (append-only), not merely contains one tip leaf; and/or (b) LOpen must allow any index in `[0, height−base]`; and/or (c) settlement headers must carry an Equihash proof (defeats the compressed-header cost goal). Any one of (a) or (b)+(honest tip finalised) closes this exploit.

**Reproduce:**
```
cd /workspace/zeutxo-review5-scratch/proj   # template + rv5.ak as built in this review
/workspace/tools/aiken-x86_64-unknown-linux-musl/aiken check -m "rv5.{..}"
# expect: rv5_c1a/b/c/e/f + controls pass; rv5_c1d + c1g fail-tests pass (rejected)
```

---

### RV5-H1 — Adaptor open items O1–O4 still block a testnet claim of “trustless happy path” (High) [E]

From `zeutxo-step2-adaptor-spec.md` §9, unchanged by v9:

- **O1** FROST/adaptor nonce hook for Orchard claim (or 2-party Schnorr with commit-reveal) — no security argument in-repo.
- **O2** BIP-340 even-y / sign(`t`) parity — “easy to get wrong”; no test vectors wired to settle6 Claim.
- **O3** Cross-group DLEQ Pallas↔secp256k1 — soundness not reviewed; a bad DLEQ lets Bob put independent `T_s`/`T_p` so Alice’s extracted `t` does not authorise C.
- **O4** Fixed fees / no CPFP for C,R — congestion can burn D_mine and force R′.

The emulator cannot catch these. They are not an excuse to skip fixing RV5-C1; together they mean even a C1-patched relay does not yet justify advertising a trustless adaptor happy path on testnet without an external crypto review of O1–O3.

---

### RV5-M1 — WF-S0 / `settle_wf` does not match the well-formedness table (Medium) [M]

`e2e9/wellformedness.md` claims settle escrow shape checks include “ADA only, script address with no stake part, phase Locked”. The code in `gen_e2e9.py` is:

```python
def settle_wf(pkh_a, pkh_b, pa, ccom, rcom, mc, h):
    return (len(bytes.fromhex(pkh_a)) == 28 and len(bytes.fromhex(pkh_b)) == 28
            and len(pa) == 32 and len(ccom) == 32 and len(rcom) == 32
            and len(TAG) > 0 and 0 < T_A < T_A + PEND < T_FB and mc >= 330)
```

`h` is unused; stake part, extra tokens, reference_script, and `phase` are not checked here. Bob’s exact-equality `bob_verifies_escrow` still saves an attentive Bob (`tokens == {}`, full datum match, script hash). A party that only runs `settle_wf`, or a future caller that reuses it, can accept a stake-bearing or token-bloated escrow. Documentation / defence-in-depth gap, not a solo theft path given M-2.

---

### RV5-M2 — D-74 stall bounds are restored only *conditional* on closing RV5-C1 (Medium) [E]

v9’s payee WF fixes do restore the *premise* of D-50/D-60 (“every dispute has a satisfiable exit”) for the v8 freeze class — regressions in `e2e9_reg.ak` pin that [M from author]. With kill_fee=900 / R=100 (D-72), self-kill discount is 100 ADA and a fraud cycle costs ≥900 ADA.

But D-74’s claim that “max free stall per honest entry 18.67 h” and “paid stall ≈ 25.2k ADA / 7 days” **does not hold as a safety bound** while RV5-C1 is open: the attacker does not stall the relay; they finalise a forged history and settle. After C1 is fixed, the D-72 economics look directionally right [E] (watcher reward covers fees + bond_c lockup; natural watchers are the swap parties). Re-measure paid-stall under 900 before citing the 25.2k figure.

---

### RV5-L1 — Checkpoint output has no min-ADA floor in Finalize (Low) [E]

Finalize checks `exact_out` (token + no ref script) and datum, not `lovelace ≥ ckpt_min`. The real ledger’s min-UTxO rule rejects a 0-ADA output, so this is unexploitable on-chain; the WF table should mark it E-by-ledger or add an explicit ≥ lane_min-style check for symmetry with lanes.

---

### RV5-L2 — `ProveC`/`ProveR` ignore phase (Low as isolated; Critical as C1 amplifier) [M]

Documented fallback behaviour; `rv5_c1f` shows ProveC in Locked. Harmless for honest C/R; required ingredient for the Locked-phase theft rows in RV5-C1. No change needed once C1 is fixed; worth a one-line comment in settle6 so future reviewers do not “tighten” it into a liveness bug.

---

## WF table audit (focus area 3)

| Area | Assessment |
|---|---|
| Payees (owner, challenger, pkh_*) | Closed for the v8 class (WF-A1/L1/D1/P1) [M author + this review’s reading]. |
| Created script outputs (branch/anchor/lane/dispute/ckpt/settle cont.) | Exact address / value / no ref script present [M]. |
| “(also proof)” rows | Acknowledged; mutants9 survivors match the table (D-75). |
| **Missing semantic invariant** | MMR leaves under a proposed/finalised summary must be disputable or inductively bound — **not in the table**. This is RV5-C1. |
| Settle creation (no script) | WF-S0 incomplete vs table (RV5-M1). |
| Sink fee shape | N/A rationale accepted. |
| Salt length | N/A rationale accepted. |
| List lengths | Cost-bounded; hash-bound; accepted with register mem ~88–91%. |
| RevealA size | D-73 model 9,080 B under v9 limits [E author]; WF-L1/L6 remove the v8 bloat path. |

---

## settle6 happy-path / refund matrix (focus area 1, aside from C1)

| Path | Who paid | Gate | Notes |
|---|---|---|---|
| Claim → Pending | (cont.) | BIP-340 under `p_a`, `pkh_b` signs, upper≤t_a | OK; sig 64 B (WF-S1). |
| CoopRelease | Bob | `pkh_a` signs, not Locked | OK. |
| Arm → Armed | (cont.) | ckpt height ≥ rel_height, lower > release_at | Trusts ckpt — **C1 poisoned ckpt Arms too**. |
| Release | Bob | lower > armed.release_at | OK given honest Arm. |
| ReleaseRelayDead | Bob | Pending, lower > t_fb | OK; D-50 bound. |
| ProveC | Bob | c_com + inclusion | **C1**. |
| ProveR | Alice | r_com + inclusion | **C1**. |
| Fallback | Alice | Locked, lower > t_fb | OK. |

Off-chain escrow check (Bob) is exact-equality + settle_wf shape; no on-chain creation validator by design (O). C1 does not need a malformed escrow.

Inclusion-proof binding for an *honest* leaf looks correct: `header_leaf` ↔ MMR, txid ↔ header merkle root, ckpt token name ↔ summary hash, `min_conf` vs ckpt height. The failure is which leaves a ckpt may commit to.

---

## branch/register under adversarial batches (focus area 2)

Extend3 WF-B1..B4 look right. Adversarial batch content (forged merkle roots, reconnect prefixes) is accepted whenever hash/PoW/linkage hold — by design of compression. Combined with descends-as-single-leaf, that is RV5-C1. No separate “batch stuffing” Critical found beyond C1. Tip3 NU7 windows were exercised by the synthetic min-diff chain in `rv5_c1a0`.

---

## What v9 did fix (credit)

- RV4-C1/C2 payee-length freezes: closed with WF-A1/L1/D1/P1 and regressions [M author].
- RevealA size griefing via junk value / huge challenger: closed with WF-L6/D2 [M author].
- Exact mint regressions rv4_02a/c/d (RV4-H1) [M author].
- kill_fee 900 / R=100 is a coherent response to sockpuppet self-kill (D-72) [E].

These are real improvements. They do not make the protocol sound.

---

## Testnet verdict

**No.** Do not start a testnet phase on v9.

Minimum bar before reconsidering:

1. **Patch RV5-C1** with an inductive MMR-extension check (or equivalent) and emulator tests that the current `rv5_c1*` suite must *fail* after the patch.
2. External review of adaptor **O1–O3** (or a documented decision to ship relay-fallback-only without claiming adaptor trustlessness).
3. Re-derive D-74 stall numbers under kill_fee=900 after (1).
4. Align WF-S0 code with the wellformedness table (RV5-M1).

Until (1) lands, a single min-diff (testnet) or one-block-of-work (mainnet [E]) forged infix steals escrow ADA, and after Claim can steal both sides.
