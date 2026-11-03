# zeUTXO path 1 — step 6 memo (shielded ZEC on Ironwood ↔ ADA)
Simulator only, on the box. No real chain, testnet, node, wallet or network transaction was used. Every key was a fresh throwaway.
Dates and times are America/New_York (ET). Work ran from Mon Nov 2, 11:32 PM ET to Tue Nov 3, about 12:50 AM ET.

## 1. Bottom line
- **The Zcash leg now runs on Ironwood with the real published libraries.** Real v6 transactions are built and verified with orchard 0.16.0 and zcash_primitives 0.31.0, against the real PostNu6_3 verifying key. The Orchard flow from step 5 is invalid after NU6.3, and the tool now refuses it.
- **One piece is my own code.** The ZIP 2005 "use_qsk" key derivation is in no published crate, so I wrote it from the ZIP. Because no test vectors exist, it is labelled *spec-implemented, not cross-checked*.
- **All review3 High findings now have a gate and a test. The full rerun passed 360/360 checks in 28 groups,** including every old attack (step 5 had 269). aiken check passed 28/28 and pok_isolated passed 10/10.
- **One theft path is still open: producer censorship.** It is proven by a CONTROL test (§6). No fee or deposit rule under your caps closes it.
- **Two other limits are honest ones.** The value cap is safe against one mining pool up to 35%, but not against a two-pool coalition near 50%. ZIP 2005 recovery mode would turn the 2-of-2 joint key into 1-of-2.

## 2. Status of each review3 finding
| Finding | Status | What was done | Tests |
|---|---|---|---|
| R3-C1 Orchard is withdraw-only after NU6.3 | **Fixed (sim)** | ZEC leg ported to Ironwood v6 on branch 0x37A5165B, with a use_qsk joint key. Funding is Ironwood→Ironwood only. Orchard cross-address spends and inflow are refused. | zecnode 30/30, happy, refund, punish |
| R3-H1 NU7 transition | **Fixed (sim)** | NU7 gate: the node must implement NU7, and its next-block branch must match the agreed branch. Measured spacing must be ≤ 1.5× nominal. Blackout runs from 1,152 blocks before to 3,332 blocks after activation. Expiry is capped at nu7−1, so a transaction that straddles activation is rebuilt. | nu7 16/16, zexpiry 4/4 |
| R3-H2 Cardano congestion | **Mitigated; residual open** | Mempool spam model. Bob broadcasts early, never after LAST, and HOLDs b if his own mempool is ≥ 50% full or he reaches < 25% of stake directly. Spam can no longer cause theft. Producer censorship can (§6). | congestion 11/11, congestion2 8/8, congestion3 7/7 (CONTROL) |
| R3-H3 value cap | **Fixed, with a stated limit** | Z ≥ minZ(max(top pool, 0.35)), which gives Z = 69 for v1. Bob refuses if the pool feed is stale (> 24 h), missing or malformed, if any pool has > 35%, or if the top two have > 50%. Also an exposure limit and recomputed budgets. Not safe against a ~45–50% two-pool coalition. | cap 15/15 |
| R3-M1 free option | **Mitigated** | Alice pays a 0.7% premium, settled K deep, before Bob funds. Bob's smaller option (0.12%) is left as is. Rate-limiting counterparties who abort is not built. | premium 3/3 |
| R3-M2 own-node dry run (B.3) | **Open** | Needs a real cardano-node, which the rules forbid. Byte-level agreement between libsodium and the node's Ed25519 is still assumed. | — |
| R3-M3 T2 Refund/Punish race | **Fixed** | T2 ≥ T1 + 1 s + R + M. Alice may only start a Refund up to LAST_REFUND = T2 − M. | laterefund 6/6, timing 23/23 |
| R3-L1 reference script on the lock | **Fixed** | Bob refuses a lock output that carries a scriptRef. | refscript 1/1 |
| R3-L2 Cardano hard forks | **Open (unchanged)** | No Cardano hard-fork blackout was coded. M still allows one fee or cost-model change, which is tested in c1fee and c1cost. | c1fee, c1cost |
| R3-L3 | No issue | — | f1 |

