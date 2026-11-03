# zeUTXO path 1, steps 3-4: design decisions (answered from first principles; not independently reviewed)

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
  [Superseded by S4-D1..D6 in step 4.]
  The swap_id now also binds the go message, so fixing L-1 means deriving swap_id from both parties' contributions,
  which is a small change for step 4.

## Step 4 (Mon Nov 2, 2026, approved by John 9:39 PM ET)
S4-D0 FINALITY (John's decision, Nov 2, 9:39 PM ET): PRACTICAL finality. Cardano settlement ≈ 5 min (≈ 15 blocks at
  20 s), Zcash confirmation ≈ 12 min (≈ 10 blocks at 75 s); a whole swap targets 1–2 h. Finality is probabilistic (as with
  exchanges). The exact K, D and Z values are set LATER from measured chain data, not from these round numbers. The
  conservative option (Cardano guaranteed finality ≈ 12 h, ADA locked ≈ a day per swap) is not used. Simulator values are
  unchanged (20 s blocks, K = 3, Z = 3) because they only exercise the logic.
S4-D1 (L-1) Two-round setup. Round 1: each party sends its statement (P, Q), its key-contribution commitment and a FRESH
  32-byte nonce (OsRng). Round 2: each proves the cross-group DLEQ + PoKs over ctx = "zeUTXO/path1/setup-proof/v2" ‖
  role(1) ‖ swap_id. A proof cannot be produced before both nonces exist, so it cannot be precomputed or reused.
  Sending P, Q before proving is safe against rogue-key choices because the PoK of dlog(P) and dlog(Q) (review L-7) is
  still required in round 2.
S4-D2 swap_id = SHA-256("zeUTXO/path1/swap_id/v2" ‖ ada_network_id(1) ‖ len ‖ zec_network ‖ script_hash(28) ‖
  lovelace(8 BE) ‖ zats(8 BE) ‖ T0 ‖ T1 ‖ T2 (8 BE each) ‖ alice_pkh(28) ‖ bob_pkh(28) ‖ alice_go_vk(32) ‖
  [P(32) ‖ Q(48) ‖ commit(32) ‖ nonce(32)] for alice then bob). Fixed lengths, one length-prefixed string, fixed slot order.
  It covers: domain separator, both network ids, the escrow parameters, both parties' Cardano keys and go key, both
  share points, and both nonces. The same swap_id goes into the datum and the go message (no second identifier).
S4-D3 The VERIFIER computes swap_id itself from its own copy of the agreed parameters and both round-1 messages. Nothing
  the prover asserts about the swap id is used (this is the actual L-1 bug). The ctx is hashed into the DLEQ transcript
  t0, from which every ring challenge and both PoK challenges derive, so one hash binds the whole proof.
S4-D4 Extra setup checks, each with its own error: role tag must match the slot; A ≠ B (both P and Q); the two nonces
  differ; and a per-party "seen" registry rejects any P, Q or nonce used in an EARLIER swap (re-running setup on the
  same swap is allowed). Only a successful setup is recorded. Why: reusing a share across swaps is fatal (once b is
  revealed in swap 1, swap 2's counterparty can sweep), and transcript binding alone does not stop a party from honestly
  re-proving an old share in a new transcript.
S4-D5 Limit (documented, tested as "limit"): a local registry only sees one's own history. Spec A.5 adds that Bob and Alice
  should also refuse a share point already visible on Cardano (any A_c/B_c in an escrow datum at the script). Not implemented in
  the sim (needs a chain index).
S4-D6 The simulator fixes T0/T1/T2 at setup time (they are in the transcript). lock() refuses to run if ledger time has moved
  since setup. A real wallet should do the same: re-run setup if it can't lock promptly.
S4-D7 Cheat modes: "wrongctx" now means the proof uses the other role's label. New "swapslots" puts the two round-1
  messages in each other's slots. The F7 "shifted" cheater chooses its blinders in round 1 so that it can publish its shifted
  statement before the transcript exists (dleq.rs gained an optional `blinders` field; proof logic is unchanged).
