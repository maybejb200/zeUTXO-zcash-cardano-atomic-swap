# zeUTXO path 1 — spec v0.6 (escrow contract v0.7). Full text, replaces v0.5 + v0.4 deltas. Simulator-validated only.
Private swap: ZEC in a shielded Zcash Ironwood note under a 2-of-2 split key ↔ ADA in an Aiken escrow on Cardano.
Alice sells ADA for Bob's ZEC. a = Alice's secret share, b = Bob's. Whoever learns the other's share takes the ZEC.
No option premium (removed in step 7, review4 F2). Decisions: decisions.md D1–D32 (D23–D32 = step 8).

## A. Setup (unchanged from v0.5 except the T3 tail now also drives the refund)
A.1 Messages go over an encrypted, mutually authenticated channel (Noise XX or TLS 1.3 with pinned keys); abort on failure.
A.2 Two rounds. Round 1: P (Pallas), Q (BLS12-381 G1), key-contribution commitment, fresh 32-byte nonce; Alice adds a fresh
    single-purpose Ed25519 go key go_vk. Agreed: both network ids, script hash, lovelace, zats, T0/T1/T2/T3, both Cardano
    pkhs, go_vk, K (k_depth), Z (z_depth), zec_branch. Round 2: cross-group DLEQ (Pallas↔BLS12-381) + PoKs over
    ctx = "zeUTXO/path1/setup-proof/v5" ‖ role ‖ swap_id.
