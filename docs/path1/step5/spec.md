# zeUTXO path 1: spec v0.4 (step 5 delta over v0.3). Simulator-validated only.
Changes from v0.1 are marked [new] (step 3), [v0.3] (step 4) and [v0.4] (step 5, review2 fixes F1-F7 + value cap).

## A. Setup
A.1 Parties exchange pub/reveal messages over an **encrypted, mutually authenticated channel** [new, M-4] (for example Noise XX,
    or TLS 1.3 with pinned keys). The key contributions let the other party view the joint note, so a passive observer of the
    channel would learn the swap. Both sides abort on any authentication failure.
A.2 [v0.3, L-1] Two rounds. Round 1: each party sends P, Q, its key-contribution commitment and a FRESH 32-byte nonce.
    Alice also creates a **fresh single-purpose Ed25519 go key** [new] and sends go_vk. The agreed parameters are: both network
    ids, script hash, lovelace, zats, T0/T1/T2, both Cardano pkhs, go_vk, and [v0.4] the agreed real depths k_depth (K) and z_depth (Z). Round 2: each sends its cross-group DLEQ + PoKs, proved
    over ctx = "zeUTXO/path1/setup-proof/v3" [v0.4] ‖ role(1: alice=1, bob=2) ‖ swap_id.
A.3 [v0.3, v0.4] swap_id = SHA-256("zeUTXO/path1/swap_id/v3" ‖ ada_network_id(1) ‖ len(zec_network)(1) ‖ zec_network ‖
    script_hash(28) ‖ lovelace(8 BE) ‖ zats(8 BE) ‖ T0 ‖ T1 ‖ T2 ‖ k_depth ‖ z_depth (8 BE each) ‖ alice_pkh(28) ‖ bob_pkh(28) ‖ go_vk(32) ‖
    alice{P(32) ‖ Q(48) ‖ commit(32) ‖ nonce(32)} ‖ bob{same}). Each verifier computes swap_id itself; it never takes it from
    the prover. This swap_id is the one in the datum and the go message.
A.5 [v0.3] The verifier aborts if: a role tag does not match its slot; A = B (P or Q); both nonces are equal; any P, Q or nonce
    was seen in an earlier swap (local registry, recorded only on successful setup). It also SHOULD refuse a share point
    already in any escrow datum at the script (chain index; not in the sim). Never reuse a share or nonce.
    [v0.4, F7] Every point is decoded and re-encoded first: P must be a canonical Pallas encoding (re-encoding equals the
    input), Q a canonical compressed BLS12-381 G1 subgroup point, neither may be the identity. All comparisons and registry
    entries use the canonical lower-case hex of the decoded value, never the string as received.
A.7 [v0.4, F2] go_vk validation at setup, by both parties: 32 bytes; canonical encoding (y < p); not the identity; in the
    prime-order subgroup (no small-order or mixed-order points; libsodium crypto_core_ed25519_is_valid_point semantics).
A.8 [v0.4, F6] Value cap. Both wallets refuse at setup if value > cap(K, Z, era, tier), where value = USD value of the larger
    leg at a fresh price (stale price feed = refuse). See §V.
