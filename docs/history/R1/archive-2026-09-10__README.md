# R1 archived research — start here

Archived 2026-09-10T15:40:38.450745+00:00 at the user's request. **NO-GO for further development of this implementation toward the required practical prototype (roughly30minute swaps).** This is a project investment decision from incomplete system evidence, not a proof that shielded atomic swaps or every R1 architecture are impossible. The recurring continuation automation was deleted; no proving job remains active. No restart or rerun is authorized by any historical document.

## What this archive contains

The complete existing project stays in place so paths, dependencies and local recovery material are preserved. This folder and its adjacent ZIP are a curated snapshot of named public reports, selected source and decision records. They are NOT a complete reproducible environment or a private-wallet backup. A manifest records exact relative filenames, byte sizes and SHA-256 digests. Runtime caches, toolchains, private note/receipt witnesses, unsafe parameters, wallet envelopes and proving keys are not packaged. Public research evidence can still contain test transaction identifiers; it is not an unlinkability-safe publication bundle.

Original locations: Windows main <WIN_HOME>/Documents/Codex/r1-project-1788792876740/project; task <WIN_HOME>/Documents/Codex/2026-09-07/hav; WSL R1-Ubuntu user <user> at <WSL_HOME>/r1-project. Do not move/delete the remaining work directories without a separate retention decision. No file cleanup here destroys failed runs or working tooling.

## Final result and why we stopped

The local regtest/offline-Cardano-emulator swap completed shielded delivery, independent buyer spending, seller claim and an elapsed-time no-payment refund. It is a research demonstration, not a public integrated swap. See outputs/integrated-swap/README.md in this bundle.

The latest optimized recursive proof succeeded:2,359,573constraints; setup2475.57s; proving102.60s; total2611.18s; peak4.93GiB resident. Fresh-process deserialization/native verification passed and rejected mutations to all12public inputs. No proving key or toxic waste persisted. Serialized gnark proof292bytes is a different format from the earlier336byte Aiken fixture; no new ledger transaction/budget was validated for it.

That proof verifies the saved joined-transcript/truncated1024cell-memory statement. It is NOT a complete STWO/header/chain verifier. Full program memory attempts failed under the cap. Full execution/AIR/PCS/FRI/lookup connections, authenticated child ranges/boundaries, actual aggregate proof generation, final Cardano interface, general genesis bootstrap and sustained relay performance remain unestablished. A model places FRI+composition hashing alone at151.4–155.6million constraints before other work. Neither full end-to-end timing nor a defensible cost-to-complete was established. The retired60% estimate must not be reused.

## Evidence to read first

1. outputs/PROJECT-DECISION.md and PROJECT-DECISION.json: requirement matrix, architecture decisions, conditional cost model, stopping rules.
2. outputs/stwo-wrapper-review/RECURSIVE-PROOF-RESULT-PAUSED.md and custom-recursive-independent-verify.json: strongest recent result and its exact limits.
3. outputs/stwo-wrapper-review/MVP-FEASIBILITY-DECISION.md and custom-recursive-setup-inventory.json: resource reasoning; older next actions are obsolete.
4. outputs/stwo-wrapper-review/TWO-CHILD-COMPACT-PROGRESS.md: two-child witness solving only, no aggregate proof or coverage binding.
5. outputs/ALTERNATIVE-CONSTRUCTIONS.md and ATTACK-TRACES.md: original R1–R5 routes and explicit adversarial obligations.
6. NEXT-ROUTE.md: conditional R2 recommendation and first stop/go conditions; no implementation is authorized.

## Reusable assets and boundaries

- Receipt semantics: bind recipient, amount, valid note encryption, offer-specific memo and historical delivery. Recipient spending must not invalidate seller payout. Seller cannot depend on a later buyer signature/viewing-key disclosure.
- Local claim/refund, timing-admission, persistence and fork/restart fixtures are reusable test ideas. They are not arbitrary-outage or production-security guarantees.
- Exact BSB22 SHA256-XMD, canonical byte/scalar encoding, subgroup checks and fixed-key verifier components have preserved positive/negative evidence. Native key constants must not become unconstrained witness inputs. Proof B must not receive untrusted precomputed lines.
- Compact solver changes witness-check allocation only. It does not remove FFT/key memory in actual proving. Default-buffer failures remain useful evidence; do not erase or repeat them unchanged.
- Old generic recursion uses shortened MiMC, unlike the saved BSB22 proofs. The custom compatible circuit solves that narrow mismatch; generic drop-in compatibility is still not implied.
- STWO native hashes use64byte domain prefixes and strict final-block handling. Exactly70masked query draws are sorted/deduplicated without redrawing collisions; exact coverage/order and mixed-height FRI conventions matter. Read the preserved detailed checkpoints before reuse.

Pinned environment references: custom port dd44a6f6529e91ce0bd8df8722ce86edd0e4dbd1; gnark0.14.0/gnark-crypto0.19.0; Go1.24.6; native STWO45d0180. Local segmented setup and bounded scalar multiplication are research allocation variants with prior parity tests, not an audit. The maximum tested virtual ceiling was10,500,000KiB with Go5GiB soft limit; routine ceiling6,500,000KiB/3GiB. Existing source snapshots/patches and original dependency metadata remain in outputs/stwo-wrapper-review/source and the unmodified working environment.

## Local recovery material retained, not archived for sharing

Dedicated test wallets and encrypted local harness state remain where created. DPAPI recovery depends on the original Windows user/machine context; do not assume copying an encrypted file to a new account makes it recoverable. The original Preview wallet key envelope was unusable; never reuse it. Replacement Preview v2 passed recovery testing; its last funding record was pending, not rechecked for this archive. Zcash Testnet self-transfer was already confirmed and its original faucet note spent; do not resubmit it. No wallet was opened, recreated or funded during archival. No private witness, key or unsafe parameter was inspected or exported.

## Rules for any future restart

Archive is read-only reference by convention, not filesystem enforcement. Keep it unchanged; start any future work from a deliberately scoped copy or separately named task only with user authorization. Define the entire transaction/proof graph, trust/privacy requirements, timing objective, prerequisite evidence, bounded usage and stop decisions before coding. A component pass is not project viability. A prototype target is not a production assurance. No automatic continuation, credits, real funds, paid services or silent privacy relaxation are authorized by this archive.
