# zeUTXO timeline: what we tried, what worked, what failed, what we learned

All dates are 2026, in America/New_York time. "Sim" means the box simulator or emulator. Nothing here has run on mainnet. Sources are linked for each phase.

---

## Phase 0: transparent HTLC MVP (Sept 5–7), before R1
- **Tried:** a classic HTLC, with an Aiken hash-lock on Cardano and a transparent P2SH/CLTV script on Zcash.
- **Worked:** confirmed public-testnet lock, claim and refund trials, 80 passing checks, and ZIP-243/244 vectors.
- **Failed and why:** it isn't private, because the hash links the two legs and the ZEC is transparent. Its own notes say it is unsafe under indefinite outages.
- **Learned:** the hard part is privacy plus timing, not mechanics.
- Source: `relay-design/audit-2026-11-01.md` §2a. TODO (GGLori): the MVP's own README.

## Phase 1: R1, the completed-payment proof (about Sept 7 – archived Sept 10)
- **Tried:** ADA locks first. Bob pays ZEC to Alice with an ordinary shielded payment. A ZK proof checked on Cardano shows the payment is in the authenticated Zcash chain, and that releases the ADA. This needs a trustless Zcash light client on Cardano, from genesis.
- **Worked (see [R1-unshielded.md](R1-unshielded.md)):**
  - Equihash 200,9 and header checks in Cairo/STWO, including a full Equihash fixture proof (187 s, 1 worker).
  - Equihash as a 26.65M-constraint circuit.
  - A recursive Groth16 verifier proof (2.36M constraints, 102.6 s prove, 4.93 GiB), with a 36/36-test Aiken verifier.
  - An integrated regtest + emulator swap: 25 header proofs, 3 receipt proofs, and claim and refund both working.
  - A confirmed Zcash testnet self-transfer.
- **Failed and why:**
  - The full verifier was modelled at 151–156M constraints.
  - Full-memory setup failed 3× at the 10.5 GB cap.
  - Chunk composition was not authenticated.
  - Staging would need 64–66 Cardano submissions per header.
  - A direct on-chain Equihash check used 19.28B CPU.
  - Genesis bootstrap was impractical.
- **Learned:** a trustless Zcash light client on Cardano is the expensive core. A component pass is not project viability. The "60 %" estimate was retired.
- Sources: `history/R1/PROJECT-DECISION.md`, `history/R1/archive-2026-09-10__README.md`, `history/R1/archive-2026-09-10__NEXT-ROUTE.md`.

## Phase 2: R2, the shared transparent auxiliary input (Sept 10 – paused Sept 27)
- **Tried:** ZEC principal in a 2-of-2 FROST/RedPallas shielded note, plus a small transparent P2SH helper output for the CLTV refund, a pre-signed shielded refund, and an ADA hash-lock.
- **Worked:** M01–M07 completed locally:
  - shielded swap and refund
  - separate signers
  - crash and submission recovery
  - fixed-fee lifetime checks
  - restarts
  - partial-transaction repair

  M08 P2 (separate-UID owners with DKG) was also done.
- **Failed and why:**
  - A withheld-delivery fixture let Bob take the ADA *and* refund his ZEC. The reverse race also exists. Any HTLC-style swap needs a bounded mining-delay assumption, and no numeric residual-risk criterion was ever accepted, so the public MVP was a **NO-GO**.
  - The "stronger settlement" redesign (ADA exits only against an authenticated Zcash outcome) brought back R1's light-client problem.
  - It decomposed into 652 proof positions. Only one leaf and one parent proof were ever produced. The quotient producer finished setup, then hit OOM at a 6.77 GB RSS.
  - On Sept 27, design pass D1 **parked both routes**, R1 direct-header and R2 composition.
- **Learned:**
  - The timing assumption can't be removed, only moved.
  - Most hard blocks were self-imposed: unbounded delay, genesis bootstrap, original-asset refunds, the memory cap, one proof stack.
  - The "original-asset unilateral refund" rule is what forces Cardano to know Zcash state.
- Sources: `history/R2/R2-OPERATING-DECISION.md`, `history/R2/zeUTXO-REVISIT-CATALOGUE.md`, `relay-design/audit-2026-11-01.md` §§2c–4.

