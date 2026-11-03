# ZEUTXO architecture v1: trust-minimised private ZEC↔ADA swap
Mon Nov 2, 2026, ~12:31 AM ET. This is phase 3 of the overnight run and combines three pieces of work:
- the relay (`zeutxo-step1-relay-cost-results.md`);
- the dispute game (`zeutxo-dispute-design.md`);
- the adaptor swap (`zeutxo-step2-adaptor-spec.md`, `zeutxo-adaptor-proto-results.md`).

**Labels:**
- **[M]** = measured on the box (emulator / unit ScriptContext).
- **[E]** = estimate.
- **[D]** = decision (see `zeutxo-decisions-log.md`).

## 1. Core idea: hybrid settlement
- **Happy path** stays a private adaptor-signature swap. No Zcash data touches Cardano, and there is no hash link between the chains.
- **Every non-happy path** settles by **"ADA follows the Zcash outcome"**. Cardano learns which of the two conflicting, pre-built Zcash txs was mined:
  - C (Alice's claim) → the ADA goes to Bob;
  - R (Bob's refund) → the ADA goes back to Alice.

  It learns this from an inclusion proof against the optimistic Equihash relay, which is secured by the dispute game.
- **Effect:** the time-race hazards H1 and H2 of the pure adaptor swap become relay assumptions, not deadlines a party can miss.
  - **Correction (Nov 2, review H-1/H-2, D-51/D-53):** this was overstated. Under v5 they were *not* removed. Bob's solo CLTV branch on X let him kill both C and R (H-1). A frivolous dispute could also hold finality past release_at so Bob got both assets (H-2). The v6 fixes are: X is 2-of-2 only and R is pre-signed by both parties (D-51); Release needs `Arm` with a checkpoint at height ≥ rel_height, plus a 6 h uncontended grace (D-53). What remains for Alice is one bounded duty, not a race: broadcast R, which she holds, once height L_R is reached, and land ProveR within the grace that follows Bob's Arm. Relay liveness and the stall costs in D-50/D-53 still apply.
- **Linkage only on disputes:** the txids of C and R sit in the escrow datum only as **salted hash commitments**. A txid is revealed (linking the two chains) only when someone uses a proof path.

## 2. Components
| # | Component | Status |
|---|---|---|
| 1 | **Relay branch** (`branch_v2`): permissionless Zcash header batches with full consensus checks except Equihash. Post-NU7: 8 headers/tx, 38.7% mem, 1.398 ADA [M]. | prototyped |
| 2 | **Anchor:** canonical pointer. Optimistic proposals with challenge window W_c = 6.5 h, a pipeline queue, and an MMR accumulator [D-08]. | single-candidate version prototyped; queue + MMR designed |
| 3 | **Dispute** (`dispute`): two-move Equihash fraud game. Reveal 59.6% mem / 1.78 ADA; ProveLeaf 24.9% mem / 0.97 ADA [M]. Bonds 1,000 / 250 ADA [D-07]. | prototyped (Open step designed) |
| 4 | **Inclusion check:** txid ∈ block ∈ canonical batch, with ≥ Z = 330 confirmations. 2.5% mem / 1.4% CPU [M]. | prototyped |
| 5 | **Settle escrow** (v1 = adaptor escrow + proof paths, below). The adaptor-only part measured 0.59% mem / 0.203 ADA per claim [M]. | adaptor part prototyped; proof paths in integration |
| 6 | **Off-chain:** BIP-340 adaptor, cross-group DLEQ (56.7 KB, unreviewed), two-party RedPallas adaptor (verified by `reddsa`) [M]. | prototyped |
| 7 | **Zcash side:** joint Orchard note N, P2SH aux output X (2-of-2 OR CLTV T_B), pre-signed C and R (v5, `nExpiryHeight` = 0). | specified, not built |

## 3. Settle escrow v1 (Cardano)
**Datum:**
- `p_a`, `pkh_a`, `pkh_b`, `msg_tag`, `t_a`;
- `c_com = blake2b_256(txid_C ‖ salt_C)`, `r_com = blake2b_256(txid_R ‖ salt_R)`;
- `min_conf = 330`;
- `phase`: `Locked` or `Pending{release_at}`;
- `t_fb`.

| Action | When | Effect |
|---|---|---|
| `Claim{sig}` (Bob) | Locked, upper bound ≤ T_A, BIP-340 sig under P_A on the outref message | → `Pending{release_at}` (same script, value kept); *t* is revealed |
| `CoopRelease` | Pending, signed by Alice (she has her ZEC) | → Bob, at once (normal happy path) |
| `Release` | Pending, lower bound > release_at | → Bob |
| `ProveC{txid, salt, proof}` | Locked or Pending, txid commits to c_com, C proven with ≥ 330 conf | → Bob (ZEC went to Alice) |
| `ProveR{txid, salt, proof}` | Locked or Pending, R proven with ≥ 330 conf | → Alice (ZEC went back to Bob) |
| `Fallback` | Locked, lower bound > t_fb | → Alice (relay-dead fallback only) |

**Timing (D2), in hours after t1, the moment the escrow is S_C deep:**
- T_A = 8.
- T_B = 17.6 (2,537 blocks) [M from `scenarios.py`].
- release_at = T_B + Z·25 s + finality lag 7 h + D = 17.6 + 2.3 + 7 + 6 ≈ **33 h** [E].
  - **Superseded (D-53):** the 7 h finality lag ignored dispute delay. In v6, release_at is only the earliest Arm time. Arm also needs a checkpoint at height ≥ rel_height = L_R + D_mine (24) + 330. Worst-case time from height L_R until that checkpoint can exist [E]: (24+330)×75 s ≈ 7.4 h, plus batch fill ≈ 0.7 h, plus D, plus entry finality up to W_c + 2τ = 6.5 + 12 = 18.5 h, giving ≈ 26.6 h + D. After that comes the Arm grace of 6 h. Every honest fake-fork reset (M-4) adds another round, costing the attacker ≥ 1,250 ADA each (D-50).
- t_fb = release_at + 7 days [D-11]. **Caveat (D-53, review M-1):** a relay staller who wins every anchor race can push the relay toward t_fb. That costs about 1,000 ADA (one forfeited bond_p) per ~6 h round, ≈ 28k ADA per 7 days [E]. ReleaseRelayDead (Bob) and Fallback (Alice) therefore only make sense when the swap value is well below that figure.

**Both parties hold R.** R pays Bob, so Alice broadcasting it is harmless. That means Alice can always force the R outcome after T_B, then use ProveR. A missing Bob therefore can't lock her ADA beyond about T_B + 2.3 h + 7 h + D.

## 4. Trust table
| Property / risk | Pure adaptor swap (prototyped today) | v1 hybrid (after the planned upgrades) |
|---|---|---|
| Custody | trustless (2-of-2 + pre-signed refund; escrow script) | same |
| H1: Bob's *t* leaks but his claim misses T_A | Bob loses unless he acts by T_A − D − S_C | ~~removed~~ **v6:** Bob proves C → gets the ADA, provided the relay is live (D-50 costs) |
| H2: Alice's C misses T_B, Bob refunds and keeps the ADA | Alice loses unless she acts within D | ~~removed~~ **v6:** Alice proves R → ADA back. Bob can only Release after Arm (checkpoint ≥ rel_height) plus a 6 h grace, and X has no Bob-only branch (D-51, D-53). Under v5 this row was false (review H-1/H-2). |
| H3 / H4 (reorgs) | depth Z = 330 / S_C | same depths, enforced on-chain by the relay |
| Relay header validity | n/a | 1 honest watcher live within D; Cardano doesn't censor for > D (dispute game); not a committee or multisig |
| Relay liveness | n/a | 1 honest relayer; if none exists until t_fb, the fallback gives the ADA to Alice (**only in this case is there a timing risk again**) |
| Trusted setup | none | none (Groth16 path rejected, D-06) |
| Privacy, happy path | no on-chain link; amounts, timing and X pattern can correlate | same; only salted commitments on Cardano |
| Privacy, dispute path | n/a | the revealed txid links the two chains (Orchard still hides amount and recipient) |
| Crypto review status | DLEQ is own code, unreviewed; adaptor math tested against reddsa / libsecp256k1 | same, plus a validator audit |

## 5. Remaining gaps (bounded)
1. Anchor v2: pipeline queue, MMR, dispute Open/pause, and rolling/prunable branches. These are **designed, not prototyped**. Without them the relay can stall, and inclusion only works within 16 batches.
2. `Reveal` uses 59.6% of the memory budget. A two-tx split fallback is designed.
3. Real Zcash txs (ZIP 244 sighash, Halo2 proof, P2SH X): not built. That needs `librustzcash` and later regtest Zebra, **with John's OK for nodes**.
4. DLEQ external review plus a Rust port. FROST adaptor hook (O1).
5. Fee / CPFP policy for pre-signed C and R (O4).
6. GPU hash-rate assumption behind the griefing cost (unmeasured).

## 6. Ranked next steps for John (each bounded)
1. **Integration end-to-end in the emulator** (being done this run): settle-v1 escrow with proof paths wired to anchor and inclusion, chained branch → anchor → dispute → settle, with negative tests.
2. **Anchor v2 prototype** (queue + MMR + Open/pause + prune): about 1 day of agent work [E]. Pass bar: all txs ≤ 60% of the limits.
3. **Zcash tx builder** (off-chain only): v5 C and R with fixed txids, run against librustzcash test vectors. About 1 day [E].
4. **DLEQ review:** send it to a cryptographer, or adopt Zwap's code after reviewing it (needs John's approval to share).
5. **Regtest Zebra plus a private Cardano devnet** for a full two-chain dry run. **Needs John's OK** (nodes, RAM).
6. **Long term:** a STARK-based Equihash validity proof, to remove the watcher-liveness assumption from relay safety.
