# Revised next research tranche

This continuation promotes R1 (private completed-payment proof) and refines R2 (shared auxiliary input). It does not approve implementation or replace the existing security gates. The earlier 73–140 person-day end-to-end estimate should **not** be applied to R1: building a Zcash verifier is additional work whose scale is not established.

## What changed in this milestone

- Distinguished proof of completed shielded delivery from proof of an escrow deposit. The first can support one-sided Cardano escrow without asking Zcash to enforce a foreign condition.
- Identified a deployed-protocol architectural precedent for payment-proof swaps and an actual Cardano proof-verifier toolkit.
- Found implementation limitations in the fetched LightSwap paper and a later published attack claim relevant to Universal Atomic Swaps.
- Wrote ten adversarial traces and concrete proof obligations. No protocol code or cryptographic experiment was run.

## Practical proof-cost evidence

The inspected IOG verifier repository generates Plinth/Aiken verifiers and includes a cost estimator. Its architecture uses BLS12-381/KZG, so feeding it a native Orchard proof is not a supported shortcut. An appropriate wrapper or separately designed receipt circuit is necessary. The repository labels itself proof-of-concept, not thoroughly tested/audited.

Its fetched benchmark table reports an Aiken simple-multiplication verifier at about 5.3 billion CPU units, and an ATMS example at 9.7 billion, against the table's 10-billion limit. Other examples exceed that limit. These are upstream examples, not measurements of our receipt circuit or guaranteed current network budgets. Search snippets showed older figures, so the opened page was preferred. [Repository](https://github.com/input-output-hk/plutus-halo2-verifier-gen)

Inference: proof verification is plausible on Cardano, but there may be little room for escrow checks and chain logic. A proof-cost decision belongs before a full implementation. BLS/KZG setup assumptions, public-input count, proof size, serialization, verifier pinning and ledger costs all need explicit evaluation.

## Proposed bounded investigation: 12–24 human person-days

Estimates assume experienced cryptographers/chain engineers and exclude reviewer scheduling. They describe future work, not effort already spent by this assistant.

| Work item | Effort | Acceptance condition |
|---|---:|---|
| Specify R1 private receipt statement | 3–5 days | Exact witness/public-input schema; prove receipt without buyer's later signature/viewing key; test vectors planned for ciphertext, amount, network, pool, replay and already-spent output |
| Map Zcash chain authentication to Cardano | 3–6 days | Select explicit SPV or full-validity model; complete header/chain-selection/checkpoint/freshness requirements; reject oracle substitution |
| Estimate verifier and prover costs | 2–5 days | Pinned toolkit and intended proof system; include entire escrow validator costs; separately estimate native-proof verification/recursion and payment-receipt arithmetic; no extrapolation from multiplication alone |
| Model deadlines and ten attack traces | 2–4 days | Exhaustive bounded-state model with pending transactions, permanent knowledge, competing branches and two clocks; explain assumptions and any counterexample |
| R2 fallback review | 2–4 days | Establish shared auxiliary-input control and pre-funding signature feasibility; list the complete allowed spend set; show no single-party sabotage path |

**Decision after the tranche:** proceed to a separately scoped local fixture only if R1's evidence statement, trust model, budget and timing survive; otherwise select R2 with explicit privacy relaxation, pursue a specified remaining research question, or stop. A discovered attack is a useful research result.

## Questions to settle on paper first

1. Can receipt validity be proved from the sender's existing transaction witness while keeping the txid and note commitment private?
2. What exact Zcash evidence does Cardano authenticate, and which chain-validity assumptions remain outside the circuit?
3. Can a single offer use a fixed verifier with hiding committed terms, avoiding a circuit/verifier generated per trade?
4. How is replay prevented without adding the same public identifier to both chains?
5. Does a refund freeze on stale relay state merely exchange asset-loss risk for indefinite ADA lockup?
6. For R2, can all refund-critical effecting data and authorization be fixed before principal funding under the actual released v6 implementation?
7. Does later scriptless-swap literature invalidate a proposed race-handling argument? Retrieve and review the full PipeSwap paper before relying on the older timed route.

## Scope and usage

The prior prototype and private data were not accessed during this continuation. No subagents, outreach, paid external service, reset redemption or chain activity occurred. Research balances were checked through the account tool; consumption is shared across tasks and can post with delay.

Visible intermediate account snapshots: **2,309.761981** credits during the literature review and **2,298.104231** after candidate analysis. Finalization snapshot: **2,284.520231** credits. The decrease from the first listed snapshot is **25.241750**, covering only that interval; it is not this continuation's total cost or exclusively attributable to it. The five-hour window remained at 100%, the weekly display at 0%, and three reset credits remained available. No reset was redeemed. Billing can lag and the final response occurs after this snapshot.

Verification: all 12 local Markdown links in the ten-document package resolved. Candidate names, stated privacy relaxations, source references and research-only labels were reviewed for consistency. The ten traces remain analytical rather than executed tests.
