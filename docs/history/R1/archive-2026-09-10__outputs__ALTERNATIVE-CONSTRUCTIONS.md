# Alternative constructions: second research milestone

Research accessed 2026-09-07 UTC. Hypotheses and architectural analysis only; no protocol implementation, keys, transactions or cryptographic experiment. Cardano remains the counterchain.

**The most promising additional direction is an ADA escrow that pays against a private proof of completed Zcash payment.** This could avoid joint shielded custody and its refund problem altogether. Its main obstacle is a trustworthy, affordable Zcash verification path on Cardano. It is a plausible architecture, not a validated protocol.

The generic idea is not new: Atomiq documents proof-time-locked contracts for Bitcoin and smart-contract chains. The potentially distinctive work here is the composition of private Zcash payment receipts, a Zcash chain verifier, and Cardano escrow. No implementation of that exact composition was established in this search. I cannot establish that nobody has tried it. [N1 in the source register below]

## Revised shortlist

| Route | What changes | Strongest advantage | Main unresolved issue | Research priority |
|---|---|---|---|---|
| R1: completed-payment proof | ADA locks first; ordinary shielded ZEC payment unlocks ADA through a proof | No shared ZEC key, adaptor or shielded refund needed | Chain authentication, private receipt correctness, proof costs and deadlines | First choice for strict shielded principal and no transparent Zcash inputs |
| R2: shared transparent auxiliary input | A small shared UTXO enables a pre-signed Zcash refund's locktime; principal remains shielded | Uses an actual Zcash timing mechanism | Secure pre-authorization, input sabotage, refund/claim race, privacy relaxation | Second choice if a visible auxiliary input is acceptable |
| R3: deferred ADA payout with refund challenge | Seller can reclaim shielded escrow, but ADA payout is delayed and challengeable | Attempts unilateral ZEC recovery without its own on-chain timer | A revealed refund signature need not mean a successful refund | Interesting research, but naive versions fail |
| R4: timed release of restricted refund authorization | Time releases a particular refund signature, not a full wallet key | No transparent input or external committee in computation-based versions | Strong timed-cryptography assumptions and later attacks on earlier constructions | Specialist research; not the quickest MVP |
| R5: Cardano reveals a missing shielded key share on refund | Cardano refund contains the secret needed for ZEC recovery | Simple cooperative recovery | Cannot force a disappearing party to reveal its secret | Reject as standalone original-asset recovery |

R1 changes a premise of the first report: verifying a **completed payment to the buyer** can be enough when ADA is already escrowed. Verifying mere **funding of a seller-controlled note** is not enough. Cardano does not constrain Zcash; it recognizes a completed event. Candidate G in the first report only rules out the latter, insufficient use of proofs.

## R1 — Private proof of payment to release ADA

Let Z sell q ZEC, and A sell p ADA. Use a currently supported shielded pool; Ironwood remains provisional pending the version reconciliation already recorded.

### Proposed sequence

1. A and Z agree on exact terms, A's fresh shielded recipient address, Z's ADA payout address, both networks, a session nonce, and deadlines. Commit privately to q and the recipient in the Cardano datum; p and the Cardano script activity remain public. The commitment must be hiding as well as binding: hashing a small amount without randomness is inadequate.
2. A deposits p ADA into a fixed Cardano escrow. It accepts a proof of the agreed payment before the claim deadline, paying only Z; otherwise it refunds A after the refund deadline. Z independently checks the script, datum, amount and confirmed output before proceeding.
3. Z constructs a normal same-pool shielded payment to A. It binds this payment to the specific offer, for example with a session tag in the encrypted memo whose encoding/encryption is covered by the receipt proof. Z checks sufficient time remains and chooses a finite expiry preventing very late inclusion.
4. After the payment reaches the required chain-security threshold, Z proves the receipt against authenticated Zcash chain data. Cardano verifies the proof and pays Z. The proof may be submitted by a relayer if the payout is immutable; no buyer acknowledgment is required.
5. If Z never pays, Z retains its ZEC and A refunds ADA. After a valid timely payment, the intended outcome is settlement, not reversal of the Zcash payment. An honest Z must have a bounded, independently executable route to claim ADA.

