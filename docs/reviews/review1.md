# zeUTXO path-1 — independent adversarial review #1

Date: 2026-11-02 (America/New_York). Reviewer: Grok Bot (executor). Scope: memo/spec/decisions (step 1), step 2 code and results, `escrow.ak`, `zec` (dleq.rs/main.rs/tree.rs), `ledger.mjs`/`e2e.mjs`, `foc_model.py`.
Rules kept: box only, no chain/network/wallets, fresh throwaway keys from my own reruns only, nothing in step1/step2 modified. All artefacts live in `review1/`.

## Verdicts at a glance

| Question | Verdict |
|---|---|
| **Privacy** (can the Cardano side be linked cryptographically to the Orchard spend?) | **PASS (cryptographically unlinkable)**, with metadata caveats (M4–M6, L5) |
| **Safety** | **FAIL** — 1 Critical, 2 High honest-loss traces |
| **Test integrity** | **PARTIAL PASS** — what is tested is tested honestly (rerun 70/70, rejection reasons are the intended ones), but the simulator can't express the failures below (C2: it confirms expired txs; no rollbacks, reorgs, or parameter changes) |
| **Proceed to testnet rehearsal?** | **FAIL as is.** Fix C-1 (a small validator + go-sign change) and write H-1/H-2 into the timing rules, then rerun step 2 and this review's adversarial tests, then rehearse |

## Reproduction status

| ID | What | Status | Evidence |
|---|---|---|---|
| Rerun | step-2 e2e, fresh keys | happy 32/32, refund 16/16, punish 13/13, setup 9/9 | `sim/e2e_rerun.log`, `sim/results/e2e-all-2026-11-03T00-59-19-261Z.json` |
| C1-fee | go-signed Redeem made invalid by a fee-param change after b is public → Bob loses | **REPRODUCED** | `sim/adv_run3.log`, `sim/adv-results-c1fee.json` |
| C1-costmodel | same, triggered by a cost-model change (script_data_hash mismatch) | **REPRODUCED** | `sim/adv_run3.log`, `sim/adv-results-c1costmodel.json` |
| C2 | emulator confirms a tx whose TTL expired while it was pending | **REPRODUCED** (sim gap) | `sim/adv_run.log` |
| C3 | Alice's go-sign policy lets Bob's Redeem also spend Alice's base-address UTxO | **REPRODUCED** | `sim/adv_run2.log`, `sim/adv-results-c3.json` |
| T1 | DLEQ proof made for swap OLD is accepted in swap NEW | **REPRODUCED** | `tests/t1_dleq_cross_swap_replay.sh`, `tests/t1_output.txt` |
| T6 | byte-level privacy scan of real v5 Orchard txs | clean apart from expiry_height=0 | `tests/t6_privacy_inspect.py`, `tests/t6_output.json` |
| aiken | `aiken check` on a copy | 19 checks, 0 errors | `aiken/` |

Run them with: `cd review1/sim/ada && node adv.mjs {c1fee|c1costmodel|c2|c3}`, `bash review1/tests/t1_dleq_cross_swap_replay.sh`, `python3 review1/tests/t6_privacy_inspect.py`.

---

## CRITICAL

### C-1. Alice's go-signature pins the *whole* Redeem body, so anything outside Bob's control that invalidates that body after b is public turns into an honest-Bob total loss
**Mechanism.** `Redeem` requires `signed(alice) && signed(bob) && upper ≤ T1−1 && share_ok(b)`. Alice's "go" is her vkey witness over one exact tx body (inputs including Bob's fee input and collateral, fee, TTL, script_data_hash, which depends on the cost model). Bob can't rebuild Redeem without a fresh signature from Alice. When Bob broadcasts, **b is public in the mempool** (the redeemer holds it in the clear). If that exact body then can't be included before T1, Alice has a+b. She sweeps the ZEC, and at T1 she Refunds her ADA. Bob ends up with nothing.

**Triggers. None of them break the model's "valid tx is mined within Δ" assumption, because the tx *stops being valid*:**
1. A protocol-parameter change at an epoch boundary between broadcast and inclusion: `minFeeA/B` (FeeTooSmall), the PlutusV3 cost model (PPViewHashesDontMatch), or the execution-unit price. Conway governance actions are public ahead of time, so **Alice can choose T1 to straddle a known enactment**. That makes the trigger adversary-chosen, not just bad luck.
2. Bob's own wallet spends the fee or collateral input in another tx (concurrency), or a rollback removes it.
3. Any relay, submit API, or mempool peer that sees b while the tx isn't confirmed (same outcome, combined with H-1).

