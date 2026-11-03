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