A.4 Timing rule [new, H-1; v0.4 F3/F4], with D = max inclusion delay, S = Cardano settlement budget for K blocks, DA = D+S,
    E = 1 (one fee/cost-model change budgeted per window), M = (1+E)·DA, R = Bob's reaction slack after a go at T0:
    T0 ≥ now + DA + ZB ; T1 ≥ T0 + 1 + M + R ; T2 ≥ T1 + M + 1 ; LAST = T1 − 1 − M (so LAST − T0 ≥ R).
    [v0.4] Every time-for-n-blocks budget (S, D, ZB = Zcash funding inclusion + Z blocks) is max(2.5 × mean, 99.9 % quantile) of
    the Poisson block process (Gamma(n, block time)); for K = 15 this is 750 s vs a 99.9 % value of 597 s (tail ≈ 1e-5).
    Bob judges LAST in chain time: now_Bob = max(own clock, time of the chain tip's slot) + DRIFT (1 min), never wall clock alone.
    Real values of D, S, Z must come from measured mainnet data (simulator: 20 s blocks, D=60 s, K=3, Z=3).
A.6 [v0.3] Finality target (John's decision, Nov 2 2026): PRACTICAL. Cardano settlement S ≈ 5 min (≈ 15 blocks), Zcash
    depth Z ≈ 12 min (≈ 10 blocks), whole swap ≈ 1–2 h. Probabilistic finality. Exact K/D/Z come later from measured
    chain data. Not the conservative ≈ 12 h Cardano finality.

## B. Cardano escrow (Aiken, PlutusV3, 1214 B)
Datum {alice, bob, alice_go_vk, network_id, swap_id, a_c, b_c, t1, t2}. Actions:
- Redeem{b, go_sig} [changed, C-1]: requires verify_ed25519(alice_go_vk, go_msg, go_sig) (script unchanged in v0.4), Bob's signature, upper bound ≤ T1−1,
  b in range and b·G1 = b_c. **Alice's tx signature is no longer needed.**
  go_msg = "zeUTXO/path1/go/v1" ‖ network_id(1) ‖ swap_id(32) ‖ own script hash(28) ‖ own outref txid(32) ‖ index(2 BE) ‖ own lovelace(8 BE) ‖ t1(8 BE).
- Refund{a}: from T1, Alice's signature, a in range, a·G1 = a_c. Punish: from T2, Bob's signature. (unchanged)
B.1 [v0.4, F1] Bob funds ZEC only after the lock has settled (≥ K confirmations), and only after checking: the exact outref
    from Alice's lock tx; the address's payment credential = the audited script AND no stake credential (or exactly an agreed
    one); value = exactly the agreed lovelace and nothing else; the datum is INLINE (not a hash); and the inline datum bytes are
    IDENTICAL to his own rebuild of Constr0[alice_pkh, bob_pkh, go_vk, network_id, swap_id, a_c, b_c, t1, t2] from the agreed
    parameters, in canonical Plutus CBOR (tag 121 d879, indefinite list 9f…ff, minimal-length ints, bytes ≤ 64 B as one
    string). Any difference, including an equivalent but differently encoded datum, is a refusal. The decision is the byte
    comparison; a decoder is used only to name the reason. T0/T1/T2 must satisfy A.4.
B.2 Alice gives go (signs go_msg) only if: the ZEC note is at depth ≥ Z **on her live view of the Zcash chain** (re-checked at
    signing time, never from a cache) [new, H-2], the escrow outref is settled, and now ≤ T0.
B.3 [v0.4, F2] Before revealing b, Bob verifies go_sig with STRICT Ed25519 = cardano-node's verifyEd25519Signature
    (libsodium crypto_sign_verify_detached): canonical A and R, A and R not small-order, S < ℓ, cofactorless equation; his
    wallet requires two independent implementations to agree. He then evaluates the exact Redeem tx with HIS OWN cardano-node
    (cardano-cli transaction build / Ogmios evaluateTransaction on his node), never with a library evaluator alone (Lucid and the
    aiken/uplc crate are laxer), and submits it only to his own node. He makes his first broadcast only at now ≤ LAST. After that, while now < T1, he rebuilds, re-signs and
    resubmits whenever his Redeem is neither pending nor confirmed (drop, rollback, fee or cost-model change).
B.4 Alice watches mempool and chain for b, then sweeps the ZEC with σ(a+b). If there is no settled Redeem, she submits Refund
    from T1 and resubmits until it settles (before T2).

## V. Value cap [v0.4, F6]
V.1 Threat: the largest single block producer reverses the other party's settlement. Zcash: q = 0.35 (largest pool ≈ 31–33 %,
    rounded up); Cardano: α = 0.15 (largest operator ≈ 12–14 %). Coalitions are NOT covered.
V.2 P(reversal of n blocks) by the exact Rosenfeld (2014) formula (cross-checked against Kovalchuk et al. 2026).
V.3 cap(K, Z) = 0 if K < 15, Z < 10 (pre-NU7) / 30 (post-NU7), or P_Zcash(Z) or P_Cardano(K) > ε (rehearsal 0.25, v1 1e-3).
    Otherwise cap = min(policy ceiling (rehearsal $500), ½ · Z · miner revenue per Zcash block in USD, EV caps), where
    EV cap = [q/(1−q) · n · reward per block] / (10 · P(n)) for each chain.
V.4 Inputs (2026-11-02): ZEC $1,254.54, ADA $0.188; Zcash 1.25 ZEC/block now, 1.25/3 per 25 s block after NU7; Cardano ≈ 213 ADA
    rewards per block. Results: rehearsal (K15/Z10 now, or K15/Z30 post-NU7) $500; v1 K15/Z60 post-NU7 ≈ $15,700; K15/Z96 ≈ $25,100.
    Scaling rule (v1, post-NU7): Z ≥ max(58, 2·V / $523), K ≥ 15. Pre-NU7: Z ≥ max(58, 2·V / $1,568) at 75 s blocks.
V.5 A real wallet refreshes prices and pool shares, and fails closed when they are stale.

## C. Zcash
C.1 All Zcash txs use expiry_height = tip + 40 [new, M-3]. Nodes reject expired txs.
C.2 Sweeps as in v0.1 (RedPallas with σ(a+b) normalisation).

## D. Known open items
[v0.4] review2 F1, F2, F3, F4, F5, F6, F7 addressed (see step5 memo). Still open: A.5 global seen-list, coalition attacks
beyond the largest single entity, go-key reuse registry, price-feed design, real-node evaluator integration, trace-specific
script failure reasons (needs a script change), independent review of v0.4.
L-1 fixed in v0.3 (residual: cross-counterparty share reuse needs the A.5 chain check), M-5 (counterparty keeps FVK: privacy after swap), real-chain parameter measurement for D/S/Z,
an independent review of v0.3, other wallet-default fingerprints (anchor depth, padding) beyond expiry.