**Repro.** `node adv.mjs c1fee` / `c1costmodel`. Alice go-signs honestly and Bob broadcasts inside his rule (230 s before T1 with Δ=60 s). The parameters change, the node drops the tx (`FeeTooSmall: 231829 < 232979` / `PPViewHashesDontMatch`), Alice reads b out of the dropped tx bytes, sweeps the 0.5 ZEC and Refunds at T1. Final: Alice 1999.6 ADA (her 1000 refunded + rest) + 0.4999 ZEC swept from the joint note; Bob 300 ADA + 0.4999 ZEC (only his funding change). **Bob lost his 0.5 ZEC and got no ADA.**

**Fix (recommended, small).** Replace "Alice co-signs the Redeem tx body" with **"Alice signs a go-message"**. In the datum, store `alice_go_vk` (a fresh, single-purpose Ed25519 key). The Redeem redeemer carries `go_sig = Sig_alice_go("zeUTXO-go" ‖ swap_id ‖ escrow_outref)`, and the validator checks `verify_ed25519_signature(alice_go_vk, msg, go_sig) && signed(bob) && upper ≤ T1−1 && share_ok(b)`. Bob can then rebuild and re-sign Redeem freely (new fee, new cost model, new inputs, new TTL) as often as he needs up to T1. The outref makes the go-sig unreplayable across swaps. **This also removes C3 entirely**, because Alice no longer signs anything that can spend her money, and the whole "Alice inspects the body" policy goes away.
Additionally: Bob must (a) phase-1 and phase-2 validate locally against the *next* epoch's parameters when an enactment is pending; (b) refuse T1 values inside ±(Δ + settlement) of an epoch boundary with a pending parameter change; (c) keep fee/collateral UTxOs reserved; (d) submit only to his own node (no third-party submit APIs).

## HIGH

### H-1. Δ must cover Cardano *settlement* (rollback depth), not only inclusion (S2-D15 vs D7)
A Redeem that lands at slot T1−3 and then gets rolled back by a short fork can't be re-included once the new tip passes T1 (upper bound exclusive). b is already public, so you get the same outcome as C-1. The mirror case: Alice's Refund lands just before T2, gets rolled back after T2, and Bob Punishes. By then **a** is public, so Bob also knows a+b and can race Alice for the ZEC. Alice can lose the ADA and possibly the ZEC.
**Fix.** Define Δ_ada = inclusion bound + settlement depth (for example k_conf blocks ≈ 20 s × k_conf plus a slot-battle margin; pick a k_conf for the value at stake). Apply it to Bob's broadcast rule (`now + Δ_ada ≤ T1−1`) and Alice's refund rule (`now + Δ_ada ≤ T2`). The model (`foc_model.py`) has "mined = final" and one Δ shared by both chains, so it can't see this. Add a "mined then rolled back" transition. The simulator can't test it either (C2).

### H-2. Zcash funding finality (Z) is the only safety-critical Zcash parameter, and nothing models it
If Bob's funding note is reorged out after Alice has gone ahead (because Bob double-spent the funding inputs, or by 51% reorg on a smaller PoW chain), Bob still Redeems the ADA and Alice's sweep has nothing to spend. Every other Zcash timing is liveness only: neither sweep has a deadline, and a reorged sweep can be rebroadcast because only its owner knows a+b. **Fix.** Spec: Alice go-signs only once the note is ≥ Z blocks deep, with Z sized to the swap value (exchange-grade confirmation counts, not 1–2). Code: `aliceGoSign` checks the existence of a stale `joint_note.json` file, not the confirmation depth on the current chain. Make it query depth. The model needs a reorg transition.

## MEDIUM

### M-1. Go-sign policy is bypassable: it compares bech32 address strings, not payment credentials (C3, reproduced)
`aliceGoSign` rejects inputs whose `address === S.A.address`. If Alice's payment key also controls a UTxO at a *base* address (or a different staking part), Bob's body can include it and Alice's witness authorizes it. The repro takes Alice's 50 ADA. The policy also doesn't check mint, withdrawals, certificates, votes, proposals, or required signers. Alice's witness would authorize a withdrawal from her reward account too if the credential matched. **Fix.** The C-1 redesign makes this moot. If it's kept: use a fresh go-only key that holds no funds, compare payment credentials, and whitelist the body's fields (exactly one script input, no mint/withdrawals/certs/votes/proposals).

### M-2. PastHorizon / TTL translation with a pinned body (liveness)
Cardano won't translate a slot more than ~3k/f (≈36 h on mainnet) past the tip. With a pinned body whose TTL = T1−1, a go-sig made far ahead of T1 can be unsubmittable, or the time→slot mapping Alice used can differ from Bob's node. C-1's fix makes this harmless because Bob rebuilds. Otherwise, constrain T1 − go_time < 30 h.

