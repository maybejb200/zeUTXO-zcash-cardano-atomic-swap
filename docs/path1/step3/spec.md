# zeUTXO path 1: spec v0.2 (step 3 delta over spec v0.1). Simulator-validated only.
Changes from v0.1 are marked [new].

## A. Setup
A.1 Parties exchange pub/reveal messages over an **encrypted, mutually authenticated channel** [new, M-4] (for example Noise XX,
    or TLS 1.3 with pinned keys). The key contributions let the other party view the joint note, so a passive observer of the
    channel would learn the swap. Both sides abort on any authentication failure.
A.2 Cross-group DLEQ + PoK as in v0.1. Alice also creates a **fresh single-purpose Ed25519 go key** [new] and sends go_vk.
A.3 swap_id = SHA-256(domain ‖ both pub messages ‖ amounts ‖ T1 ‖ T2 ‖ network_id ‖ script hash ‖ go_vk) [new].
A.4 Timing rule [new, H-1], with D = max inclusion delay, S = Cardano settlement depth (time for K blocks), DA = D+S,
    E = 1 (one fee/cost-model change budgeted per window), M = (1+E)·DA, DZ/Z = Zcash inclusion/finality depth:
    T0 ≥ now + DA + DZ + Z·(zcash block) ; T1 ≥ T0 + 1 + M ; T2 ≥ T1 + M + 1 ; LAST = T1 − 1 − M.
    Real values of D, S, Z must come from measured mainnet data (simulator: 20 s blocks, D=60 s, K=3, Z=3).

## B. Cardano escrow (Aiken, PlutusV3, 1214 B)
Datum {alice, bob, alice_go_vk, network_id, swap_id, a_c, b_c, t1, t2}. Actions:
- Redeem{b, go_sig} [changed, C-1]: requires verify_ed25519(alice_go_vk, go_msg, go_sig), Bob's signature, upper bound ≤ T1−1,
  b in range and b·G1 = b_c. **Alice's tx signature is no longer needed.**
  go_msg = "zeUTXO/path1/go/v1" ‖ network_id(1) ‖ swap_id(32) ‖ own script hash(28) ‖ own outref txid(32) ‖ index(2 BE) ‖ own lovelace(8 BE) ‖ t1(8 BE).
- Refund{a}: from T1, Alice's signature, a in range, a·G1 = a_c. Punish: from T2, Bob's signature. (unchanged)
B.1 Bob funds ZEC only after the lock has settled (≥ K confirmations), and only after checking: the exact outref from
    Alice's lock tx, script hash, lovelace only (no other assets), parties, go_vk = agreed key, network_id, swap_id, a_c/b_c =
    DLEQ points, and T0/T1/T2 satisfying A.4 [new].
B.2 Alice gives go (signs go_msg) only if: the ZEC note is at depth ≥ Z **on her live view of the Zcash chain** (re-checked at
    signing time, never from a cache) [new, H-2], the escrow outref is settled, and now ≤ T0.
B.3 Bob verifies go_sig off-chain against the live escrow and **evaluates his Redeem with the real Plutus evaluator before
    broadcasting** [new]. He makes his first broadcast only at now ≤ LAST. After that, while now < T1, he rebuilds, re-signs and
    resubmits whenever his Redeem is neither pending nor confirmed (drop, rollback, fee or cost-model change).
B.4 Alice watches mempool and chain for b, then sweeps the ZEC with σ(a+b). If there is no settled Redeem, she submits Refund
    from T1 and resubmits until it settles (before T2).

## C. Zcash
C.1 All Zcash txs use expiry_height = tip + 40 [new, M-3]. Nodes reject expired txs.
C.2 Sweeps as in v0.1 (RedPallas with σ(a+b) normalisation).

## D. Known open items
L-1 (DLEQ ctx swap_id binding), M-5 (counterparty keeps FVK: privacy after swap), real-chain parameter measurement for D/S/Z,
an independent review of v0.2, other wallet-default fingerprints (anchor depth, padding) beyond expiry.
