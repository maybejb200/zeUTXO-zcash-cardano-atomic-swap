# zeUTXO path 1: independent adversarial review #4 (step 6 / spec v0.5, Ironwood port)

Reviewer: review4 (independent). Box only, simulator only, fresh throwaway keys. step6/ was not modified; all work is in review4/ (a copy of step6 is in review4/work/step6). Times are ET.

## Verdict at a glance
| Area | Verdict |
|---|---|
| **Ironwood port (R3-C1)** | **PASS (sim).** The use_qsk derivation in `joint_keys()` matches ZIP 2005. It **also matches independent third-party vectors** (zafe-core, unofficial): nk, qsk, qk, rivk_ext and the default address, on 2 of 2 complete vectors. The ak ỹ=0 normalisation, branch 0x37A5165B, the PostNu6_3 VK and the 0x03 lead byte are correct. Adaptor, DLEQ and rogue-key: no new issue. Acceptance by a real Zebra node is still unproven (rehearsal item). |
| **ZIP 2005 recovery mode (D3)** | **Not Critical. Low/Info for v1.** The memo overstates it (see F5). |
| **Censorship theft (congestion3)** | **High, still open in step 6.** A structural fix exists: a two-phase **Commit/Reveal** escrow with a no-secret escape at T3. I prototyped and tested it: Aiken 25/25 with 5/5 mutants killed, emulator 70/70. **Recommended. No Bob bond is needed.** |
| **New findings** | 0 Critical, 2 High (the censorship residual, carried over, plus **F2: the premium is a free $105 for Bob**), 2 Medium (fail-open gates), 5 Low/Info. |
| **Privacy** | **PASS.** Ironwood is now the main shielded pool (≈4.2M ZEC, 2026-11-03), so the anonymity set is good. The shared sk exposes nk, rivk, qsk and FVK only to the counterparty (known M-5). |
| **Test integrity** | **PASS with notes.** Rerun: **360/360 checks, 28/28 groups**, fresh keys (rerun-all.log). The corrected expectations are not loosened. Some gate tests can't fail for the case they name (F6, F7). |
| **Move on to writing the $500 testnet rehearsal plan?** | **CONDITIONAL PASS.** Write the plan, but write it for the two-phase escrow (F1). Drop or restructure the premium (F2). Make the gates fail closed (F3, F4). |

---

## Findings

