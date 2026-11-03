# R1 receipt specification — Sprint 0 baseline 1

This is a circuit design contract, not an implemented proof system. The source profile and application encoding are now pinned below. Library fixture acceptance and the actual proof-system/circuit implementation remain Sprint 1/2 gates.

## Statement

Given authenticated Zcash relay state R and an existing ADA escrow E, the seller proves knowledge of a historical, sufficiently confirmed shielded payment satisfying E's committed terms. The buyer must already be able to spend the output without sending any new message. The payout is fixed by E, not selected by the proof submitter.

## Public and private data

| Visibility | Data | Required binding |
|---|---|---|
| Cardano public | Unique escrow output reference, hiding terms commitment, fixed ADA payout, validity deadline, network/protocol domain | Validator reads the real escrow input; circuit and validator use identical encoding |
| Cardano public | Authenticated relay-state reference/root, confirmation policy | State identity and update validator are verified; no arbitrary root supplied by caller |
| Private witness | Agreed shielded address, amount, random commitment salt, session marker | Open hiding commitment; fixed-width amounts/range checks; distinct network/pool domains |
| Private witness | Payment data, note opening, sender encryption randomness/material, encrypted memo | Prove correct note commitment and recipient ciphertext; bind session marker inside actual delivered data |
| Private witness | Transaction/action identity, inclusion branch, relevant block evidence | Derive authenticated membership; do not publish txid, note commitment or action index |

The unique escrow reference is determined after escrow creation and included in the payment's encrypted session marker. The circuit must establish this linkage. Publicly supplying the reference without tying it to the payment does not prevent replay. Terms use a fresh 32-byte random salt and the SHA-256 encoding below; constant salts in tests are synthetic only.

## Mandatory constraints

1. Bind amount, recipient, network, pool, protocol version and offer; enforce canonical encoding and valid ranges. Amount uses integer smallest units, never floating point.
2. Establish correct note construction and recipient encryption using witness the seller actually retains. Never require the buyer's spending/viewing key or post-payment acknowledgement.
3. Authenticate the transaction and sufficient confirmations through the selected relay security model. Header commitments alone are not full transaction validity.
4. Permit a historical receipt after the buyer spends the note. Current unspentness must not be required.
5. Consume exactly the bound escrow and pay exactly its authorized destination/value. Permit a third-party submitter only if payout cannot change.
6. Reject alternate offer reuse. A valid payment for E1 must not satisfy E2, even if recipient and amount match.
7. Enforce a nonoverlapping claim/refund interval on Cardano. Draft model: claim inclusion strictly before D; refund inclusion at or after D. Map actual ledger interval semantics explicitly.

## Required real-cryptography fixtures

| Case | Expected |
|---|---|
| Correct historical payment | Accept |
| Same payment, buyer subsequently spends note | Accept |
| Wrong recipient, amount, network or pool | Reject each independently |
| Correct note commitment but malformed recipient ciphertext | Reject |
| Memo/session not bound to delivered ciphertext | Reject |
| Same payment reused for another escrow | Reject |
| Invalid inclusion branch, forged root, insufficient confirmations | Reject each independently |
| Losing fork or stale relay policy violation | Reject under specified relay policy |
| Changed ADA destination, escrow reference or deadline | Reject |
| Noncanonical data, overflowing/negative amount | Reject |

These full-receipt fixtures are planned, not executed. Sprint 0 executes timing/event models, application-encoding tests and a published symmetric-encryption vector. Those checks do not establish private-proof soundness, note spendability or consensus correctness.

## Pinned payment profile and witness

