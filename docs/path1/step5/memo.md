# zeUTXO path 1, step 5: review2 fixes, value cap, full rerun
Mon Nov 2, 2026, 10:32 PM to about 11:00 PM ET. Simulator only and box only, with fresh throwaway keys. Nothing touched a real
chain, testnet, node, wallet or the network, apart from read-only web pages for the cost estimate. step1-4, review1 and review2
were not modified.

## Bottom line
- Both blockers from review2 are fixed in the simulator.
  - **F1 (critical):** Bob now funds only if Alice's datum is byte-for-byte the one he builds himself. The hostage attack and 12
    other bad datums are refused before any ZEC moves.
  - **F2 (high):** Ed25519 is now strict, go keys are validated at setup, and a node-equivalent ledger check runs separately from
    Bob's own check. Forged go signatures are refused.
- The medium findings (F3-F7) are also fixed and tested.
- **Full rerun:** 269/269 end-to-end checks pass (step 4 had 188). Also aiken check 28/28 and the isolated PoK test 10/10.
- **Value limit:**
  - **$500 per swap for a rehearsal.**
  - **About $15,000 per swap for a first real version (v1).** This needs Zcash 60 blocks deep after NU7, about 25 minutes.
  - Larger swaps need proportionally deeper Zcash confirmation. The wallets enforce this.
- No new way for an honest party to lose funds was found. This is my own check and it is NOT independent.

## Status of review2 findings
| # | Finding | Status | What changed |
|---|---|---|---|
| F1 | Datum type confusion / hostage (critical) | **Fixed** | Bob rebuilds the canonical datum and requires identical bytes, inline (not a hash), the exact script address with no stake key, and the exact value. Each failure gives a specific reason. |
| F2 | Lax Ed25519, unvalidated go key (high) | **Fixed in the sim.** One real-world step is still to build. | Strict verify (canonical A/R, no small-order points, S<ℓ). Bad go keys are refused at setup. Bob requires libsodium and OpenSSL to agree. The simulated ledger now re-checks every Redeem the way cardano-node does (libsodium). In the real world, Bob must test-run on his own node and submit only there (spec B.3). That is not built yet. |
| F3 | Time budgets used the average | **Fixed** | Budgets are max(2.5× the average, the 99.9% worst case). |
| F4 | No slack after a late go; Bob's clock | **Fixed** | T1 ≥ T0+1+M+R, where R = 5 min of reaction time. Bob's clock = max(own clock, chain-tip time) + 1 min. |
| F5 | Vacuous go-message tests | **Fixed** | Each test uses the real key and changes exactly one field (7 fields), with a positive control. Script error messages are still generic, because naming the failing check would mean changing the audited script. |
| F6 | No value cap | **Done** | Formula and tests are below. It is enforced at setup in both wallets, and the depths are part of the swap id. |
| F7 | Seen-list bypass by hex letter case | **Fixed** | Points are decoded and re-encoded, and non-canonical or identity points are refused. Upper-case reuse is now caught. |
| F8 | Constructor tag / extra fields | **Fixed** (by F1) | Tested. |
| F9 | Free option | Inherent, documented | Unchanged. Keep T0 short. |
| F10 | Lock rollback after funding | OK (inside the K budget) | — |
| F11 | Validity-bound 1-slot gap | Still holds, safe | — |
| F12 | PoK enforcement | Confirmed. Isolated test ported into step 5 (10/10). | — |
| F13 | Rogue key on the 2-of-2 | None | — |
| F14 | Encoding consistency | OK. Datum encoding is now pinned in spec B.1. | — |

