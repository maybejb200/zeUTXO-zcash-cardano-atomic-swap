# R1: the unshielded (public-chain) successes

R1 ("shielded completed-payment research") ran from about Sept 7 to Sept 10, 2026, when it was archived as a **no-go** for the ~30-minute prototype target.
Its *goal* was shielded: ADA locks first, Bob makes an ordinary shielded ZEC payment, and a proof checked on Cardano releases the ADA.
To get there, R1 had to authenticate Zcash's **public** chain (headers, Equihash proof-of-work, targets) on Cardano, and that public-chain work is where most of its real, measured results are.
This page collects those results. Everything here is copied from R1's own reports (see `docs/history/R1/`) or from the Nov 1 audit (`docs/relay-design/audit-2026-11-01.md`). Nothing is new or re-measured.

> R1's own framing, which still applies: "Technical possibility is unresolved, rather than disproved." A component pass is not project viability.

Source key: **[PD]** PROJECT-DECISION.md, **[AR]** archive README, **[CS]** zoro-stack-review/CUSTOM-STACK-STATUS.md, **[ZC]** zoro-cairo-tests/README.md, **[JP]** stwo-wrapper-review/JOINED-PROOF-MILESTONE.md, **[MF]** stwo-wrapper-review/MVP-FEASIBILITY-DECISION.md, **[IS]** integrated-swap/README.md, **[TS]** testnet-setup/README.md, **[PH]** PROJECT-HANDOFF.md, **[AU]** the Nov 1 audit (which read R1 files on GGLori and quotes DESTINATION-CHECKPOINT.md, which is not among the copied docs).

## 1. Equihash (200,9) and header verification in Cairo / STWO

| Result | Numbers | Source |
|---|---|---|
| Zoro upstream: 17 difficulty tests pass; isolated Equihash 200,9 case passes at an 8,500,000 KiB cap | 25,843,568 VM steps (short ASCII message, not a real 140-byte header prefix) | [ZC] |
| Local compatibility patch (exact compact bits, 90-min median upper bound, height-activated mainnet median-time check) | Full patched suite **104/104 tests**, 136.53 s, peak RSS 3,471,804 KiB | [ZC] |
| Shared Blake2b prefix state across Equihash leaves (after fixing an upstream buffering bug found by native differential tests) | 104/104 consensus tests; 14.54 % fewer steps on the 200,9 case; 50/50 utility tests incl. 16 native differential hash cases | [ZC] |
| **Real mined regtest header (true 140-byte prefix)** | Steps 37,848,494 → 22,223,492; peak RSS 4,961,996 → 3,094,624 KiB | [ZC] |
| Rotation-optimised Blake2b (v2) | 54 utility + 105 consensus tests; mined-header steps 21,311,525; 64-hash proof 75.11 s → 62.38 s | [ZC] |
| Custom Cairo stack: full Equihash test executable accepts a mined regtest solution and rejects changed nonce, duplicate leaf, reordered leaves | 4 cases, 7.81 s, 4,723,459 VM steps | [CS] |
| Extended header fixture: 4 Equihash cases + serialized-header SHA-256 vs native reference + target accept/equal/reject boundaries | 8 checks, 8.98 s, 5,413,448 steps | [CS] |
| Ten-case custom hash **STWO proof**, separately verified | 140.0 s prove, 0.096 s verify, peak RSS 8,703,660 KiB, 70 FRI queries, 26 PoW bits; tampering and host-binding controls reject | [CS] |
| **Full Equihash fixture STWO proof** (26-case public artifact incl. a mined solution and rejection controls) | 187.35 s (1 worker) / 110.58 s (2) / 80.46 s (4), byte-identical proofs; verify 0.115 s; proof 16,452,099 B | [CS] |
| Combined 30-case Equihash + header-hash + target proof | 168.63 s, peak RSS 9,663,864 KiB, 19,321,660 B; verify 0.131 s; all tamper and host-binding controls reject | [CS] |

Limits stated by R1 itself: no contextual difficulty, timestamps or chain-from-genesis verification; no recursion compatibility; no Cardano binding; no independent audit [CS].

## 2. Equihash as a Groth16 circuit, and on-chain cost

| Result | Numbers | Source |
|---|---|---|
| Equihash(200,9) as a circuit | **26,650,078 constraints**; staged version: four 8,212,125-constraint leaves + a 7,152,467-constraint global relation | [AU] quoting DESTINATION-CHECKPOINT.md |
| Legacy direct-header benchmark | 5 proofs per header, 701.34 s + 129.79 s parameter loading | [AU] quoting PROJECT-DECISION.md |
| Direct Equihash checker on Cardano | **Exceeded budget: 19.28 billion CPU units** (a failure, recorded for honesty) | [AU] quoting DESTINATION-CHECKPOINT.md |

TODO (GGLori): the Equihash circuit source, its constraint reports, and DESTINATION-CHECKPOINT.md were not among the copied docs. Copy them from R1 to confirm these figures and add the circuit's location.

## 3. Recursive proof of the STWO verifier (Groth16 / gnark over BLS12-381)

