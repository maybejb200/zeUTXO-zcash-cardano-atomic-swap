# Project decision: original shielded atomic-swap MVP

Assessment date: 2026-09-10T13:17:30.406Z. Existing evidence only. No new proof, benchmark, transaction, external research or implementation was performed for this assessment. Automatic development remains paused.

**Decision: HOLD implementation of the original MVP. The available evidence does not support committing to its delivery on this machine. Technical possibility is unresolved, rather than disproved.** The recent proof result is real and useful, but it removes one resource uncertainty while major correctness, architecture and operating-cost questions remain.

Recommendation: preserve the existing research result and do not authorize another component optimization or proof run on the strength of this assessment. A complete public MVP cannot be represented as routine remaining integration. If predictable delivery is required, stop the current MVP effort or explicitly change the deliverable to the existing local research demonstration. Neither a funded wallet nor more included usage would resolve the main blockers.

## Acceptance contract

The original deliverable is a public Cardano Preview ↔ Zcash Testnet shielded swap: a real shielded payment, independently spendable by the buyer, authenticated to Cardano without trusting a relay signer or a recent checkpoint, with correct payout/refund behavior. A public testnet demonstration can explicitly use unsafe research setup; that does not qualify as production-secure deployment. No mainnet, real funds or paid services are authorized. Private keys, note openings, proving keys and toxic waste stay local and out of public artifacts.

The following requirements govern a GO decision. They are acceptance criteria, not claims that tests exist:

| Requirement | Acceptance evidence needed |
|---|---|
| Complete verification | Every required statement, execution/AIR, lookup/memory, PCS/FRI and transcript check is connected to the exact claimed header and payment. No unauthenticated intermediate value can satisfy a required fact. |
| Chain trust | Fixed-genesis bootstrap, all applicable contextual rules, ancestry, fork choice, confirmations and reorg handling; no trusted recent-state shortcut. |
| Atomic outcome | Public testnet claim on valid payment and refund after no payment; late payment, stale relay and recovery cannot enable an incorrect payout or extend deadlines. |
| Hardware | Complete generation and verification fit the established 10,500,000 KiB virtual ceiling with measured margin and reproducible handling of failure. A single successful component is insufficient. |
| Ledger | Exact final transaction/interface works under the selected network's applicable limits with the project's 20% resource reserve. Saved budgets are diagnostic evidence until a final implementation is measured. |
| Operating performance | Measure cold bootstrap separately from a warmed-up swap, including data acquisition, loading, leaf proofs, aggregation, submissions, confirmations and recovery. Relay processing must keep pace with incoming required work, with explicit headroom and a catch-up plan. |
| Security scope | Public testnet research limitations are explicit. Production suitability requires a secure setup strategy and independent review, neither demonstrated here. |

Selected requirement: a practical prototype. This follows option B offered during the assessment: approximately 30 minutes per swap, with a running, caught-up relay. Treat this as the acceptance target, not a demonstrated capability or guaranteed network latency. Count payment/confirmation handling, required proof work, relay updates and final claim settlement; report initial bootstrap and circuit setup separately rather than hiding them. Exact timer start, confirmation policy, outage allowance, bootstrap budget and sustained-load margin still need specification before any performance test is approved. All original correctness, fixed-genesis trust, testnet-only and no-paid-service constraints remain. A local research demonstration alone does not satisfy this selected deliverable. Existing evidence has not established that the complete prototype meets the target; implementation remains on HOLD.

## Evidence ledger

“Demonstrated locally” is scoped to the listed fixture/environment. “Failed” applies to the measured implementation and cap. “Open” means mandatory evidence is absent; it is not a percentage of remaining effort.

