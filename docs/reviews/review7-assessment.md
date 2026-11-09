# Review 7: assessment of the solution as of PR #1 (Nov 9, 2026)

Scope: branch of PR #1 at `d2d74b7` (spec v0.7, escrow v0.7, step 10 wallet). Done by an AI session, like reviews 1–6;
it is **not** an independent third-party audit.

## Verdict
**Conditional pass for the testnet rehearsal; not ready for real funds.** The design and the escrow are sound. One new
Medium wallet finding (W-1) and one Low (W-2) were found and are fixed in step 11 (decisions D47–D50).

## What was checked
- Fresh build from the branch: `npm ci`, `cargo build --release`; `tests/step10/fixes_test.mjs` 21/21, gates9 13/13,
  gates8 58/58, `e2e9.mjs all` 701/701 in the sim profile.
- Own read of `escrow.ak` against spec §B, of the cross-group DLEQ (`zec/src/dleq.rs`) and of the joint-key derivation.
- `aiken check` could not be run in the review environment (downloaded binaries are blocked). CI now does it (D50).

## Escrow and protocol: no finding
- Every secret-carrying spend (Reveal, RefundReveal) has no deadline; every deadline-bound spend (Commit, Notice, Escape,
  Forfeit) carries no secret. The validator enforces exactly that.
- Commit and Notice: exactly one script input, exactly one continuing output to the same address with the same value
  and a byte-equal inline datum, no reference script. Terminal spends pay nowhere specific, so nothing to double-satisfy.
- The go message binds network, swap id, script hash, outref, lovelace and T1. No re-Notice, so t4 cannot be pushed out.
- Left to the wallet (W.1 is therefore safety-critical): t1 < t2 < t3 and the locked amount are not checked on-chain.
- Residuals R-1, R-2, L1 are as the spec states. A 3-hour rehearsal tail makes R-1 far cheaper than the 7-day v1 tail.

## Cryptography: no finding
- DLEQ: 252 bit commitments per group, AOS ring per bit with one 248-bit challenge valid in both fields, weighted sums
  must reproduce P and Q, Schnorr PoK on each side, strict decoding. The 2^252 range equals the escrow's share bound.
- `ak` = ±(A + B) is set directly and never derived from the shared `sk`, so the shared hash gives viewing keys only.
- Open (unchanged): ZIP 2005 `use_qsk` derivation is unvalidated against a real Zebra node.

## W-1 (Medium, fixed): the secret watchers trusted any Reveal-shaped redeemer
`aliceSeesB` / `refundA` returned the first redeemer with constructor 1 / 3 in any seen transaction, without checking
x·G1 against the datum point. Bob could commit, stall, and broadcast a junk `Reveal{12345}` on any script: Alice's Escape
gate then refused at T3 ("b was seen"), her sweep with the junk value failed, and Bob kept the right to Reveal whenever
he liked. Mirror case: a junk RefundReveal stops Bob's Forfeit. Demonstrated in the simulator before the fix
(`results/step11/before_r11_decoy.txt`). Fix: D47.

## W-2 (Low, fixed): `spendingRedeemer` paired redeemers with unsorted inputs and fell back to the first redeemer
Fix: D48.

## Engineering
- Alice and Bob were functions in one process sharing one view. Step 11 gives each party its own view, feed and durable
  state for the secret path (D49); the transaction builders and UTxO discovery are still one process.
- There was no CI; pass counts came from hand runs. Fixed: D50.

## Still needed before real funds
A real Zebra node accepting `use_qsk` keys; measured inclusion/settlement times; fully separate Alice and Bob clients;
price-feed design; coalition-censorship analysis; an independent human audit.
