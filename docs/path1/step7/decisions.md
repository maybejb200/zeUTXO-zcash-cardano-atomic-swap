# step6 design decisions (answered from first principles; executor, NOT independently reviewed)

D1. Joint Ironwood key = ZIP 2005 use_qsk with a per-swap shared sk.
  sk = BLAKE2b-256("zeUTXO_p1_jsk_v6", "sk" || swap_id || contrib_A || contrib_B), contributions commit-then-reveal
  (commitments are inside swap_id). nk, qsk, qk, rivk_ext derived exactly as ZIP 2005; ak = sigma*(A_p+B_p) with sigma
  in {+1,-1} making the y-sign bit 0 (orchard 0.16 rejects ỹ=1: tested). No ask is ever derived from sk.
  Why: ZIP 2005 requires FROST/DKG participants to agree on sk privately; binding it to swap_id makes every swap's
  viewing key fresh and unlinkable; commit-reveal stops either side choosing it.
D2. What the shared sk gives each party (visibility). Both hold nk/ivk/ovk/qk/qsk of the joint key. They can see:
  the funding note (already known), its nullifier = when it is spent (already observable via the protocol), and any
  output encrypted with the joint ovk. They can NOT spend pre-quantum (spend needs sigma*(a+b), the discrete log of ak).
  Rule: sweep outputs use ovk = None (never the joint ovk), so the counterparty learns one hop only: "the joint note was
  spent", not where it went. Implemented in sweep(). Change never returns to the joint address.
D3. Post-quantum / recovery mode. ZIP 2005's future Recovery Protocol authorises a spend from knowledge of qsk (+ a sig
  under ak). Both parties know qsk => in recovery mode the 2-of-2 collapses to 1-of-2 (either party could take the note).
  Mitigation (not a fix): (a) the joint note lives only T0..T1/T2 (hours); (b) the tool refuses to start if any announced
  network upgrade that changes Orchard-protocol spend authorisation activates before T2 + 24 h; (c) sweep immediately
  on success; (d) never reuse a joint key. Residual: a quantum adversary who learns qsk from a party during the
  window. Logged as OPEN (memo).
D4. Bob funds Ironwood -> Ironwood only. Orchard -> Ironwood directly is consensus-valid (turnstile) but publishes the
  exact swap amount; tool refuses unless forced. Migration first, with ZIP 318 canonical denominations and delays.
D5. Expiry: wallet convention, ZIP 203 + ZIP 218: target+40 pre-NU7, target+120 from NU7; a tx for the NU6.3 branch is
  capped at nu7_height-1. Any tx crossing activation must be rebuilt and re-signed (branch id in sighash) — tested.
D6. Swap transcript v4 binds zec_branch (NU6.3 or NU7) and the tag "ironwood/use_qsk"; setup-proof context v4.
D7. VK: one PostNu6_3 VK for both pools; any other circuit's proof is rejected (tested with FixedPostNu6_2).
D8. NU7 gate: refuse to fund unless the wallet's own node implements NU7 and its next-block branch equals the agreed
  zec_branch. Blackout: no swap whose window [now, now + swap + 24 h] comes within 1,152 blocks (24 h at 75 s) before
  activation, nor within 3,332 blocks (model: first 24 h at 25 s with DAA recovery) after. Fail closed if measured
  spacing > 1.5× nominal. Reason: branch id is in the sighash, expiry semantics change, and the DAA needs ~3 h to settle.
D9. Congestion: the Cardano mempool is FIFO, so spam that arrives after Bob's Redeem was admitted cannot delay it;
  spam can only stop admission (Bob then HOLDS b: liveness loss only). Rule: Bob broadcasts early (as soon as go is
  verified), never after LAST, only if his own mempool < 50% full and direct submission reaches ≥ 25% of stake.
  No fee-based economic rule bounds producer bribery/censorship; that residual is written up (CONTROL test), not patched.
D10. Refund window: Alice must START a Refund by LAST_REFUND = T2 − M, and params need T2 ≥ T1 + 1 s + R + M (step-5
  T2 = T1 + M + 1 is refused). Otherwise a Refund still pending at T2 exposes a while Bob can Punish.
D11. Value cap: Z ≥ minZ(q = max(largest pool, 0.35), ε = 1e-3, stale 5% post-NU7 / 2% now) = 69 at v1; refuse if the
  pool feed is missing, malformed or > 24 h old, any pool > 35%, or top two > 50%. Honest claim: safe against a single
  pool ≤ 35%, NOT against a 45-50% two-pool coalition (needs Z in the hundreds to thousands or is impossible).
D12. Free option (R3-M1): 0.7% premium from Alice, settled K deep on Cardano before Bob funds. Bob's own option (0.12%) left.
D13. Reference script on the lock output: Bob refuses (it changes min-ADA and is not part of the canonical lock).

# Step 7 decisions (Tue Nov 3, 2026, written 1:00–1:23 AM ET from file mtimes; executor, NOT independently reviewed)

D14. Escrow v0.6 = review4 escrow2, adopted with one tightening: "exactly one script input" counts inputs by payment
  credential (not by datum shape), so a second escrow at the same script can't be co-spent. States: Open(phase 0) →
  Commit{go_sig} (Bob sig, upper ≤ T1−1, continuing output with byte-equal datum except phase=1, same value) → Claimed
  → Reveal{b} (Bob sig, no time bound). Refund{a} (Open, ≥ T1), Punish (Open, ≥ T2), Escape (Claimed, Alice, ≥ T3).
  Datum is 11 fields; t3 is bound in swap_id (domain v5) so neither side can shorten the Escape tail after setup.