The absence of a shielded refund is not hidden: this construction intentionally never deposits ZEC into an intermediate shared escrow. It substitutes proof-based settlement for the dual-lock workflow.

### Exact proof obligations

The public statement should bind: escrow output reference, network/pool/version, hiding terms commitment, authenticated chain-state identifier, required security depth, and payout branch. The private witness should establish all of the following:

- A particular output/action exists in an accepted transaction at an eligible height on the authenticated chain.
- Its note commitment opens to the exact agreed amount and recipient using the correct pool-specific construction.
- Its note plaintext, ephemeral key and ciphertext are consistent and decryptable by that recipient under the normal receiving procedure. A note commitment by itself is insufficient evidence that the wallet can recover the note.
- The agreed session discriminator is tied to that same payment. Reusing an unrelated old receipt for a new offer must fail.
- The proof binds all effecting and necessary authorizing data through the chosen chain-validation model, not a fabricated transaction sharing an insufficient identifier.
- The Cardano spend consumes the intended offer and cannot redirect payment or apply one receipt to multiple live escrows.

Do not require the buyer's note to remain unspent: A might spend the received ZEC immediately. Proving historical valid receipt must still allow Z to collect ADA. Otherwise A can defeat payout simply by spending its receipt.

Do not require a signature or viewing-key disclosure from A after payment. A malicious buyer could withhold it. The sender must possess enough transaction-construction information to generate the proof alone.

These are a proposed circuit interface and security requirements, not an existing circuit. Current deprecated `z_getpaymentdisclosure` is explicitly Sprout-only, so it does not fill this gap. [N6]

### Authenticate the chain, not just the arithmetic

Three materially different options exist:

| Chain evidence | What it could establish | Residual assumption / cost |
|---|---|---|
| Zcash header relay plus inclusion proof | Payment under a chain selected by checked work/difficulty and fork rules | SPV-style honest-miner/valid-chain assumptions; all relevant Zcash header rules, checkpoints, freshness and competing forks need design |
| Proof of full Zcash state transitions | Validated transactions, proofs, signatures, nullifier rules and chain evolution from a defined starting state | Much larger engineering/proving burden; still needs chain selection, data availability and a justified starting state |
| Server signs a claimed root | Only that the server asserted it | Trusted oracle; fails the default trust model |

A proof that some PoW chain exists is not proof that it is the canonical chain. A valid heavier branch may be unavailable to the contract. The relay needs a clear fork-selection and update model. Neither a threshold signature over a root nor a proof that such signatures verify eliminates trust in those signers.

Zcash lightwallet services are not automatically consensus proofs. ZIP 307 identifies a full node as a trust root in its proposed light-client architecture. [N7] Atomiq's Bitcoin relay provides relevant architecture, not a Zcash-compatible verifier. [N2]

### Privacy

An initial easier version could publish the Zcash txid/output reference while hiding the note opening. That would retain shielded principal and note confidentiality but explicitly fail cross-chain transaction unlinkability.

A stronger version proves membership while keeping the txid, action position, note commitment, recipient, amount and memo private. Cardano sees an offer-specific commitment and chain checkpoint. The encrypted session tag avoids a matching public marker. This is a hypothesis for P5, not a proof: checkpoint timing, unique prices, ADA amounts, ciphertext shape, repeated offers and the trading counterparty still leak information.

Keep claim-scoped private witnesses off general-purpose remote provers unless their exposure is explicitly accepted. A supposedly private proof produced by a service that sees both the offer and its note is not private from that service.

### Deadline risk and honest-party safety

The dangerous interval is after irreversible ZEC payment but before ADA claim. Set a seller stop-pay time earlier than the escrow claim deadline by a budget covering Zcash inclusion/finality, relay update, proof construction, Cardano inclusion, restart and safety margin. Refund validity must not overlap an ordinary claim interval.