Use NU6.3 transaction v6, branch `0x37a5165b`, Ironwood bundle and V3 notes. The payment must have no transparent, Sapling, Orchard or Sprout components; fees come from the Ironwood value balance. This assumes pre-existing Ironwood funding. Creating initial synthetic funding is a separate local-fixture operation, not a privacy claim about acquiring funds. [Zebra release source](https://github.com/ZcashFoundation/zebra/tree/f5c5277fe41eba9c74f37098738f93f35dd70d60) and [library pins](SOURCE-PINS.json) specify the versions; local node acceptance is still required.

Sender witness consists of the recipient's raw address, value, `rho`, `rseed`, V3 note version, the full 512-byte memo and inclusion/effecting transaction data. `rho` must correspond to the actual action's old nullifier. The circuit recomputes the V3 note commitment and the transmitted ephemeral key and full recipient ciphertext. It must enforce valid canonical points/scalars, nonzero ephemeral secret and note-version rules; accepting supplied hashes or supplied encryption keys without checking their derivation is insufficient.

The pinned [note-encryption implementation](https://github.com/zcash/orchard/blob/ae3511076ec8ecb39ffc02d9cdaf19c441c5b53d/src/note_encryption.rs) derives the ephemeral secret from the note, uses the recipient's transmission key for sender-side key agreement, and serializes version, diversifier, little-endian note value, seed and memo. [Note construction](https://github.com/zcash/orchard/blob/ae3511076ec8ecb39ffc02d9cdaf19c441c5b53d/src/note.rs) supplies the V3-specific commitment derivation. These establish a source-backed witness path without the buyer's private key, but do not establish a complete circuit or its cost.

The seller must persist a newly generated, swap-scoped outgoing viewing key before building, set the builder's outgoing key to that value, and save the signed transaction and terms before broadcast. The library's outgoing-recovery path can recover the note and memo from this key and transaction. Sprint 1 must demonstrate this through actual library calls and recovery after restart; do not depend on extracting inaccessible builder fields or exporting a general wallet viewing key. Recovered note data remains private.

The circuit reconstructs the v6 Ironwood effects digest and transaction inclusion, binding the entire encrypted memo and authentication tag. The pinned [bundle commitment code](https://github.com/zcash/orchard/blob/ae3511076ec8ecb39ffc02d9cdaf19c441c5b53d/src/bundle/commitments.rs) includes separate compact, memo and noncompact ciphertext components with Ironwood domain separation. V6 anchors are authorizing data, so a v5 digest shortcut is disallowed. SPV transaction validity remains the explicit assumption in the [relay policy](R1-RELAY-POLICY.md).

## Application encoding

`envelope.mjs` implements this R1 application format. It is not native Zcash serialization. Every integer below is unsigned big-endian; note encryption still uses the library's native serialization. Hex inputs must be lowercase, even-length and exact-width; unknown terms fields reject. The codec checks syntax/ranges, not address ownership or curve validity.

Terms preimage, in order:

| Field | Bytes |
|---|---:|
| ASCII `R1TRM001` | 8 |
| Private random salt | 32 |
| Zcash genesis block hash in display order | 32 |
| Configured Cardano Shelley genesis hash | 32 |
| R1 pool code `03` (an application code, not a consensus identifier) | 1 |
| Branch id `37a5165b` | 4 |
| Transaction version `00000006` | 4 |
| Raw recipient address bytes from the pinned library | 43 |
| Positive amount in zatoshis, at most 2,100,000,000,000,000 | 8 |
| Cardano claim deadline as POSIX milliseconds | 8 |
| Payout-address byte length | 2 |
| Raw Cardano payout address, 1–128 bytes at codec layer | variable |
| Policy hash | 32 |

Commitment is SHA-256 of these exact bytes. The policy hash identifies SHA-256 of the exact agreed UTF-8 policy-manifest bytes, without whitespace normalization; its full bytes and hash are persisted. A fixture manifest must pin relay/proof policy and both network configurations before use. Genesis values in codec tests are dummy bytes and cannot be used as a network configuration. Cardano address validity and network checks belong to the validator, beyond the codec's length limit.

Memo is exactly 512 bytes: ASCII `R1PAY001` (8), Cardano escrow transaction id in display order (32), output index (4), terms commitment (32), then 436 zero bytes. The plaintext memo is private and must appear in the *actual delivered* encrypted note. The encoding binds offers, but only a real receipt proof can establish that encrypted-delivery linkage. No common public Zcash marker is introduced by this encoding.

## Privacy and proof boundaries

Public Cardano terms commitment and relay history root remain visible. Transaction id, action index, note commitment, address, value, seed and memo stay inside the private witness. A shared relay root can still narrow a time/block range; this is not a claim against timing correlation or disclosure by the counterparty. The SHA-256 choice is a baseline to benchmark, not evidence that its circuit fits Cardano. Native Orchard/Ironwood Halo2 proofs are not directly compatible with the proposed BLS12-381/KZG receipt verifier.