## Tests (all with fresh throwaway keys; logs in results/FINAL_*)
| Group | Checks | Notes |
|---|---|---|
| Step 4 suite: setup-replay (l1), happy, refund, punish, setup cheats, fee/cost-model changes, C2, C3, rollbacks, Zcash reorg/expiry | 172/172 | Unchanged logic. The setup-cheat tests now expect the more specific datum errors. One step-4 test's expected-error pattern was widened, because Bob now gives a more specific reason ("R is small-order" for an all-zero signature). |
| Go-message (rewritten, F5) | 22/22 | Real key, one field changed per test. Positive control accepted. |
| F1 datum attacks | 18/18 | Refused, each with its own reason: t2/t1/network as bytes, a_c as int, tag 1, 10 fields, 8 fields, definite list, padded int, bignum t2, t2=2^70, t2=−1, 33-byte go key, datum hash, stake key, 1 lovelace short. Honest control accepted. |
| Hostage (review2) | 2/2 | Bob refuses; no ZEC is ever sent. |
| F2 forged go / bad keys | 18/18 | Identity-R signature: Bob and the ledger refuse. Identity, order-2, mixed-order, off-curve, non-canonical, 31-byte and upper-case keys are refused at setup. With the setup check bypassed, the forged go is still rejected by the ledger. The local evaluator alone still accepts it (shown as "observe"). |
| Timing (F3/F4) | 22/22 | Go at exactly T0: Bob settles 260 s before T1. Bob 120 s slow: refuses past LAST (a wall-clock rule would not). Bob 120 s fast: refuses early, Alice refunds. Rule without R: refused. |
| Seen-list / encodings (F7) | 8/8 | Upper-case reuse, mirrored points, Pallas x+p, identity P, a bad BLS flag and BLS infinity are all refused. |
| Value cap | 7/7 | $627 at Z=60: accepted. 20 ZEC at Z=60: refused with "needs Z ≥ 96". Accepted at Z=96. Rehearsal-tier limits enforced. |
| **e2e total** | **269/269** | 6 min run |
| aiken check (script unchanged) | 28/28 | |
| Isolated PoK test | 10/10 | |

## Value limit: recommendation and reasoning
**Recommendation:**
- Rehearsal: **$500 per swap**, with Cardano 15 blocks and Zcash 10 blocks now (30 blocks after NU7).
- v1: **cap about $15,000** (computed $15,682; rounding down is sensible given the uncertainty), with Cardano 15 blocks and
  Zcash 60 blocks after NU7.
- Bigger swaps: Zcash depth ≥ max(58, 2 × value ÷ $523) blocks after NU7. Example: $25k needs 96 blocks, about 40 min.

**Why:**
1. **Who can cheat.** With "practical" finality, a party who controls a large share of block production can undo the other
   side's settlement.
   - Today's largest Zcash pool has about 31–33% of the hashrate. I use 35%.
   - The largest Cardano operator has about 12–14% of the stake. I use 15%.
