# zeUTXO path 1, step 4: L-1 fix (setup proofs bound to one swap), plus the finality decision
Mon Nov 2, 2026, 9:39 to 9:52 PM ET (about 13 min). Box and simulator only: no chains, testnets, nodes, wallets or network.
Every key and nonce was freshly generated and thrown away.

## What changed, in plain English
**The problem (review L-1).** At setup, each party proves that its secret share is the same number on both chains (the
"DLEQ proof"). That proof was labelled with a swap id that the *prover* chose. So a proof from an old swap still passed in a new one.

**The fix.** Setup now has two rounds:
1. Each side sends its public share, a commitment to its key contribution, and a **fresh random nonce**.
2. Only after that does each side make its proof. The proof is stamped with a **swap id that the checker computes itself**,
   from its own copy of the agreed deal:
   - a version tag, plus both network ids (Cardano and Zcash)
   - the escrow script, both amounts, and the deadlines T0, T1 and T2
   - both parties' Cardano keys and Alice's go key
   - both public shares and **both nonces**
   - which role (Alice or Bob) the proof is for

   This stamp goes into the hash that every challenge in the proof comes from. A proof made for any other swap, network,
   amount, deadline, key or role therefore fails. This same swap id is the one in the Cardano datum and the go message.

**Extra checks at setup**, each with its own error:
- the role label must match
- the two shares must differ (no mirroring the other side's proof back)
- the two nonces must differ
- a per-party "already seen" list refuses any share or nonce used in an earlier swap

The last check matters because reusing a share is fatal: once it is revealed in one swap, the counterparty in another swap
could take the coins. A fresh proof can't prevent that by itself.

**Finality (your decision, recorded in decisions.md S4-D0 and spec A.6):** practical finality. That means about 5 min on
Cardano (~15 blocks) and about 12 min on Zcash (~10 blocks), with whole swaps taking about 1–2 h. The exact numbers will come
later from measured chain data. The simulator still uses its own short test values.

## Test results: full step-3 suite plus the new L-1 tests, fresh keys: **188/188 pass** (plus aiken 28/28)
| Scenario | Result |
|---|---|
| **New: L-1 binding** (`l1`): details below | **PASS 21/21** |
| (a) happy, (b) refund, (c) punish | PASS 30/30, 19/19, 13/13 |
| Setup cheats (bad/shifted/mismatched/wrong-role proofs, bad reveal, datum/lock checks, late or bad go) | PASS 15/15 |
| C-1 fee change, C-1 cost-model change | PASS 10/10, 10/10 |
| C2 expired tx, C3 Alice's coins | PASS 8/8, 8/8 |
| Cardano rollback of the claim, and of the refund with a fee change | PASS 13/13, 13/13 |
| Zcash reorg/double-spend, Zcash expiry | PASS 8/8, 4/4 |
| Go-message attacks | PASS 16/16 |
| Controls (rule deliberately broken) | Loss happens as expected, same as step 3 |
| Aiken validator checks (contract unchanged, same script hash) | 28/28 |

**L-1 tests.** Each attack must be rejected with exactly this error:
| Attack | Expected and observed error |
|---|---|
| Bob replays his whole old setup message + proof to a new Alice | `bob's DLEQ proof invalid (ring)` |
| Alice replays her old message + proof to a new Bob | `alice's DLEQ proof invalid (ring)` |
| Bob replays only his old share + proof, with a fresh nonce | `bob's DLEQ proof invalid (ring)` |
| Proof made for another Cardano network (mainnet id 1) | `bob's DLEQ proof invalid (ring)` |
| Proof made for another Zcash network | `bob's DLEQ proof invalid (ring)` |
| Proof made for a different ADA amount, ZEC amount, T1, or escrow script | `… (ring)` (4 tests) |
| Proof made for a different Alice Cardano key, or a different go key | `… (ring)` (2 tests) |
| Swapped roles: proof uses Alice's role label | `bob's DLEQ proof invalid (ring)` |
| Swapped roles: proof built with the two parties' slots exchanged | `bob's DLEQ proof invalid (ring)` |
| Bob mirrors Alice's own message + proof back as his | `duplicate share point (A == B)` |
| Bob's message claims the Alice role | `bob's round-1 message carries role "alice"` |
| Bob makes a *valid* new proof for an old share, to the same Alice | `bob's share point P already seen in an earlier swap` |
| Bob reuses an old nonce with the same Alice | `bob's setup nonce already seen in an earlier swap` |
| Bob echoes Alice's nonce as his own | `duplicate setup nonce` |
| Controls: honest setup accepted, both sides get the same swap id, and re-running setup on the same swap is not flagged; the replayed proofs still verify in their *own* swap (so the rejections come from the binding, not from broken bytes) | accepted (2 tests) |
| Known limit: a valid new proof of an old share sent to a *new* counterparty, who has no shared history | accepted (documented, see below) |

One harness bug of mine, fixed during the step: my first replay test swapped in the old message *after* the honest side had
already made her proof. The fixed test has the replayer send the old message in round 1, as a real attacker would.

## Still open
- **Reuse toward a stranger.** If someone reuses their own old share with a brand-new counterparty, only a check against shares
  already visible on Cardano catches it. Spec A.5 says wallets should do that check. It is not in the simulator, because it needs a
  chain index. This mainly hurts the person reusing the share.
- **Which check fires first.** The proof-of-knowledge challenges are bound by the same hash, but in these tests the ring check
  always fails first. No test hits the proof-of-knowledge check alone.
- **Carried over from step 3:** M-5 (the counterparty keeps the viewing key), other Zcash wallet fingerprints, the encrypted
  setup channel in real code, real K/D/Z values from measured data, and an independent review of spec v0.3. All self-checks are
  my own work, not independent.

## Files changed (step4/ vs step3/)
`zec/src/main.rs`, `zec/src/dleq.rs`, `ada/e2e3.mjs`, `spec.md` (v0.3), `decisions.md`, `selfcheck.md`, `progress.md`,
`memo.md`. New results: `results/FINAL_e2e3-all.json`, `results/run_all_step4.log`, `results/aiken_check_step4.txt`. Step 3's
results were moved to `results/from_step3/`. The contract and the other code are unchanged.