A.3 swap_id = SHA-256("zeUTXO/path1/swap_id/v5" ‖ … ‖ T0 ‖ T1 ‖ T2 ‖ T3 ‖ k_depth ‖ z_depth ‖ zec_branch ‖ "ironwood/use_qsk" ‖
    pkhs ‖ go_vk ‖ both parties' {P, Q, commit, nonce}). Each side computes it itself. Because T3 − T1 is bound here, the
    refund tail (B.4) needs no new field in the hash.
A.4 Point hygiene: canonical encodings, no identity, A ≠ B, distinct nonces, local seen-registry of P/Q/nonces; go_vk 32 B,
    canonical, prime-order subgroup.
A.5 Value cap (§V) checked at setup by both wallets; stale or missing feed = refuse.
A.6 Finality target PRACTICAL (John, 2 Nov 2026): Cardano K ≈ 15 blocks, Zcash Z per §V, probabilistic finality.

## T. Timing (real values from model/step8_model.py)
D = inclusion bound, S = time for K Cardano blocks, DA = D + S, E = 1 parameter change per window, M = (1+E)·DA,
Mc = (1+E)·D, R = reaction slack (300 s). Budgets = max(2.5 × mean, 99.9 % Gamma quantile).
  T0 ≥ now + DA + Zcash funding budget        Alice's last moment to give go
  LAST_COMMIT = T1 − 1 s − Mc                 Bob's last first broadcast of Commit (chain time + 1 min drift)
  T1 ≥ T0 + 1 s + R + Mc                      Commit must be INCLUDED before T1 (upper bound T1 − 1 s)
  T2 ≥ T1 + S + 1 s + R + Mc                  from T2 Bob may send the Notice himself (liveness only)
  T3 = T1 + tail, tail = 7 days               Alice's Escape from Claimed
  t4 = (Notice upper bound) + tail            written into the datum by the Notice; Bob's Forfeit from t4
No refund-start or last-refund times exist any more (v0.5 REFUND_START/LAST_REFUND removed).
v1 profile (37.5 s Zcash gate, σ = 0.25): T0 144.7, LAST_COMMIT 149.7, T1 179.6, T2 227.1 min after setup; honest refund
done ≈ 249.5 min; T3 ≈ 7.12 d; t4 ≈ 7.17 d (Alice Notices at T1) or ≈ 7.20 d (Bob Notices at T2).

## B. Cardano escrow v0.7 (Aiken, PlutusV3, 2,445 B, hash 0ed9e054…0087e0)
Datum (12 fields, inline, canonical CBOR): {alice, bob, alice_go_vk, network_id, swap_id, a_c, b_c, t1, t2, t3, phase, t4}.
phase 0 = Open, 1 = Claimed, 2 = Refunding; t4 = 0 unless Refunding.
Redeemers and rules (each spends exactly one escrow input; continuing outputs: same script address, no stake change, exact
value, inline datum byte-equal to the expected one, no reference script):
 0 Commit{go_sig}   Open → Claimed. Bob signs; upper bound ≤ T1 − 1 s; verify_ed25519(go_vk, go_msg, go_sig);
                    output datum = input with phase 1 (t4 stays 0).
                    go_msg = "zeUTXO/path1/go/v1" ‖ network_id ‖ swap_id ‖ script hash ‖ own outref ‖ lovelace ‖ t1.
 1 Reveal{b}        Claimed → Bob takes ADA. Bob signs; b in range, b·G1 = b_c. No deadline.
 5 Escape           Claimed → ADA back to Alice. Alice signs; lower bound ≥ T3.
 2 Notice           Open → Refunding. Either (Alice signs and lower ≥ T1) or (Bob signs and lower ≥ T2). Finite lower lo
                    and upper hi with hi − lo ≤ 6 h; output datum = input with phase 2 and t4 = hi + (t3 − t1).
                    Carries NO secret. Not allowed on Claimed or Refunding (no re-Notice, so t4 cannot be pushed out).
 3 RefundReveal{a}  Refunding → ADA back to Alice. Alice signs; a in range, a·G1 = a_c. No deadline in the script.
 4 Forfeit          Refunding → Bob takes ADA. Bob signs; lower ≥ t4.
Removed vs v0.6: one-step Refund{a} from Open, and Punish. Commit (upper ≤ T1 − 1 s) and Notice (lower ≥ T1) are disjoint in
time, so they can only compete inside a fork that branches before T1.

## W. Wallet rules (all fail closed; policy7.mjs + policy8.mjs)
W.1 Bob funds ZEC only after the lock is ≥ K deep and its outref, credential, value and inline datum bytes equal his own
    rebuild (12 fields, phase 0, t4 0), timing rule §T, no reference script, NU7/upgrade gates, value cap.
W.2 Alice gives go only if the ZEC note is ≥ Z deep on her LIVE Zcash view, the escrow outref is settled, now ≤ T0.
W.3 Bob Commit: verify go_sig strictly (two Ed25519 implementations agree), evaluate on his own node, first broadcast at
    chain-time ≤ LAST_COMMIT; resubmit on drop until T1 − 1 s.
W.4 Bob Reveal: only when his own Commit is ≥ K deep and the Claimed output is byte-equal to what he expects; HOLD if his
    mempool ≥ 50 % full or his direct submission reaches < 25 % stake (unless now ≥ T3 − M); then resubmit until settled.
W.5 Alice, Claimed: sweep the ZEC as soon as b is seen in any mempool or block; Escape only at ≥ T3 if b never seen.
W.6 Alice refund, step 1 (Notice): from T1, only while the escrow is Open; validity [now, now + 1 h]; rebuild and resubmit
    on drop/expiry/fee change; retry next block on a mempool conflict. A Notice sent by Bob counts the same.
W.7 Alice refund, step 2 (RefundReveal{a}): only when the Refunding output comes from a Notice ≥ K deep, its datum is
    byte-equal to the expected one (t4 = that Notice's upper bound + tail) and its value exact, and now ≤ t4 − M. Then
    resubmit until settled. She never reveals a on any other UTxO.
W.8 Bob Notice: from T2 if the escrow is still Open (Alice silent). Bob Forfeit: at ≥ t4, only if Refunding and he has
    NOT seen a (if he has, he sweeps his ZEC with a+b instead).
W.9 Bob, after seeing a anywhere (mempool or block): sweep the ZEC immediately.

## O. Outcomes
happy: Alice ADA → Bob, Bob ZEC → Alice. Bob never commits: Alice refunds (Notice + a), Bob sweeps back with a+b.
Bob commits and stalls: Alice Escapes at T3 (no secret); Bob's ZEC stays locked (stalling costs him everything).
Alice silent from the start: Bob Notices at T2, Forfeits at t4; ZEC stays locked (as the old Punish).
Alice Notices then stalls: Bob Forfeits at t4; ZEC stays locked. No lockup stacks: Claimed and Refunding are exclusive.
Residuals: (R-1) ~100 % stake censorship for the whole 7-day tail of a secret-carrying tx (Reveal{b} before T3, or
RefundReveal{a} before t4) lets the colluding counterparty take both legs. (R-2) Forks deeper than K. (R-3) §D.

## V. Value cap (unchanged from v0.5)
Z ≥ minZ(max(top pool, 0.35), ε, stale) (69 for v1 at 5 % stales); refuse on stale (> 24 h), missing or malformed pool feed,
single pool > 35 %, top two > 50 %; ≤ 10 swaps per counterparty (v1). Caps $500 (rehearsal) / $15,000 (v1).

## C. Zcash (unchanged from v0.5)
Ironwood (NU6.3, ZIP 258/2006), tx v6, branch 0x37A5165B (NU7 0x77190AD9); joint key sk = BLAKE2b-256("zeUTXO_p1_jsk_v6", …);
ZIP 2005 use_qsk derivation; spend auth needs the RedPallas adaptor signature under ak = σ·(A+B) (discrete log a+b).
Ironwood → joint Ironwood only (Orchard turnstile refused). Sweeps ovk = None. Expiry tip + 40 (75 s era) / + 120 (NU7);
NU6.3 txs capped at nu7_height − 1. NU7 gate and blackout before Bob funds.

## D. Known open items
use_qsk / Ironwood derivation validated only against our own simulator, not real Zebra/zcashd; Rust sim node and Aiken
script reviewed only by the same author (selfcheck not independent); real-chain D/S/Z measurement; coalition attacks
beyond the largest single entity; A.4 global seen-list; price-feed design; real-node evaluator integration; R-1 has no
burn/deposit counter-measure (decided not worth the complexity, D31).
