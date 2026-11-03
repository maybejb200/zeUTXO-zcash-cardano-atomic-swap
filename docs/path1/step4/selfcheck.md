# Adversarial self-check of the go-message design (step 3)
**NOT INDEPENDENT.** The same agent that designed and coded the fix wrote this review. Treat it as a checklist for a
real independent review, not as one. Mon Nov 2, 2026, 9:05 PM ET.

| # | Attack / question | Result | Evidence |
|---|---|---|---|
| 1 | Replay a go_sig from another swap (even if Alice reused her go key) | Blocked: the message contains the escrow outref, which is unique on a ledger | aiken g1/g1b; e2e gomsg "replayed on swap 2" (ScriptFailure) |
| 2 | Wrong network (testnet sig used on mainnet) | Blocked in two ways. network_id is in the message and datum. Separately, outrefs cannot coincide across chains. Plutus cannot read the network id, so the datum field binds only because Bob checks it at lock time (done in bobChecksLock) | aiken g3; e2e gomsg wrong_net; setup "network id" |
| 3 | Signing-domain confusion (sig made for another message type, or bytes that parse two ways) | Blocked: fixed 18-byte domain tag, fixed-length fields (129 bytes total), and a single-purpose go key never used for anything else | aiken g4; e2e wrong_domain |
| 4 | Signature malleability (S+ℓ, bit flips, wrong length) | Rejected on-chain. A malleated but valid signature would also be harmless: it authorises the same statement, and witness bytes do not change the tx id | aiken g7/g8; e2e malleated |
| 5 | Front-runner copies b + go_sig from the mempool and redeems to itself | Blocked: Redeem still requires Bob's tx signature | aiken g10; e2e frontrun |
| 6 | Alice signs go for a different amount/T1/key than the datum | Bob verifies the go_sig off-chain against the live escrow before revealing b. His tool refuses | e2e setup "wrong amount" |
| 7 | Alice uses a bogus go_vk in the datum (griefing: no sig can ever verify) | Bob checks go_vk = the key agreed in setup and verifies the sig before revealing b. Worst case is a refund, not a loss | setup "go key" |
| 8 | Alice signs no tx at all, so can Bob slip her inputs into something she signs (C3)? | Impossible by construction. Spending her UTxO needs her wallet witness, which never exists | e2e c3 (MissingVKeyWitnesses) |
| 9 | Fee or cost-model change after b is public (C-1) | Bob rebuilds with the same go_sig and settles before T1 | e2e c1fee, c1cost |
| 10 | Lock rolled back and replaced by a different lock tx (new outref) | The old go_sig is useless on the new outref. Prevented anyway: Bob funds only after the lock settles, and Alice signs go only for a settled outref | model mutant bob_funds_tentative_lock; setup "not settled" |
| 11 | **Off-chain vs on-chain Ed25519 disagreement** (non-canonical R, small-order key): Bob's Node/OpenSSL check accepts but the Plutus builtin rejects | **New requirement, not a loss within the rules:** Bob must evaluate his Redeem with the real script evaluator before broadcasting (Lucid's `complete()` does this; our e2e does). A failing tx is then never sent, so b is never revealed. If a wallet broadcast without local evaluation, b could leak with no Redeem. Added to spec §B | spec v0.2 §B.3 |
| 12 | Go given, then Bob delays and broadcasts late | Bob's own tool refuses a first broadcast after LAST. A Bob who breaks the rule can lose only his own funds (control test shows exactly this) | e2e refund "past LAST"; rbredeem CONTROL |
| 13 | Two param changes inside one window | Outside the budget E=1. Needs E=2 (larger windows). Mainnet epochs are 5 days, so this is not expected within a window of minutes to hours | decisions S3-D6 |
| 14 | DLEQ cross-swap replay (review L-1) | Step 4: FIXED. The proof is bound to the verifier-computed swap_id (both nonces, both networks, escrow params, all keys, role), and a seen-registry blocks share/nonce reuse. Residual: a share reused toward a NEW counterparty with no shared history is only caught by the spec A.5 chain check (not in the sim) | e2e3 l1 21/21; decisions S4-D1..D7 |

No new case was found in which an honest party who follows the rules loses funds within the modelled bounds.