## Phase 3: optimistic relay design, v1–v10 (Nov 1–2, box), superseded
- **Tried:** a cheap optimistic Zcash→Cardano header relay (Binocular-style), with Equihash checked only in disputes. Hybrid settlement (D-11): an adaptor-signature happy path, with relay-proof dispute paths (ProveC/ProveR).
- **Version by version** (details are in `relay-design/integration-results.md`, `decisions-log.md` and the `independent-review*.md` files):
  - **v1–v3 (I1–I3):** a settle-v1 escrow on a real Zcash block with a BIP-340 adaptor sig; anchor2 + dispute2; a chained end-to-end emulator run. Step 1 cost test: PASS on cost, but a fraud-proof path is needed.
  - **v4–v5:** an MMR accumulator, compressed headers in the dispute contracts, and DLEQ v2 with mandatory proofs of knowledge (F7). **Review (v5): C-1 Critical.** `ProveLeaf` had no `0 ≤ p < 512` bound, so anyone could "prove fraud" against an honest header. **C-2 Critical:** the single anchor UTxO could be hogged, so disputes were censored. Fixed in v6 (D-49, lanes and paid spends, D-50).
  - **v6:** lanes, checkpoints, Arm/grace. **Review v6 NEW-C1 Critical:** a lane-name collision let an attacker Finalize past an open dispute, giving a permanent fake checkpoint for about 250 ADA.
  - **v7:** NU7 relay rules (ZIP 218 difficulty, 25 s blocks, depth 990), and a RevealA/RevealB split. **Review v7 NEW-C1′ Critical:** the dispute thread token was not unique, so the token leaked and could kill entries or fake checkpoints.
  - **v8:** fix for NEW-C1′. **Review v8 RV4-C1/C2 Critical:** unchecked payee lengths (challenger, owner) made disputes or entries impossible to close, and the relay froze.
  - **v9:** a well-formedness sweep of every datum, redeemer and output. **Review v9 RV5-C1 Critical:** undisputable forged MMR history, so ProveR/ProveC of a txid that was never mined.
  - **v10:** inductive append-only MMR extension (D-77), fuzzer (7,800 cases on the fixed core, 0 violations), Rollback6. **Review v10 RV6-C1 Critical:** unkillable young valid-PoW fork entries capture the relay for good.
- **Why it was dropped:** five reviews in a row each found a new Critical. The relay exists only to arbitrate a Zcash-side race between claim C and refund R, and that race exists only because the Zcash side had its own timed refund. A Farcaster/COMIT layout (2-of-2 key split on Zcash, every clock in one Cardano script) removes the relay, anchor, dispute game and MMR entirely. The cost: if Alice vanishes, Bob is compensated in ADA (Punish/Forfeit), not given back his original ZEC. John accepted that trade-off.
- **Learned:** cost isn't the main problem. Attack surface is. Each layer added to fix a race brought a new class of Critical.
- Sources: `relay-design/reflection-and-plan.md`, `relay-design/v10-report.md`, `relay-design/morning-summary.md`.

## Phase 4: Path 1, a Farcaster-style adaptor-signature swap (Nov 2–3, box sim)

| Step | Spec | What was done | Result |
|---|---|---|---|
| 1 | v0.1 | spec, state model, (a) Orchard split-key signing, (b) cross-group DLEQ Pallas↔BLS12-381, (c) Aiken escrow | GO: model 0 honest losses under bounded delay; 1,664/1,664 Orchard checks; 26/26 bad DLEQ rejected; Refund 2.84 % CPU |
| 2 | — | full sim: real offline Orchard txs + Cardano emulator | 70/70 (happy 32, refund 16, punish 13, setup 9) |
| 3 | v0.2 | review 1 fixes: "go" message instead of co-signing a tx, wider deadlines | 167/167 |
| 4 | v0.3 | L-1: setup proofs bound to a checker-computed swap id (2-round setup, nonces) | 188/188 |
| 5 | v0.4 | review 2 fixes: byte-exact datum check, strict Ed25519, value cap | 269/269; aiken 28/28; PoK 10/10 |
| 6 | v0.5 | review 3 fix: port to **Ironwood** (v6 txs, use_qsk joint key), NU7 gates, congestion model | 360/360 in 28 groups |
| 7 | v0.5 text + step 7 deltas | review 4 fix: two-step **Commit → Reveal** claim with Escape at T1+7 d; premium removed; gates fail closed | e2e3 413/413 after one test-ordering fix; aiken 52/52; mutants 17/17; gates7 42/42; the mirror-image refund-censorship issue was written up (D22(d)) |
| 8 | v0.6 (contract v0.7) | two-step refund: **Notice → RefundReveal / Forfeit**; Punish removed | e2e4 593 checks (591 on the full run, 2 stale expectations fixed); aiken 71/71; mutants 30/30; gates8 58/58 |
| 9 | **v0.7** (contract v0.7 unchanged) | review 5 fixes (wallet only) + post-NU7 update | **683/683** e2e9; gates9 13/13; gates8 58/58; aiken 71 (+5 r5 = 76); PoK 10/10 |

