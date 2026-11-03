# zeUTXO Path 1: "$500" testnet rehearsal proposal (for approval, NOT started)

Prepared Tue Nov 3, 2026 (ET). Nothing has been installed, synced, funded, signed or sent. This document is the whole proposal. Approving it means approving only what is written here.

## 1. Goal and scope

**What it proves.** The step 8 design (escrow v0.7, two-step refund, wallet gates) works on real public test networks, not just our emulator and simulated Zebra:
- **Zcash testnet, real Zebra:**
  - Our `use_qsk` (ZIP 2005) joint key, Ironwood address and RedPallas adaptor signature produce notes that a real node accepts.
  - We can spend them with a v6 sweep.
- **Cardano preprod:**
  - Escrow v0.7 (PlutusV3, hash `0ed9e054…0087e0`) deploys.
  - Every redeemer (Commit, Reveal, Notice, RefundReveal, Forfeit, Escape) behaves as the emulator predicted, with real validity ranges, real slot timing and real fees.
- **Wallet gates:** they refuse what they should, against real chain data.

**What it does not prove:**
- It is not mainnet and moves no real money.
- It is not an outside security review. A fifth independent attack review is still recommended before any mainnet value.
- It cannot test the main threat in the design: censorship by nearly all stake producers (see §8).
- It does not test real counterparties, real price moves or real liquidity.

**Important change since step 8.** The research turned up something that affects the plan:
- Zcash **NU7 is already live on public testnet**, since height 4,465,026. Testnet therefore has **25-second blocks**, and v4 transactions are no longer valid there.
- Mainnet NU7 activates at height 3,543,405, around **Nov 5, 2026**.
- The current node is **Zebra 7.0.0** (Oct 22, 2026). It has a shortened 8-week support window, and a 7.1 is already in alpha.

So the rehearsal must use the post-NU7 profile:
- Branch `0x77190AD9`, which our tool already accepts.
- K=15 Cardano blocks, Z=30 Zcash blocks at 25 s.
- Not the old Z=10 at 75 s profile, which no longer matches testnet.

Phase 1 also has to confirm that our NU7 branch ID and v6 encoding match what Zebra 7.0.0 actually enforces.

## 2. Where it runs

| Option | Disk | RAM | Sync time | Verdict |
|---|---|---|---|---|
| **Zebra 7.0.0 testnet node on the box** | ~10–12 GB of state; ~25–30 GB peak if restored from snapshot | ~2–4 GB | ~1–3 h from snapshot, under a day from scratch | **Yes.** The `use_qsk` check needs our own node. |
| Cardano preprod node on the box | ~20–25 GB (chain DB ≈ 18 GB) | 8–12 GB in practice | Several hours (Genesis mode) | **No.** The box has 8 cores, 15 GB RAM (only about 3–4 GB free, shared with other agents) and 60 GB free disk. |
| **Hosted Cardano API (Koios public tier, or Blockfrost free "Starter")** | 0 | 0 | 0 | **Yes.** Blockfrost Starter: 50k requests/day, 10 req/s, preprod included, no card. Koios has a public no-key tier. Either is plenty. |
| John's PC (GGLori) | – | – | – | **No.** It is off-limits, and key material must never leave the box. |

**Recommendation:**
- Run everything on the box.
- Run our own Zebra 7.0.0 testnet node, using the signed release binary after checking SHA256SUMS and the sigstore signature.
- Use Cardano preprod through **Koios public, which needs no account**. Blockfrost Starter is the fallback, but it needs a free sign-up, which is a separate small approval.
- Validate the Cardano script with our own pinned Aiken/Lucid toolchain, already on the box. No preprod node is needed.
- If the box is short of disk or RAM when we start, stop and ask. Do not move to GGLori.

## 3. Money, stated honestly

- **Test coins are worthless.** TAZ comes from the Zcash testnet faucet (zcashfaucet.jinolabs.xyz, 0.1 TAZ per address per day after a browser proof-of-work). tADA comes from the Cardano preprod faucet. They cannot be sold or converted, and no real funds touch any part of the rehearsal.
- **The "$500" is a simulated cap, not a spend.** It is the value ceiling the wallet gates are configured for in the rehearsal tier, priced at mainnet rates. The gates refuse any swap whose notional value, priced as if the coins were real, is above $500. Real v1 would use $15k. The rehearsal exercises the gate logic at that tier.
- **Real costs:**
  - API: $0 on the free tier.
  - Compute: $0 extra, since the box already exists. Disk use is about 12 GB (30 GB at peak), deleted afterwards on request.
  - Network: about 15–20 GB of download.