## 3. Ironwood design and privacy
- **Joint key.** Both parties compute sk = BLAKE2b-256("zeUTXO_p1_jsk_v6", "sk" ‖ swap_id ‖ both committed contributions). The ZIP 2005 use_qsk chain then gives nk, qsk, qk and rivk. The spend key is ak = σ·(A+B), where A and B are the two parties' adaptor points and σ is ±1. σ is chosen so that ak has ỹ = 0, and orchard rejects ỹ = 1, which is tested. Spending needs a RedPallas signature whose secret is a+b, so neither party can spend alone (pre-quantum).
- **What each side can see.** Both can view the joint note and see when it is spent. Sweeps use ovk = None, so the other side cannot see where the money went. That is a one-hop view only. Viewing keys are fresh per swap, so swaps cannot be linked to each other.
- **Funding.** Ironwood → Ironwood only. A direct Orchard → Ironwood transfer (the turnstile) would publish the exact swap amount, so it is refused unless forced. Migrate first under ZIP 318, in standard denominations with delays.
- **Post-quantum exposure (open).** ZIP 2005's future recovery protocol authorises a spend from qsk. Both parties know qsk, so in that mode the 2-of-2 becomes 1-of-2. Mitigations: the joint note lives only for hours, the tool refuses if such an upgrade is announced before T2 + 24 h, it sweeps immediately, and keys are never reused.
- **Transcript.** swap_id v4 binds zec_branch and the tag "ironwood/use_qsk". The setup-proof context is v4.

## 4. Library versions — what is real and what is simulated
| Real (published code, run locally) | Simulated |
|---|---|
| orchard 0.16.0: Halo2 proofs, PostNu6_3 VK, RedPallas, note encryption, batch verification | The Zcash "node": my chain.json store plus my reading of the consensus rules (ZIP 258/259/317/203/218). It is not zebrad. |
| zcash_primitives 0.31.0: v6 transaction and v6 sighash | Block times, DAA recovery and stale rates come from models, not a network |
| zcash_protocol 0.11.0: branch ids and heights | The ZIP 2005 use_qsk derivation: written from the spec, not cross-checked |
| pasta_curves 0.5 / bls12_381 for the DLEQ (same as step 5) | Cardano ledger: Lucid emulator plus my strict checker. The mempool is one FIFO queue of 2 blocks. |
| Aiken v1.1.24 and the compiled UPLC script (byte-identical to step 5) | Mining-pool feed, stake reach and spam are fake inputs |
| rustc 1.99.1 (rustup, on the box only) | Producer censorship is a test hook |

