# zeUTXO — Reflection and next-steps plan (2026-11-02)

_Tags: [M] measured or quoted from project docs, [E] estimate or reasoning, [W] web (read this session)._

## 0. The short answer

- **[E] The relay is probably not needed.** It exists only because the current design gives the Zcash side its own timed refund (R/R′ with nLockTime, plus the transparent helper X). Then two Zcash outcomes, claim C or refund R, can compete, and Cardano has to learn which one won. A Farcaster/COMIT-style layout removes any refund on the Zcash side. The Zcash coins sit under a plain 2-of-2 *key split*. All the clocks (redeem, cancel/refund, punish) live in one Cardano script, and each party ends up holding the *whole* Zcash key or never gets it. **Cardano then never needs to know anything about Zcash.** The relay, the anchor, the dispute game, the MMR, and every one of the six Critical classes disappear, because the code that had them is gone.
- **What it gives up [E]:** "the ZEC holder can always get his *original* ZEC back by himself, however long the ADA holder is gone". In the Farcaster layout, if the ADA holder disappears during the refund window, the ZEC holder is paid in **ADA**, through the Punish branch. That isn't the ZEC back. The project's old "original-asset unilateral refund" rule (audit §4.1 item 7; shortlist route "R5: Cardano reveals a missing key share. **Rejected.**") is the one property that forces Cardano to know Zcash state. **That is the decision John has to make (§8).**
- **What doesn't change [M, from the docs]:** every design, including the relay, still assumes "an honest party gets a transaction mined within a known window". The audit itself says the relay "doesn't actually remove timing assumptions … the cost went up by orders of magnitude, but the kind of assumption didn't change" (audit §4.1.3). The Farcaster layout keeps that assumption on **one** chain, Cardano, which has deterministic fees and validity intervals. It no longer stretches across two clocks.
- **Recommended first step (§7):** a paper-and-box-only step of about ⅓ of a weekly budget. (1) Write the Farcaster-mapped protocol as a ~1-page state machine. (2) Model-check it in a small Python or Quint model against 6 safety properties and 2 liveness properties. (3) Settle the two remaining crypto questions (Pallas↔BLS12-381/secp256k1 DLEQ, and Orchard key-share mechanics) with small tests. **Pause relay work** until that is done.

## 1. Step back: is the relay needed at all?

### 1.1 Why the relay was introduced (the chain of reasons, from the docs)