- **Grok Bot usage:** step 8 used about 4 points (47.1% → 51.2%). The rehearsal is mostly waiting on blocks plus about 6 working sessions. **Estimate: 6–10% of the plan limit, hard ceiling 15%.**
- **Expected on-chain fees:**
  - Cardano: about 0.18–0.32 tADA per transaction.
  - Zcash: 10,000 zats per fund or sweep.
  - Both are paid in test coins.

## 4. Steps, in order (≈2–3 days wall-clock, mostly unattended)

**Rehearsal tail.** In real v1 the Escape and Forfeit paths wait about 7 days (T3 − T1 = refund tail). The script does not hard-code this. T3 and t4 come from the datum, and "T3 ≥ T1 + 7 d" is a **wallet config value** (`T3_MIN`).
- I propose a rehearsal-only `T3_MIN` = **2 hours**, which gives a 2 h tail. The on-chain script is byte-identical to v0.7.
- This is a declared deviation, and it is logged in every swap record.
- The alternative is to run the full 7-day tail on one Escape swap only. That adds about 7 days and is **not** included in this approval.

| # | Step | Time |
|---|---|---|
| 0 | **Setup.** Verify and install Zebra 7.0.0 and sync testnet. Point the tools at Koios preprod. Generate fresh throwaway keys on the box. Fetch TAZ (1–2 drips) and tADA from the faucets. | 3–8 h (mostly sync) |
| 1 | **`use_qsk` against real Zebra (top open risk).** Derive a joint key and address and fund it with a small TAZ amount. Sweep it with a v6 transaction signed through the adaptor flow, and confirm Zebra 7.0.0 accepts and mines it under the NU7 branch. Run one negative control, a deliberately wrong key or branch, which Zebra must reject. | 1–2 h |
| 2 | **F8 vectors as CI.** Run the independent `use_qsk` vectors (review4 F8) and our derivation side by side, and check that the addresses match what the node and zcash-devtool see. Re-run the PoK and adaptor tests against the step 1 chain data. | 1 h |
| 3 | **Deploy v0.7 on preprod.** Check that the hash equals `0ed9e054…`. Lock a test UTxO and confirm the datum (12 fields, network_id 0) is byte-equal to what the wallet expects. | 1 h |
| 4 | **Happy claim.** Lock → Commit → Reveal; Alice sweeps ZEC with the revealed secret. | ~3 h |
| 5 | **Two-step refund.** Bob never commits: Notice (from T2) → RefundReveal. Alice recovers ADA, Bob recovers ZEC. | ~4–5 h |
| 6 | **Silent Alice.** Bob sends the Notice at T2 and Alice stays silent. Bob Forfeits after t4 only because he never saw `a`. | ~2 h tail + 3 h |
| 7 | **Bob stall / Escape.** Bob commits, then stalls. Alice Escapes after T3. | ~2 h tail + 2 h |
| 8 | **Realistic adversarial cases.** (a) *Censorship stand-in:* hold a signed transaction until just before its deadline and check that the gates (M, Mc, K-deep Notice, now ≤ t4 − M) refuse or allow exactly as specified. (b) *Late Commit* after LAST_COMMIT: wallet refuses. (c) *Rollback:* watch natural testnet reorgs (testnet minimum-difficulty bursts happen) and check that no action fires before K/Z depth. Rollback injection only stays in the emulator. (d) Replay of an old datum or redeemer: script rejects. | ~4 h |
| 9 | **Write-up.** Compare the results with the simulation (step8_model.json, e2e4 results) and produce memo, logs and txids. Then delete or keep the node state, as John chooses. | 1–2 h |

## 5. Pass/fail criteria