Finite Zcash expiry prevents inclusion after a particular height, not after a Cardano slot. A chain stall makes those clocks diverge. The policy must cover this explicitly. A cancellation transaction is not reliable revocation of a disclosed payment unless its conflict is confirmed under the same chain assumptions.

An optional Cardano Closing state could grant a grace period for outstanding claims. However, a plain grace period is only another time budget. Freezing refunds when the relay is stale can preserve safety but strand ADA; an administrator override reintroduces trust. No state machine can promise both finite refunds and safe already-sent payments under arbitrary censorship and outages.

**Conditional viability:** R1 appears compatible in principle with unchanged Zcash transaction rules and programmable Cardano escrow, under an explicit chain-verification and bounded-liveness model. Whether it fits Cardano's execution budget and can produce proofs within the deadline is unknown.

## R2 — Refund enabled by a shared auxiliary UTXO

Refine the earlier mixed-input candidate by protecting the auxiliary input as carefully as the shielded principal:

- ZEC principal is a jointly controlled shielded note. A small separately identified transparent UTXO is shared between Z and A.
- Before principal funding, arrange exact authorized claim/refund templates. The refund includes the auxiliary input with a nonfinal sequence and future locktime. It pays principal back to Z's shielded address.
- Neither participant should hold authority for an arbitrary standalone auxiliary spend. Restrict the available joint signatures to the intended mutually conflicting transactions. A single-owner or anyone-can-spend auxiliary input is unsafe.
- Use exact pool/version-aware authorization, safe fees, a finite claim window and a justified gap before the opposing Cardano refund. Prove no alternate shielded authorization bypasses the transcript.

The inspected Zebra behavior from milestone one supplies the timing hook, but not the whole construction. v6 anchor-independent pre-authorization may make arranging transactions before note confirmation easier; it does not establish that all witnesses, nullifiers, binding signatures, fees and refund dependencies can be fixed in advance. [N8]

This is not a transparent HTLC for the principal: the visible auxiliary UTXO carries a separate small value. Nevertheless it fails P3s, and observable input/script/fee patterns may expose the swap. Both success and refund paths need a public-value-flow inventory. No amount is chosen or funded here.

**Conditional viability:** a stronger engineering candidate than an invented shielded timelock, but less private than the strict target and still blocked on a complete adversarial protocol.

## R3 — Deferred Cardano payout and a refund challenge

An adaptation worth investigating is: give Z a pre-authorized shielded refund, allow Z to request ADA settlement, and delay the actual ADA payout so A can challenge a Zcash refund. LightSwap explores a related pattern; its paper also notes that its Monero pre-signing step cannot be implemented in the form described without changing the input representation. [N4]

Zcash v6 pre-authorization might remove a chain-specific obstacle, which is a potentially useful composition rather than an established solution. But a naive challenge based only on an extracted refund secret is unsafe: a revealed signature can lose its double-spend race while its secret remains usable on Cardano. See trace T4 in [ATTACK-TRACES.md](ATTACK-TRACES.md).

Requiring proof of actual refund inclusion would repair that specific evidence error, subject to reorganizations, but imports much of R1's chain-verifier complexity while retaining shared ZEC custody. Unless it has a measurable advantage, prefer the simpler R1 ownership model. Full LightSwap security is not assessed by this attack against a simplified adaptation.

## R4 — Timed release of only the refund authorization

The most defensible timed-cryptography hypothesis releases a narrowly scoped refund signature or signature share, rather than the entire shielded spending key. Otherwise the recovered key might authorize new conflicting spends that the protocol never intended.

Release must be verifiably bound to the correct transaction, output, note, amount and network before funding. The design also needs a rule preventing refund release from racing a nearly completed claim; “the puzzle takes about an hour” is not such a rule. Computational delay, beacon rounds and chain time differ.

PipeSwap's ePrint entry, listed as S&P 2025, reports a double-claiming attack on earlier scriptless designs and introduces a two-hop approach. The full PDF did not load here, so this is an author-reported result, not an independently reproduced break. It makes reviewing the later security literature mandatory before treating Universal Atomic Swaps as the design baseline. [N5]

