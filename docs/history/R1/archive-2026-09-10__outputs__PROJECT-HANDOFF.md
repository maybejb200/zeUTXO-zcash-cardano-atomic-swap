# Full project handoff — 2026-09-07

## Start here on the destination machine

This is the complete authored research/source/report set for R1, plus pinned upstream proof-generator source and its generated Aiken files. Read this document, SPRINT-STATUS.md, R1-RECEIPT-SPEC.md, R1-CONTRACT-SPEC.md and SPRINT-1-NODE-HANDOFF.md before implementation. This context document summarizes the conversation's project decisions; it is not a verbatim chat transcript.

The user asked to transfer the entire project and context to the app-connected machine, remote-pc. SSH inspection identifies that destination as Windows under <WIN_HOME>\Documents, not Linux. Transfer the files there without changing its system setup; Linux node testing still requires a suitable environment. The original workspace remains intact. Transfer verification is recorded separately after extraction.

## Goal and protocol

Build an MVP exchanging native ADA for native same-pool shielded ZEC. Buyer locks ADA first with a hiding terms commitment and fixed seller payout. Seller makes an ordinary shielded payment directly to the buyer and uses a private historical payment receipt to claim ADA without a subsequent buyer message. No delivered payment means buyer refunds ADA after the deadline. After payment, unilateral claiming depends on explicit bounded liveness; arbitrary outages can cause seller loss.

The receipt must prove the agreed recipient, amount, note commitment, full recipient ciphertext and encrypted offer memo, plus authenticated transaction inclusion and confirmations. It must remain usable after the buyer spends the note. No buyer private key, general viewing-key disclosure, wrapped asset, principal pool crossing, signed-root oracle, or boolean proof substitute is allowed. ADA amount/time and relay root remain public; universal timing unlinkability is not claimed.

Payment profile: NU6.3 branch 0x37a5165b, transaction v6, Ironwood V3 notes, no transparent/Sapling/Orchard/Sprout components in the payment. Sender recovery uses a new swap-specific outgoing viewing key persisted before broadcast. V6 transaction effects commitments must bind full ciphertext/memo; native proof verification is distinct from the private Cardano receipt.

Relay model: proof-verified header/history light client with honest validating miners, observation/data availability and bounded-reorg assumptions. It is not full transaction validity verification. A unique state token and fixed update validator must authenticate state. Greater cumulative work, authenticated ancestry, confirmation depth, freshness and losing-fork rejection are required. Reposting unchanged evidence cannot refresh state age. Freshness is not proof of global best chain. Genesis-to-tip provenance is baseline; changing checkpoint trust requires explicit design revision.

## User decisions and boundaries

- User authorized research, MVP sprint planning/implementation, independent later-sprint work while the Linux gate is pending, and this project transfer.
- Keep the original Windows PC's system setup unchanged: no WSL/Docker, feature changes, global configuration or restart. Toolchains used so far are workspace-local.
- On the destination, work within the designated project directory. Transfer authorization does not by itself authorize destructive changes or system installation there.
- No mainnet, real funds, paid external services, publication, outreach or subagents. Do not read existing wallets or previous projects' private directories, keys or journals. Do not send messages to other people.
- Use outputs for deliverables and work for scratch/builds/new synthetic fixture secrets. Do not redistribute scratch secrets. No independent security audit has occurred.
- The overnight one-window work session ended and its automation is paused. Do not recreate it, redeem usage-reset credits or silently resume a recurring usage budget. Account usage is shared; historical balances are not exclusive project costs.

## Completed evidence

