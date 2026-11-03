# R1 escrow boundary — Sprint 2 preparation

2026-09-07. This executable design supplements the receipt specification. The [model and tests](r1-contract/README.md) are independent of the pending Sprint 1 node gate. The [Aiken project](escrow/README.md) now passes 51 tests covering the compiled refund scaffold, claim-context preparation and cross-language statement encoding. Claims remain disabled in the spending handler. Nothing is deployed. The user authorized continuing independent work while keeping this PC's system setup unchanged.

## Narrow first profile

One R1 escrow input is permitted per transaction, counted by payment script credential, including inputs with different staking credentials. This prevents two invocations from each counting one payment output as satisfying their obligations. Batching requires a separately reviewed accounting design and is excluded for now.

The escrow contains positive ADA only. A selected plain output must return exactly the full input ADA to the fixed seller address on claim or buyer address on refund; fees require separate funding. Tokens, output datums and reference scripts are rejected on the selected payout. Both destinations are enterprise payment-key addresses on the configured network. This is a deliberate restriction of the earlier codec's broad address length allowance. Output minimum ADA, fees, collateral, value conservation, actual signatures and transaction encoding remain ledger/builder checks.

Datum version 1 contains commitment, fixed seller payout, fixed buyer refund address, deadline and policy hash. The actual script input supplies the escrow reference and ADA amount. These cannot come from a caller's claimed receipt fields. Anyone may submit a correctly paying claim or refund; no submitter may redirect the funds. Initial offer acceptance must check the datum, exact input value, script parameters and agreed terms before the seller pays ZEC.

## Deadline and freshness containment

The first profile requires a finite nonempty validity interval `[L,U)` in POSIX milliseconds. Claim requires `U <= D`; refund requires `L >= D`. Thus `[D-1,D)` can claim and `[D,D+1)` can refund, but no valid interval can do both. Merely overlapping the permitted time period is insufficient.

The standard library documents Plutus V3 upper-open transaction ranges and interval containment. The adapter must check bound types/inclusivity explicitly and use the actual network slot-to-time conversion; test milliseconds are synthetic and are not a deployment schedule. [Aiken interval documentation](https://aiken-lang.github.io/stdlib/aiken/interval.html), [transaction types](https://github.com/aiken-lang/stdlib/blob/main/lib/cardano/transaction.ak). These references were inspected on 2026-09-07; a compiler/library commit must be pinned before compiled validation.

A claim must reference exactly one state bearing the pinned relay token with quantity one at the pinned relay script. No mint/burn of that token or spending of relay state is permitted in the same claim transaction. Its policy must match the fixed offer policy. For state last advanced at A and permitted age M, require `L >= A` and `U <= A+M`. This checks freshness at every possible inclusion time, not just the lower bound. Refund does not require a relay, preserving timeout recovery during relay outages.

These shape checks rely on a future unique-token minting policy and proof-verified update script. Synthetic test tokens are not authenticated chain evidence. The update script must constrain timestamps and prevent identical evidence refreshing A. Freshness still does not establish globally greatest work, and withheld forks remain a stated relay risk. Confirmation count is a minimum of one and is defined here as descendants after the payment block; the receipt circuit must enforce `tipHeight - paymentHeight >= confirmations` inside authenticated history.

## Public proof interface

The validator derives a 422-byte statement preimage, all integers unsigned big-endian:

| Ordered field | Bytes |
|---|---:|
| ASCII R1PUB001 | 8 |
| Actual escrow transaction ID and output index | 32 + 4 |
| Hiding terms commitment | 32 |
| Full escrow lovelace | 8 |
| Seller payout and buyer refund raw enterprise addresses | 29 + 29 |
| Deadline | 8 |
| Policy hash | 32 |
| Zcash and Cardano genesis identifiers | 32 + 32 |
| Escrow payment script hash | 28 |
| Current relay output transaction ID and index | 32 + 4 |
| Current authenticated history root and tip hash | 32 + 32 |
| Tip height | 8 |
| Cumulative work | 32 |
| Required descendant confirmations | 8 |

Public inputs are SHA-256 of this preimage split into two big-endian 128-bit integers. A 256-bit hash must not be silently reduced modulo the receipt proof's scalar field. The circuit must reconstruct the same preimage, enforce canonical widths and equality to both public limbs, open the private terms commitment, and prove the full note/encryption/memo/inclusion relation. Hashing supplied fields without these constraints proves nothing about delivery. The proof backend remains undecided.

Binding the current relay output reference means a relay update between proving and claim submission can require regenerating the receipt, even if the payment remains on the accepted branch. This conservative first interface does not promise proof reuse across updates. Operational proving/update cadence is an unresolved liveness/cost issue; an authenticated historical-root interface may later reduce this friction without allowing losing roots.

## Verification and remaining gates

The model tests payout diversion, under/overpayment, duplicate escrow accounting, unsupported addresses, malformed integers, deadline containment, relay impersonation/duplication/mint/spend, future/stale state and statement binding. A finite grid covers 6,105 intervals, including 1,275 acceptable claim contexts and 55 refund contexts with no overlap. It does not quantify real-world safety probability.

The Aiken claim-context library now prepares the same public digest as the JavaScript context. Four codec vectors also match exact bytes and both limbs; six malformed-width/range cases reject. Fifteen Aiken claim-context tests include relay substitutions, freshness and deadline containment. These library checks do not authenticate the synthetic relay or establish delivery and are not connected to the spending handler.

Remaining work: connect a real receipt verifier and the claim preparation to the handler, test serialized ledger-context adapters, measure the complete transaction under pinned ledger costs, and implement the authenticated relay. The refund scaffold with claims disabled does not pass Sprint 2's private-proof/cost gate. Sprint 1 remains open until node acceptance is demonstrated in a suitable environment.
