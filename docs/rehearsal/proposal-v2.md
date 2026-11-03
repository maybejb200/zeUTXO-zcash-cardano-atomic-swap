# zeUTXO Path 1: "$500" testnet rehearsal proposal v2 (post-NU7, step 9 code) — for approval, NOT started

Prepared Tue Nov 3, 2026 (ET). Nothing has been installed, synced, funded, signed or sent. **v2 replaces proposal.md**
(kept unchanged for the record). Everything in proposal.md §2–§8 still applies **except where this document changes it**.
Approving v2 means approving only what is written in proposal.md as amended here.

## 1. What changed since v1 of the proposal
- **Code under test is step 9** (review 5 fixes): `step9/ada/policy9.mjs` + `e2e9.mjs` gates. The on-chain escrow is
  unchanged (v0.7, PlutusV3, hash `0ed9e054…0087e0`).
- **Post-NU7 settings, read from the node, not from config** (step 9 M2/M3):

| Setting | Value | Source |
|---|---|---|
| Zcash branch | `0x77190AD9` (NU7) | node `status` RPC, cross-checked with config; mismatch = abort |
| NU7 activation | testnet 4,465,026 (live since Oct 4); mainnet 3,543,405 (~Nov 5) | ZIP 259; node must report the same |
| Block spacing | 25 s nominal; refuse if measured > 1.5× (37.5 s) | node |
| Transactions | v5 or v6 only (v4 invalid after NU7); sweeps use v6 | |
| Node | Zebra ≥ 7.0.0, signed release, SHA256SUMS + sigstore verified | |
| Cardano depth K | 15 blocks | |
| Zcash depth Z | 30 (rehearsal floor; Z from price would be 30 at any ZEC price ≥ $300) | step9_model.json |
| Refund tail | 2 h rehearsal-only `T3_MIN` (declared deviation; script byte-identical) | |
| Bob reveal hold cap | 12 min after Commit settles (10% of the 2 h tail); late cutoff T3 − 34 min; race alarm from T3 − M | D35–D37 |
| Min-ADA | lock ≥ minADA(Refunding datum) + 2 tADA | D43 |

## 2. Timing (from step9/results/step9_model.json, rehearsal K15/Z30, 1.5× slow-block gate)
- Zcash funding budget 56 min; T0 ≈ 84 min; T1 ≈ 119 min; T2 ≈ 166 min; T3 ≈ 239 min after setup.
- Happy claim ≈ 2–3 h; two-step refund ≈ 3.2 h; silent-Alice Forfeit ≈ 5.8 h; Escape ≈ 4 h.
- Whole rehearsal still ≈ 2–3 days wall-clock, mostly unattended. Stop at 5 days.

## 3. Zebra 7.0.0 end-of-support check (asked by John)
- Zebra 7.0.0 shipped Oct 22, 2026 with a shortened 8-week support window → end-of-support ≈ **Dec 17, 2026**, after
  which the node halts by design. A 7.1.0-alpha.0 exists (Oct 30).
- The new blackout gate (D42) refuses any swap whose T3 + 24 h falls after the node's end-of-support height, and refuses
  if that height is unknown. Each rehearsal swap needs < 1 day, so the gate is satisfied until ≈ Dec 16.
- **Effect:** start by **≈ Dec 10, 2026** (5-day cap + 1 day margin) on 7.0.x. If starting later, use the then-current
  stable Zebra (≥ 7.1.0, not an alpha) — that is a version change and needs a one-line re-approval.
- If Zebra halts or an upgrade is announced mid-run: stop rule (new #9 below).

## 4. Changes to steps (proposal.md §4)
- Step 0: also record `status` (tip, nu7_height, branch, spacing, version, EOS height) and check it against ZIP 259 and an
  independent explorer.
- Step 2: re-run the step 9 suites (e2e9, gates9, aiken 76/76) as the baseline.
- Step 8 adds: (c) **Bob hold cap**: hold Bob's reveal with a busy-mempool input and confirm he broadcasts at the cap
  (12 min), not later; (d) **fake Refunding coin**: send a plain payment carrying a Refunding-looking datum to the escrow
  address and confirm Alice's wallet refuses to reveal `a`; (e) **era check**: point the wallet at a config that says
  NU6.3/75 s and confirm it refuses.
- Fee pass criteria use the step 9 table (Commit ≈ 0.320 tADA etc., ±20%).

## 5. Added stop rules (proposal.md §6)
9. Zebra halts, reaches end-of-support, or the node reports a branch/era/spacing that disagrees with ZIP 259.
10. Any gate reports GO-LATE or GO-RACE on a path that should have been GO earlier (a hold-cap failure).

## 6. Costs (unchanged)
$0 in money (faucet coins only, free Koios tier); ~12 GB disk (30 GB peak); 15–20 GB download; Grok Bot usage estimate
6–10% of the plan limit, hard ceiling +15%. Note: usage at the end of step 9 is 58.1%, so +15% would take it to ~73% of
the weekly limit (resets Mon Nov 9, 6:37 PM ET) — consider starting after the reset.

## 7. Approval sentence

> "I approve the zeUTXO testnet rehearsal as written in rehearsal/proposal-v2.md (with proposal.md as amended by it): run on the box only (not GGLori), testing the step 9 code. Install and run a verified Zebra 7.0.x testnet node (≥ 7.0.0, start before Dec 10, 2026) with NU7 branch 0x77190AD9, 25 s blocks, v5/v6 transactions, K=15 and Z=30, with era and branch read from the node. Use Cardano preprod through the Koios public API. Generate fresh throwaway keys that never leave the box. Claim faucet TAZ and tADA only. Use a rehearsal-only 2-hour refund tail. Never touch mainnet. No GitHub actions or outside messages. Stop at 5 days wall-clock or +15% Grok Bot usage, or on any stop rule in proposal.md §6 or proposal-v2.md §5."

Optional add-ons, each needing its own sentence: Blockfrost free sign-up as fallback API; one extra Escape swap with the
full 7-day tail; a newer stable Zebra (≥ 7.1.0) if starting after Dec 10.
