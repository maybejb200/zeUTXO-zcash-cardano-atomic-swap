# Step #2a: Adaptor-signature ZEC (Orchard) ↔ ADA swap, built on R2

Draft v0.1, Mon Nov 2, 2026 ~12:10 AM ET. A research specification, **not reviewed and not implemented**. Deadlines and the delay limit D come from `zeutxo-step2-risk-sheet.md`.

**Status: PASS for "the specification has no unresolved step" at the protocol level.** There are 4 open items (§9), which need measurement or an outside cryptographic review.

## 1. Goal and what changes from R2
- **R2 as built:** a 2-of-2 FROST Orchard/Ironwood note, a transparent P2SH auxiliary output with a CLTV refund, a pre-signed shielded refund, and an ADA script that releases funds on a **shared hash preimage**. The hash links the two chains publicly.
- **This variant:** the hash goes away. The secret that moves between chains is a scalar *t*, revealed only to the counterparty, through **adaptor signatures**:
  - on Cardano: a BIP-340 Schnorr signature over secp256k1, which Plutus checks with the CIP-49 builtin `verifySchnorrSecp256k1Signature` ([CIP-49](https://cips.cardano.org/cip/CIP-49));
  - on Zcash: the RedPallas spend authorization signature of the Orchard claim.
- **Cross-curve link:** a cross-group DLEQ proof that the same *t* sits behind `T_s = t·G_secp` and `T_p = t·G_pallas`.
- **Kept from R2:** the auxiliary-output refund timelock, the pre-signed refund, journals, recovery, the FROST/DKG code, and the finite-state model.
- **Rewritten:** the ADA validator (signature check instead of hash check), and the Orchard claim-signing step (adaptor nonce).

## 2. Roles and assets
- **Bob** holds ZEC (Orchard) and wants ADA. Bob chooses the secret *t*.
- **Alice** holds ADA and wants ZEC.
- The party who learns *t* last is Alice. She learns it when Bob claims the ADA on Cardano.

## 3. Keys and notation (all fresh per swap; never reuse R1/R2 keys, witnesses or nonces)

| Symbol | Curve | Owner | Use |
|---|---|---|---|
| `ak = ak_A + ak_B` | Pallas | 2-of-2 (two-party Schnorr or ZIP 312 FROST with 2 signers) | spend authorization key of the joint Orchard note |
| `α_claim`, `α_refund` | Pallas scalar | agreed during setup | Orchard re-randomizers; `rk = ak + [α]G` ([ZIP 312](https://zips.z.cash/zip-0312)) |
| `x_A`, `P_A = x_A·G` | secp256k1 | Alice | key whose BIP-340 signature unlocks Bob's ADA claim path |
| `pkh_A`, `pkh_B` | Ed25519 (Cardano keys) | each | ordinary Cardano tx signers / refund owner |
| `t`, `T_s`, `T_p` | both | Bob creates *t* | adaptor secret and its two public points |
| `K_A`, `K_B` (aux) | secp256k1 ECDSA | each | transparent P2SH auxiliary 2-of-2 + CLTV branch |

*t* must be sampled below `min(order_secp, order_pallas)`; in practice a 252-bit scalar. That keeps it valid on both curves, which the cross-group DLEQ requires ([Farcaster dleq.rs](https://docs.rs/farcaster_core/latest/src/farcaster_core/crypto/dleq.rs.html) handles this with bit decomposition).

## 4. On-chain objects

**Zcash (v5/v6 transactions only; v4 is invalid after NU7 per [Zebra 7.0.0 notes](https://zfnd.org/zebra-7-0-0-release/))**
- **N:** an Orchard (or Ironwood, as in R2) note of value `v` to the joint address with spend key `ak`.
- **X:** a small transparent P2SH auxiliary output. Script (**changed Nov 2, D-51, review H-1**): `2 <K_A> <K_B> 2 CHECKMULTISIG` — 2-of-2 only, **no unilateral CLTV branch**. Its job is to make the claim and refund *conflict* (both spend X and N). The refund's earliest time now comes from R's own `nLockTime` (a block **height** `L_R`), which both parties sign over.
  - *Superseded (unsafe):* `IF 2 <K_A> <K_B> 2 CHECKMULTISIG ELSE <T_B> CHECKLOCKTIMEVERIFY DROP <K_B> CHECKSIG ENDIF`. After T_B Bob could spend X alone with some X' ≠ R, which invalidates both C and R. Then neither ProveC nor ProveR can ever succeed, Bob takes the ADA via Release, and N is frozen (review H-1).
- **Claim tx C:** spends N + X(2-of-2 branch) → Alice's shielded address. Fee is fixed when built.
- **Refund tx R:** spends N + X(2-of-2) → Bob's address. `nLockTime = L_R`, a block height corresponding to T_B. It is pre-signed by **both** parties, with K_A and K_B on X and library FROST on N, before any funds move. **Both** Alice and Bob keep the fully signed R. So the only possible spends of X are C and R, and each is provable on Cardano (D-51).
- Because v5+ txids exclude signatures and proofs ([ZIP 244](https://zips.z.cash/zip-0244)), C and R have **fixed txids and sighashes once built**. That also makes them usable later for relay settlement (path #1).

**Cardano (Plutus V3 validator `adaptor_escrow`)**
- **Datum:** `{P_A (x-only 32 bytes), pkh_A, pkh_B, T_A (POSIX ms), msg_tag}`.
- **Claim redeemer `Claim(sig64)`:** valid iff
  1. tx validity upper bound ≤ `T_A`;
  2. signed by `pkh_B`;
  3. `verifySchnorrSecp256k1Signature(P_A, m, sig64)`, where `m = blake2b_256(msg_tag || own_outref)`. This binds the signature to this escrow, so it can't be replayed;
  4. pays the escrow value to `pkh_B`.
- **Refund redeemer:** tx validity lower bound > `T_A` and signed by `pkh_A`.
- Bob's claim signature `sig64 = (R_s.x, s)` sits in the redeemer, so it is public on Cardano. That is how Alice extracts *t*.

## 5. Protocol

**Phase 0 – negotiate.**
- Agree `v`, the ADA amount, fees (ZIP 317, with headroom), and D, T_A and T_B from the risk sheet.
- Each party checks every other party's numbers against its own clock and the chain tips.

**Phase 1 – keys.**
1. Run a 2-of-2 DKG on Pallas for `ak` (R2 M01). Exchange `K_A`, `K_B`, `P_A`, `pkh_*`.
2. Bob samples *t* and sends `T_s`, `T_p` and `π_DLEQ`. Alice verifies `π_DLEQ`; **abort if it fails.**

**Phase 2 – build and pre-sign, before any funds move.**
3. Agree on `α_refund` and the refund height `L_R`. Bob builds R with `nLockTime = L_R`. Both co-sign R's Orchard spend with library FROST, and both sign R's X input (K_A, K_B). **Both parties now hold a fully signed refund R.** Alice signs nothing else that spends X or N except C (D-51).
4. Alice builds C and agrees on `α_claim` with Bob. Bob signs C's X input with `K_B` (ECDSA, a full signature) and gives it to Alice.
5. **Orchard adaptor pre-signature on C** (two-party Schnorr with an adaptor):
   - Nonces: Alice `R_A = r_A·G`, Bob `R_B = r_B·G`. The joint nonce is `R = R_A + R_B + T_p`.
   - `c = H*(R || rk_claim || sighash_C)`, the RedPallas challenge ([ZIP 312 rationale](https://zips.z.cash/zip-0312)).
   - Bob sends `z_B = r_B + c·(ak_B + α_claim)`. Alice computes `z_A = r_A + c·ak_A`; the α term is counted once.
   - The pre-signature is `z' = z_A + z_B`. Alice checks `z'·G == R − T_p + c·rk_claim`; **abort if not.**
   - The final signature `(R, z' + t)` is valid only once *t* is known. Bob never sees `z_A`, so Bob cannot complete C.
   - If FROST is used, R2's ZIP 312 code needs a hook that adds `T_p` into the group commitment (open item O1).

**Phase 3 – Bob funds ZEC.**
6. Bob broadcasts the funding tx creating N and X.
7. Alice waits until N and X are buried ≥ `Z_fund` Zcash blocks (risk sheet). She checks N's value with the incoming viewing key shared during setup, and checks X's script hash.

**Phase 4 – Alice locks ADA.**
8. Alice makes a **BIP-340 adaptor pre-signature** on `m`:
   - Nonce `k`, `R_s = k·G + T_s`, adjusted for BIP-340's even-y rule (open item O2).
   - `e = H_tag(R_s.x || P_A || m)` and `s' = k + e·x_A`.
   - She sends `(R_s, s')` to Bob.
   - **Bob checks** `s'·G == R_s − T_s + e·P_A`; abort if not.
9. Alice submits the `adaptor_escrow` output with the datum. Bob waits for `S_C` Cardano blocks of depth.
   - **Bob verifies the escrow before claiming (review M-2, D-52):** the output's payment credential must equal the agreed settle-script hash, compiled with the agreed `anchor_hash` and `base`. The datum must equal the agreed values field by field (SettleDatum6: p_a, pkh_a, pkh_b, msg_tag, t_a, c_com, r_com, min_conf = 330, pending_ms, t_fb, rel_height, grace_ms, phase = Locked), with no extra tokens. The value must equal the agreed ADA. msg_tag carries the swap id. Any mismatch → do not claim. Model: `e2e6/gen_e2e6.py` `bob_verifies_escrow`, which rejects 3 rogue escrows [M].
   - **Session binding (review M-3, D-52):** every adaptor/FROST signing session uses `session_id = BLAKE2b("zeutxo_adp_sessn", swap_id‖ak‖rk‖sighash‖T_p)`. Each share signs only one session at a time, with single-use nonces, and refuses a second session with the same session_id once it is done. Model: `zeutxo-adaptor-proto/frost_2of2` `BobSigner`, run3_m3.txt ALL_OK [M]. Protection against cross-protocol reuse of shares between library FROST (R) and the adaptor session (C) rests on that rule plus fresh committed nonces. This is argued, not proven.

**Phase 5 – Bob claims ADA (must start by `T_A − D − S_C`).**
10. Bob computes `s = s' + t` (with parity handling) and submits `Claim((R_s.x, s))` with validity upper bound `T_A`.

**Phase 6 – Alice claims ZEC (must be mined and `Z_claim` deep before `T_B`).**
11. Alice sees Bob's claim, in the mempool or on-chain, and extracts `t = s − s'`, adjusted for parity.
12. She completes `σ_C = (R, z' + t)`, attaches her `K_A` ECDSA signature and Bob's for X, creates the Halo2 proof for C, and broadcasts it.

**Phase 7 – refunds (only if the happy path fails).**
- Bob never claimed ADA: after `T_A`, Alice refunds the ADA. After `T_B`, Bob broadcasts R.
- If Alice never locked ADA, Bob simply waits for `T_B` and broadcasts R.

## 6. Why each party is safe (assuming every honest action lands within D)
- **Alice cannot take ZEC without paying:** she needs *t*, which appears only in Bob's ADA claim.
- **Bob cannot take ZEC:** he lacks `z_A`.
- **Bob cannot take ADA without revealing t:** the only claim path needs a valid BIP-340 signature under `P_A`. Alice's only signature for `m` is the pre-signature, so any valid completion reveals *t* (Schnorr adaptor extraction).
- **Bob gets his ZEC back if Alice disappears:** he holds R and can broadcast it once the chain reaches height `L_R`. Alice holds R too. If C cannot land, she broadcasts R herself and then ProveR on Cardano (D-51/D-50).
- **X has no unilateral branch (D-51):** every spend of X needs both K_A and K_B, and honest Alice only signs C and R. Model check: `zeutxo-step1-relay-cost/integration/h1_model.py` (old script: a Bob-alone unprovable spend is reachable; new script: none). This is a small enumeration, not a proof.
- **Timing hazards** (fully listed in the risk sheet):
  - **(H1)** Bob's claim shows *t* in the Cardano mempool but isn't mined by `T_A`. Alice could then refund the ADA *and* claim the ZEC, and **Bob loses**. Mitigated by Bob submitting by `T_A − D − S_C`.
  - **(H2)** Alice's C is not mined by `T_B`. Bob refunds with R and also keeps the ADA, and **Alice loses**. Mitigated by the gap `T_B − T_A`.
  - **(H3)** A Zcash reorg removes C after T_B, letting R win. Mitigated by Alice needing C buried `Z_claim` deep before T_B.
  - **(H4)** A Cardano rollback removes Bob's claim after T_A. Alice may then refund ADA while holding *t*, and **Bob loses**. Mitigated by `S_C` depth before `T_A`.

## 7. Privacy

| Observer | Sees | Doesn't see |
|---|---|---|
| Zcash public | funding tx with a transparent P2SH output X and its value; later, a tx spending X plus an Orchard action. Orchard amounts and recipients stay hidden. **X makes these txs recognizable as "R2-style swaps"** (same as R2). | the note value `v` (unless inferable from fees or patterns), Alice's address |
| Cardano public | the escrow script, the ADA amount, `P_A`, Bob's BIP-340 signature | any value tied to Zcash; there is no shared hash, so `sig64` is unlinkable to the Orchard signature without *t* |
| Counterparty | everything about this swap (as in ZIP 312's threat model) | other activity |

- **Linkage left over** [analysis]: timing correlation, ADA amount vs. `v`, and the recognizable P2SH-X pattern.
- **Mitigations:** variable amounts (R2 used a fixed 1,000,000 zatoshi), randomized delays, and a common X template shared across users.

## 8. Reuse map from R2 (per the audit)
- **As-is:** M01 DKG and FROST signing (needs an adaptor-nonce hook), M02/M03 note funding and viewing-key checks, the M04 auxiliary-output pattern (CLTV branch unchanged; hash branch → 2-of-2), the M05–M07 journals, restart and recovery, the Lucid emulator harness.
- **New:**
  - the `adaptor_escrow` validator (small; a cost measurement is planned in step 1's code);
  - a BIP-340 adaptor sign/verify/extract module (libraries for secp256k1 adaptor signatures exist, e.g. the ones used in DLC and PTLC work — **[not checked this session]**);
  - the cross-group DLEQ (Farcaster's ed25519↔secp256k1 code shows the method; Pallas↔secp256k1 code was reportedly built by Zwap and appears in [vizor-wallet PR 323](https://github.com/chainapsis/vizor-wallet/pull/323) — **[contents not reviewed]**).
- **Alternative:** Cardano Ed25519 (`verifyEd25519Signature`) instead of BIP-340. This is possible because Ed25519 verification is a Schnorr equation. But adaptor nonces conflict with Ed25519's deterministic-nonce convention, and fewer adaptor libraries exist. The BIP-340 route is preferred [analysis].

## 9. Open items (need review or measurement, not unresolved protocol steps)
- **O1 – FROST adaptor hook:** adding `T_p` to the group commitment in ZIP 312 re-randomized FROST, and proving the result is still secure. For exactly 2 parties, a plain two-party Schnorr with nonce commitments (a commit-then-reveal round to prevent nonce-cancellation attacks) avoids changing FROST.
- **O2 – BIP-340 parity:** the even-y requirement on `R_s` (and on `P_A`) forces the sign of *t* or *k* to be chosen correctly. That's standard but easy to get wrong; it needs test vectors.
- **O3 – Cross-group DLEQ:** proof size and soundness for Pallas↔secp256k1. Needs an external review, the same caveat the Logos appendix gives ([source](https://raw.githubusercontent.com/logos-co/rfp/master/appendix/zcash-atomic-swap-primitives.md)).
- **O4 – Fee bumping (R2 M09):** C and R are pre-signed with fixed fees. Rebuilding C changes its sighash and needs a fresh adaptor round with Bob, and Bob may be gone. So set a generous fee with headroom for congestion. Alternatively, give X a small extra output Alice can spend to pay a child-pays-for-parent fee; whether Zcash relay policy supports CPFP is **[unverified]**.

## 10. Upgrade path to trustless
- This protocol still depends on D.
- The upgrade (research report path #1) is to replace "Alice refunds ADA after T_A" with "ADA follows the Zcash outcome proven by the relay". Cardano sees which of the fixed txids C or R was included:
  - if R: Alice gets the ADA back;
  - if C: Bob gets the ADA.
- That removes hazards H1 and H2 in exchange for the relay's assumptions: one honest relayer, plus the checkpoint until it is proven.

## 11. NU7 notes (from [ZIP 218](https://zips.z.cash/zip-0218))
- Default wallet expiry becomes 120 blocks. Pre-signed C and R must set `nExpiryHeight` explicitly: 0 means no expiry, per ZIP 203 (ZIP 203 re-fetched Nov 2, ~3:10 AM ET: a tx with nExpiryHeight N is invalid in any block above N; 0 = no expiry; max 499,999,999). Otherwise a pre-signed refund could expire before it is ever broadcast. **Superseded for R by D-60 (Nov 2, ~3:00 AM ET), see §12:** C keeps nExpiryHeight = 0; R gets a deliberate expiry.
- Nodes may follow reorgs of up to 600+ blocks after NU7. That's why the Zcash depth comes from the risk sheet, not node policy.

## 12. v7 amendments (Nov 2, ~3:10 AM ET; D-56..D-63; emulator-verified only, not reviewed)
- **R has a bounded mining window (review-2 NEW-H3, D-60).** R: `nLockTime = L_R`, **`nExpiryHeight = L_R + D_mine`**. Settlement: `rel_height = L_R + D_mine + 330`. Then any R that can ever be mined sits at height ≤ rel_height − 330, so it has ≥ 330 confirmations in every checkpoint ≥ rel_height — including the one Bob must cite to Arm. Alice's ProveR during grace needs no further relay progress. Emulator test: R mined exactly at its expiry height is provable with the Arm checkpoint at exactly 330 confirmations [M].
- **D_mine** (blocks R may wait in the mempool): post-NU7 144 blocks ≈ 1 h at 25 s; pre-NU7 48 blocks ≈ 1 h at 75 s. Nodes drop txs that are within a few blocks of expiry from the mempool (zcashd uses 3; not re-verified for Zebra), so D_mine must be ≫ 3. R's fixed fee (O4) must be generous enough to land within D_mine under congestion; whoever is online (Alice or Bob) broadcasts R as soon as height L_R is reached.
- **Backup refund R′ (D-60).** If R misses its window, Bob's ZEC would be stuck in X/N. Before funding, both parties also pre-sign R′: same inputs, `nLockTime = L_R′` with L_R′ well after t_fb (every Cardano path closed; suggest t_fb + 7 days in blocks), `nExpiryHeight = 0`. Alice, who learns t when Bob claims, must take C before L_R′ (she must be online at least once in that multi-day window, the usual liveness assumption). If Bob never claimed, Alice has no t, takes the ADA by Fallback at t_fb, and Bob later takes R′.
- **Grace = 21 h** (was 6 h, D-60): ≥ max free relay stall of one honest entry (W_c + 2τ + max_skew = 18.67 h) + 0.5 h register lag + 2 × 0.25 h reaction + 1 h margin [E], so it holds even if Alice needs a fresher checkpoint than Bob's Arm checkpoint.
- **NU7 (D-56):** C and R commit to the consensus branch id (ZIP 244). Both parties refuse to set up a swap if an activation height falls inside [setup height, rel_height + 72] (off-chain check in gen_e2e7.py). Post-NU7, 330 confirmations ≈ 2.3 h and ≈ 1/3 of the pre-NU7 work; **superseded by D-64:** the default depth post-NU7 is **990** (equal work to 330 pre-NU7, and above Zebra's 600-block reorg limit); 330 remains for pre-NU7 heights. min_conf is a per-swap datum field, so every `330` in this section reads `min_conf` (330 pre-NU7, 990 post-NU7): `rel_height = L_R + D_mine + min_conf`. Emulator: swap S7 with min_conf 990 — ProveR at 966 conf rejected, at exactly 990 via the Arm checkpoint accepted [M]. Bob's worst free wait post-NU7 ≈ 48.0 h [E].
- **Bob's worst free wait (L_R → ADA by Release)** post-NU7 with the D-64 default of 990 confirmations ≈ 1 (D_mine) + 6.88 (990 × 25 s) + 0.5 + 18.67 + 21 ≈ **48.0 h** [E] (≈ 43.5 h only if a swap keeps min_conf 330: 2.29 h instead of 6.88 h), so t_fb = T_A + 25 h + 7 d stays far above it. *(Fixed Nov 2 ~4:30 AM ET: this bullet said 43.5 h after D-64; review 3 NEW-L1′.)*

## 13. v8 amendment (Nov 2, ~4:30 AM ET; D-65..D-69; emulator-verified only, pending re-review)
- **Nothing in the Zcash side or the settlement flow changes.** v8 only changes how the Cardano relay's dispute game authenticates its dispute UTxOs (review 3 NEW-C1′/NEW-H1′): every dispute thread token is named `blake2b_256("dsp" ‖ src.txid ‖ src.idx ‖ entry_id ‖ hh)`, where `src` is the lane UTxO the LOpen spent, so names are unique by construction; exactly one is minted per LOpen and every resolving tx burns exactly that one; every dispute tx has exactly one dispute input; every dispute transition requires the token whose name the validator re-derives from the datum. The settlement assumptions in §10–§12 (one honest relayer, checkpoint finality after the window) are unchanged; v8 restores them against the review-3 forgery.