| Step | Pass | Fail |
|---|---|---|
| 0 | Node synced to the testnet tip and agrees with an independent explorer; binaries verified | Signature or hash mismatch; cannot sync |
| 1 | The v6 sweep from the `use_qsk` joint key is mined; the negative control is rejected | Rejected, or a mismatch in derived ak/address/branch |
| 2 | All vectors match and the addresses agree with the node | Any mismatch |
| 3 | Script hash equals v0.7; datum is byte-equal | Different hash or datum |
| 4–7 | Each party ends with exactly the expected coins minus fees; the transaction sequence matches the emulator; no unexpected acceptance | Any principal loss on a safe path; any transaction accepted that the emulator rejects, or the reverse |
| 8 | Gates behave as specified; no action before depth | A gate lets through a late or unsafe action |
| fees | Within 20% of the simulated figures (e.g. Commit ≈ 0.320 tADA) | Off by more than 20%, which is investigated and is not by itself a safety failure |

**Overall GO bar** (for "ready for an outside review and a mainnet plan"):
- Steps 1–7 all pass.
- Zero principal loss on any safe path.
- No key material has left the box.
- Every deviation is logged.

Anything less is NO-GO, and the write-up states why.

## 6. Stop rules (stop immediately, report, wait for John)

1. Any loss of principal on a path that should be safe.
2. Any `use_qsk`, address, branch or encoding mismatch with real Zebra. No workaround is attempted.
3. Any transaction accepted that our emulator or spec says must be rejected.
4. Grok Bot usage reaches **+15%** above the starting level.
5. Wall-clock reaches **5 days** from start.
6. Anything that would touch mainnet: a mainnet endpoint, address prefix, network ID 1, a mainnet branch context, or a real-value key.
7. Disk free below 15 GB, or the box under memory pressure that affects other work.
8. A faucet or API asks for an account, a payment, personal data or a captcha that needs John. Stop and ask.

## 7. Safety rules

- **Keys:** fresh throwaway keys only, generated on the box for this rehearsal. Never read or reuse old witnesses, keys, nonces or adaptor secrets from step 1–8 or review 1–4. Every nonce is fresh, and no swap_id is reused.
- **Where key material lives:** it stays only on the box, in `rehearsal/keys/` with mode 600. It never appears in chat, logs, memos, GitHub or any upload. The logs record only public keys, addresses and txids.
- **Mainnet:** none. Testnet and preprod endpoints are hard-coded, and network ID or branch checks abort on mismatch.
- **Scope:** no GitHub actions, no outside messages and no posts. Only these outside interactions happen: the two faucet claims and the Koios API calls. GGLori and John's PC are not touched, and step 1–8 and review 1–4 are not modified (the rehearsal works on copies).
- **Cleanup:** at the end, keys are wiped or kept, as John chooses. Leftover test coins can be returned to the faucet or abandoned.

## 8. Open risks the rehearsal will not cover

- **Censorship by ~100% of stake:**
  - For the whole 7-day tail: censoring a secret-carrying transaction (R-1).
  - For about 55 min: censoring the Refund before T2.
  - These cannot be produced on a public testnet.
- **Real 7-day timing:** the 2 h tail checks the logic, not week-long behaviour such as node restarts, clock drift or API outages over 7 days.
- **Deep rollbacks and adversarial reorgs:** these are tested only in the emulator.
- **NU7 and Zebra churn:** Zebra 7.0.0 has an 8-week support window and mainnet NU7 lands around Nov 5. A later upgrade could change behaviour, so results are tied to the exact versions.
- **The `use_qsk` vectors are third-party**, not official, and orchard on crates.io has no qsk API. A pass shows that one node and one vector set agree, not that the ZIP is final.
- **Economic risks:** mainnet fees, liquidity, price moves during a lockup, and counterparty griefing cost (worst case 7.2 d, about $14 on $15k).
- **No independent review:** a fifth attack review is still recommended.

## 9. Approval sentence

> "I approve the zeUTXO testnet rehearsal as written in rehearsal/proposal.md: run on the box only (not GGLori). Install and run a verified Zebra 7.0.0 testnet node, and use Cardano preprod through the Koios public API. Generate fresh throwaway keys that never leave the box. Claim faucet TAZ and tADA only. Use a rehearsal-only 2-hour refund tail. Never touch mainnet. No GitHub actions or outside messages. Stop at 5 days wall-clock or +15% Grok Bot usage, or on any stop rule in §6."

Optional add-ons, which need their own sentence: a Blockfrost free sign-up as the fallback API, or one extra Escape swap with the full 7-day tail.
