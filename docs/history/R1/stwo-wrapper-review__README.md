# STWO wrapper compatibility investigation

The public [Herodotus STWO-to-Groth16 wrapper](https://github.com/HerodotusDev/stwo-gnark-verifier/tree/dd44a6f6529e91ce0bd8df8722ce86edd0e4dbd1) is a concrete candidate for a later recursive relay architecture. It is not integrated with R1. Reviewed revision: `dd44a6f6529e91ce0bd8df8722ce86edd0e4dbd1`. No upstream modifications, messages or pull requests were published.

## Source findings

- The entry point compiles and witnesses over BN254. R1's measured Cardano verifier uses BLS12-381. Switching the outer field needs executable arithmetic, full-circuit, serialization and Cardano verifier checks.
- The entry point declares the entire STARK proof public. A small outer proof alone would not give R1 a compact statement: public input count and verification-key size matter. No compressed R1 statement binding has been implemented.
- `DefaultPcsConfig()` uses one FRI query; `ProdPcsConfig()` uses 70. The repository contains only the one-query all-components fixture. A test comment says ten queries, but executable configuration is one. The development fixture is not a production-security proof or a Zcash proof.
- Program memory, output memory and initial/final machine registers appear in the public claim. Any later private-proof wrapper must explicitly bind the exact approved program, security configuration, initial conditions and output statement. Merely hiding the proof and exposing an unrelated digest would be unsound.
- The M31 accumulator uses a conservative BN254-based bit limit. Its compatibility with BLS12-381 is under test; passing arithmetic cases would not establish the soundness of the whole wrapper.
- The project's README labels it unaudited. No independent security assessment has been completed here.

These observations come from the pinned `main.go`, `variables/pcs_config.go`, `variables/public_data.go`, `m31/m31.go` and verifier source. The earlier [Zoro review](../zoro-review/README.md) separately identifies consensus/profile and Cardano integration gaps. Matching two projects' broad use of STWO does not establish proof-format compatibility.

## Bounded experiment

A project-local Go 1.24.6 toolchain was downloaded from go.dev and checked against its official SHA-256: `bbca37cc395c974ffa4893ee35819ad23ebb27426df87af92e93a9ec66ef8712`. System PATH and global tools were not changed. Pinned gnark 0.14.0 and gnark-crypto 0.19.0 dependencies use the repository's existing module checksums.

M31/QM31 arithmetic tests pass over BLS12-381, including 49 variable multiplication/addition vectors and rejection of altered results, plus existing component cases. The unmodified whole wrapper stops at an explicit BN254-only Blake2s guard. A separate isolated port admits BLS12-381 as well; twelve native Blake2s length vectors and altered digests pass on both curves.

The ported whole-wrapper engine exhausted an initial 3,500,000 KiB virtual-memory cap (peak resident 2,003,920 KiB), then the established 8,500,000 KiB cap as the sole large job (peak resident 7,002,876 KiB, 189.13 seconds). Neither attempt completed validity checking. These are bounded resource failures, not proof verification passes.

A binary range-check diagnostic passed the one-query fixture in the execution engine and rejected an altered final program counter (83.45 seconds, peak resident 2,490,020 KiB). It uses bit decomposition while preserving other commitments and forwarding the frontend cache. Its first adapter attempt failed on a missing cache interface; that failure log is retained. No range check, commitment or security configuration is intentionally skipped.

Actual R1CS compilation failed at the 8,500,000 KiB virtual-memory cap with both range-check strategies. Default range checks failed after 134.57 seconds (peak resident 5,849,504 KiB); binary range checks failed after 302.57 seconds (peak resident 6,060,580 KiB). A separate SparseR1CS/PLONK-oriented compilation also exhausted the same cap after 117.30 seconds (peak resident 5,715,196 KiB). None produced a complete constraint system, setup or proof. Engine success is narrower than proving-system success. There is no active wrapper job. Further work requires an architectural or measured resource change rather than repeating unchanged failed compilations; a sparse backend would additionally require a different verifier integration.

The development fixture schema has 66,527 public variables and zero secret variables. It cannot be used as R1's compact on-chain statement without additional binding work. Gnark's Groth16 backend also supports proof commitments and their knowledge proof; where this wrapper uses them, R1's plain three-point Bellman verifier is insufficient. A compatible verifier must check those extra commitments rather than discard them.

Zoro's recursive dependency is a Ztarknet STWO-Cairo branch with optional custom Blake2b support; its pure-Cairo Blake2b path is also present. Compatibility with the wrapper's pinned shape/AIR version has not been established. No new proving setup, Zcash recursion proof or Cardano wrapper transaction has been generated.

## Acceptance gates before adoption

Later bundled Scarb 2.12.2 STWO proofs were generated and verified locally with 70 FRI queries (arithmetic and 8/32/64 hash probes). Their schema does not match this wrapper: generated opcode claims include ten fields absent from its raw Go structure, while the wrapper expects different opcode partitions and an interaction_pow field absent from these proofs. See generated-proof-schema-comparison.json. Missing optional fields alone are not a cryptographic incompatibility proof, but no matched-version bridge has been established. Do not coerce missing fields to zero and treat parsing as verification.

1. Match and verify a securely configured proof from the exact intended recursive Cairo program and toolchain.
2. Bind pinned genesis, network, consensus rules, program identity and complete old/new history state into a compact canonical statement. Retain the existing fork-selection and freshness rules.
3. Measure compilation, witness generation, proving, memory, key size and Cardano transaction verification on the intended configuration. One-query timing does not extrapolate to 70 queries.
4. Demonstrate actual header recursion from genesis and sufficient sustained throughput. Compressing a proof does not remove the computation needed to establish history.
5. Supply setup assurance and independent review before release.

This investigation does not authorize trusted recent checkpoints, oracle signers, paid proving services or a weaker relay baseline.