## 5. Caps and timing in real minutes (after setup)
| Case | T0 (go deadline) | LAST (Bob's last broadcast) | T1 | LAST_REFUND | T2 |
|---|---|---|---|---|---|
| v1 nominal (25 s blocks) | 94.4 | 99.4 | 131.9 | 136.9 | 169.4 |
| v1, 37.5 s spacing gate | 133.4 | 138.4 | 170.9 | 175.9 | 208.4 |
| **v1, gate + 25% direct stake (what the spec uses)** | **144.7** | **149.7** | **204.6** | **209.6** | **264.6** |
| Rehearsal (NU6.3 era, 75 s blocks, Z = 10) | 83.7 | 88.7 | 143.7 | 148.7 | 203.6 |

**Caps.**
- **Rehearsal:** $500.
- **v1:** $15,000, with Z = 69 Zcash blocks and K = 15 Cardano blocks.
- **Exposure limit:** 10 swaps per counterparty, which keeps lifetime reversal risk at about 1%.
- **Free-option premium:** 0.7% (about $105 on $15k).

**Costs (from the sim).**
- **Ironwood transactions:** 9,166 B and 2 actions each, with a 10,000-zat fee. Proving takes about 0.7 s and verification about 5 ms.
- **Cardano transactions:** the Redeem is 1,699 B with a 0.256 ADA fee; the Lock is 0.177 ADA.
- **DLEQ proof:** 60.6 KB, about 0.5 s to prove.

**Spam economics.**
- **Running cost:** spamming Cardano costs about $2.47 per minute.
- **Cost of holding up Bob:** about $10.87 in the test, and about $80 to stall for the whole 32.5-minute margin.
- **What spam buys:** at most a lost swap (liveness), never theft.

## 6. The remaining theft path: producer censorship (congestion3)
**What happens.**
1. Bob broadcasts his Redeem, which reveals b.
2. As soon as any mempool holds it, b is public.
3. If the block producers who make every block until T1 leave that transaction out, it never settles. This is a bribery or collusion attack, not spam.
4. After T1 the Redeem is invalid.
5. Alice, who has read b from the mempool, sweeps the ZEC (the test shows this succeeds). She also refunds her ADA.
6. **Bob, who is honest, loses his ZEC.**

**Why no rule closes it.** FIFO means fees cannot buy priority, so outbidding doesn't help. A deposit or premium under your caps is far smaller than what a bribed producer set can extract.

**What reduces it.**
- Broadcast early.
- Hold b unless Bob reaches ≥ 25% of stake directly.
- With 25% direct reach, the model gives P(late) ≈ 0.1%. That figure assumes producers act independently; coordinated censorship by everyone is not bounded.

**Honest wording for the spec.** "Safe against spam and against any minority of block producers. Not safe if the producers of every block for about 55 minutes collude with Alice." Following your rule, this is written up, not patched.

## 7. Test table (full rerun, fresh keys, finished ~12:43 AM ET, 976 s)
| Group | Checks | Group | Checks |
|---|---|---|---|
| l1 | 21/21 | gomsg | 22/22 |
| happy | 30/30 | f1 | 18/18 |
| refund | 19/19 | hostage | 2/2 |
| punish | 13/13 | f2 | 18/18 |
| setup | 15/15 | timing | 23/23 |
| c1fee | 10/10 | seenhex | 8/8 |
| c1cost | 10/10 | cap | 15/15 |
| c2 | 8/8 | **nu7** | 16/16 |
| c3 | 8/8 | **congestion** | 11/11 |
| rbredeem | 13/13 | **congestion2** | 8/8 |
| rbrefund | 13/13 | **congestion3 (CONTROL)** | 7/7 |
| zreorg | 8/8 | **laterefund** | 6/6 |
| zexpiry | 4/4 | **refscript** | 1/1 |
| | | **premium** | 3/3 |
| | | **zecnode** (runs neg_tests.sh) | 30/30 |
| **Total** | **360/360** | aiken check | 28/28 |
| | | pok_isolated | 10/10 |

Bold rows are new in step 6. The zecnode group runs neg_tests.sh, which checks that these are rejected:
- Orchard cross-address spends and Orchard inflow;
- the Orchard turnstile, which is refused by policy;
- the wrong VK;
- the wrong branch (three cases);
- v4 after NU7;
- expiry 0, an expired tx and the expiry cap;
- a stale-branch sweep;
- one share only, a wrong share, a missing negation, a wrong sighash and a tampered proof;
- a double spend.

It also runs the use_qsk selftest.

**Test-only changes made in this step:**
- The zexpiry expectation is now tip+1+40.
- The nu7 "far" case moved to height 6000, because the swap window can be 3,613 fast blocks.
- The congestion suites were fixed: mempool fill now counts pre-fill, a flood that arrives after admission queues behind the Redeem, and the censorship hook now acts before inclusion.

## 8. What's open
1. **Producer censorship or bribery** (§6). This is the only theft path still found.
2. **Two-pool coalition.** At about 45–50% combined, Z would need to be 972 to 3,000+ blocks, or no Z works. The cap only covers a single pool ≤ 35%.
3. **ZIP 2005 recovery mode** makes the joint key 1-of-2. Watch the ZIP.
4. **use_qsk derivation not cross-checked.** It needs official vectors or a second implementation.
5. **R3-M2.** The own-node dry run and the real cardano-node Ed25519 vectors need a real node, which was out of scope.
6. **R3-L2.** No Cardano hard-fork blackout is coded.
7. **Mempool and DAA models.** Real Cardano relay ordering across peers, NU7's real stale rate and the real DAA curve are all modelled, not measured.
8. **NU7 itself.** ZIP 259 is still *Proposed*; the activation height 3,543,405 comes from zcash_protocol 0.11.0.
9. **Not independent.** Nothing here has been reviewed independently (see selfcheck.md). A review4 is needed before any rehearsal.

## 9. Exact list of changed and new files (all under step6/; nothing outside step6/ was modified)
- **Changed from step 5:**
  - ada/e2e3.mjs
  - ada/ledger.mjs
  - zec/Cargo.toml
  - zec/Cargo.lock
  - zec/src/main.rs (rewritten, v0.6.0)
  - zec/src/dleq.rs (imports only)
  - zec/examples/pok_isolated.rs (imports only)
  - spec.md (v0.5 delta added on top)
- **New:**
  - ada/policy6.mjs
  - zec/neg_tests.sh
  - zec/neg_results.jsonl
  - zec/Cargo.step5.toml.txt and zec/Cargo.step5.lock.txt (references)
  - model/step6_model.py and model/step6_model_output.txt
  - research/summary.md and research/zip-*.html / .txt
  - decisions.md (D1–D13)
  - progress.md
  - selfcheck.md
  - memo.md
  - results/* (FINAL_e2e3_all.json, full_run_step6.log, pok_isolated_step6.txt, step6_model.json and per-group JSON files)
  - runs/* (throwaway sim runs)
- **Unchanged:** the Aiken validator (byte-identical to step 5).
- **Backup:** /home/box/zeutxo-backups/step6/