D15. Timing from first principles (sim and real):
  T1 ≥ T0 + 1 + Mc + R   (Mc = (1+E)·D: only the small Commit must land; no secret is at risk, so no M margin needed)
  LAST_COMMIT = T1 − 1 − Mc (a LIVENESS rule only: a late Commit that misses T1 costs nothing — see rbredeem CONTROL1)
  REFUND_START = T1 + S where Alice also waits K blocks after T1 and sees the escrow still Open (refund-trap rule D18)
  T2 ≥ T1 + S + 1 + R + M,  LAST_REFUND = T2 − M,  T3 ≥ T1 + 7 days.
  Real v1 (37.5 s gate profile): T0 144.7, LAST_COMMIT 149.7, T1 179.6, REFUND_START 192.1, LAST_REFUND 197.1,
  T2 252.1 min after setup; T3 = T1 + 7 d. Step 6 was T1 204.6 / T2 264.6. (model/step7_model.py)
D16. Bob's reveal rule: reveal b only on the Claimed output of HIS OWN Commit once that Commit has ≥ K confirmations;
  if the reveal gate holds (congested mempool, low stake view) he waits, but at/after T3 − M he reveals anyway.
  Why: a Reveal whose Commit is rolled back past T1 hands Alice both coins (rbredeem CONTROL2 shows the loss).
D17. Honest Alice never Escapes after seeing b (she has already swept the ZEC); Escape is only for "Bob committed then
  vanished". Punish is disjoint from Commit/Escape (Punish spends Open only).
D18. Refund trap. If Alice refunds (revealing a) while a pre-T1 Commit is in flight/unsettled, Bob gets both coins.
  Rule: refund only when the escrow is still Open ≥ K blocks after T1 (refundStartGate7). Hence the S term in T2.
D19. Premium dropped (John 12:59 AM ET). Alice's free option is now unpriced: 0.664% (σ_ann 100%, 144.7 min pre-go);
  Bob's option go→T1 34.9 min = 0.326% (step 6 reported 0.123% for 5 min); Bob's option after Commit = 0.
D20. Fail-closed gates (policy7): every input (feed, prices, date, depths, exposure, spacing window ≥ 48, NU7 support,
  branch, upgrade list, escrow state, block counts, "saw b") must be present and valid or the gate REFUSES. The value
  cap uses live feed prices (review4 F3), not constants. Generic upgrade blackout added (F5). D3 reworded: recovery
  mode also needs a RedDSA signature under ak (not only the shared sk).
D21. NU7 blackout covers setup → T2 + 24 h. It does NOT cover the 7-day T3 tail: a Reveal or Escape during an
  activation is a Cardano-side action and the ZEC side is already swept or never touched, so it is acceptable;
  post-activation blackout = 3,456 blocks at 25 s. The old "3,613 blocks" label is replaced by the computed value.

D22. Check against Rapidash (FC 2025), He-HTLC and DEMBA (arXiv 2510.20645) — John's steering 1:18 AM ET.
  Source: prior-art/prior-art.md §5. Rapidash splits the REFUND side into a secret-free intent + later reveal and
  defends against miner bribery with a burn path; He-HTLC/DEMBA add deposits so a bribed/censoring outcome is
  unprofitable. Our design splits the CLAIM side (the mirror image).
  (a) Commit censorship / bribery near T1: producers (bribed by Alice) exclude Bob's Commit until T1. Result: abort
      only. The Commit carries no secret; Alice refunds after T1 + K blocks; Bob recovers his ZEC with a. Nobody loses
      principal; Alice keeps her (unpriced) free option — the bribe buys nothing beyond what she could get by not
      sending go. Tested: congestion (spam), rbredeem CONTROL1 (late Commit rolled back after T1).
  (b) Commit front-run / replay: impossible — Bob signature required and go_sig is bound to the escrow outref; a replay
      on the Claimed output fails (happy, gomsg tests).
  (c) Reveal censorship: theft needs EVERY producer to exclude the Reveal until T3 (7 days ≈ 30,000 blocks) so Alice
      can Escape. One unbribed producer includes it; Bob can raise the fee up to V. Residual: unlike Rapidash there is
      no burn path, so a coalition of Alice + ~100% of stake for 7 days is not defended. Stated, not patched.
  (d) NEW RESIDUAL HONEST-LOSS PATH (inherited from step 6; the mirror of the old congestion3). Producers censor
      Alice's REFUND (it carries a) from REFUND_START until past T2. Bob reads a from the mempool, sweeps the ZEC with
      a+b, then Punishes for the ADA. Needs all producers to censor for > M (~55 min real) — far cheaper than (c).
      This is exactly the attack Rapidash's two-step refund defends. Proposed fix (NOT implemented, per "write it up"):
      symmetric two-step refund — RefundIntent (no secret, ≥ T1, disables Commit and Punish) → RefundReveal{a} (no
      deadline), with Bob's fallback (take the ADA) only after T4 = intent + 7 days without a RefundReveal.
      This is the "one decision for John" in memo.md.
  (e) A > K-deep private fork on Cardano is outside the settlement model (same as step 6).
