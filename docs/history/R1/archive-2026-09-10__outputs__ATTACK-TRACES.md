# Adversarial traces for the proposed alternatives

Analytical thought experiments, 2026-09-07 UTC. **These are not executed tests, formal model-checker results, cryptographic breaks of named papers, or evidence of node acceptance.** They identify obligations for proposed local adaptations. Z sells ZEC; A sells ADA.

## T1 — Funding proof mistaken for delivery

1. A locks ADA against proof that Z funded a shielded note.
2. Z proves a genuine note under a key it controls.
3. Cardano releases ADA to Z.
4. Z spends the note back to itself.

Result: Z retains both assets. Fix: R1 proves actual delivery to A's committed recipient, not existence of a seller-owned deposit. This is the distinction missing from the earlier blanket concern about proof-based release.

## T2 — A valid receipt arrives too late

1. A's ADA becomes refundable at Cardano slot D.
2. Z broadcasts a shielded payment with insufficient margin.
3. The Zcash payment confirms, but proving or relay updates take longer than expected.
4. A refunds at D before Z can submit an accepted claim.

Result: A holds both assets. Fix: no payment near the deadline; bounded end-to-end proving/relay/inclusion budget and finite payment expiry. A larger margin mitigates a stated delay model, not arbitrary outages. If the required bound cannot be defended, reject R1's finite-refund design.

## T3 — Fake or stale chain evidence

1. Z supplies a mathematically valid proof of a payment under an attacker-selected root or low-work branch.
2. Cardano verifies the circuit but never authenticates the root against its chain-selection policy.
3. Z receives ADA, although A has no payment on the accepted Zcash chain.

Result: proof correctness without chain correctness loses funds. Fix: authenticate chain state, starting checkpoint, work/difficulty, fork selection, freshness and necessary validity assumptions. An RPC response signed by a server is a changed trust model, not the same fix.

## T4 — Refund secret exposure mistaken for successful refund

1. In a simplified R3, Z starts delayed ADA settlement and gives A the material needed to claim the shared ZEC.
2. Before settlement finalizes, honest Z invokes the permitted abort path and broadcasts the authorized Zcash refund.
3. A sees the refund's signature/secret in the mempool. A races a conflicting ZEC claim, which wins.
4. A uses the observed refund secret to cancel Z's ADA payout and regain ADA.

Result: A has both assets even though the ZEC refund never happened. Fix options: remove the race through a fully proved transaction graph, or require stable actual-refund evidence. The latter needs chain verification and reorg handling. A signature's availability cannot by itself certify its transaction's inclusion. This is a challenge to the simplified adaptation, not a claimed break of the full LightSwap protocol.

## T5 — Single-owner auxiliary input sabotage

1. In naive R2, the Zcash claim depends on a transparent auxiliary UTXO that malicious Z can spend alone.
2. Honest A broadcasts its Zcash claim, exposing the swap secret.
3. Z spends the auxiliary input in a competing transaction, preventing A's claim from confirming.
4. Z uses the exposed secret to claim ADA.

Result: A has paid ADA but did not receive ZEC. Fix: neither party has unilateral arbitrary-spend authority over the shared auxiliary input; verify the complete jointly authorized transaction set. A shared label or wallet convention is insufficient. Shared control still does not resolve normal deadline/reorg races.

## T6 — Refund authorization unavailable after disappearance

1. Z locks principal under a joint shielded key.
2. ADA's refund branch requires A to reveal its key share.
3. A disappears permanently and never submits that branch.
4. Z waits beyond every Cardano deadline.

Result: no additional secret becomes knowable merely from elapsed time; ZEC stays locked. Fix: independently usable recovery capability before funding, timed cryptography with explicit assumptions, or R1's removal of shared custody. Compensation in ADA does not restore the ZEC note.

## T7 — Old receipt pays a new offer

1. Z previously paid A the same amount.
2. A creates a new ADA offer using the same receiving address.
3. Z proves the old receipt again.

Result: Z collects a second payment without new delivery. Fix: bind a fresh session discriminator to the note/payment and the specific consumed escrow. Merely putting the new offer ID in proof public inputs does not suffice unless the circuit checks its relationship to the payment.

## T8 — Recipient spends receipt before seller claims

1. Z pays A correctly.
2. A spends its note to another address.
3. A naive R1 verifier requires the receipt note still to be unspent.
4. Z's ADA claim fails; A later refunds.

Result: recipient activity defeats payment. Fix: verify historical valid receipt, not current possession of an unspent note. Preserve a usable chain witness after spending.

## T9 — Both branches expose information across a reorganization

1. A Cardano success transaction reveals a key share or settles against a Zcash receipt.
2. The other chain's resulting transfer becomes practically irreversible.
3. A sufficiently deep Cardano rollback restores a refundable escrow, or a Zcash rollback removes the recognized payment.

Result: the branches can disagree across chains. Fix: explicit reorg bounds, finality policy, no reset of knowledge flags, and no claim of safety against arbitrary rollback. Separate honest-party protection within the assumed bound from residual chain-security risk.

## T10 — Committed output, unusable ciphertext

1. Z proves a note commitment for the agreed value and recipient.
2. The proof does not check that the published encrypted note data match the opening.
3. Cardano pays Z, but A cannot discover/reconstruct the note through normal wallet operation.

Result: an incomplete delivery statement can accept an unusable receipt. Fix: include correct note-encryption/decryption relation and recipient/pool encoding. Identify exactly what sender-held witness lets the circuit prove this without asking A to cooperate afterward.

## Terminal outcomes to require

| Situation | Required honest-party outcome |
|---|---|
| A never funds ADA | Z makes no payment |
| A funds; Z never pays | Z retains ZEC; A refunds ADA |
| Z pays correctly with policy-compliant margin | Z can collect ADA without A's later cooperation |
| Incorrect amount, recipient or session | Claim fails; conforming Z would never have sent such a payment |
| Already delivered note is spent by A | Z's valid historical receipt remains usable |
| Relay/prover cannot meet policy before payment | Z refuses to pay |
| Assumed liveness fails after payment | Explicit failure mode; no unconditional refund promise |

Next work should translate these traces into a small formal transition model before any signing or transaction code. A model must include permanent knowledge separately from reversible ledger state, two independent chain clocks, and an adversary that sees pending transactions.