| Result | Numbers | Source |
|---|---|---|
| Joined 1,024-cell transcript/memory proof | 2,387,930 constraints; setup 2,295.75 s; prove 100.10 s; peak RSS 5,120,860 KiB; native verify + 4 negative controls pass | [JP] |
| **Aiken verifier for that proof** | **36/36 Aiken tests** (each of 12 changed public inputs, non-canonical limbs, altered points, lengths); offline cost CPU 4,668,240,938 / mem 38,117, accepted under saved Preview limits | [JP] |
| Optimised single recursive verifier proof | **2,359,573 constraints; setup 2,475.57 s; prove 102.60 s; total 2,611.18 s; peak 4.93 GiB**; separate-process verify; all 12 public-input mutations rejected; 292-byte gnark proof | [PD], [AR] |
| Native BSB22 commitment-hash compatibility | Exact BSB22 hash, point/knowledge binding and public accumulation work in the connected verifier | [PD] |
| Two-child capacity | 4,521,845-constraint circuit accepts a duplicated valid fixture and rejects all 20 corruptions (witness solving only, no aggregate proof) | [PD] |

Limits: it verifies a truncated 1,024-of-21,250-cell memory statement, not a complete STWO/header/chain verifier. The full verifier was modelled at 151.4–155.6 M constraints for FRI + composition hashing alone. Three full-memory setups failed at the 10,500,000 KiB cap [PD], [MF].

TODO (GGLori): RECURSIVE-PROOF-RESULT-PAUSED.md, TWO-CHILD-COMPACT-PROGRESS.md and the JSON evidence (custom-recursive-independent-verify.json, PROJECT-DECISION.json) were not copied.

## 4. Integrated local swap (regtest Zcash + offline Cardano emulator)

- A dedicated Zcash regtest node was connected to a persistent offline Cardano emulator. A separate native miner solved each adopted header and checked Equihash and the target. **25 real node-header proofs and 3 receipt proofs** were verified by the Cardano-side chain certificate [IS].
- The node accepted the payment and the independent buyer spend. A restart picked an alternate height-3 block; the membership builder rejected the mismatch, and the harness repaired the branch [IS].
- **Seller claim settled** before the deadline: 10,636 B, **7,755,274,251 CPU**, 1,587,436 memory, within the 20 % reserve. A separate no-payment escrow rejected an early refund and returned all 10 emulator ADA after the deadline, from a restored ledger in a new process [IS].
- Earlier sprint evidence [PH]: Sprint 0, 29 Node tests, 5,103 timing schedules, 11,126 bounded event states; contract context model, 31 Node tests and 6,105 intervals with no claim/refund overlap; Aiken project, 51 tests; a 422-byte R1PUB001 public-statement encoding with 4 cross-language vectors; an IOG BLS12-381/KZG proof probe (1,120-byte proof).

The *payment* in this swap was shielded (Ironwood v6), so only the header/relay/claim side counts as "unshielded" work.

## 5. Public testnet operation

- Cardano Preview: the first wallet's key envelope turned out to be empty and was retired; replacement wallet v2 passed encrypted-key round-trip and separate-process recovery [TS].
- Zcash Testnet: a dedicated wallet received 0.1 TAZ and made a **confirmed self-transfer** (mined at height 4,336,218, 9,166 bytes), with Merkle paths and nullifier absence checked locally [TS]. This shows native shielded testnet wallet operation, not an atomic swap.
- (Wallet keys and witnesses stayed in restricted local directories on GGLori and are **not** in this repo.)

## 6. The separate transparent MVP (before R1, Sept 5–7)

According to the audit [AU §2a], an earlier, separate transparent HTLC project ran a classic HTLC: Aiken/Plutus V3 hash-lock on Cardano + transparent P2SH/CLTV on Zcash. It recorded confirmed public-testnet trials (Cardano Preview lock and claim, transparent v4 Zcash lock and claim, a separate refund trial), 80 passing checks, and ZIP-243/244 test vectors passing. It was not private, and its own notes said it "is not safe under indefinite outages".

TODO (GGLori): the transparent MVP's README.md and docs/ARCHITECTURE.md were not copied. Confirm these figures from it.

## 7. Why R1 stopped (summary)

Full verifier modelled at 151.4–155.6 M constraints; full-memory setup failed 3× at the cap; chunk composition not authenticated; staged on-chain verification would need 64–66 submissions per header; genesis bootstrap impractical (a historical straight-line figure of about 162 years was given, as an illustration only) [PD], [AU]. Decision: HOLD / no-go, archived Sept 10, 2026 [AR].

## Still to be completed from GGLori

- TODO: SPRINT-STATUS.md and DESTINATION-CHECKPOINT.md (the source of the Equihash circuit and 19.28B CPU figures).
- TODO: the Equihash Groth16 circuit source and constraint reports.
- TODO: RECURSIVE-PROOF-RESULT-PAUSED.md, TWO-CHILD-COMPACT-PROGRESS.md, and their JSON evidence.
- TODO: the transparent MVP README / ARCHITECTURE notes.
- TODO: decide whether any R1 *source* (Cairo patches, Aiken verifier, gnark circuits) should be added. Only public fixtures, with no wallet, witness or setup material.
