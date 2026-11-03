# ZEUTXO testnet plan: PREPARED, NOT EXECUTED (Mon Nov 2, ~2:25 AM ET; v7 update ~3:15 AM ET, see §0b)

Status: **plan only.** Nothing here has been run. Every phase below needs John's explicit OK first, including Phase R (a local Zcash regtest node on the box with no network and no funds). Throughout: test keys are freshly generated per phase and never the old R1/R2 keys, witnesses or nonces. No mainnet. No real funds. Faucet coins only in Phase T. No GitHub pushes. GGLori stays read-only unless John changes that rule.

Legend: [M] = measured on the box, [E] = estimate, [W] = taken from a web page on Nov 2 and not verified by me.

## 0. Facts that change the plan (found while preparing it)
- **Zcash NU7 is already active on the public testnet** [W: Zakura NU7 dashboard]: 25 s target spacing (was 75 s), a 102-block difficulty averaging window (was 17), testnet NU7 height 4,465,026. **Mainnet NU7 is listed as pending at block 3,543,405, ≈ Nov 5 2026** [W]. The v6 relay contracts and every emulator run so far use the **pre-NU7 mainnet DAA (W = 17, 75 s)**. Before any testnet relay step, the difficulty/time checks in branch_c/header_c must be parameterized for NU7 (window 102, 25 s spacing, the activation boundary). Otherwise honest headers will be rejected. **This also means the relay needs the same change for mainnet within days.** 330 confirmations then take ≈ 2.3 h at 25 s, not 6.9 h, so the H-2 budget (D-53) shrinks accordingly [E]. **D-64: post-NU7 swaps use min_conf 990 (≈ 6.9 h, equal work); the testnet is post-NU7, so testnet T-steps use 990.**
- **Zcash testnet has a minimum-difficulty rule** (a block may use the pow limit when its timestamp is more than 6 target spacings after the previous block). The relay does not implement it, so on testnet it would reject honest min-difficulty headers. It needs either a testnet-only branch (clearly labelled, never deployed on mainnet) or a header window chosen to avoid such blocks, which is fragile.
- **Zebra regtest skips Equihash and PoW checks** [W: Zebra Book, Regtest]. Regtest headers therefore carry no real Equihash solution. Regtest can test the **Zcash transaction side** (X script, C/R, ZIP-244 txids, nLockTime, FROST/adaptor spends) and relay **parsing/inclusion**, but **not** Equihash disputes or difficulty. That gap is closed only in Phase T.
- Zebra regtest supports `generate` / `generatetoaddress` and `sendrawtransaction` over loopback RPC with cookie auth [W].

## 0b. v7 update (Nov 2, ~3:15 AM ET) — still nothing executed on any network
- **T0 is done in the emulator (v7):** NU7 DAA (W 17 → 102, 75 s → 25 s at the activation height; NU7 height is a validator parameter), testnet min-difficulty rule (gap > 450 s ⇒ PoWLimit bits), always-on bits check. Verified [M] against 281 real public Testnet headers across activation 4,465,026 and 215 Mainnet headers (Python model, bit-exact), and in Aiken: lib tests 15/15, full v7 chain 110/110 ledger steps (103 script checks) on Testnet and on Mainnet data; v8 (review-3 fix, D-65..) 117/117 steps (109 script checks) on both [M]. *(Count fixed Nov 2 ~4:30 AM ET; review 3 NEW-L1′.)* **Gap left for T0:** no real min-difficulty block was in the fetched Testnet range, so that rule is covered only by synthetic tests; Phase T must fetch ≥ 1 window containing one (read-only) before relaying.
- **Mainnet NU7 ≈ Thu Nov 5 ~9 PM ET [E]** (4,340 blocks to go at 2:36 AM ET). Any swap whose Zcash window crosses an activation is refused by both parties (off-chain straddle check, D-56).
- **Second review (v6) fixes in v7:** NEW-C1 one-shot lane ids, NEW-H2 since = lower + 10 min max validity interval, NEW-H3 R nExpiryHeight + grace 21 h, NEW-M1 Reveal split (A 56.7 %, B 48.0 % of max tx size [E]). v7 itself is **not yet independently reviewed**; I recommend a review of v7 before any Phase T dispute drill. **Update (Nov 2 ~4:30 AM ET): review 3 found a Critical in v7 (NEW-C1′, forged disputes via a leaked dispute thread token) and a High (NEW-H1′); v8 fixes both in the emulator (D-65..D-69). Phase T must deploy v8 scripts (not v6/v7), and only after a re-review of v8.**
- **Batch size:** v7 registers 24 headers per tx (12.4–12.7 M mem, 88.6–90.5 %) [M]; post-NU7 that is 144 register txs/day ≈ 216 ADA/day [E] (pre-NU7 v6: ≈ 51 ADA/day). Cardano preview faucet budget for a relay drill must cover this.
- **Changed drill rows:** T7 (H-2 drill) now uses grace = 21 h and must include the "R mined at its expiry height" case (S6 in the emulator). Add **T7b**: build R with nExpiryHeight = L_R + D_mine and confirm a Zcash testnet node rejects it above the expiry height (read: `sendrawtransaction` error), and build R′ (no expiry, late lock).
- Machine choice for Phase T (GGLori with a rule change vs. a small VPS) and the Zcash regtest node (Phase R) still wait for John (D-55). No node was started.