### F1 (HIGH, carried over: R3-H2 residual / congestion3). Producer censorship of the Redeem steals Bob's ZEC. The fix is structural.
**Mechanism (step 6, reproduced by the authors' own CONTROL, congestion3 7/7):**
1. Redeem is the only transaction that publishes b, and it must land before T1.
2. If producers exclude it until T1, Alice reads b from the mempool and sweeps the ZEC.
3. At T1 she also Refunds the ADA.

The redeemBroadcastGate (mempool < 50 %, ≥ 25 % stake reached directly) stops spam, but it does not stop paid censorship. Cardano's mempool is FIFO with no fee market, so Bob can't outbid an attacker either.

**Candidate fixes evaluated (first principles):**
| Design | Theft removed? | Notes |
|---|---|---|
| (a) Bigger M, LAST earlier | No | Only makes the censorship last longer. |
| (b) "Commit/Reveal with a T3 timeout giving the ADA back to Alice" (the step-6 memo §6 idea) **if the T3 path reveals a** | No | Alice already swept the ZEC with her head start. Getting a later doesn't help Bob, because his ZEC is gone. Bob also gets a free option worth about σ√T3, roughly 9 % over 30 days, so this variant would need a Bob bond. |
| (c) Separate reveal channel, or private submission to an SPO | No (trusted) | This moves trust onto SPOs. |
| (d) Reference inputs | No | Reading a UTxO doesn't put b on-chain any faster. |
| **(X) Two-phase: Commit (no secret, before T1) → Claimed; Reveal{b} with no deadline; Alice escapes at T3 WITHOUT revealing a** | **Yes** | See below. |

**Design X:**

| Action | Allowed when | What it does |
|---|---|---|
| `Commit{go_sig}` | Open, Bob signs, go message valid, upper bound ≤ T1−1 | Moves the escrow to the same address with the same value, an inline `phase=1` datum, no scriptRef, and exactly one script input. |
| `Reveal{b}` | Claimed, Bob signs, b·G1 = B_c | No time bound. |
| `Escape` | Claimed, Alice signs, from T3 (e.g. T1 + 7 days) | No secret is revealed. |
| `Refund{a}` / `Punish` | Open only | As before. |

Why it works:
- **Censoring Commit** leaks nothing. The swap aborts: Alice refunds with a and Bob takes his ZEC back.
- **Censoring Reveal** gives Alice b, so she gets her ZEC (her side of the trade). But she can't touch the ADA until T3, and any one honest block before T3 settles Bob's Reveal.
- **A Bob who never reveals** loses his own ZEC forever, because Escape never publishes a. So not revealing is strictly dominated: no free option for Bob, and **no bond needed**.
- **The only residual** is whole-network censorship for days, up to T3. That isn't credible.
- **Side benefits:**
  - R3-M2 (Bob's own-node dry run) drops to Low, because a Reveal that fails phase 2 can simply be rebuilt with no deadline.
  - c1fee/c1cost-style parameter changes stop being safety-relevant after Commit.
  - The T2 Refund/Punish race never touches the Claimed path.
- **New wallet rule:** Bob reveals only after Commit has ≥ K confirmations. A Commit rolled back past T1 can't come back, and Bob has not revealed, so he is safe (tested).
- **Costs:**
  - One extra Cardano transaction.
  - The script grows from 1,214 B to 1,866 B.
  - The script hash changes, so everything on the Cardano side must be rerun.
  - Alice's ADA can be stuck until T3 only if Bob burns his own ZEC to grief her.

**Prototype (review4/):**
- `aiken_twophase/validators/escrow2.ak`: `aiken check` passes **25/25**. The tests cover double satisfaction with 2 escrows → 1 output, value skim, phase kept at 0, T3 rewritten, scriptRef, wrong address, datum not inline, 2 outputs, Commit at T1, no Bob signature, bad go signature, Refund/Punish on Claimed, Escape before T3 or from Open, and Reveal on Open.
  - Mutation check (`aiken_twophase/mutation.log`): deleting each key condition (`n_in == 1`, Refund `phase == 0`, `reference_script == None`, `value == me.value`, Escape `lower ≥ t3`) is caught by exactly its intended test.
- Emulator (`work/step6/ada/e2e_tp.mjs`, StrictLedger + real Ironwood zec binary + node-equivalent Ed25519 overlay): **70/70 checks, 7/7 groups** (`twophase-run.log`, `twophase-results.json`):

| Group | Result |
|---|---|
| `tp_happy` | 13/13. Commit carries no secret. Alice's Refund{a} on the Claimed UTxO is rejected by the script. Reveal settles after T1. Alice sweeps with b. |
| `tp_censor_commit` | 10/10. Commit is censored past T1 and dropped. **b is never broadcast.** Alice refunds and Bob takes his ZEC back with a. |
| `tp_censor_reveal` | 11/11. Reveal is censored until T2 + 10 min. Alice sweeps the ZEC with b, but **Refund{a} at T1 and Escape at T2 are both rejected by the script**. The same Reveal then settles and Bob gets the ADA. |
| `tp_censor_to_t3` | 7/7. CONTROL: only censorship that lasts the whole T3 window lets Alice keep both legs. |
| `tp_commit_rollback` | 9/9. Commit is orphaned after T1 and dropped. Bob's wallet refuses to reveal. Alice refunds and Bob recovers his ZEC. |
| `tp_bob_silent` | 10/10. Escape at T3 with no secret. Bob can't recover his ZEC. A late Reveal hits BadInputs. |
| `tp_commit_cheats` | 10/10. phase=0 output, T3→T1 rewrite, late upper bound and a go_sig over another outref are all rejected by the script. |

**Fix:** adopt X as escrow v0.6 and set T3 = T1 + 7 days. Add the K-deep Commit rule to Bob's wallet. Rerun the whole suite against the new script hash.

### F2 (HIGH, new). The 0.7 % premium (R3-M1 "fix") is a riskless walk-away profit for Bob, and it isn't wired into the flow
- Alice pays the premium upfront, settled K deep, **before** Bob funds. Nothing on any chain makes Bob fund afterwards.
- Bob's dominant strategy against a premium-paying Alice is to collect $105 per $15k (0.7 %) and abort. He has no capital at risk. The per-counterparty exposure counter can't stop this, because counterparties are free to create (Sybil).
- So the premium turns a ~0.5 % option that Alice could abuse into a 0.7 % certain loss that Bob can impose.
- Also, `premiumGate` is only called by 3 pure-function unit tests (`e2e3.mjs` 964–966). `fundZec`/`bobChecksLock` never call it. The "premium 3/3" line in the memo therefore says nothing about the swap flow.
- Repro: `tests/gates_test.mjs` probes P1 and P2.
- A trustless conditional premium would need the Cardano script to see Bob's ZEC funding, which it can't.
- **Fix:** drop the premium for v1. Rely on a short T0, which shrinks Alice's option, plus rate-limiting by counterparty reputation. If a deposit is wanted, make it **Alice's**, held in the escrow datum and paid to Bob only via Punish (it already reaches Bob only if Alice goes silent). Never pay it to Bob before he funds.

### F3 (MEDIUM, new). The value cap fails open, and it prices the swap with hard-coded constants instead of the feed
Repro: `tests/gates_test.mjs`, probes V1, V2, V2b, V3 and V5.
- **V5:** `paramsCheck` computes `usd` from `VC.ZEC_usd = 1254.54` / `VC.ADA_usd` (e2e3.mjs:122, also :845), not from `feed.zecUsd`. The 24 h staleness check guards the feed but not the number actually used. If ZEC doubles, a 10 ZEC ($25k) swap is seen as $12.5k and **accepted** under the $15k cap.
- **V1, V2, V2b:** `usd = NaN`, `feed.zecUsd = NaN` or a missing `zecUsd` → accepted, because `usd > cap` and `usd > ½·Z·NaN` are both false.
- **V3:** a feed dated 30 days in the **future** is never stale.

**Fix:** take usd from the feed's prices. Require `Number.isFinite` and a value > 0 for usd, zecUsd and adaUsd. Refuse when `asOf > now + 5 min`.

### F4 (MEDIUM, new). The NU7 gate fails open on missing or unmeasured data. In the e2e flow the spacing check has no measured data to check
Repro: `tests/gates_test.mjs`, probes N1–N4.
- `nu7Gate` accepts `nu7Height = undefined` or `NaN` (the blackout test is `nu7Height !== null && …`), and it accepts `measuredSpacing = NaN`.
- `zecGate` (e2e3.mjs:220) passes `measured_mean_spacing_s || nominal_spacing_s`.
- The sim's `status` returns a mean of 0.0 when there's no window. In `fundZec` the gate runs right after genesis, so **the "measured" spacing equals nominal on every e2e swap**. Only `nu7-slow` exercises a real measurement.
- A real wallet whose node RPC omits the field, or returns 0, would skip the DAA-recovery check without any warning.
- **Fix:** refuse when any input is non-finite. Require a window of ≥ 12 blocks of real data, and prefer ≥ 48 blocks (12 blocks at 25 s is a noisy 5 min). Drop the `||` fallback.

### F5 (LOW/INFO). ZIP 2005 recovery mode (D3) is not a 2-of-2 → 1-of-2 collapse against a classical adversary
- The live ZIP 2005 (Proposed, read 2026-11-03) says the Recovery Statement requires **both** a SoK^qsk **and** a RedDSA signature under ak. It also says spend authorization stays t-of-n while discrete logs remain hard.
- A counterparty who knows qsk (both parties do, by design: "participants MUST privately agree on sk") can recover alone only if it can **also** break discrete log on Pallas. Such an adversary already breaks the swap without recovery mode: a_c and b_c sit in the Cardano datum, and ak is a Pallas point.
- So this is not Critical, and not even a v1-specific risk.
- **When it could be enabled:** only through a future network upgrade, announced months ahead. Mid-swap, it is a liveness and branch-ID issue of the same kind as NU7.
- **Mitigations:**
  - Generalise the NU7 gate into an "any scheduled upgrade" blackout.
  - Alice sweeps immediately. Notes live only for hours.
  - Keep use_qsk = true. The legacy sk-derived ask isn't possible for a joint key, and the ZIP mandates use_qsk for FROST/DKG keys.
- **Fix:** reword D3 and the memo.

### F6 (LOW). Test labels or paths that don't test what they name
- `nu7` "NU7 at 6000 (> tip + swap window at 25 s (**3,613** blocks) + 1,152)": the code computes `swapBlocks = 4,093`, so 1 + 4,093 + 1,152 = 5,246. The test still passes, but the label and memo §8 are wrong (probe N5).
- `nu7` "100 blocks after activation … refused": the run passes because the **branch** check fires first. The regex accepts `/blackout|branch/`. Probe N6 shows the post-activation blackout does work on its own, so this is only imprecise.
- `refundStartGate({now: NaN})` returns null (probe G1). It is harmless in the flow, because `now` comes from the ledger.

### F7 (LOW/INFO). Documentation integrity
- `memo.md` and `progress.md` both have mtime 00:34:56 ET. They claim the full run "finished ~12:43 AM ET" and the work ended "about 12:50 AM ET", which is later than the files themselves.
- The run they cite (`results/e2e3-all-…05-26-54Z.json`) is from 00:26:54 ET, and FINAL_e2e3_all.json is a copy of it made at 00:33.
- The 360/360 result is real (reproduced here), but the times in the memo shouldn't be trusted. A clock jump around the reported "system restart" is possible.

### F8 (INFO). `use_qsk` now has independent vectors
- step 6 states "no official vectors found". Third-party vectors do exist (zafe-core, "not official").
- `vectors/qsk_vectors.rs` copies `joint_keys()` lines 89–92 **verbatim** (by script) and runs them against 2 complete vectors. All values match, including `FullViewingKey::from_bytes(...).address_at(0, External)` through orchard 0.16.0.
- orchard 0.16.0 (latest on crates.io) still has no qsk API, so the step-6 code remains the only implementation in-tree.

---

## Ironwood port: details checked
- **Derivation vs ZIP 2005 §4.2.3:**
  - nk = ToBase(PRF^expand_sk[0x07])
  - qsk = truncate32(PRF^expand_sk[0x0C])
  - qk = BLAKE3.derive_key("Zcash ZIP 2005 qk-derivation v1", qsk)
  - rivk_ext = ToScalar(PRF^expand_qk([0x0D] ‖ I2LEOSP256(ak) ‖ I2LEOSP256(nk)))

  All match, and the independent vectors confirm them (F8).
- **ak:** σ ∈ {±1} is chosen so that the last bit of repr_P(σ(A+B)) is 0, so `ak.to_bytes()` = I2LEOSP256(Extract_P). That's what the ZIP requires ("any suitably secure method … last bit 0"). The adaptor secret is σ(a+b). Both sides compute σ from the transcript.
- **Branch / VK:** NU6.3 0x37A5165B, PostNu6_3 VK, v6 transactions, Ironwood-only funding. Orchard cross-address spends and inflow are refused (zecnode 30/30, rerun). Coinbase-only lead byte 0x03 (ZIP 258) is enforced, and non-coinbase decryption uses IronwoodDomain.
- **Adaptor / DLEQ / rogue key:** unchanged algebra on Pallas. The PoK binds each share before the sum, and the DLEQ binds A↔a_c. The derived sk comes from both committed contributions, so neither party can steer nk or rivk. No new issue.

## Status of earlier findings (verified, not taken on trust)
Evidence for every row is the review4 rerun (360/360) unless stated otherwise.

| Finding | Status (review4) |
|---|---|
| R1 C-1 pinned Redeem body | Fixed (c1fee 10/10, c1cost 10/10). With X, this stops being safety-relevant after Commit. |
| R1 C2 sim confirms an expired tx | Fixed (c2 8/8). |
| R1 C3 Alice's coins via go-sign | Fixed/moot (c3 8/8). |
| R1 H-1 Δ includes settlement | Fixed (rbredeem/rbrefund 13/13). Adversarial inclusion → F1. |
| R1 H-2 Zcash Z | Fixed (zreorg 8/8). Z = 69 (cap). |
| R1 M-1/M-2 | Moot / fixed. |
| R1 M-3 expiry | Fixed. tip+1+40 is correct (target height = tip+1), and NU7 uses +120 (zexpiry 4/4). |
| R1 M-4 setup-channel confidentiality | Open, documented. |
| R1 M-5 counterparty keeps FVK | Open, inherent. Under Ironwood the counterparty also holds qsk (F5: harmless pre-quantum). |
| R1 M-6 sim gaps | Mostly fixed. New gaps: F4 (spacing never measured in e2e) and the real Zebra node is untested. |
| R1 L-1…L-7 | Hold (l1 21/21, PoK, front-running). |
| R2 F1 datum hostage | Fixed (f1 18/18, hostage 2/2). |
| R2 F2 lax Ed25519 / go key | Fixed in sim (f2 18/18, gomsg 22/22). Node equivalence untested (R3-M2). |
| R2 F3/F4 timing | Fixed (timing 23/23). |
| R2 F5 vacuous tests | Fixed (gomsg is field-isolated with a positive control). |
| R2 F6 value cap | See R3-H3 / F3. |
| R2 F7 hex case | Fixed (seenhex). |
| R2 F8–F14 | Fixed / OK / inherent, as in review3. |
| R3-C1 Orchard withdraw-only | **Fixed (sim)**, verified with independent vectors (F8). Real-node acceptance → rehearsal. |
| R3-H1 NU7 transition | **Fixed with gaps** (nu7 16/16). Fails open on missing data (F4). Label error (F6). |
| R3-H2 congestion | **Partly fixed.** Spam is handled (congestion 11/11, congestion2 8/8). **Censorship is still open → F1 (design X).** |
| R3-H3 value cap | **Fixed with gaps** (cap 15/15). Hard-coded price, NaN, future feed (F3). |
| R3-M1 free option | **The "fix" is flawed** (F2). |
| R3-M2 own-node dry run | Open (needs a real node). Drops to Low under X. |
| R3-M3 T2 race | **Fixed.** T2 ≥ T1 + 1 + R + M is a *tightening* (laterefund 6/6). |
| R3-L1 scriptRef | Fixed (refscript 1/1). |
| R3-L2 Cardano hard forks | Open. Fold it into the generalised upgrade blackout (F5). |

## Censorship-fix verdict
Adopt design X: two-phase Commit/Reveal, no-secret Escape at T3, no Bob bond.
- It removes the theft rather than shrinking the window.
- It is small: one validator, 5 actions, about 40 extra lines.
- It is tested here at both script and emulator level.
- The T3 timeout must **not** reveal a. That variant brings back a free option for Bob and would need a bond.

## Recovery-mode verdict
Low/Info, not Critical (F5). Pre-quantum, recovery still needs a RedDSA signature under ak, i.e. both shares. Handle it with the upgrade-blackout gate.

## Privacy verdict: PASS
- **Anonymity set:** Ironwood holds about 4.22M ZEC, and all new shielded activity lands there (zecstats.org/ironwood, read 2026-11-03).
- **What the shared sk reveals:** sk gives each party nk, rivk, qsk and the FVK. The counterparty can see the note and the nullifier when it is spent, so Bob learns which transaction is Alice's sweep. Every output is built with ovk = None (`zec/src/main.rs:213`, verified), so Bob can't decrypt where Alice's sweep went. That is the known M-5 metadata, and it isn't public.
- **Public on Cardano:** a_c, b_c and one share. None of these appears on Zcash (rk is re-randomised and the proofs are ZK).
- **Fingerprint:** the expiry delta (+40 now, +120 under NU7) must match the dominant wallet's default.

## Test-integrity verdict: PASS with notes
- I reproduced 360/360 (28 groups) with fresh keys in 8 m 46 s.
- The "corrected" expectations (zexpiry tip+1+40, timing T2 rule) are correct and tightened, not loosened.
- Gaps:
  - `premium 3/3` doesn't test the flow (F2).
  - The NU7 spacing gate never sees real data in e2e (F4).
  - Two tests are labelled imprecisely (F6).
  - Memo timestamps are unreliable (F7).

## Fixes, in order
1. **F1:** escrow v0.6 = design X (`review4/aiken_twophase/validators/escrow2.ak` as the starting point). Add Bob's "reveal only after Commit has K confirmations" rule, set T3 = T1 + 7 d, and rerun everything against the new hash. Port the review4 scenarios (`e2e_tp.mjs`) into the suite.
2. **F2:** remove the prepaid premium. If one is wanted, use an Alice deposit inside the escrow, payable only via Punish.
3. **F3/F4:** make all gates fail closed on non-finite inputs or future-dated feeds. Price usd from the feed. Measure spacing over ≥ 48 real blocks with no `||` fallback. Add `tests/gates_test.mjs` to the suite; it must report 0 "FAILS OPEN" except the documented P-items.
4. **F5:** reword D3. Add a generic upgrade blackout (Zcash NU7, recovery-mode activation, Cardano hard fork).
5. **F6/F7:** fix the labels and the memo timestamps.
6. **Rehearsal plan must include:**
   - acceptance of the joint-key funding/sweep by a real Zebra node on testnet;
   - the R3-M2 own-node dry run;
   - the F8 vectors as a CI check.

## Reproductions (all under review4/)
- `rerun-all.log`: full step-6 suite, 360/360.
- `vectors/qsk_vectors.rs`, `vectors/qsk_vectors_result.txt`: use_qsk vs independent vectors, ALL MATCH.
- `aiken_twophase/` (escrow2.ak, `check.json`, `mutation.log`): 25/25, 5/5 mutants killed.
- `work/step6/ada/e2e_tp.mjs`, `nodecheck_tp.mjs`, `twophase-run.log`, `twophase-results.json`: 70/70.
- `tests/gates_test.mjs`, `tests/gates_test.results.json`: 13 of 16 probes fail open (F2, F3, F4, F6).

## Sources (web, read 2026-11-03)
- ZIP 2005 (zips.z.cash/zip-2005, Proposed)
- ZIP 258 (zips.z.cash/zip-0258)
- zafe-core use_qsk vectors (third-party; the values were taken from a search snippet because the page sits behind Cloudflare)
- crates.io orchard versions (0.16.0 latest, no qsk)
- zecstats.org/ironwood