| Requirement or component | Finding | Consequence |
|---|---|---|
| Shielded delivery, buyer spend, claim and no-payment refund | Demonstrated in the integrated regtest/offline Cardano emulator, including 25 header proofs and three receipt proofs. [Local swap](integrated-swap/README.md) | Preserve this as a research demonstration. It is not a public integrated swap. |
| Current single recursive verifier proof | Demonstrated: 2,359,573 constraints; 2,475.57 s setup, 102.60 s proving, 2,611.18 s total, 4.93 GiB peak RSS. Separate-process verification and all 12 public-input mutation rejections pass. [Result](stwo-wrapper-review/RECURSIVE-PROOF-RESULT-PAUSED.md) | The claim that this particular proof cannot fit is refuted. No equivalent result for the complete verifier follows. |
| Native commitment-hash compatibility | Exact original BSB22 hash, point/knowledge binding and public accumulation work in that connected verifier. | The historical generic shortened-MiMC incompatibility has a tested custom solution for this profile. It is no longer an unresolved single-proof blocker. |
| Two-proof verification capacity | 4,521,845-constraint circuit accepts a duplicated valid fixture and rejects all 20 corruptions using compact witness solving. No two-child setup/proof. [Evidence](stwo-wrapper-review/TWO-CHILD-COMPACT-PROGRESS.md) | Positive solver capacity only; neither useful aggregation nor aggregate proof generation is demonstrated. |
| Authenticated chunk composition | Open. Existing 12 inputs expose a transcript digest and truncated-memory sum, not a complete chunk instance/range/boundary contract. | Parent metadata cannot repair facts absent from child proofs. New child relations and authenticated coverage are required. |
| Complete program memory | Three bounded setup attempts for the 21,250-cell kernel failed; successful proof uses only 1,024 cells. [Recorded decision](stwo-wrapper-review/MVP-FEASIBILITY-DECISION.md) | Unchanged full-memory implementation is a failed route under the measured limit. Smaller proof success does not discharge full memory. |
| Full AIR/composition/PCS/FRI | Partial native/circuit checks pass; the full compiled AIR equality and all connected authentication obligations are absent. [Composition](stwo-wrapper-review/SPLIT-COMPOSITION-PROGRESS.md) | A valid partial statement must not be accepted as a valid full STWO proof. |
| Header application binding | Canonical output-binding helper and joined circuit solving pass; complete execution and chain context remain unverified by that helper. [Header binding](stwo-wrapper-review/HEADER-BINDING-PROGRESS.md) | Output equality alone is not execution authentication. |
| Full verification scale | Model: 151.4–155.6 million constraints for FRI plus composition hashes, excluding other work. [Cost model](stwo-wrapper-review/custom-constant-full-fri-cost-model.json) | Strong evidence of a scaling challenge, not a full memory/time measurement or impossibility result. |
| Genesis bootstrap and sustained relay | Isolated native header proofs and a heights 0–2 diagnostic pass; general public bootstrap, context, fork handling and sustained delivery remain open. [Relay](relay-throughput/CUSTOM-RELAY-PROGRESS.md) | A finite selected fixture does not establish a relay that can keep up or start from genesis practically. |
| Cardano cost | Local claim measured 7,755,274,251 CPU; maximum-context diagnostic is hypothetical, not a final public ledger transaction. [Claim diagnostic](claim-context-diagnostics/report.json) | Useful budget evidence. No final recursive public-swap transaction budget is established. |
| Public integration | Zcash Testnet self-transfer is recorded; no public cross-chain swap is demonstrated. | Funding would enable tests but is not the primary feasibility blocker. |
| Recovery and security review | Selected local refund/restart controls pass; broader failures and independent security review remain open. | Preserve scope limitations; no production readiness claim. |

## Architecture verdicts

| Candidate | Present decision | Reason |
|---|---|---|
| Unchanged large monolithic verifier | NO-GO for continued unchanged implementation | Full-memory attempts failed; complete verifier is absent and modeled hashing is much larger. This is not a proof that every monolithic design is impossible. |
| Chunked verifier with recursive aggregation | HOLD; not ready for an MVP implementation commitment | Single-proof generation works, but complete child relations, coverage, actual aggregate proving, final interface and total throughput are missing. This is a substantial architecture gap. |
| Staged on-chain verification | HOLD; not demonstrated as a practical alternative | Under saved cost assumptions, 64–66 ideal chunks imply 64–66 submissions and 16–17 fully available blocks/header, before other costs. State dependencies and unavailable chunks need a sound design. This conditional calculation neither measures final cost nor rules out all alternatives. |
| Existing local demonstration | GO only as an explicitly narrower research deliverable | A reproducible local claim/refund demonstration exists. It cannot be relabeled as the original public MVP. No additional packaging work is authorized by this assessment. |