## Phase R — Zcash regtest, local only (machine: **box**; needs John's OK)
Resources [E]: zebrad build from source with `cargo build --release -j 2` ≈ 40–70 min, peak RAM ≈ 2–3 GB, ≈ 5–8 GB disk for target/ (the box has 66 GB free and 8 cores; RAM is shared with other agents, ~4.7 GB free now [M]). Running regtest with ephemeral state: < 1 GB RAM, < 1 GB disk [E]. Wall time for all R steps ≈ 3–5 h of work after the build [E].
Isolation: config `network = "Regtest"`, `listen_addr = 127.0.0.1:18233`, `initial_testnet_peers = []`, `[state] ephemeral = true`, `[rpc] listen_addr = 127.0.0.1:18232` with cookie auth. If available, run inside `unshare -n` (no network namespace) so it cannot reach peers even by mistake. Stop the node after each session; nothing persists.

| Step | What | Pass | Fail → action |
|---|---|---|---|
| R0 | Build zebrad (pinned release tag), record version and hash | binary runs `zebrad --version` | stop; report build error; no retries with different flags beyond one fix |
| R1 | Start regtest with NU5..NU7 activation at low heights | `getblockchaininfo` = regtest, height 0, NU7 active by its height | stop node, report |
| R2 | `generatetoaddress 200` to a fresh throwaway transparent key | coinbase mature (≥100 conf), balance visible via RPC | report |
| R3 | Own Rust builder (librustzcash/orchard crates, extending zeutxo-adaptor-proto) shields coinbase → joint Orchard address from a fresh 2-of-2 FROST DKG | tx accepted by `sendrawtransaction`, mined after `generate 1`; note decrypts with the shared IVK | report the mismatch; do not hand-patch consensus fields |
| R4 | Funding tx creates N (Orchard) + X = P2SH(`2 K_A K_B 2 CHECKMULTISIG`) | both outputs mined; X script hash matches the spec | report |
| R5 | Build C and R; compute ZIP-244 txids before and after signing | txid unchanged by signatures/proofs (C and R) | **stop the protocol**: settlement depends on fixed txids |
| R6 | R pre-signed by both (X ECDSA + library FROST on N), nLockTime = L_R | broadcast at height < L_R **rejected**; at ≥ L_R accepted (on a branch that is then discarded) | report: H-1 fix invalid as written |
| R7 | Bob-only spend of X (K_B signature only) | **rejected** by consensus | report: H-1 regression |
| R8 | Adaptor C: Bob's BIP-340 claim (simulated Cardano side) reveals t; Alice completes σ_C and broadcasts C | C mined; afterwards R rejected (input already spent) | report |
| R9 | Export the regtest headers (≥ 330 above C) + txids; run the Aiken emulator ProveC/ProveR with conf 330 using those real regtest txids and inclusion proofs (Equihash disputes **disabled and labelled**, since regtest has no PoW) | ProveC/ProveR accept the real txids; wrong txid/depth negatives rejected | report; no cap changes |
| R10 | Tear down: stop node, delete ephemeral state, record versions/logs in /workspace | nothing left running | — |

What could go wrong in R: the Orchard tx builder or FROST/RedPallas integration (ZIP 312 hook for T_p, open item O1) does not produce consensus-valid signatures; Zebra regtest parameter quirks for NU7; the build is too heavy for shared RAM (cap at `-j 2`; abort if free RAM < 1.5 GB); regtest acceptance ≠ zcashd acceptance [W]; the Halo2 proving key takes minutes on first use [E].