1. **Orchard notes have no scripts and no working timelock [M+W].** Audit roadblock #1: "Zcash shielded notes have no scripts or time-locks … refunds need joint custody, a transparent helper input, or off-Zcash logic." A web check confirms a subtle detail: **Zcash enforces `nLockTime` only if some transparent input has a non-final sequence number. A shielded-only tx is always "final", whatever lock time it carries** ([W] [zcash/zips#539](https://github.com/zcash/zips/issues/539); Zebra `lock_time_has_passed` returns OK when `tx.lock_time()` is `None`). That is the real reason the design needs the transparent helper output **X**: without a transparent input, the pre-signed refund R's `nLockTime = L_R` would do nothing.
2. **So the design copied the HTLC shape of R2 [M].** The ZEC holder (Bob) locks first, picks the secret t, and keeps a *timed Zcash-side refund* (R, later R′). This creates two competing Zcash outcomes, C and R, raced against a Cardano deadline. The hazards come from that race (risk sheet §4): **H1** (Bob's t shows in the mempool but his claim misses T_A), **H2** (Alice's C misses T_B, so R wins and Bob keeps both), **H3** (a Zcash reorg flips C→R), **H5** (a pre-signed fee is too low and can't be rebuilt). Roadblock #3 (two clocks drifting apart) also comes from it.
3. **"Safe under arbitrary delay" + "original-asset unilateral refund" [M].** R2 was asked for asset preservation "despite arbitrarily long post-disclosure delay" (audit §4.1.1). Penalty or collateral designs were rejected "as not proving original-asset recovery" (audit §4.2). Route R5, "Cardano reveals a missing key share", was **Rejected**. That is precisely the Farcaster layout.
4. **D-11 (hybrid settlement) [M]:** "Removes the H1/H2 time races … residual trust is the relay's." In other words, the ADA should follow whichever of C or R was mined. Cardano can only know that by verifying Zcash, so it needs a header relay, then an anchor, a dispute game, an MMR, fork choice, and so on.
5. **Then the patches piled up [M].** R needed a bounded expiry and the backup R′ (D-60, nExpiryHeight). X lost its CLTV branch (D-51, H-1). The Arm/grace timers needed dispute delay added (D-53, then grace 6 h → 21 h). min_conf went 330→990 for NU7 (D-64). Each patch came from that same race.

**Bottom line [E]:** the relay is there to arbitrate a **Zcash-side race between C and R**. That race exists only because the Zcash side was given its own timed refund.

### 1.2 The Farcaster/COMIT layout mapped onto Cardano + Orchard

Roles (keeping zeUTXO names): **Alice holds ADA** (scriptable chain, the COMIT "BTC" role). **Bob holds ZEC** (scriptless chain, the COMIT "XMR" role).

**Keys (fresh per swap) [E]:**
- Bob samples a Pallas scalar share *b*, and Alice samples *a* (both < 2^252).
- The joint Orchard spend-auth key is `ak = a·G_P + b·G_P`. Both parties know the shared `nk` and `rivk`, so both can *watch* the note, but neither can *spend* it alone.
- Each party publishes the matching point on the Cardano-checkable curve (`A_c = a·G_c`, `B_c = b·G_c`) with a **cross-group DLEQ proof** that it is the same scalar on Pallas. This is the only piece of new cryptography, and Farcaster does the same thing for ed25519↔secp256k1.

**Order of play [E]:**
1. Alice locks ADA in a Cardano script **first**. The script has three time zones, no Zcash data, and no relay:

   | Branch | When | Who | Effect |
   |---|---|---|---|
   | **Redeem** | before T1 | Bob, with Alice's "go" signature over this outref | Redeemer **reveals b**. Script checks it matches B_c. ADA → Bob |
   | **Refund** | T1 … T2 | Alice | Redeemer **reveals a**. Script checks it matches A_c. ADA → Alice |
   | **Punish** | after T2 | Bob | ADA → Bob (Alice failed to refund. Bob's ZEC stays frozen, so the ADA is his compensation) |
2. Bob checks the escrow (script hash, datum, value; the D-52 check already exists) and funds an **ordinary Orchard note** to the joint address.
3. Alice checks the note with the viewing key at depth Z, then gives Bob the "go" signature. In COMIT this is the encrypted redeem signature.
4. Bob Redeems and reveals b. Alice now knows a+b, **and only Alice does**. She sweeps the ZEC whenever she likes. **There is no Zcash deadline, no pre-signed Zcash tx, no X, no nLockTime and no nExpiryHeight.**
5. If Bob never redeems: after T1 Alice Refunds and reveals a. Bob now knows a+b, and only he does, so he sweeps his ZEC back.

Why Cardano no longer needs to see Zcash [E]: a script can't be paid twice. Redeem, Refund and Punish all spend the same UTxO, so **at most one share is ever revealed**. Whoever ends up with the whole key is the only one who can move the ZEC. Ending up with the key *is* the settlement, so nobody has to prove anything about Zcash to Cardano.

### 1.3 Hazard-by-hazard comparison [E]

| Hazard | Current hybrid (v10) | Farcaster layout on Cardano |
|---|---|---|
| H1: secret shows in mempool, tx misses deadline | becomes relay assumptions (one honest relayer, watcher within W, dispute stalls) | **Still there, on Cardano only:** Bob must land Redeem before T1. Mitigation: submit by T1 − D, or the 2-step "commit then reveal" below |
| H2: Alice's ZEC claim misses a Zcash deadline | relay + Arm/grace 21 h | **Gone.** No Zcash deadline exists |
| H3: Zcash reorg flips C/R | 990-conf depth enforced by relay | **Mostly gone.** Only the *funding* depth Z before Alice's go-signature matters, a pure consensus (51%) assumption, like Farcaster's XMR confirmations |
| H4: Cardano rollback | S_C depth | same |
| H5 / O4: pre-signed Zcash fee too low | open item | **Gone on Zcash.** The sweeper builds a fresh tx with any fee. Cardano fees are deterministic |
| Cross-clock drift (roadblock #3) | bounded by relay + allowances | **Gone.** Only Cardano time is used |
| Zcash privacy | transparent P2SH X marks the tx as a swap | **Better.** Funding and sweep are ordinary Orchard txs. Nothing transparent |
| Linkage on Cardano | salted txid commitments; txid revealed on disputes | revealed scalar share only. Not linkable without the other share and α [E; to check] |
| Liveness duties | relayer + watcher + Alice ProveR within grace | **Alice: be online once in [T1, T2]** if Bob didn't redeem (else Punish). **Bob: redeem before T1** |
| Attack surface on Cardano | branch/anchor/dispute/MMR/settle: thousands of lines, 6 Critical classes | **one ~100–200 line validator** with 3 branches [E] |

**Optional "commit then reveal" refinement [E]:** step A, `Commit` (Bob, before T1, reveals nothing) moves the escrow to a Committed state that disables Refund. Step B, `Reveal(b)`, is due before T3 ≫ T1, say days later. If Bob never reveals, Alice reclaims after T3. Bob's tx is time-critical only in step A, and step A leaks nothing if it fails. That shrinks the H1 window from hours to days. It is a tuning knob, not a different design.

### 1.4 What the Farcaster layout gives up, precisely [E]

1. **Original-asset recovery for the ZEC holder without the ADA holder's help.** If Alice goes silent during [T1, T2], Bob gets **ADA (Punish)**, not his ZEC back. This is exactly the property the project rejected route R5 over. It is also the **only** property I can find that forces Cardano to know Zcash state. Stated precisely: *"Bob must be able to recover his ZEC itself without any action by Alice, and ADA settlement must depend on which Zcash tx was mined."* Once a Zcash-side timed refund exists, there is a Zcash-side race, and Cardano has to arbitrate it.
2. **One party must stay online during a window.** Alice during [T1, T2] in the refund case; Bob before T1. These are the same kind of duty the relay design has (watcher within W, Alice ProveR within the 21 h grace). Under Farcaster they sit on one chain and can be sized in days.
3. **A punish branch.** Someone can lose money through their *own* inaction. Protocols like this treat that as normal; the old R2 rules did not.

**Residual risks that remain [E]:** cross-group DLEQ soundness (a broken DLEQ means theft; see self-review F7); bugs in Orchard key-share handling (ak sign/ỹ normalization, re-randomizer α); the funding depth Z against rented hashpower; Cardano censorship longer than D; the free option for the second mover (price risk while T1 runs); and the go-signature step (Bob depends on Alice for liveness only, not safety, because Refund then Punish still pays him).

### 1.5 A middle option that keeps original-asset recovery without a relay [E]

**"Farcaster + long Zcash backstop":** drop Punish. Refund stays open after T1 with no T2. Add a pre-signed Zcash refund R′ with nLockTime **days after T1**. This needs the transparent X again, because shielded-only nLockTime is not enforced. If Alice vanishes, Bob takes his *own* ZEC back via R′ once L_R′ passes. If Bob redeemed (b revealed before T1), Alice must sweep before L_R′: a race again, but with a window of several days, and a *self-inflicted* one (she holds the full key the whole time). Cardano still needs no Zcash data: Refund only reveals a, which is harmless once the note is gone. Cost: X brings back the transparent fingerprint and the pre-signed fee problem (O4) for R′ only. This is the same R′ trick already accepted in D-60, minus the relay.

## 2. If a relay really is needed: the minimal standard design

Only relevant if John keeps "original-asset unilateral refund *and* ADA must follow the Zcash outcome" (see §8).

**The reference design [W]:** Binocular, the Bitcoin oracle on Cardano. It "maintains a binary tree of competing forks and automatically selects the canonical chain using Bitcoin's chainwork calculation. Blocks achieving 100+ confirmations and 200+ minutes of on-chain aging are promoted to the confirmed state", under "a 1-honest-party assumption" ([whitepaper](https://raw.githubusercontent.com/lantr-io/binocular/main/Whitepaper.md)). It starts from a deep checkpoint. Three differences from zeUTXO v10:
1. **Fork choice is by heaviest chainwork across all known forks.** v10 instead compares only with its *own queue tail* and drops entries by age. That is RV6-C1.
2. **Every header is fully checked on-chain.** Bitcoin's SHA-256d is cheap. Zcash's Equihash is not: 19.28B CPU [M, audit]. So for Zcash the PoW check has to be optimistic, behind a fraud proof. That is the one genuinely Zcash-specific complication.
3. **Age only promotes a block. It never protects a block from being displaced by a heavier fork.**

**Even smaller option, which I'd prefer if a relay is ever needed [E]: a per-swap "SPV contest", not a global relay.**
- The two swap parties sign a recent Zcash checkpoint into the swap datum at setup. This is trust-free, because both parties agree to it and it only affects their own swap.
- In a dispute, a claimant posts a header segment from that checkpoint, which can be split across txs, plus a tx inclusion proof at depth ≥ min_conf.
- During a contest window, the counterparty may post a **heavier** segment (more total work) from the same checkpoint, or a fraud proof against one header's Equihash. The heaviest valid segment wins. This is the classic proof-of-proof-of-work "contest" pattern (NIPoPoW-style).
- **No global anchor, lanes, queue, MMR, dispute tokens or relayer economy.** One state thread per swap, two players.
- Cost [E from M]: 990 post-NU7 headers at 8 headers/tx and ≈1.4 ADA/tx [M] ≈ 124 txs ≈ **170 ADA per contested proof**, paid only in disputes and refundable to the winner from bonds. Difficulty-adjustment checks over the 102-block window [M, risk sheet] add to that. Unmeasured.

**Which of the six Critical classes disappear [E]:**

| Critical class | Global relay with heaviest-work (Binocular-style) | Per-swap SPV contest | Farcaster layout (no relay) |
|---|---|---|---|
| Recreatable lane names | possibly remains (if lanes/tokens kept) | **gone** (no lanes) | **gone** |
| Leaked dispute tokens | remains in kind (any token-thread design) | mostly gone (one thread token, minted at swap open, burned at close) | **gone** |
| Unchecked key-hash / payee lengths freezing payouts | remains (well-formedness is universal) but small surface | small surface: 2 known payees fixed at setup | trivial: 2 payees fixed at setup |
| Old history not inductively bound (MMR) | reduced if every header links by hash to a checkpoint, no accumulator | **gone** (straight hash-linked segment from the checkpoint) | **gone** |
| Valid fork capture by queue/age | **gone** (heaviest work wins) | **gone** | **gone** |
| Equihash validity (fraud game) | remains | remains, but 2-party only | **gone** |

(The brief counts six Critical classes. The sixth row, Equihash validity, is the fraud-game surface behind the others. [M] RV6-C1 is the fork-capture finding in `zeutxo-independent-review-v10.md`.)

## 3. Process lessons: why Criticals kept appearing, and what verification fits

**What happened [M, from reviews v5–v10]:** six reviews in a row each found a Critical. Every fix added guards; the v10 mutant run covered 59 guards [M]. The invariants document came *after* the code (v10 INVARIANTS.md), and review 6 showed one of its liveness claims (L4, "an honest relayer can always Propose a heavier branch eventually") was simply false. Most reviews before v10 were by the same agent that wrote the code.

**Why [E]:**
1. **Wrong layer for the problem.** A relay is a *consensus protocol*: fork choice, liveness under an adversary who chooses the order of moves, economic stalls. Scenario tests and mutants only check the attacks someone already thought of. The Criticals were all *protocol-level* (who can block whom, what history is bound) and showed up as code bugs.
2. **Fix-forward on a growing state machine.** Each patch (lanes → tokens → WF sweep → MMR induction → rollback) added state, and the new state added new interactions. When Criticals keep moving one layer deeper, the abstraction itself is usually the problem. That is a signal to step back, not to patch again.
3. **Liveness was never checked adversarially.** RV6-C1 is a pure liveness attack: "keep one young valid entry queued forever". An explicit-state model checker finds that kind of bug in seconds, because "eventually honest work wins" fails on a short loop.
4. **The requirement was never written as testable properties.** "Trustless" was a word, not a list of "no honest party loses X if every honest tx lands within D".

**Method that fits (in this order) [E]:**
1. **Properties first.** One page of safety and liveness properties per protocol, with the delay bound D as a parameter. For the Farcaster layout, for example:
   - S1: an honest party never ends with neither asset.
   - S2: at most one ZEC key share is ever revealed.
   - S3: an honest Alice never loses ADA without being able to take the ZEC.
   - S4: an honest Bob never loses ZEC without getting the ADA.
   - L1/L2: each honest party finishes within a bounded time.
2. **An abstract state model before contracts.** Two parties, honest or adversarial; a mempool the adversary can read; tx delay ≤ D; time ticks. Exhaustive search over a small bounded model. Use **Quint** (TLA+-family, npm install, has a random simulator and Apalache/TLC back ends) or, at zero install cost, a **~200-line Python breadth-first explorer**. Also run with **D unbounded**, so the model *prints the exact traces where someone loses*. That gives John the residual-risk statement the audit says was never written down.
3. **Contracts derived from the model.** Each validator branch is one model transition. Tests are generated from model traces (model-based testing). The existing fuzz oracle idea (v10) is good: point it at the model as the oracle.
4. **Mutation + fuzzing last,** as a check on the code against the model, not as the main way to find protocol bugs.
5. **Independent review of the model and properties,** which is cheaper and higher-leverage than a review of 2,000 lines of Aiken.

## 4. The open adaptor items O1–O4, and how to settle them cheaply

Under the Farcaster layout, **three of the four mostly disappear [E]**:

| Item | Current design | Farcaster layout | How to settle cheaply (paper / small box test) |
|---|---|---|---|
| **O1 FROST adaptor hook** | needed: T_p added to the FROST group commitment | **Gone.** No adaptor signature on Zcash. The winner of the key sweeps the note with an ordinary single-signer RedPallas signature over `rk = ak + α·G` | Box test (Rust, reuses `redpallas_adaptor` / `reddsa`): additive shares a,b → ak; apply Orchard's ỹ-sign normalization (negate both shares if needed); sign with (a+b)+α; verify against rk with `reddsa`. Pass = verifies and the wrong-share/negation cases fail. ~30 min |
| **O2 BIP-340 parity** | needed (even-y R and P) | **Gone if** Cardano checks the revealed share as a plain scalar with the Plutus V3 BLS12-381 G1 builtins (`bls12_381_G1_scalarMul` + equality; CIP-381) instead of a BIP-340 adaptor. **If BIP-340 adaptors are kept** (existing code), it remains | Paper: write the parity rule in 5 lines. Box: (a) 20-line Aiken validator that checks `b·G1 == B_c`, measure mem/CPU in the emulator; pass = < 5% of the per-tx budget. (b) If BIP-340 is kept, a 1,000-iteration random test of adaptor sign→complete→extract with both parities |
| **O3 Cross-group DLEQ** | needed (Pallas↔secp256k1), own Python, unreviewed; self-review F7 found a theft bug | **Still needed and now the single critical primitive.** Pallas↔BLS12-381-G1 (or ↔secp256k1). Scalars must be < 2^252, which is below all three group orders (Pallas 2^254.0, BLS r 2^254.86, secp 2^256) [M, calc] | Paper: write the soundness argument the MRL-0010 way (per-bit ring signatures, blinders summing to zero in **both** groups, a shared challenge, a transcript binding both points + swap id + generators). Box: negative-test suite (blinder sum ≠ 0 = F7, bit ∉ {0,1}, scalar ≥ 2^252, swapped generators, replayed transcript) where all must reject, plus 1,000 random honest proofs that must accept. Then **one** outside cryptographer review of ~3 pages; this is the only external review needed |
| **O4 Fees on pre-signed txs** | C and R pre-signed with fixed fees, no CPFP | **Gone on Zcash** (sweep tx built fresh at sweep time). Cardano fees are deterministic | Only for the §1.5 backstop variant: R′ fee = ZIP 317 15,000 zat for 3 logical actions; 10× headroom is just 0.0015 ZEC [E, calc]. Paper only |

**New small items the Farcaster layout adds [E]:**
- **O5:** how to import or construct an Orchard spend from raw (ask, nk, rivk) rather than from a 32-byte `sk`. ZIP 312 FROST tooling already does this, via the orchard crate's FROST-oriented key constructors. Check the API by reading the orchard crate docs; build nothing.
- **O6:** rogue-key protection for the additive split. Each party must prove knowledge of its share, which the DLEQ already does, *before* the other reveals its point. Decision D-42 already covers rogue keys and has a demo [M].
- **O7:** the go-signature. Ed25519 via `verifyEd25519Signature` over (msg_tag ‖ outref), or simply require Alice's pkh as a co-signer of Redeem. Paper only.

## 5. Ranked candidate paths

Usage is given as a fraction of one weekly usage budget (the morning summary says the last week's budget was used up by the overnight relay run, v5→v10, which is roughly "1 week ≈ 1 overnight relay iteration series") [E]. Hours are agent wall-clock.

| # | Path | Expected payoff | Cost | Key risk | Pass / fail test |
|---|---|---|---|---|---|
| **1** | **Farcaster-on-Cardano (FoC): paper spec + state model + crypto micro-tests** | **Very high.** If it passes, the whole relay/anchor/dispute stack (and its ≈216 ADA/day relay running cost, an [E] figure in the morning summary) becomes unnecessary; the remaining trusted-nothing design is ~1 small validator + 1 DLEQ | **≈ ⅓ week**, 4–6 h | John doesn't accept "Punish instead of original-asset refund" (§8); DLEQ soundness | **Pass:** the exhaustive model shows S1–S4 hold for every adversary when every honest tx lands within D, and the only losses with D unbounded are the *expected* ones (Bob's Redeem stuck past T1; Alice offline through [T1,T2]); BLS G1 check < 5% of tx budget; the Orchard share-sign test verifies; all DLEQ negative tests reject. **Fail:** any loss trace with delays ≤ D, or a share-handling mismatch that can't be fixed on paper |
| **2** | **FoC + long Zcash backstop R′ (no Punish), §1.5** | High. Keeps "original ZEC back without Alice" with no relay | +≈ 0.1 week on top of #1 (same model, one extra branch), 1–2 h | Brings back the transparent X fingerprint and one pre-signed fee; Alice must sweep within days | **Pass:** model shows Bob never loses ZEC without Alice's help when L_R′ − T1 ≥ D_long, and Alice's only exposure is failing to sweep for D_long (days). **Fail:** any trace where Bob ends with both, or Alice loses with delays ≤ D_long |
| **3** | **FoC build-out (after 1 passes):** Aiken validator + emulator tests from model traces; offline-built Orchard sweep tx from a+b (librustzcash, no node) | High: an end-to-end testnet-ready prototype, the first in the project's history with a shielded leg and no trusted party | ≈ 1 week, 1–2 days | Orchard/librustzcash API friction (O5); compile time | **Pass:** all model traces replay in the emulator; offline Orchard tx built and its signature verifies; mutants on the ~3 branches all killed. **Fail:** O5 needs a fork of the orchard crate |
| **4** | **Relay rescue, model-first:** replace the global optimistic relay with the per-swap SPV contest (§2): heaviest work from a swap-agreed checkpoint | Medium. Only valuable if John insists on "ADA follows the Zcash outcome" | ≈ 1–2 weeks; model 0.3 week first | Equihash fraud game + difficulty checks stay deep; ~170 ADA per contested proof [E] | **Pass:** a Quint/Python model with ≥ 1 honest party shows "heaviest valid segment wins within the contest window" and no capture loop; per-header cost measured. **Fail:** any capture/stall loop in the model |
| 5 | Keep patching v10 → v11 (heaviest-work fork tree in the global relay) | Low. The trend says the next review finds a next-layer Critical | open-ended, ≥ 1 week per iteration | complexity grows faster than assurance | not recommended until #1 is decided |

**Not recommended right now:** the validity-proof light client (Zoro/STWO→Groth16). It is the end-state *only* if a relay is required, and §1 says it probably isn't.

## 6. Why I rank FoC first (sanity check against the "trustless" goal) [E]

- **No third party, no committee, no oracle, no checkpoint, no trusted setup.** The assumptions are only Cardano consensus, Zcash consensus (funding depth Z), the discrete-log assumption plus DLEQ soundness, and "each honest party gets one Cardano tx in within D". The audit's own working definition of "fully trustless" is "no party beyond the two chains' consensus, plus one honest watcher, with a numeric delay bound written down" (research §0) [M]. FoC meets it **with no watcher at all**: each party watches only its own swap.
- **Precedent:** this is the deployed BTC↔XMR design (COMIT xmr-btc-swap, Farcaster), where Monero, like Orchard, has no scripts. Orchard is *easier* than Monero in one respect: Zcash already has RedPallas/FROST tooling for split spend keys (ZIP 312).
- **Upgrade path, as the brief asks:** FoC is not a relaxed-trust stepping stone. It is trustless under a written delay bound. If John later wants original-asset refunds, path #2 adds that with no relay. Only if he wants *both* original-asset refunds *and* zero sweep duty does path #4 come back. Every piece of FoC (DLEQ, Orchard share handling, model) is reused in #4.

## 7. Recommended first step (fits ≈ ⅓ of a weekly usage budget; box only)

**"FoC go/no-go pack". Four bounded pieces, in order, each writing to a new file and modifying nothing that exists:**

1. **Spec (≈ 45 min):** `zeutxo-foc-spec.md`, one page.
   - Keys (a, b, A_P, B_P, A_c, B_c, nk/rivk agreed by commit-reveal, the ỹ-sign rule).
   - Order of play.
   - The 3-branch Cardano script with T1/T2 (and the optional Commit/Reveal).
   - The §1.5 variant as an appendix.
   - Properties S1–S4, L1–L2 written as testable sentences.
2. **Model (≈ 1.5–2 h):** `zeutxo-foc-model/` with a Python explicit-state explorer (zero installs). Use Quint only if `npm i -g @informalsystems/quint` works in < 5 min.
   - Actors: Alice and Bob, each honest or adversarial.
   - Adversary powers: reads the mempool, delays any tx up to D (or unboundedly in "stress" mode), chooses the order of moves.
   - Output: "all properties hold for delay ≤ D" plus a printed list of loss traces when delay is unbounded. **That printed list is the residual-risk statement** the audit says was never written down.
3. **Crypto micro-tests (≈ 1.5 h)**, reusing existing box code:
   - (a) Rust/`reddsa`: additive Orchard key share → sign with (a+b)+α → verify against rk; include the ỹ-sign negation case.
   - (b) Python DLEQ negative suite (F7 + 4 more) and 1,000 honest proofs.
   - (c) A 20-line Aiken validator checking `b·G1 == B_c` with the BLS12-381 builtins; measure mem/CPU in the emulator.
4. **Memo (≈ 20 min):** `zeutxo-foc-go-no-go.md`, with pass/fail per §5 row 1 and the residual-risk traces in plain English.

**Stop rules:** no relay code, no new contracts beyond the 20-line measurement, no nodes, keys or network. If the model finds a loss trace with delay ≤ D, stop and write it up; don't patch around it in the same run.

## 8. The one decision John needs to make

> **If the ADA holder goes silent during the refund window, is the ZEC holder OK being compensated in ADA (Farcaster "Punish") instead of getting his *original* ZEC back by himself?**

- **Yes → no relay is needed.** Go with path #1 (then #3). The relay work (v5–v10) is archived as research. The Zcash leg becomes fully shielded, with no transparent X.
- **"Original ZEC, but a multi-day sweep duty for the ADA holder is fine" → path #2.** Still no relay; it costs a transparent helper output.
- **"Original ZEC back *and* no time-bounded duty at all" → a relay is unavoidable.** Use path #4, the per-swap heaviest-work SPV contest, model-first, not v11 of the global relay. Note that even then the relay design still carries a timing duty (watcher within W, ProveR within grace) [M, audit §4.1.3]. No design reaches "safe under unbounded delay".

My recommendation [E]: **Yes**, i.e. accept Punish, because the alternative buys no real reduction in timing assumptions and costs orders of magnitude more surface.

## 9. Confidence and caveats

- [E] The FoC argument is a paper argument from one short session. It has not been model-checked. That is exactly what step 7.2 does.
- [W] The nLockTime finding (not enforced on shielded-only txs) comes from zcash/zips#539 and Zebra's `lock_time_has_passed`. It explains why X was needed, but it doesn't affect FoC, which uses no Zcash timelocks.
- [E] The "revealed share is unlinkable" privacy claim assumes the other share and α stay private. Check it in the spec.
- [E] Usage fractions are guesses calibrated only on "the v5→v10 run used a full week".
- Sources read: architecture-v1, step2 spec, risk sheet, audit (§2–§5), research §0, decisions log (D-11, D-41/42, D-51..D-83 skim), review v10 (RV6-C1), v10 report, morning summary. I skimmed reviews v6–v9 only through the decisions-log and summary references, not line by line.

_Status: complete (first full pass)._