For scenario A (hours acceptable), latency is less restrictive but complete trust-preserving verification and bootstrap are still mandatory and unestablished. Scenarios B and C have no supporting complete-system timing evidence. None receives a full-MVP GO. The assessment does not claim either B or C has been mathematically ruled out.

## How the complete cost must be accounted for

Per-header online cost includes fetching/validating input, generating the original header proof, every verification chunk, every aggregate layer, loading reusable artifacts, final transaction construction/submission and confirmation. Per-swap time also includes the confirmation policy and receipt proof/claim path. Some steps can overlap only if dependencies and available hardware permit it; no overlap is assumed here. Bootstrap and catch-up are separate accumulated workloads. Setup is a circuit/key-specific preparation cost, not necessarily repeated per swap; no proving key was persisted in the experiment, so its 103-second proving measurement is not an operational restart benchmark.

Do not multiply 103 seconds by 64–66 and label it measured latency. Those chunks have different shapes, the count is conditional, other work is omitted, and actual aggregation is missing. Likewise do not add every historical circuit count: they overlap, use different scopes and include alternatives. The saved eight-thread legacy header benchmark (five proofs in 701.34 seconds plus 129.79 seconds parameter loading) is a different path from the custom STWO header primitive; their figures cannot be mixed into one throughput result. [Legacy benchmark](relay-throughput/eight-thread-report.json)

The evidence does not contain a trustworthy complete-work total or a defensible cost-to-complete estimate. That missing information is itself a reason to withhold an implementation commitment, not a license to keep exploring indefinitely.

## Additional-test decision and stopping rules

**No new computational test is recommended now.** Another isolated scalar/hash optimization, a repeat of the successful proof, or a proof of the same duplicated children would not decide full-MVP viability. The single-proof resource question was answered. A meaningful next experiment needs a specified complete composition architecture first; implementing that missing design is not a small verification exercise.

If you later choose to reopen feasibility work, the prerequisite is a reviewable obligation map: every full-verifier obligation assigned exactly once, exact authenticated child/parent public interfaces, key schedule, coverage/adjacency rules, final acceptance conditions and a complete-work cost model with explicit unknowns. If that map requires unauthenticated supplied values, changes the trust model, omits work, or cannot identify a resource-bounded representative test, reject the design before coding. No duration or usage estimate for constructing it is substantiated in the current record, so this assessment does not invent one.

Only after that prerequisite can a test proposal be eligible: two distinct real adjacent chunks from the actual chosen partition, child-proved instance and boundary data, parent proof, independent verification, and gap/overlap/replay/instance/boundary substitution rejection. Success would clear that named composition gate only; it would not close full-verifier completeness or throughput. Failure would stop that candidate unchanged. The proposal must state a concrete construction budget, maximum included usage and wall time, existing memory ceiling, expected artifacts, exact pass/fail outcomes, and the decision each triggers. **Budget is currently unset; therefore no such test is approved or scheduled.** No automatic next experiment after a pass, no unchanged retry after failure, and no ceiling increase.

Firm current stop rule: keep MVP implementation and the recurring automation paused. A newly selected latency preference can refine the assessment without automatically authorizing more development. Resume only after an explicit user choice addressing a concrete proposal. If the required investigation exceeds the acceptable budget, archive or narrow the project; do not continue under a vague progress estimate.

## Sprint status replaces percentage estimates

| Sprint | Current status |
|---|---|
| 0–2: specification, delivery and receipt | Demonstrated within local research scope; public and security-release claims remain separate. |
| 3: authenticated public relay | BLOCKED at architecture/completeness/operating-feasibility gates. The single recursive-proof resource gate passed. |
| 4: integration and recovery | Local happy path/refund and selected recovery tests passed; broader failure and final ledger coverage incomplete. |
| 5: public-testnet MVP | NOT DEMONSTRATED. |

The prior “60% complete” figure is retired for planning and reporting. It cannot be converted into a credible remaining-hours estimate or success probability. This assessment authorizes no new project work and makes no production-security assertion.

Named source files and their SHA-256 digests are recorded in [evidence manifest](PROJECT-DECISION-EVIDENCE.json). Machine-readable decisions and measured figures are in [decision record](PROJECT-DECISION.json). Older checkpoint next actions are historical and superseded by this assessment and the user's pause.