## Phase T — Zcash testnet + Cardano preview, faucet coins only (needs John's OK; machine: **not the box by default**)
Machine choice: Zebra testnet state ≈ 11.4 GiB compressed snapshot (Oct 23) and ≈ 24 GB during restore; ≈ 12 h to sync from zero; 8 GB RAM practical [W: Zebra Book, Sova docs]. The box (16 GB RAM shared by all agents, 66 GB free) could hold it on disk, but a long-running synced node would starve other agents. **Recommendation: a dedicated machine**, either GGLori (only if John lifts its read-only rule and its specs fit: ≥ 8 GB RAM, ≥ 40 GB free) or a small VPS (4 vCPU / 8 GB / 60 GB). **Cardano: no node.** Submit and read through a public preview API (Koios/Ogmios-hosted/Blockfrost-style), which avoids ~20–50 GB disk and 4–16 GB RAM [W]. A full preview node with Mithril bootstrap is the fallback.
Coins: TAZ from a testnet faucet [W]: Valar 0.125 TAZ/IP/day, `npx zcash-faucet` 0.1 TAZ, Fauzec 1 TAZ/address/day. These are third-party services, so use throwaway addresses. tADA from the official preview faucet [W]. **v6 mainnet bonds (bond_p 1,000, bond_c 250 ADA) exceed what a faucet run will likely provide.** Use a separately labelled *testnet parameter set* with scaled bonds (e.g. ÷100); this is a deployment parameter, not a cap raise, and the mainnet set stays as measured. Return leftover coins to the faucets afterwards.

| Step | What | Pass | Fail → action |
|---|---|---|---|
| T0 | Pre-req (box, emulator): NU7 DAA (102/25 s) + testnet min-difficulty branch in the relay; re-run the e2e6 suite + mutants against real testnet headers fetched read-only from an explorer/RPC | all checks as expected on ≥ 3 real testnet windows incl. one with a min-difficulty block | stop: relay not testnet-ready |
| T1 | Restore the Zebra testnet snapshot on the chosen machine, sync to tip | tip within 2 blocks of a public explorer | report |
| T2 | Deploy v6 scripts on preview as reference scripts (testnet params); record script hashes | hashes match `aiken build` output | report |
| T3 | Relay: register/propose/finalize real testnet header batches for ~1 day | checkpoints finalize; tx fees and ex-units recorded [M] vs emulator [E] | report divergence > 10 % |
| T4 | Dispute drill: a fake-hash entry → honest Open on a lane → Timeout → Kill; a ProveLeaf dispute against an honest header must lose (C-1 regression on chain) | as in e2e6 | stop: security regression |
| T5 | Happy swap: tiny TAZ ↔ tADA coop path | both sides complete | report |
| T6 | ProveC path and ProveR path (R broadcast by **Alice** at L_R, H-1) with min_conf 990 (post-NU7, D-64) | escrow pays the right party | stop |
| T7 | H-2 drill: Bob Arms only with a checkpoint ≥ rel_height; Release only after grace; Alice's ProveR during grace wins | as in e2e6 S5/S2 | stop |
| T8 | Reveal tx size on chain (emulator estimate 15,957 B, 97.4 %) | under 16,384 with reference scripts | split Reveal before anything else |
| T9 | Tear down; return coins; write results | — | — |

Time [E]: T0 1–2 days of work; T1 2–3 h with a snapshot (12 h without); T2–T9 ≈ 2–3 days, mostly waiting on W_c (6.5 h), τ (6 h) and 990 confs (≈ 6.9 h at 25 s, D-64).
What could go wrong in T: NU7/testnet DAA mismatch (T0); faucet limits or dry faucets; a preview hard fork or cost-model change altering ex-units; public API rate limits or downtime (the stall-cost model assumes the honest side can submit); testnet reorgs deeper than expected (330 conf covers this); third-party faucets/APIs seeing our addresses (privacy, irrelevant for test coins); Reveal exceeding the tx size limit on chain.

## Approvals John needs to give (separately)
1. Phase R on the box (build zebrad + regtest node, no network, no funds).
2. NU7 relay parameter work (T0, emulator-only; can be done on the box without a node; I recommend this next, given the mainnet NU7 date).
3. Phase T machine choice (GGLori rule change, or a VPS) and the use of faucets/public APIs.
4. External review of v6 before any Phase T dispute drill.
