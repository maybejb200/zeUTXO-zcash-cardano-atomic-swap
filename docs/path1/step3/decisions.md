# zeUTXO path 1, step 3: design decisions (answered from first principles; not independently reviewed)

S3-D1 (C-1) Replace Alice's co-signature over one exact Redeem tx with a signed "go" MESSAGE that the script checks.
  Why: a signature over a tx body pins the fee, TTL, inputs and script_data_hash, so a fee/cost-model change or a
  dropped input after b is public stranded Bob (reproduced in review1). A message about the escrow lets Bob rebuild
  and re-sign his own Redeem as often as needed until T1.
S3-D2 Message = "zeUTXO/path1/go/v1" ‖ network_id(1) ‖ swap_id(32) ‖ script_hash(28) ‖ escrow txid(32) ‖ index(2 BE)
  ‖ lovelace(8 BE) ‖ T1_ms(8 BE): 129 bytes, fixed-length fields (no concatenation ambiguity). The script rebuilds it from
  its own input (outref, own script hash, own lovelace) and the datum (network_id, swap_id, t1).
  Replay protection comes from the outref (unique on a ledger). swap_id + network_id + domain give domain separation
  across swaps, networks and future message types. Plutus cannot see the network id, so network_id in the datum is
  only binding because BOB checks it at lock time. That is stated in the spec.
S3-D3 Go key: a fresh single-purpose Ed25519 key per swap, committed in the datum (alice_go_vk) and agreed in setup
  (it is part of the swap_id preimage). It is never Alice's wallet key, so a go signature can never authorise a tx
  (C3 disappears: Alice signs no tx at all). Wallet-key reuse would also work cryptographically, but a separate key
  removes any cross-protocol signing risk.
S3-D4 Bob's tx signature is still required in Redeem. Otherwise anyone who sees b + go_sig in the mempool could submit
  a Redeem that pays elsewhere. (Outputs are not constrained by the script, so Bob's signature is what binds them.)
S3-D5 Network id: 0 for the simulator (testnet-like). Bob refuses a datum with the wrong id.
S3-D6 Timing rule (H-1), in ms, with D = max inclusion delay for a valid tx, S = settlement (rollback) depth,
  DA = D + S, E = 1 if a param change (epoch boundary/governance) can fall inside a window, M = (1+E)·DA:
    T0 ≥ (lock settles: DA) + (ZEC funding confirmed to depth Z) ; T1 ≥ T0 + 1 + M ; T2 ≥ T1 + M + 1 ;
    Bob's first Redeem broadcast only at t ≤ LAST = T1 − 1 − M; after that he rebuilds/resubmits while t < T1.
    Alice gives go only at t ≤ T0 and only for a final note; Alice resubmits Refund from T1 until settled.
    Bob funds ZEC only after the lock has settled (≥ K confirmations).
  The model (foc_model3.py) found every weaker variant losing an honest party; the rule had 0 violations.
  E=1 budgets ONE param change per window. Mainnet epochs are 5 days, which is much longer than any sane window. Two changes per
  window would need E=2.
S3-D7 Simulator constants: 20 s blocks, D = 60 s, K = 3 blocks (S = 60 s), DA = 120 s, M = 240 s, T0 = 240 s, T1 = 500 s,
  T2 = 760 s, LAST = 259 s after the lock. REAL deployments need D and S from measured mainnet data (k-deep
  settlement is probabilistic on Ouroboros; wallets often use 10–30+ blocks); the simulator values only prove the logic.
S3-D8 (H-2) Zcash depth Z = 3 in the sim. Alice's go re-runs `watch` against the live simulated chain each time.
  `watch` deletes a stale joint_note.json if the note is no longer good. Real Z must come from Zcash reorg data
  (exchanges commonly use 10–24 blocks).
S3-D9 (M-3) expiry_height = tip + 40 (wallet default). The node refuses expiry 0 (our policy, to remove the step-2
  fingerprint) and txs whose expiry has passed.
S3-D10 (M-4) Spec requires the setup channel to be encrypted and mutually authenticated (e.g. Noise XX or TLS 1.3 with
  pinned keys), because pub.json/reveal.json contain key contributions that let the other party view the joint note.
  Not implemented in the simulator (both parties share a directory).
S3-D11 Ledger strictness (M-6): txs wait in a pool, re-validated at the block's slot under the params then in force;
  invalid ones are dropped with the reason; rollbacks restore snapshots and return orphans to the pool; params can
  change. Negative tests assert an expected error class (regex). Script failures can only be asserted as
  "ScriptFailure (phase 2)" because the compiled validator does not emit trace messages.
S3-D12 Adversary in the e2e may delay a valid tx for up to D (3 blocks), roll back fewer than K blocks, change params once.
S3-D13 Controls that break the rule (late Bob broadcast; late Alice refund) are run and are EXPECTED to lose: they show
  the rule is necessary, not just sufficient in the sim.
S3-D14 L-1 (DLEQ context takes swap_id from the prover's own pub.json) is not in this step's required list. Left OPEN.
  The swap_id now also binds the go message, so fixing L-1 means deriving swap_id from both parties' contributions,
  which is a small change for step 4.