### M-3. Zcash tx fingerprint: `expiry_height = 0` (confirmed by T6)
All four real txs (fund, sweep, the alt_joint and alt_adaptor variants) have `nExpiryHeight=0`, `lock_time=0`. Mainstream wallets (zcashd/zallet, Zashi, YWallet) set expiry = height+40. Zero-expiry Orchard txs are a small, distinctive set, so they label both the Bob→joint funding and the joint→Alice sweep as "zeUTXO", which undermines timing unlinkability. **Fix.** Set expiry = tip+40 like wallets do, and send via the same wallet-default code path (anchor depth, action padding to 2, ZIP-317 fee) so the txs look like ordinary Zashi traffic. Fee/valueBalance=10000 for 2 actions is standard and fine.

### M-4. Setup-channel confidentiality is a hidden requirement
Whoever sees the setup messages (A_p, B_p, the joint FVK / joint address, amounts, A_c/B_c) can link the Cardano escrow (A_c/B_c are in the datum) to the Orchard note, and later decrypt the sweep's incoming side via the FVK. The spec doesn't state that the setup transport must be end-to-end encrypted and authenticated. **Fix.** Make it a stated requirement (Noise/age over an authenticated channel, no relays that log), and delete the joint FVK after settlement.

### M-5. Counterparty keeps the joint FVK forever (inherent; document it)
Each party can later prove to a third party which Zcash txs were the swap's (fund and sweep). That's inherent to a 2-of-2 note. Document it, and advise each party to sweep onward to a fresh address with a random delay so the counterparty can't follow the funds further.

### M-6. Simulator/test gaps that hide exactly the failures above (test integrity)
- **C2:** `awaitBlock` moves mempool→ledger without re-checking TTL, so "Bob broadcast in time" is only a recorded boolean. The emulator can't show a late Redeem failing.
- No parameter-change, rollback, PastHorizon, mempool-drop, or Zcash-reorg scenarios. `zec` node has no expiry handling or reorgs.
- `mustFail` passes on *any* exception, including harness bugs. I audited the step-2 rejection reasons and they are the intended ones, but nothing enforces that. **Fix:** assert on the expected error class.
- `bobChecksLock` takes `utxosAt(script)[0]`. It should check the specific outref that the go-sig/redeem commits to, and handle several UTxOs at the shared script address.
- `utxoToCml` drops multi-assets and reference scripts. Token-dust UTxOs at the script address aren't represented.
- The "adaptor" and "joint" Zcash variants aren't tied to the protocol's revealed secret (they are separate signing demos).

## LOW / INFO

- **L-1. DLEQ context binds to the prover's swap id (T1, reproduced).** `dleq_ctx(pj["swap"], who)` reads the swap id from the counterparty's own pub.json, so a proof from swap OLD verifies in swap NEW. Today it only harms the replayer (reusing a share is self-harm). Still, fix it: derive `swap_id = H(sorted commitments of both parties ‖ amounts ‖ T1 ‖ T2 ‖ network ids)` locally, verify against that, reject `A == B`, and reject any share point already seen (including any B_c / A_c seen on chain). **Reusing a share across swaps is fatal:** once b is revealed in swap 1, swap 2's counterparty can sweep. The setup should refuse previously seen points.
- **L-2. D15 inclusivity (answered).** Cardano ledger: validity lower bound inclusive, upper bound exclusive (`slot < ttl`). Plutus sees `[lower, upper)` with `is_inclusive` flags that the validator ignores. The current checks (`Redeem: upper ≤ T1−1`, `Refund: lower ≥ T1`, `Punish: lower ≥ T2`) are **safe with no overlap**. The cost is a 1-slot dead gap, which is harmless. Keep it. Optionally check `is_inclusive` explicitly, or switch to `upper ≤ T1` with exclusive-upper semantics, and document the choice.
- **L-3. Code vs spec drift.** `aliceGoSign` allows going ahead until `T1 − Δ/2`, but the spec says before T0. Near T1 that leaves Bob too little room (makes C-1/H-1 worse). Enforce the spec deadline `now ≤ T1 − Δ_ada − margin`.
- **L-4. "Adaptor signatures" in the description vs the implementation.** The tested path reveals the share and then signs solo (RedPallas with rsk = σ(a+b)+α). Adaptor-signature nonce reuse is therefore not reachable in the tested path, and simpler. If the adaptor variant is ever used: fresh nonce per presignature, never re-presign the same message with a different nonce under the same adaptor point. Update the wording.
- **L-5. Metadata (inherent).** A constant escrow script hash labels every swap on Cardano: amount, pkhs, T1/T2 and timing are public. Timing correlation between the Cardano lock/Redeem and the Zcash fund/sweep is the main residual linkage. Mitigations: random delays for both sweeps (no deadline), common round amounts, fresh Cardano keys/addresses per swap, Bob funding from the Orchard pool only (cross-pool funding reveals the amount).
- **L-6. Front-running / third parties.** Not possible. Redeem, Refund and Punish each require a counterparty signature, so a mempool observer can read b but can't redeem. (b is useless to observers; only Alice can use it.)
- **L-7. Rogue key / malleability.** PoKs of dlog(P) and dlog(Q) inside the DLEQ transcript prevent rogue-key choices of B_p. The σ (ỹ-sign) normalization is consistent between `zec` and the sweep; the scalar range is < 2^252 on both curves, and the Cardano validator range-checks b and recomputes [b]G₁ = B_c, so a malleated b is rejected.

