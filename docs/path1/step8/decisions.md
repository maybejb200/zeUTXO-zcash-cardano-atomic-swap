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

# Step 8 decisions (Tue Nov 3, 2026, from ~7:55 AM ET; executor, NOT independently reviewed)
John approved the symmetric two-step refund (step7 memo §10). Answered from first principles.

D23. State machine v0.7 (escrow.ak). Three live states, every arrow spends the single escrow UTxO:
    Open(0)     --Commit{go_sig}  Bob sig, upper ≤ T1−1, no secret          --> Claimed(1)
    Open(0)     --Notice          Alice sig & lower ≥ T1, OR Bob sig & lower ≥ T2; finite upper u with u − lower ≤ 6 h;
                                  no secret                                   --> Refunding(2), datum t4 := u + (t3 − t1)
    Claimed(1)  --Reveal{b}       Bob sig, no deadline                        --> anywhere (Bob)
    Claimed(1)  --Escape          Alice sig, lower ≥ t3                       --> anywhere (Alice)
    Refunding(2)--RefundReveal{a} Alice sig, no deadline                      --> anywhere (Alice)
    Refunding(2)--Forfeit         Bob sig, lower ≥ t4                         --> anywhere (Bob)
  Continuing outputs (Commit, Notice): exactly one input locked by this script (payment credential), exactly one output
  to the same address, same value, inline datum byte-equal to the input datum except phase (and t4 for Notice), no
  reference script. Datum = 12 fields (step 7's 11 + t4; t4 = 0 while Open/Claimed). The old Refund{a}-from-Open and
  Punish are REMOVED. Nothing that carries a secret has a deadline; every deadline-bound tx carries no secret.
D24. Why t4 is relative and uses the SAME tail as T3. The reveal of a must have a long, censorship-proof window after
  the Notice, wherever the Notice lands; an absolute T4 would shrink to minutes for a late Notice (= the step-7 hole
  again). t4 = u + tail ≥ inclusion + tail because the ledger only includes a tx at a slot < u. tail = t3 − t1 (7 days
  real) is already bound in swap_id (domain v5), so no new transcript field and no Rust change; it makes the two
  griefing tails equal by construction. The 6 h cap on u − lower stops a griefing Alice from pushing t4 out by choosing
  a far upper bound (the ledger's own horizon is ~36 h); it costs her nothing because her wallet uses 1 h.
D25. Does Punish still have a role? Its JOB (compensate Bob when Alice goes silent after he funded) stays; its FORM
  (Open --Punish at T2--> Bob) is removed, because it is exactly what turned "censor Alice's refund until T2" into a
  loss. Replacement: from T2 Bob may send the Notice himself. That starts the same 7-day clock Alice's own Notice
  would; if Alice is alive she reveals a and refunds; if she is gone, Bob Forfeits at t4 and takes the ADA (his ZEC
  stays locked; trade executed at the agreed rate). So censoring Alice's Notice until T2 now only means Bob starts the
  clock for her: no loss. T2 is a LIVENESS parameter only (gives Alice the first chance); rule T2 ≥ T1 + S + 1 + R + Mc.
D26. Commit vs Notice race near T1. Commit needs upper ≤ T1−1 s, Notice needs lower ≥ T1: no tx can be valid for both,
  and both spend the one Open UTxO, so the ledger serialises them; whichever is included wins and the other is
  dropped (BadInputs / mempool conflict). Neither carries a secret, so the loser loses nothing. Alice may therefore
  send her Notice AT T1 (the step-7 REFUND_START = T1 + S wait is no longer needed for safety; kept as nothing).
  Remaining danger = a fork: Alice sees her Notice confirmed while a competing fork contains a pre-T1 Commit.
  Rule A-REVEAL (mirror of Bob's 3-confirmation rule D16): Alice reveals a ONLY on the phase-2 output of a settled
  Notice (≥ K confirmations), with the exact expected datum (t4 = that Notice's upper + tail) and value. A fork that
  replaces a K-deep Notice with a pre-T1 Commit is > K deep, outside the settlement model (same as step 6 D22(e)).
  Tested: refund-trap fork test (honest rule: no loss) + CONTROL (reveal after 1 confirmation → loss).
D27. Alice's deadline rule. She reveals a only while now ≤ t4 − M (otherwise a pending RefundReveal at t4 hands a to
  Bob, who could Forfeit = the old hole). With t4 ≥ Notice + 7 days that window is ~7 days minus ~1 h. Bob's Forfeit
  rule (honest Bob): only at ≥ t4 and only if no RefundReveal{a} was seen; if a was seen he sweeps his ZEC and does not
  Forfeit (a Forfeit after seeing a is theft, possible only under 7 days of total censorship — residual D29(c)).
D28. Rollbacks. (a) Notice rolled back < K: it returns to the pool (still valid: lower ≥ T1, no upper problem within
  6 h) or is rebuilt; Alice has not revealed (K rule) — no loss. If it is rebuilt with a new upper, t4 moves later by
  the delay; Alice's wallet always reads t4 from the settled Notice. (b) RefundReveal rolled back < K: back to the
  pool, no deadline, still valid; Bob already knows a and can only sweep his own ZEC. (c) Commit rolled back after T1:
  dropped (TTL) — Alice then Notices; unchanged from step 7. (d) Reveal rolled back: unchanged (no deadline).
D29. Double 7-day lock-ups. Claimed and Refunding are mutually exclusive successors of Open, so the two tails never
  stack. Worst cases: Alice's ADA locked ≤ T3 = T1 + 7 d (Bob commits and stalls); Bob's ZEC locked ≤ T2 + 6 h + 7 d
  (Alice silent; Bob Notices at T2) — about 7.3 days real. A griefer always locks his own coin for the same time.
  A rolled-back-and-rebuilt Notice can only push t4 by the rebuild delay (minutes), not by another 7 days.
D30. Re-check against Rapidash (FC 2025), He-HTLC, DEMBA (prior-art.md §5).
  (a) Commit censorship/bribery near T1: abort only (unchanged). (b) Notice censorship (new): no secret; until T2 it
      just delays; from T2 Bob can Notice himself; whichever Notice lands, Alice has ≥ 7 days. The step-7 honest-loss
      path D22(d) is CLOSED (test refund_censored, both_censored). (c) Reveal{b} censorship to T3 and RefundReveal{a}
      censorship to t4: theft needs ~100% of stake for 7 days (~30,000 blocks). This is now the ONLY principal-loss
      path for an honest party, and it is symmetric. Rapidash adds a burn path (a miner who sees both secrets can
      burn), He-HTLC/DEMBA add deposits making the briber's net gain ≤ 0; we have neither: residual stated, not patched.
      (Bribery economics: the briber must pay every producer for 7 days to gain V ≤ $15k; with ~2,000+ pools a 7-day
      cartel is far costlier than V, but this is an argument, not a mechanism.)
  (d) Rapidash-style "reverse bribery" (the victim outbids): the victim's tx carries no deadline pressure for 7 days,
      so the victim can raise fees up to V; we do not model fee auctions. (e) Front-running: all six actions need the
      acting party's signature; Notice from Bob only after T2. (f) Griefing: symmetric 7-day tails, no premium, no
      deposit; a griefer gains nothing and locks his own coin equally. Option value: Alice's pre-go option (0.664%)
      and Bob's go→T1 option (~0.33%) unchanged; Notice/RefundReveal add no option (a refund returns each his coin).
D31. Gates (policy8, fail closed): noticeGate (Alice: now ≥ T1, escrow Open), bobNoticeGate (now ≥ T2, escrow Open, Bob
  did not Commit), refundRevealGate (notice confs ≥ K, own expected Refunding datum, now ≤ t4 − M), forfeitGate
  (now ≥ t4, Refunding, a not seen), escapeGate unchanged, refundStartGate7/LAST_REFUND removed.
D32. Premium: still removed everywhere (spec v0.6, D19).

## D33 (step 8, during the run) T2 rule relaxed to T1 + S + 1 + R + Mc
T2 no longer protects a secret (Punish is gone); it only decides when Bob may Notice. It must leave Alice time to get her
own T1 Notice settled (S) plus slack (R) and one rebuild (Mc). Using M was over-conservative. Sim T2 = T1 + 260 s; v1 T2 =
227.1 min (step 7: 252.1). Test: timing group "T2 = T1+1+R+Mc (no S) refused".
## D34 Notice accepted from either party by Alice's wallet
If producers censor Alice's Notice and include Bob's (from T2), the Refunding datum is identical in form (t4 = its upper +
tail), so Alice's reveal rule accepts it. Test g8_refund_censored case 2.
