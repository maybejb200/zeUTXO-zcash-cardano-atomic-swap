# Phase 2 results: adaptor-signature ZEC↔ADA swap prototype
Mon Nov 2, 2026, ~12:30 AM ET. Code is in `/workspace/zeutxo-adaptor-proto/` (see its README). The spec is `zeutxo-step2-adaptor-spec.md` v0.1.

**Labels:**
- **[M]** = measured or run on the box.
- **[E]** = estimate.
- **[Model]** = logic simulation, not consensus code.

## Verdict: PASS (prototype scope)
- **End-to-end flow works with fresh random keys.** Steps: DLEQ → BIP-340 adaptor pre-signature → Bob completes it → Cardano emulator accepts the claim → Alice extracts *t* → Alice completes the Orchard RedPallas adaptor signature, which the ZF `reddsa` crate's standard verifier accepts.
- **Refund paths and all 9 Cardano negative tests behave as expected.**
- **Not covered:** real Zcash transactions. That means no ZIP 244 sighash, no Halo2 proof, no P2SH X output, no FROST. The Orchard part is limited to the spend-authorization signature.

## Libraries used (cited)
| Part | Implementation | Source |
|---|---|---|
| RedPallas verify, SpendAuth basepoint check | `reddsa` 0.5.2 (Zcash Foundation) + `pasta_curves` 0.5 | https://github.com/ZcashFoundation/reddsa , https://github.com/zcash/pasta_curves |
| BIP-340 reference verify | own port of BIP-340 `reference.py` | https://github.com/bitcoin/bips/blob/master/bip-0340/reference.py |
| BIP-340 independent check | `coincurve` 21.0.0 (libsecp256k1 bindings) | https://github.com/ofek/coincurve |
| Cardano Schnorr check | Plutus V3 builtin `verifySchnorrSecp256k1Signature` via Aiken stdlib v4.0.0 | CIP-49 |
| Cross-group DLEQ | **own** Python, following MRL-0010 and Farcaster's `dleq.rs` design | https://www.getmonero.org/resources/research-lab/pubs/MRL-0010.pdf , https://docs.rs/farcaster_core/latest/src/farcaster_core/crypto/dleq.rs.html |

I found no maintained Pallas↔secp256k1 DLEQ library. The Zwap code the spec mentions was not reviewed.

## Off-chain checks: 24/24 PASS [M] (`py/swap_e2e.py`)
- **DLEQ proofs (secp256k1 ↔ Pallas, 252 bits):**
  - a valid proof verifies;
  - rejected: wrong T_p, a tampered response, a wrong context (session binding), and a proof for a different secret;
  - proof size **56,700 B**; prove **8.6 s**, verify **8.7 s** in pure Python [M]. A Rust version would be milliseconds [E].
- **BIP-340 adaptor:**
  - Bob pre-verifies Alice's pre-signature;
  - rejected: a pre-signature checked against a wrong T, and the pre-signature used as a signature on its own;
  - the completed signature is valid under the reference verifier **and** under libsecp256k1 (coincurve);
  - Alice extracts *t* = Bob's secret, and t·G_pallas = T_p;
  - even-y parity handling: both branches exercised across repeated runs (6 of 8 runs used the non-negated branch).
- **Orchard RedPallas two-party adaptor** (`reddsa` verifier):
  - my basepoint and key re-randomization match `reddsa`'s own derivation;
  - nonce commit-then-reveal works;
  - Alice's pre-verification check `z'·G = R − T_p + c·rk` holds;
  - rejected: the pre-signature alone, Bob alone even if he knows *t* (he lacks z_A), a completion with a wrong *t*, and the signature checked on another message;
  - the completion with the extracted *t* is valid;
  - the plain two-party refund signature R is valid;
  - a separate run with a wrong *t* cannot complete.

## Cardano `adaptor_escrow` in the emulator [M] (`aiken tx simulate`, real ScriptContext, unsigned, never submitted)
**Setup:**
- Script: 955 B, used as a reference script. Escrow: 100 ADA.
- D2 deadline: T_A = t1 + 8 h.
- Signed message: m = blake2b_256(tag ‖ txid ‖ idx_be16), which binds the signature to this exact outref.

| Tx | Result | Size | Mem | CPU | Fee |
|---|---|---|---|---|---|
| claim_ok (Bob, t1 + 30 min) | **ACCEPT** | 490 B | 97,793 (0.59%) | 79,143,405 (0.79%) | **0.203 ADA** |
| refund_after_T_A (Alice) | **ACCEPT** | 417 B | 87,574 (0.53%) | 30,270,802 (0.30%) | **0.195 ADA** |

**Rejected, as expected (9/9 failed in script execution):**
- bit-flipped signature;
- pre-signature only;
- a signature for another outref (replay);
- a claim after T_A;
- a claim without an upper validity bound;
- a claim not signed by Bob;
- a claim that pays the wrong party;
- a refund before T_A;
- a refund by Bob.

The fee figure is the formula 44·size + 155,381 + prices·ExUnits + 15·script bytes, using mainnet epoch-665 parameters. Real fees would be close [E].

## Outcome scenarios under D2: 8/8 as expected [Model, using the emulator and reddsa results] (`py/scenarios.py`)
- **Happy path:** ADA → Bob, ZEC → Alice.
- **Bob never claims:** both refunds work.
- **Alice never locks:** Bob refunds the ZEC.
- **Bob claims late:** rejected; both refund.
- **Claim without *t*:** rejected.
- **Alice refunds early:** rejected; the swap still completes.
- **Alice uses a wrong *t*:** Bob refunds.
- **Alice too slow:** she misses T_B. **This is hazard H2, so Alice loses.** It is shown deliberately: it is the residual timeout risk that the relay upgrade removes.

**Timing:**
- T_A = t1 + 8.00 h.
- T_B = t1 + 17.62 h (≈ 2,537 Zcash blocks).
- Gap T_B − T_A = 9.62 h ≥ D + Z = 8.29 h, **so the check passes**. The risk sheet's ≈ 10.4 h used a slightly larger allowance base; both pass (logged as D-10).

## Gaps and next steps
- **Real Zcash transactions:** a v5 ZIP 244 sighash for C and R with `nExpiryHeight` = 0, the Halo2 proof, and the P2SH X output. Use `librustzcash`'s builder off-chain, plus regtest Zebra only once John allows nodes.
- **FROST adaptor hook (O1):** not done. This prototype uses plain two-party Schnorr with commitments.
- **DLEQ (O3):** my own code and **unreviewed**. It needs an external review and a constant-time Rust port. Proof size is 56.7 KB, so send it off-chain only.
- **Parity (O2):** covered by tests here. Port the tests to the production language.
