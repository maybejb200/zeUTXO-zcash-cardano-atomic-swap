# Step #2b: Risk-limit sheet (delay limit D, deadlines T_A and T_B), recalibrated for NU7

Mon Nov 2, 2026 ~12:15 AM ET. **John picks D. This sheet does not pick it for him.**

## 1. Verified inputs

| Input | Value | Source |
|---|---|---|
| NU7 mainnet activation | height **3,543,405**, "planned for around November 5". Testnet has run NU7 since height 4,465,026. | [ZF, Zebra 7.0.0 release (Oct 22, 2026)](https://zfnd.org/zebra-7-0-0-release/) |
| Zcash block spacing after NU7 | **25 s** target (was 75 s), ZIP 218 | same |
| v4 transactions | invalid after NU7; v5/v6 still valid | same; [ZIP 259](https://zips.z.cash/zip-0259) |
| Testnet lesson | "bursts of competing blocks could leave a node stuck on a losing branch" (fixed in 7.0.0) | same |
| Zcash depth practice (pre-NU7) | Coinbase: 110 confirmations; nodes refuse rollbacks of 100+ blocks; no 51% attack observed | [ZecSec](https://defuse.ca/zecsec/zcash-51-percent-attack.htm) (Coinbase PSA blocks bots; cited via the earlier research) |
| Cardano | k = 2160 blocks ≈ 12 h hard bound (implies ~20 s average blocks); practical 10–20 blocks; exchanges 15–30 | [Cardano consensus](https://developers.cardano.org/docs/developers/curriculum/fundamentals/consensus-and-ouroboros/), [CPS-0017](https://cips.cardano.org/cps/CPS-0017) |

**Key NU7 recalibration, two models.** Source: [ZIP 218](https://zips.z.cash/zip-0218), fetched this session.
- **Attacker controls a fixed share of hashrate.** ZIP 218 says shorter spacing "can reduce confirmation latency by nearly the same factor" when blocks propagate fast. So a similar *block count* (e.g. 110 confirmations, now ≈46 min) gives roughly similar safety. It's slightly worse because the expected stale rate rises: theoretical 3.26%; 4.86% measured on a 99-node devnet, vs 0.4% today.
- **Economic / hash-rental model.** An attacker pays per unit of *work*, so the old 110-block work margin needs **330 post-NU7 blocks (≈2.3 h)** [analysis]. ZIP 218 itself notes that under economic models the mean waiting time stays "roughly the same".
- **Node rollback limit.** `MAX_REORG_LENGTH` rises from 99 to "at least 600" blocks after NU7, about 4.2 h; Zebra keeps 1,000. So nodes will *follow* reorgs of up to 600+ blocks, and no swap deadline should rely on the old "nodes refuse 100+ block rollbacks" rule.
- **Wallet expiry.** The default expiry delta becomes 120 blocks, which matters for R2's pre-signed transactions.
- **Difficulty averaging window.** It grows from 17 to **102** blocks; the median span of 11 is unchanged. This matters for the relay in step 1.

## 2. Definitions
- **D:** the longest time you assume between "an honest party must act" and "that party's fee-paying transaction is mined", on either chain. It includes watcher reaction time, being offline, and congestion. **If any required action takes longer than D, someone can lose funds.**
- **t1:** the moment Alice's ADA escrow is S_C deep (protocol phase 4 done).
- **S_C:** Cardano depth Bob needs before T_A. **Z:** Zcash depth Alice needs for C before T_B. **W_B:** Bob's normal working window.
- **Height error allowance:** T_B is a Zcash *height*, while T_A is Cardano *POSIX time*. Allowance = 10% of the interval + 30 min [assumption, to replace with measured post-NU7 block-time variance].
- **Formulas:**
  - `T_A = t1 + W_B + D + S_C`; Bob must submit his claim by `T_A − D − S_C`.
  - `T_B = T_A + D + Z + allowance`, converted to height at 25 s/block.

## 3. Three candidates (my arithmetic, ESTIMATES)

| | **D1 = 1 h ("fast")** | **D2 = 6 h ("balanced")** | **D3 = 24 h ("conservative")** |
|---|---|---|---|
| Cardano depth S_C | 15 blocks ≈ 5 min (practical) | 180 blocks ≈ 1 h | 2160 blocks ≈ 12 h (true immutability) |
| Zcash depth Z (funding and claim) | 110 blocks ≈ 46 min (same count; fixed-share model) | 330 blocks ≈ 2.3 h (same work; economic model) | 330 blocks ≈ 2.3 h |
| Bob window W_B | 30 min | 1 h | 2 h |
| **T_A after t1** | **≈ 1.6 h** | **≈ 8 h** | **≈ 38 h** |
| Gap T_B − T_A | ≈ 2.6 h | ≈ 10.4 h | ≈ 33 h |
| **T_B after t1** | **≈ 4.2 h ≈ 602 blocks** | **≈ 18.4 h ≈ 2,653 blocks** | **≈ 71 h ≈ 10,256 blocks** |
| Happy-path time (Bob claims early) | about Z_fund + S_C + minutes ≈ 1 h | ≈ 3.5 h | ≈ 14.5 h |
| Worst-case capital lock | Bob's ZEC ~4 h, Alice's ADA ~1.6 h | ~18 h / ~8 h | ~3 days / ~1.6 days |

### What each risks
- **D1:**
  - Loses funds if any required tx is delayed more than 1 h: congestion spike, ZIP 317 fee too low, laptop asleep, ISP outage.
  - 110 post-NU7 blocks is fine against a fixed-share attacker per ZIP 218, but costs a hash-renter only ⅓ of today's 110-block reorg, so H3 is more exposed.
  - Fits the 30-minute aspiration best; needs always-on watchers on both sides.
- **D2:**
  - Tolerates an overnight outage or a short chain halt.
  - Keeps the old Zcash work margin.
  - Exposure: a free option for the party who moves second (whoever can walk away if the price moves) over ~8 h; capital locked up to ~18 h.
- **D3:**
  - Tolerates a day-long outage, and Cardano's full 12 h immutability.
  - Largest free-option and price risk (~1.6 days), slow user experience, multi-day refunds.
  - Still not safe against delays above 24 h; no finite D is.

## 4. Hazard table (which party loses if D is exceeded)

| Hazard | Trigger | Loser | Guard |
|---|---|---|---|
| H1 | Bob's claim shows *t* but is not mined by T_A | Bob | submit by T_A − D − S_C |
| H2 | Alice's C not mined before T_B | Alice | gap ≥ D + Z + allowance |
| H3 | Zcash reorg removes C after T_B | Alice | Z blocks deep before T_B |
| H4 | Cardano rollback removes Bob's claim after T_A | Bob | S_C deep before T_A |
| H5 | Fee too low for a pre-signed C or R (no rebuild possible) | Alice (C) or Bob (R) | fee headroom; see spec O4 |

## 5. How to replace the assumptions with data (after NU7, testnet only, no funds)
- Measure the post-NU7 block-interval distribution and the testnet inclusion delay at ZIP 317 fees, over 1 week.
- Pull Cardano block-depth and rollback statistics.
- Then replace the 10% + 30 min allowance and confirm Z.

**Decision for John:** pick D1, D2 or D3, or another value, plus which Zcash depth model applies: same *count* (110 blocks, ZIP 218's fixed-share view) or same *work* (330 blocks, the hash-rental view).