### Attack reviews and their Criticals

| Review | Scope | Critical / top finding | Fix |
|---|---|---|---|
| **1** (Nov 2) | step 2 | **C-1 (Critical):** Alice's go-signature pinned the *whole* Redeem body. A fee-parameter or cost-model change after b was public made Redeem invalid, so Bob lost both legs (reproduced). Also H-1 (Δ must cover rollback depth), H-2 (Zcash finality Z unmodelled), M-1 (go-sign policy bypass), and T1 (DLEQ cross-swap replay). | Step 3: Alice signs a short "go" message naming the escrow, which the script checks, so Bob can rebuild Redeem freely. Step 4: proofs bound to a checker-computed swap id. |
| **2** (Nov 2) | step 4 / v0.3 | **F1 (Critical), hostage:** a malformed but check-passing datum (e.g. t2 as bytes) disabled Punish, so Alice could hold Bob's ZEC hostage and still Refund after T2. F2 (High): a lax Ed25519 evaluator accepted identity / small-order go keys. Vacuous negatives and a seen-registry hex-case bypass were also found. | Step 5: Bob funds only if Alice's datum is byte-for-byte the one he builds himself (13 bad datums refused). Strict Ed25519, go-key validation, a separate node-equivalent check. |
| **3** (Nov 2) | step 5 / v0.4 | **R3-C1 (Critical):** since **NU6.3 (ZIP 258), Orchard is withdraw-only**, so the funding and sweep txs were consensus-invalid on mainnet and testnet. Also H1 (NU7 transition), H2 (Cardano congestion), and H3 (value cap had only 2 blocks of margin). | Step 6: ZEC leg ported to **Ironwood** v6 (branch 0x37A5165B) with a ZIP 2005 use_qsk joint key; NU7 gate and blackout; congestion model; Z ≥ minZ with pool-feed checks. |
| **4** (Nov 3) | step 6 / v0.5 | **F1 (High, theft), censorship:** producers censor Bob's Redeem (the only tx that publishes b) until T1. Alice reads b from the mempool, sweeps the ZEC, then also Refunds. F2: the option premium was a free $105 for Bob. F3/F4: gates failed open. use_qsk matched independent third-party vectors (2/2). | Step 7: two-phase escrow. A secret-free **Commit** turns off Refund, **Reveal** has no deadline, Escape at T1+7 d. Premium removed; gates fail closed. Step 8 closed the mirror image (refund censorship) with Notice → RefundReveal / Forfeit. |
| **5** (Nov 3) | step 8 / v0.6, contract v0.7 | **CONDITIONAL PASS.** No on-chain theft bug. **R5-H1 (High):** Bob's fail-closed Reveal HOLD could last until T3 − M, so about 55 minutes of censorship would take both legs instead of 7 days (reproduced 17/17). M1: Alice could be tricked into revealing a for a fake "refund" coin. M2: era, branch and spacing came from config, not the node. M3: pre-NU7 settings. | Step 9 (wallet only, escrow unchanged): HOLD capped at **90 min** after Commit; unknown inputs → broadcast; warning from T3 − 2 d; race alarm. Alice verifies the coin's provenance; era and branch are read from the node; post-NU7 parameters (branch 0x77190AD9, 25 s). **683/683.** |

- **Learned:**
  - Every review found something the author missed, so self-review isn't enough.
  - The simulator can hide real-chain rules (NU6.3 was found by reading ZIPs, not by tests).
  - Censorship, not cryptography, is the main residual risk, so the design moves secrets *after* a secret-free commitment.
- **Next:** testnet rehearsal approved (`rehearsal/proposal-v2.md`). It starts after Nov 9, on the box only, with throwaway keys and faucet coins, a Zebra 7.0.x testnet node and Cardano preprod via Koios. It will be the first check of use_qsk against a real Zebra.
