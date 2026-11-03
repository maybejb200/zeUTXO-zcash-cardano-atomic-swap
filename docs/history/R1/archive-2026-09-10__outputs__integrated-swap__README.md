# Integrated local swap — successful research run

This run connects a dedicated Zcash regtest node to a persistent, offline Cardano emulator. The node's regtest configuration bypasses proof of work internally; a separate native miner solves each adopted header and checks Equihash and the configured target. The Cardano chain certificate independently verifies the staged proofs and snapshot transition. No public relay or production deployment is claimed.

`progress.json` records the last completed emulator stage, transaction costs, canonical height and wall-clock elapsed time. The entire emulator ledger and fresh account seeds are encrypted with Windows CurrentUser DPAPI under the actual user account. Each completed transaction is checkpointed. A separate-process test restored a pending transaction and signed a subsequent spend. This is not exhaustive power-loss testing: interruptions during native block replacement or between proof bytes and report creation can require explicit recovery.

The run preserves certificate outpoints by excluding every token-bearing output from automatic coin selection. The receipt binds the exact retained certificate outpoint and proves ancestry against the current uniquely initialized relay state. Advancing to a new reference requires new receipt proofs.

The tested offer used two inclusive Zcash confirmations, a two-hour claim deadline, a 90-minute payment admission cutoff, a 30-minute relay-update age and a two-hour tip age. These are local experiment limits chosen with the measured sequential proof costs; they do not establish a conservative public-network or outage guarantee. Wall-clock advancement continues across proof generation and process restarts.

The policy manifest commits to the experimental anchor semantics, network identifiers, script source hash, verification keys, relay identities and freshness parameters. It explicitly identifies unsafe local research setup. No private keys, note openings or offer salt appear in the public evidence folder.

## Privacy inventory

Cardano transactions expose the ADA escrow amount, payout/refund addresses, deadline, script/policy identities, reference outpoints and authenticated relay snapshot. The receipt package exposes statement and bridge commitments and three proofs. Its witness contains the recipient, amount, opening salt, note randomness and selected historical payment membership. The swap-specific outgoing viewing key stays in the seller's local wallet; buyer spending keys are not required for receipt recovery.

This local diagnostic folder intentionally records transaction identifiers and exact node blocks to verify the experiment. Those diagnostic mappings are not encoded as public payment identifiers in the Cardano receipt. Sharing the diagnostic folder would reveal the local test mapping; keeping keys private does not make the diagnostic evidence unlinkable.

Remaining gates include broader timed failure scenarios, crash/fork recovery, public-genesis bootstrap and sustained relay throughput. Sprints 3–5 remain open. Existing receipt and Equihash proving parameters are reused only after integrity and verification-key checks.


## Verified progress

The node accepted payment 6395e1792a86dfda6dadfee6dc83546500ce4acb060f051323ed83f490cc86b3 and the independent buyer spend 49f7d4388abd0bb7961cfa65037e9bedb7ab7666f7105fea43c416084d466754. A restart had selected an alternate height-3 funding block. The membership builder rejected the mismatch; rejected-branch-v1 preserves that diagnostic evidence. The harness reimported the exact solved funding block, invalidated the local alternate and replayed the identical transaction bytes. The repaired headers 4 and 5 now extend the certified prefix exactly; host payment membership checks pass. The cause of the node branch-selection behavior has not been independently established.

A separate no-payment escrow rejected early refund and returned all 10 emulator ADA after the actual wall deadline, using a restored ledger in a new process. The main delivered escrow has now been claimed successfully, as recorded below.


## Positive integrated claim completed

The seller claim passed native protocol-11 Cardano evaluation and settled in the persistent emulator before the unchanged deadline. The complete transaction used 10636 bytes, 7755274251 CPU and 1587436 memory, within the 20% reserve. All 25 actual node-header proofs and all three receipt proofs are preserved. The two native transactions are the same bytes used during branch repair. The user requested a stopping point: development and the scheduled continuation are now paused. No public cross-chain swap, safe setup or production readiness is claimed.

Raw header prover reports retain a generic legacy scope string. The exact header fixtures, native block records and successful certificate transactions establish the actual node-backed provenance of this run.