## DLEQ / cross-group soundness (checked, no finding)
252-bit decomposition with Pedersen bit commitments on both groups (H_p, H_b hash-to-curve, no known dlog). AOS 2-member rings per bit with a shared 248-bit challenge, below both group orders, so special soundness extracts a bit per position on both sides. Zero-sum blinders are enforced by the PoKs, so the bit commitments sum to exactly P and Q. The value is < 2^252 < min(r_pallas, r_bls), so x is the same integer on both curves. Rust compressed G1 encoding matches the Plutus `bls12_381_G1_uncompress` input (verified by the passing setup and redeem flows plus the tampered-encoding negative). Remaining requirements: Fiat–Shamir transcript must include both groups' generators and all commitments (it does), and the context string (L-1).

## Privacy verdict (detail)
**Cryptographically unlinkable: PASS.** What's public on Cardano: A_c, B_c (datum) and one share, b (Redeem) or a (Refund). None of these, nor anything derived from them, appears on Zcash (T6 byte scan: no b, a, A_c, B_c, A_p, B_p, ak, −ak, nk, rivk, or raw joint address in any tx). `rk = ak + [α]G` uses fresh uniform α from OsRng per build; T6 confirms rk ≠ ±ak and differs between builds. The spend-auth signature is masked by α and its nonce. Halo2 is zero-knowledge. Nullifiers need nk, which never leaves the parties. Outputs use ovk=None. There are no transparent or Sapling parts (node rejects them; T6 confirms 0/0/0). Knowing b plus the Cardano data doesn't let an outsider derive ak, because they lack a and A_p.
**What still links:** timing and amounts (L-5), the expiry=0 fingerprint (M-3), the setup channel (M-4), and the counterparty's own knowledge (M-5). The counterparty learns only the joint note, its fund and sweep txids, and the other party's revealed share, which is the minimum for this construction.

## Test-integrity verdict (detail)
I reran the step-2 suite with fresh keys and got 70/70, matching step 2's claims. Every recorded rejection reason is the intended one (no "passed because something unrelated crashed" cases in the current results). The emulator does verify vkey signatures cryptographically and runs phase-2 scripts with the real cost model. The `zec` checker does real Orchard batch validation (Halo2 proof, RedPallas spend-auth and binding sigs), anchor membership, nullifier freshness and ZIP-317 fee, and rejects non-Orchard parts. So the tests aren't trivially passing. **But** the harness structurally can't show the Critical and High issues (M-6), and `mustFail` accepts any exception. Call it "honest but blind to time, rollback and parameter failures".

## Recommended fixes, in order
1. **C-1:** go-message signature (Ed25519 over swap_id ‖ escrow_outref) verified in the validator, with Bob building and rebuilding Redeem himself. This retires M-1 and M-2. New script hash means rerunning step 2.
2. **H-1/H-2:** split Δ into Δ_ada (inclusion + settlement) and Z (Zcash confirmation depth). Rewrite Bob's broadcast rule, Alice's refund rule and Alice's go-ahead rule with them. Add epoch-boundary avoidance. Make `aliceGoSign` query live note depth.
3. Simulator: re-check TTL at block time; add param-change, mempool-drop, rollback and Zcash-reorg scenarios; make `mustFail` assert on the error class. Port `adv.mjs` C1/C2/C3 into the regression suite (C1 must then show Bob *rebuilding* and winning).
4. Privacy hygiene: expiry = tip+40 and wallet-default tx shape (M-3); encrypted, authenticated setup channel requirement (M-4); random sweep delays and fresh keys per swap (L-5).
5. L-1 swap-id binding plus seen-point rejection; L-3 deadline; doc updates (L-2, L-4).

## Overall
**FAIL for proceeding to the testnet rehearsal as currently designed.** One reproduced honest-loss trace (C-1) is adversary-schedulable via public governance timing, and two timing definitions (H-1, H-2) are unsafe as written. None of this touches the cryptography or privacy core, which held up. After fix 1 and the rule changes in fix 2, plus a green rerun with the new adversarial tests, I'd expect a PASS.