2. **How likely it is (Rosenfeld's exact formula,** checked against a 2026 paper to 4 digits).
   - A 35% Zcash pool undoes 10 blocks with probability 17%, 30 blocks 1.8%, and 60 blocks 0.08%.
   - A 15% Cardano operator undoes 15 blocks with probability 0.0008%.
   - So Zcash depth is the limiting factor. For v1 I require at most 1 in 1,000, which needs Zcash ≥ 58 blocks.
3. **What it costs.** A Zcash rewrite means giving up block rewards: about $1,568 per block today (1.25 ZEC at $1,254.54).
   After NU7, blocks come 3× faster at a third of the reward, so about $523 per block, and the same security takes 3× as many
   blocks (the same wall-clock time).
   - Renting a majority is not possible today. NiceHash offers about 1% of Zcash hashrate. Crypto51 estimates $72k for a
     1-hour attack if it could be rented.
   - Rewriting Cardano needs majority stake, about $2B, but Cardano has no slashing. That is why the Cardano side's protection
     is the low probability, not a cost.
4. **The cap.** The smaller of: half the reward value of the Zcash blocks being rewritten (60 × $523 × ½ ≈ $15.7k), and an
   expected-value bound (attacker gain × probability under one tenth of the forfeited rewards). For rehearsal, a $500 policy
   ceiling applies, because P at 10 blocks is high.

**Uncertainty and limits:**
- Prices and pool shares move. A real wallet must refresh them and refuse when the data is stale.
- A coalition of the top two Zcash pools (over 50%) breaks the model entirely. It covers single entities only.
- NU7 activation is expected at Zcash height 3,543,405 (≈ Nov 5, 2026), but this was not verified on a live chain.
- I invented no numbers. Every input is below.

**Sources** (read Nov 2, 2026 unless noted):
- crypto51.app/coins/ZEC.html: 36 GH/s; NiceHash 388 MH/s ≈ 1%; $72,413 for a 1 h attack.
- zecstats, coinwarz, firsthandbitcoin: hashrate ≈ 30.6–31 GSol/s.
- cryptohall24: 1,440 ZEC/day emission and pool list.
- equihash.com: ViaBTC 31.1%. asicprofit (Oct 30, 2026): ViaBTC 32.9%.
- nicehash.com: Equihash market.
- ZEC $1,254.54 (exa.ai market data); ADA $0.188 (Yahoo Finance).
- ZIP 218 / ZIP 259, and Zebra 7.0.0 release notes: NU7 height, 25 s blocks.
- supercardano / realtap: Coinbase ≈ 12–13%, Nakamoto ≈ 13–14.
- cardanoscan: epoch 663, 4.61M ADA rewards, 21,600 blocks.
- Kovalchuk et al., MDPI Cybersecurity 6(3):80, May 1, 2026.
- Rosenfeld, arXiv:1402.2009 (2014).

## Timing in real minutes (Cardano 15 blocks, inclusion budget 3 blocks, R = 5 min, clock drift 1 min)
| Profile | ZEC funding budget | Go deadline T0 | Bob's last reveal (LAST) | T1 (Alice may refund) | T2 (Bob may punish) |
|---|---|---|---|---|---|
| Rehearsal: Zcash 10 blocks now, or 30 after NU7 | 37.5 min | 53.7 min | 58.7 min | 91.2 min | 123.7 min |
| v1: Zcash 60 blocks after NU7 | 68.8 min | 85.0 min | 90.0 min | 122.5 min | 155.0 min |
| $25k: Zcash 96 blocks after NU7 | 106.2 min | 122.5 min | 127.5 min | 160.0 min | 192.5 min |

All times are from setup. Cardano settlement budget S = 12.5 min. Each window M = 32.5 min (allows one fee or cost-model
change). A normal swap finishes well before T0 + settlement. The table shows worst-case bounds; if things go wrong, funds can
be locked for up to T2 (about 2–3 h).

## Open items
1. Bob's real-world pre-broadcast step: test-run on his own cardano-node, submit only there (spec B.3). Not built yet.
2. A global (on-chain) seen-list for share points (spec A.5); local only today.
3. Coalition attacks beyond the single largest pool or operator.
4. Price-feed and pool-share refresh design (fail closed when stale).
5. Trace-specific script error reasons (needs a script change and re-audit).
6. Residual: a slow Bob clock combined with a long Cardano block gap larger than the 1 min drift. It eats into the settlement
   margin and is not a direct loss. Written up in decisions S5-D5.
7. An independent review of spec v0.4 and the step-5 code. This self-check (selfcheck.md) is NOT independent.

## Next step
An independent review of v0.4 (focused on F1/F2 and the cap model). If it passes, write the rehearsal plan: testnet only, $500
cap, Cardano 15 blocks, Zcash 10 now or 30 after NU7, with Bob's own node doing the pre-broadcast test-run.

## One decision for John
**For v1, choose:**
- **(a)** a ~$15k per-swap cap with Zcash 60 blocks after NU7 (~25 min ZEC wait, ~1.5 h total to T0+settle, up to ~2.6 h
  locked if things go wrong); or
- **(b)** keep the faster ~10-block / ~12 min Zcash wait and accept a much lower cap. At 1-in-1,000 safety that is not
  allowed at all; it would need accepting about a 1-in-6 chance that the largest pool could reverse it, which only makes sense
  for rehearsal-sized amounts.

My recommendation is (a), rounded down to $15,000.

Files: spec.md (v0.4), decisions.md (S5-D1..D12), selfcheck.md (NOT independent), progress.md, model/step5_model.py,
ada/{e2e3,gomsg,nodecheck,valuecap,ed25519_attack}.mjs, zec/src/main.rs, zec/examples/pok_isolated.rs, results/FINAL_*.
