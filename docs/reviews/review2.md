# zeUTXO path 1, independent adversarial review #2 (step 4 / spec v0.3)

Reviewer: Grok Bot (executor). Date: Mon Nov 2 2026, about 22:08 ET. Box only. No chain, node, wallet or network transaction. Fresh throwaway keys only. step4/ was read and not modified. All runs are in `review2/work/`, a copy of step4.

## Verdicts at a glance

| Question | Verdict |
|---|---|
| **Safety** | **FAIL.** 1 Critical (reproduced): a malformed but "check-passing" datum lets Alice disable Punish and hold Bob's ZEC hostage. |
| **Privacy** | **PASS** (still cryptographically unlinkable). Metadata caveats are below. |
| **Test integrity** | **PARTIAL PASS.** The rerun is 188/188 and PoK enforcement is confirmed. But 4 of the go-message negatives are vacuous, the simulator shares Bob's (lax) Ed25519 evaluator, and the datum shape is never attacked. |
| **Proceed to planning a testnet rehearsal?** | **FAIL as is. PASS once fixes F1 and F2 are in** (both are small and off-chain, with no script change needed) and the tests below are added. |

## Reproduction summary

| ID | What | Result | Evidence |
|---|---|---|---|
| Rerun | `node ada/e2e3.mjs all`, fresh keys | **188/188 ok, 0 FAIL**, EXIT 0 | `work/results/rerun_all.log` |
| R2-A | datum type confusion (5 variants) | **3 variants pass Bob's check and disable a spend path** | `tests/adv2_dtype.log` |
| R2-A2 | full hostage sequence (t2 as bytes) | **REPRODUCED**: Bob funds ZEC; Punish is rejected after T2; Alice can still Refund 1 h after T2 | `tests/adv2_hostage.log` |
| R2-B | identity-R / small-order go key | Simulator accepts; libsodium and Node reject | `tests/adv2_gokey.log`, `tests/ed_lax_output.json`, `tests/aiken_ed_output.txt` |
| R2-C | specificity of the e2e go negatives | **4 of 6 are vacuous** (wrong key). Fixed versions pass. | `tests/adv2_gomsgint.log` |
| R2-D | seen-registry hex case | **REPRODUCED bypass** | `tests/adv2_seenhex.log` |
| PoK | isolated PoK test (Rust) | 10/10. The PoK is enforced and is the *only* thing catching shifted points. | `tests/pok_isolated_output.txt`, `work/zec/examples/pok_isolated.rs` |

To reproduce:
- `cd review2/work/ada && node adv2.mjs {dtype|hostage|gokey|gomsgint|seenhex}`. The file is also in `tests/adv2.mjs`.
- `cd review2/work/zec && cargo run --release --offline --example pok_isolated`.
- `node review2/tests/ed_lax.mjs`.
- For the Aiken builtin vectors: `cd review2/aiken_ed && aiken check`.

---

## CRITICAL

### F1. Datum type confusion: Alice can lock with a datum that passes Bob's check but makes Punish impossible. Bob's ZEC becomes a hostage. (REPRODUCED)

**Cause.** `bobChecksLock` (e2e3.mjs:118-132) has three gaps:
- It destructures `Data.from(u.datum).fields`.
- It compares the integer fields with `Number(x)`.
- It never checks the constructor tag, the field count, or the field *types*.

If a ByteArray field is the hex string `"01793675894582"`, `Number()` reads it as the decimal number 1793675894582, which equals T2. The Aiken validator decodes datum fields lazily (`unIData` runs only when a field is used). So:

| Datum variant (passes Bob's check) | Redeem | Refund | Punish | Consequence |
|---|---|---|---|---|
| **t2 = ByteArray of its decimal digits** | ok | ok (also long after T2) | **always fails** | **Alice's free option and extortion.** Bob funds ZEC. Alice never gives go and never refunds. Bob can never punish. Alice can refund whenever she likes, e.g. after demanding a ransom or waiting for a price move. Bob's ZEC stays locked until she does. |
| t1 = ByteArray digits | fails | fails | ok | Alice can only hurt herself (Bob punishes at T2, and the ZEC is burned in the joint note). Griefing. |
| network_id = ByteArray 00 | fails | ok | ok | Bob's test-run catches the Redeem failure before b is revealed. Liveness/griefing only. |
| constructor tag 1, or an extra field | ok | ok | ok | Harmless today, but shows the check isn't strict. |

The hostage sequence (R2-A2) was run end to end: lock with the bad datum, Bob's check accepts, Bob funds ZEC at depth Z, T2 + 20 s passes, Bob's Punish gets `ScriptFailure … failed to deserialise PlutusData using UnIData … BoundedBytes`, and at T2 + 1 h Alice's Refund is still accepted.

**Fix (off-chain, small).** Bob builds the expected inline datum himself from the agreed parameters, using the same function Alice uses (`datumOf`). He then requires **byte equality** with the on-chain inline datum, and requires the datum to be inline (not a hash).
- Any mismatch, including a different but equivalent CBOR encoding, means abort before funding. Aborting before funding is always safe.
- Optionally, have the validator check t2 > t1 and do a strict full decode. But an on-chain check alone can't help, because Alice picks the datum. The off-chain byte check is what protects Bob.

**Tests to add:** the five R2-A variants, plus "indefinite vs definite list CBOR" and "datum hash instead of inline". Each one must make Bob refuse with a specific reason.

---

## HIGH

### F2. The stated Ed25519 safeguard is wrong, and the go key is never validated (latent; not exploitable with today's code)

- The spec (B.3) and selfcheck #11 say Bob is safe because he "evaluates with the real Plutus evaluator". That isn't true. Lucid's local evaluator and the aiken/uplc crate (cryptoxide) are **laxer** than cardano-node's builtin (libsodium).
  - They accept identity-R signatures and forgeries under small-order keys (identity, order 2, order 8). Shown in `tests/aiken_ed_output.txt`.
  - libsodium 1.0.22 and Node/OpenSSL reject all of them (`tests/ed_lax_output.json`).
- The simulator's StrictLedger uses the *same* lax evaluator as Bob's test-run, so it can't detect a mismatch.
- R2-B showed two things:
  - (a) An identity-R go signature: the simulator accepts the Redeem, while libsodium rejects it.
  - (b) Alice can agree a **small-order go_vk** (the identity point). Setup and `bobChecksLock` both accept it. In the simulator, **anyone can then forge a "go"** (R = [r]B, S = r).
- What protects Bob today is only that `goVerify` happens to use Node's OpenSSL, which is strict. If an implementation swaps in a lax verifier (cryptoxide, some JS libs), the failure mode is:
  1. Bob's check passes.
  2. Bob reveals b to his submit path.
  3. The real node rejects the Redeem.
  4. If the submit path is observable (a third-party submit API or relay), b leaks while Bob gets nothing.
- **Fix:**
  1. Specify libsodium-equivalent verification: canonical A and R, reject small-order A and R, S < ℓ, cofactorless.
  2. At setup, reject any go_vk that is non-canonical, small-order, or not in the prime-order subgroup.
  3. Bob's final pre-broadcast check uses the node's own evaluator (`cardano-cli transaction build` / Ogmios `evaluateTransaction`) on **his own** node.
  4. Submit b only to his own node.
  5. Add these vectors to the test suite.

---

## MEDIUM

### F3. "S ≈ 5 min ≈ 15 blocks" uses the *mean*. The time for 15 blocks has a fat tail.
With 20 s average Cardano blocks, P(15 blocks take longer than 5 min) is **47%**, 1.5× is 3.9%, 2× is 9e-4, and 2.5× is 1e-5. For Zcash at 75 s and 10 blocks: 2× is 5e-3, 2.5× is 2e-4. If S is a wall-clock budget, then half of all swaps reach T1 with Bob's Redeem less than K blocks deep. That is the window in which a rollback lets Alice Refund instead.
**Fix:** define S as the 1e-5 quantile of time-to-K-blocks (≈ 2.5× the mean, ≈ 12.5 min for K = 15), or enforce K by block count at T1. Size T0 the same way for Zcash funding plus Z (≈ 2.5 × 12.5 min), otherwise many swaps abort.

### F4. No slack between T0 and LAST, and LAST depends on Bob's clock
The rule T1 ≥ T0 + 1 + M gives LAST = T1 − 1 − M ≥ T0. In the simulator, LAST − T0 = 19 s, which is less than one block. Alice can legitimately send go at T0, leaving Bob almost no time. A Bob whose local clock is behind could broadcast *after* the true LAST. That is a safety deadline, not a convenience.
**Fix:** require T1 ≥ T0 + M + R, where R is Bob's reaction margin (minutes). Bob measures time by the chain tip's slot time minus a drift margin, never his wall clock. Add a boundary test where go arrives exactly at T0 and Bob is skewed by ±δ.

### F5. Test integrity: 4 of the 6 go-message e2e negatives are vacuous
`goCases()` sets `S2.go = S1.go` *after* swap 2's datum was written with swap 2's own key. So the "wrong network / wrong domain / wrong T1 / replay" signatures are all made with the **wrong key** and would fail even if the script ignored those fields. R2-C proves it: a signature over the *correct* message with that key is also rejected (`ScriptFailure`). The rewritten tests (real key, one field changed each, including output index and swap id, plus a positive control) all behave correctly. The generic `/^ScriptFailure/` regex can't tell the reasons apart.
Aiken `m0` (exact message bytes) together with the g-tests does cover the encoding, so the protection exists. Only the e2e evidence is weaker than claimed.
**Fix:** use the R2-C versions, and use trace-specific failure reasons (`expect … ? "go_sig"`) so the negatives say which check fired.

### F6. Practical finality makes this an economic-security system, so the swap value must be capped
- After Alice's go, Bob's protection depends on Cardano not reorganising deeper than K after T1. That favours Alice if she is a large stake-pool operator or colludes with one.
- Alice's protection depends on Zcash not reorganising deeper than Z after her go. That favours Bob if he can rent Equihash hashpower for about 10 blocks.
- With practical finality, a swap is only safe while its value is below the cost of such a reorg.
**Fix / decision:** set a per-swap value cap, or scale K and Z with value (see "John's decision").

---

## LOW / INFO

- **F7. The seen registry and the A==B check compare hex *strings* (REPRODUCED).** Bob re-proves an old share with P and Q in upper-case hex. `hex::decode` accepts it and the swap_id is the same, but the registry misses it and the setup is accepted (R2-D). This mostly harms the reuser (reuse is self-harm), but it defeats the stated protection. **Fix:** normalise to canonical compressed bytes (lower-case hex of the decoded point) before every comparison and registry insert. Also reject non-canonical point encodings.
- **F8. Bob's lock check ignores the constructor tag and extra fields.** Covered by the F1 byte-equality fix.
- **F9. Free option (inherent).**
  - Bob can delay funding until near T0.
  - Alice can withhold go until T0 and then refund at T1. Bob gets his ZEC back but has lost the time and the price move.
  - This is normal for HTLC-style swaps. Document it and keep T0 short.
- **F10. Lock rollback after Bob funds.** This is inside the K risk already budgeted in H-1. OK.
- **F11. Bounds.** Validity bounds (upper ≤ T1−1, lower ≥ T1 / ≥ T2), checked with `is_inclusive` ignored: still safe, with a 1-slot gap (review1 L-2 still holds).
- **F12. PoK.** Enforced: `verify()` calls `verify_opt(with_pok = true)`. The isolated test (10/10) shows:
  - an F7 shift in both groups is caught *only* by the PoK; the no-PoK weighted check accepts it;
  - a BLS-only shift is caught only by the PoK;
  - a transplanted PoK and an identity-R PoK are rejected.
  The existing e2e F7 test reaches the PoK, but only for P and only with the generic `/DLEQ proof invalid/`. Add the isolated test to CI.
- **F13. Rogue key on the 2-of-2.** None. ak = ±(A_p + B_p) with both PoKs inside the transcript-bound DLEQ, and nk/rivk from commit-then-reveal. Duplicate commitments aren't rejected, which is harmless because each side's contribution is hashed in.
- **F14. Encoding consistency (Rust / JS / Aiken).**
  - go message: 129 bytes. JS `goMsg` equals the Aiken `go_message` (m0).
  - swap_id preimage: built from decoded bytes in Rust; JS uses the Rust output.
  - No mismatch was found, apart from F1 and F7 (string-level checks).

## Status of the review-1 findings

| ID | Status | Note |
|---|---|---|
| C-1 (pinned Redeem body) | **FIXED** | go is now a message over the outref, not a tx. c1fee and c1cost pass (10/10 each) in the rerun. |
| C2 (sim confirms expired tx) | **FIXED** | StrictLedger drops slot ≥ ttl at block time (c2 8/8). |
| C3 (Alice's coins via go-sign policy) | **FIXED / moot** | go doesn't sign a tx (c3 8/8). |
| H-1 (Δ must include settlement) | **FIXED in rule**, but see **F3** (S must be a tail quantile, not the mean). |
| H-2 (Zcash Z) | **FIXED in code** (Alice checks live depth ≥ Z). Residual: **F6** (value cap). |
| M-1 (address string compare) | **Moot** (no go-sign policy any more). |
| M-2 (PastHorizon / TTL with pinned body) | **FIXED** (Bob builds his own Redeem). |
| M-3 (expiry_height = 0) | **FIXED** (tip + 40). |
| M-4 (setup-channel confidentiality) | **Open, documented.** Stronger now: the swap_id is a binding commitment to both share points, so a leaked transcript *proves* the Cardano↔Zcash link. |
| M-5 (counterparty keeps FVK) | **Open, inherent, documented.** |
| M-6 (sim gaps) | **Mostly fixed** (rollbacks, reorgs, param changes, TTL). **New gap:** the evaluator is shared with Bob (F2), and the datum shape is never attacked (F1). |
| L-1 (proof replay) | **FIXED** (l1 21/21). Residual: F7 (hex-case registry bypass). |
| L-2 (bounds) | Still correct. |
| L-3 (go deadline drift) | **FIXED** (go ≤ T0). See F4 for slack. |
| L-4 (wording: reveal-then-solo-sign) | Unchanged. Fine as documented. |
| L-5 (metadata) | Unchanged. See privacy. |
| L-6 (front-running) | Still holds (front-run test is valid, R2-C). |
| L-7 (rogue key / malleability) | Still holds. PoK enforcement confirmed (F12). |

## Privacy verdict: PASS (cryptographically), with metadata caveats

- **On Cardano, the datum shows:** alice/bob pkh, go_vk, network id, swap_id, A_c, B_c (BLS points), T1/T2, and the constant script hash (which labels every swap).
- **What reaches Zcash:** none of these. b becomes public in Redeem, but it lives on Orchard only as one share of a key behind a randomised (α) spend authorisation. The memo is zeroed, ovk is None, and expiry is wallet-like.
- **swap_id:**
  - Outsiders can't link it, because it hashes secret nonces and commitments.
  - The parties *can* use it, together with their transcript, as a binding proof of the link (strengthens M-4 and M-5).
- **go_vk:** fresh per swap, so it links nothing across swaps. Keep it single-use and never derive it from a wallet key.
- **Main residual leak:** timing and amount correlation (L-5).

## Test-integrity verdict: PARTIAL PASS

- 188/188 reproduced with fresh keys, and most rejection reasons are specific.
- Weaknesses:
  - **F5:** vacuous go negatives.
  - **F2:** the simulator evaluator is the same lax evaluator Bob uses, so evaluator divergence can't be tested.
  - **F1:** the datum shape and types are never fuzzed.
  - The PoK has no isolated test in the suite (added here).

## Fixes, in order

1. **F1:** Bob byte-compares the inline datum to his own `datumOf(agreed params)`. Add the five R2-A variants as negatives.
2. **F2:** strict (libsodium-equivalent) go verification; validate go_vk at setup; pre-broadcast evaluation on Bob's own node evaluator; submit only to his own node; add small-order and identity-R vectors.
3. **F3/F4:** S and the Zcash budget become tail quantiles (≈ 2.5× mean); add a reaction margin R so that LAST ≥ T0 + R; use chain-tip time.
4. **F5:** replace the vacuous tests; add specific trace reasons.
5. **F7:** canonicalise points and nonces before comparing and registering.
6. **F6:** the value cap (John's decision).
7. Rerun everything. Then rehearsal planning can proceed.

## John's decision

The practical-finality choice (5 min / 12 min) is fine for small swaps, but it turns safety into economics: a swap is only safe while its value is below the cost of a deep enough reorg on either chain. Decide a **maximum value per swap** for the rehearsal and for v1. Suggested: start at a small cap, with K and Z scaled up above it. Alternatively, accept proportionally longer windows for larger swaps.