1. Sprint 0 complete: 29 Node tests, 5,103 timing schedules and 11,126 bounded event states. Conditional timing safety and intentional outage/reorg loss traces are documented. These counts are not real-world probabilities.
2. Sprint 1 native Rust cryptography works on Windows: v6 payment proof/signatures, fresh seller recovery, independent buyer decrypt/spend construction, and recovery afterward. Five separate processes, three Rust unit tests, ten recovery checks before/after, cross-language memo equality. Initial funding/tree and network identifiers are synthetic; neither transaction was mined or node-accepted. Thus Sprint 1 remains open.
3. Contract context model: 31 Node tests and 6,105 intervals with no claim/refund overlap. One R1 escrow input per transaction prevents two escrows counting one payout. Exact full pure-ADA payout, fixed enterprise-key addresses, finite nonempty [L,U) ranges; claim U<=D, refund L>=D. Fees require separate funding.
4. Aiken project: 51 tests pass, comprising 26 refund/scaffold tests, 15 claim-context tests and 10 codec tests. Shared context produces a 1,567-byte unapplied refund scaffold. Every spending-handler claim still rejects. Claim preparation/encoding libraries are tested but not connected to the handler; scaffold size excludes proof verification. Typed-context unit evaluations are not full serialized ledger transactions.
5. Public statement: 422-byte R1PUB001 encoding, SHA-256 split into two big-endian 128-bit limbs. Four cross-language vectors agree on exact preimage, digest and limbs. Never reduce the full 256-bit digest silently into a smaller scalar field. Circuit must reconstruct all bindings, not just accept supplied hashes. Binding current relay UTXO can force reproving after relay updates; this is an unresolved operational constraint.
6. IOG proof probe: source b95783e64082185f8cbffcf070df2358bab4275b compiled on workspace Rust 1.91.1 GNU. simple_mul generated and Rust-verified a real BLS12-381/KZG arithmetic proof and emitted Aiken/Plinth code. Actual proof size 1,120 bytes versus estimated 1,088. Generated Aiken verifier has NOT been compiled/tested here. Example uses dummy public inputs and deterministic unsafe setup; it proves no payment and provides no production setup assurance.

## Next work

First run the Linux fixture, then complete actual node integration: configure isolated pinned Zebra regtest, obtain accepted synthetic funding and tree witnesses, adapt the fixture, mine payment/buyer spend, recover historically, and reject invalid proof/signature/expiry/anchor/nullifier cases for their intended reasons. The package does not contain a completed node adapter or ready node configuration. Inspect pinned upstream NU6.3 regression tests rather than inventing production-compatible values.

Independently, compile and attack-test the generated arithmetic Aiken verifier. Then implement a real proof of the exact statement with two constrained limbs before expanding to the full delivery relation. The inspected Midnight circuits source offers SHA-256 and foreign-curve machinery; a complete Pallas/Sinsemilla/ChaCha20-Poly1305 Ironwood receipt gadget was not found there. Pallas arithmetic, seed/key derivation, note commitment, full encryption and v6 private inclusion remain substantial work. Native Ironwood Halo2 proofs are not directly compatible with the BLS12-381 verifier.

Sprint 2 requires full receipt proof plus complete Cardano transaction CPU/memory/size with provisional 20% headroom and setup/proving measurements. Sprint 3 requires authenticated relay. Sprint 4 requires integrated local swaps, failure/reorg/crash tests and measured timing bounds. Sprint 5 requires prior gates and testnet evidence, with independent review before real funds. Do not mark a gate complete because a smaller mock/example passed.

Earlier subjective estimates were roughly 60% eventual technical feasibility and 30% practical MVP, with broad judgment ranges. They were not statistical confidence intervals and have not been recalculated from these tests.

## Portable files and reconstruction

All authored project work lives in outputs. run-linux.sh at archive root runs the Rust fixture using native Linux Rust 1.91.1, Node 24+ and a C compiler. It verifies SHA256SUMS before running. The historical rust-toolchain.toml is Windows-specific, so retain the explicit Linux override. No Linux execution has been performed by this task.

The Aiken source is portable but its run.ps1/verify.mjs and vector formatter invocation currently target the Windows workspace executable; port those launchers to native Aiken v1.1.23 before claiming Linux reproduction. Standard library is pinned in aiken.toml. Run the same tests with warnings denied and traces disabled; preserve actual reports separately from historical Windows results.

vendor/halo2-source.tar is the tracked upstream source at the pinned commit, including its license. Extract into work/halo2-run and copy outputs/proof-probe/Cargo.lock there before building with native Rust 1.91.1. outputs/proof-probe/generated-aiken preserves the emitted source; license is alongside it. Do not use the upstream submitter or default mainnet configuration. Rebuild compiler/dependency caches on Linux; no Windows binary is needed.

Excluded: synthetic spending keys/outgoing viewing keys/note seeds, unsafe setup caches, wallet data, downloaded compiler binaries, build products, dependency caches and original tool-call/chat storage. Regenerate synthetic material. Every archived file is checksum-listed. Existing results are historical evidence, not evidence of a run on the destination.
