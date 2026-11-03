# Custom Cairo stack — local research

The pinned custom compiler builds successfully. Ten native-reference hash boundary cases pass after a local high-level buffering repair. Fifteen additional API cases pass, including cloned 140-byte prefix reuse and each partial-word ending. The original upstream checkout is unchanged.

The full Equihash test executable accepts an existing mined regtest solution and rejects a changed nonce, duplicate leaf and reordered leaves. Its four cases execute in 7.81 seconds using 4,723,459 VM steps. This measurement includes negative cases and is not directly comparable to the earlier single-solution measurements. It does not verify contextual difficulty, timestamps, header hash against target, or a chain from genesis.

A separate extended fixture now passes eight checks: the four Equihash cases, serialized header SHA-256 matching a native reference, and target acceptance, equality and rejection boundaries. Execution took 8.98 seconds and 5,413,448 steps. It still does not verify contextual difficulty, timestamps or a chain from genesis. See `custom-header-report-v1.json`.

The matching prover and verifier have built successfully. The initial attempt reached its 30-minute limit; the offline resume completed in 23m53s with peak resident memory 2,302,840 KiB. Both binaries are hashed in `prover-build-report.json`; the initial timeout and versioned logs are preserved.

The ten-case custom hash proof now succeeds and separately verifies. It took 140.0 seconds with one worker, a 9,000,000 KiB virtual cap and peak resident memory 8,703,660 KiB. The 13,683,374-byte JSON proof SHA-256 is `af42589a6f8ed41103abe9aeb94e5e0bdd26dea1f16bd36f9e44adf46da4b624`. It uses 70 FRI queries, blowup log 1, last-layer log 0 and 26 proof-of-work bits. Separate verification took 0.096 seconds. Altered final PC and public output reject; host binding rejects altered program, output, settings and preprocessing commitment. See `custom-verification-report.json`.

## Verification integration observations

The pinned generic verifier CLI accepts a proof path, channel and preprocessing variant. It does not accept an application-specific expected program or output. `verify_cairo` reads security parameters from the proof. The local host binding helper now passes on the generated proof and requires exact artifact field words, expected output, 70-query settings and the separately recomputed preprocessing commitment. The first bytecode comparison caught signed executable immediates versus their canonical field residues; normalizing the expected signed words modulo the Cairo prime yields exact equality. Noncanonical proof field values reject.

The inspected `verify_cairo` function commits the proof-supplied preprocessing root with the selected trace sizes; no comparison to an independently expected root is visible in that function. The host helper pins a separately computed root. A broader review remains open. This is an integration observation, not a demonstrated exploit or an audit conclusion.

Recomputing full canonical preprocessing exceeded the 8,500,000 KiB virtual cap. The supported no-Pedersen variant succeeded in 39.87 seconds, peak resident 5,032,388 KiB, producing `f67c7e85cb16f6ea29d45a3f3b85c2c6af49304bbae367aba47280684e8b8b04`. The fixture entrypoints do not use Pedersen. This is a separate calculation using the same pinned implementation, not an independent audit.

The initial small-proof configuration omitted the required `store_polynomials_coefficients` field and failed before proving. Corrected attempt v2, with the documented false default, reached out-of-domain evaluation but exceeded the 8,500,000 KiB cap after 137 seconds, peak resident 8,337,536 KiB. Successful attempt v3 used the same artifact, preprocessing root and security parameters with one worker and the measured 9,000,000 KiB virtual cap. No coefficients-setting retry was made because source inspection shows it still constructs the same weight map.

Pinned files supporting these observations:

- `stwo_cairo_prover/crates/dev_utils/src/bin/verify.rs`
- `stwo_cairo_prover/crates/cairo-air/src/verifier.rs`
- `stwo_cairo_prover/crates/cairo-air/src/air.rs`
- `stwo_cairo_prover/crates/prover/src/witness/preprocessed_trace.rs`

The repository commit is `f94a1439b9a7fbb6e93f0b26d68a6725ca588624` within stack commit `d3fd3f1f8093e7efc0a0b6ad54317a36646acf66`.

## Next gates

The optimized full Equihash fixture proof and separate verification are complete. Recursive proof compatibility, compact Cardano binding, practical relay throughput, genesis bootstrap and independent review remain unfinished. A static comparison of the actual custom proof finds fields missing from the candidate wrapper: `blake2b_context`, `verify_bitwise_xor_8_b`, opcode `blake_2_b`, and optional `channel_salt`. No wrapper proof or compatibility is claimed.

Completed checks must not be repeated unchanged. The full Equihash proof runner remains guarded on a successful small-proof separate verification. All heavy jobs use the exclusive lock.

All artifacts in this directory are public test fixtures or source. No new chain transaction, key export, paid service, mainnet action or public cross-chain swap occurred in this experiment.


## Verified full Equihash fixture

The optimized full Equihash fixture proof succeeded in 187.35 seconds with one worker, peak resident 9,455,696 KiB and a 10,000,000 KiB virtual cap. Separate verification passed in 0.115 seconds; altered final PC and output rejected. Host checks also rejected changed program, output, security settings and preprocessing root. Proof size is 16,452,099 bytes, SHA-256 716157ef4f883ba2224cabc72ce52262c5f174be2394e1e16c347d02625cfc41. The exact 26-case public artifact includes a mined solution and rejection controls; twelve separate native digest references also pass. This is the same pinned implementation, not an independent audit. Contextual chain validation, recursion and Cardano integration remain open.


The combined 30-case Equihash/header-hash/target proof also succeeded: 168.63 seconds, 9,663,864 KiB peak resident, 19,321,660 bytes. Separate verification passed in 0.131 seconds and both proof tamper cases and all four host-binding controls rejected. SHA-256 c8de3012c48d005c84cb51205a9fcc53a6c3f3a95f21371c904450741af641eb. The successful retry used a 10,500,000 KiB process cap without changing WSL allocation.

The identical Equihash-only artifact measured 187.35 seconds with one worker, 110.58 with two and 80.46 with four. All three produced byte-identical proofs. These are single sequential measurements, not a sustained relay benchmark; see custom-throughput-report.json.