JugglingSwap's gradual secret release is another published family, but moves the difficulty to fairness and unequal computation during interruption. It is not evidence of a current Cardano/Zcash implementation. [N10]

## Why some attractive shortcuts still fail

Cardano cannot manufacture an unknown secret from public data merely because a deadline passes. If a refund requires a party's secret and that party disappears, an ordinary script cannot recover it. Making an incentive or collateral penalty large may encourage cooperation; it does not prove eventual original-asset recovery.

A full secret published to an immutable contract cannot remain confidential until a future slot without additional cryptography or trust. Encrypting it to the intended recipient makes it available immediately to that recipient. Encrypting it to a future beacon adds the beacon's assumptions.

Deleting a key share is not evidence that every copy was deleted. Designs based on “the seller promises not to sign another spend” or “the buyer deletes its refund after seeing success” fail against a malicious participant.

## Source register for this continuation

All accessed 2026-09-07 UTC. Moving branches were inspected, not pinned or executed. No audit coverage is inferred from an organization's name.

| ID | Source and date | Evidence level / relevance |
|---|---|---|
| N1 | [Atomiq PrTLC documentation](https://docs.atomiq.exchange/overview/core-primitives/prtlc), updated 2026-07-09 | Project-authored description of confirmed-payment escrow for BTC and Solana/Starknet/EVM. Precedent, not Zcash/Cardano support. |
| N2 | [Atomiq Bitcoin light client](https://docs.atomiq.exchange/overview/core-primitives/bitcoin-light-client), current page | On-chain relay architecture. No portability or performance guarantee for Equihash/Zcash. |
| N3 | [IOG Halo2-Plutus article](https://www.iog.io/news/unlocking-zero-knowledge-proofs-for-cardano-the-halo2-plutus-verifier), 2025-08-26; [verifier generator repository](https://github.com/input-output-hk/plutus-halo2-verifier-gen) | Prototype toolkit, actual verifier generation and reported costs. BLS12-381/KZG architecture; not native Orchard proof verification. |
| N4 | [LightSwap full fetched PDF](https://eprint.iacr.org/2022/1650.pdf), 2022 preprint | Read construction and implementation discussion, especially §§4–5. Identifies pre-signing obstacle and Bitcoin-side testnet transactions; no full Monero/Zcash deployment inferred. |
| N5 | [PipeSwap ePrint entry](https://eprint.iacr.org/2024/881), received 2024-06-03, revised 2025-04-14, lists S&P 2025 | Abstract, metadata and claimed attack inspected. Full PDF unavailable; exact applicability remains a review task. |
| N6 | [Zcash payment disclosure RPC](https://zcash.github.io/rpc/z_getpaymentdisclosure.html), versioned 6.12.2 docs | Deprecated experimental Sprout-only facility; cannot be used as an Ironwood receipt implementation. |
| N7 | [ZIP 307](https://zips.z.cash/zip-0307), light-client payment detection | Trust boundary for wallet detection differs from self-authenticating cross-chain evidence. |
| N8 | [ZIP 229](https://zips.z.cash/zip-0229); [ZIP 258](https://zips.z.cash/zip-0258), 2026 drafts | Rechecked v6 pre-authorization/pool context. The earlier Draft/Reserved/specification mismatch is not resolved by this continuation. |
| N9 | [AthanorLabs protocol](https://github.com/AthanorLabs/atomic-swap/blob/master/docs/protocol.md), moving branch | ETH/Monero key-share release and timeout precedent. Does not make absent-party Zcash recovery unconditional. |
| N10 | [JugglingSwap](https://arxiv.org/abs/2007.14423), 2020 | Gradual secret-release research; abstract inspected, no implementation reproduced. |
| N11 | [IO cyclic swap daemon](https://github.com/input-output-hk/cyclic-atomic-swap/blob/main/swap-daemon/README.md), moving branch | Additional BTC/Cardano MuSig2/adaptor code lead. No Zcash support or audit inferred. |

This research found useful compositions, not evidence of novelty or a completed security proof. Search coverage was targeted, not exhaustive.
