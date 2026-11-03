# zeUTXO path 1, step 2: simulator results (plain-English memo)

Mon Nov 2, 2026. Started 7:18 PM ET, final recorded run 7:42 PM ET. Everything ran on the box only: no real chains, testnets, wallets, or network transactions. Every key was a fresh throwaway made during the run.

## Verdict

| Outcome | What happens | Result |
|---|---|---|
| (a) Happy swap | Bob takes the ADA, which reveals his secret half. Alice uses it to take the ZEC. | **PASS** (32/32 checks) |
| (b) Refund | Bob doesn't claim in time. Alice takes her ADA back after T1, which reveals her half. Bob uses it to take his ZEC back. | **PASS** (16/16) |
| (c) Punish | Alice goes silent. After T2, Bob takes the ADA and the ZEC stays locked. This is the trade-off you accepted. | **PASS** (13/13) |
| Setup cheats | Bad or forged proofs and mismatched details at the start. | **PASS** (9/9): the honest party stops before risking anything |

In total there were 70 checks. Every honest step went through, and every one of the roughly 45 cheating attempts was rejected for the intended reason. **I found no design flaw, meaning no way for an honest party to lose funds while messages arrive within the agreed delay.** Full log: `results/e2e-all-2026-11-03T00-42-05-453Z.json`.

## What was built

1. **Real Zcash transactions (offline).** These are genuine shielded (Orchard) Zcash transactions with real zero-knowledge proofs, built with the official Zcash libraries. One locks 0.5 ZEC to an address that neither party controls alone. Another spends it using the combined key, and that spend only works once one party has learned the other's secret half. A small simulated Zcash node checks each transaction the way the real network would: the proof, every signature, the balance, no double spend, and the fee.
2. **Real Cardano transactions (local emulator).** The four transactions are Lock, Redeem, Refund and Punish. They run against the unchanged step-1 Aiken contract, with the time windows (before T1, after T1, after T2) and the on-chain check that each revealed secret matches the published point. The off-the-shelf emulator skips running contracts on submit, so I wrapped it in a stricter ledger. The wrapper re-runs the contract and checks fees, collateral and time windows using mainnet cost settings.
3. **A script that plays out a whole swap** between two simulated people for each outcome. It tries cheats at every stage.

Examples of the cheats that failed:
- a wrong or out-of-range secret;
- claiming too early or too late;
- claiming without the other party's go-ahead signature;
- taking the ZEC with only one half of the key;
- a tampered proof;
- signing the wrong transaction;
- a double spend;
- a refund after a claim;
- a stranger trying Punish;
- a forged or replayed cross-chain link proof;
- the wrong amount of ZEC, or ZEC not yet confirmed deeply enough.

## What it costs (measured)

| Transaction | Size | Fee |
|---|---|---|
| Cardano Lock | 425 B | 0.174 ADA |
| Cardano Redeem | 1,326 B | 0.232 ADA (uses ~2% of a tx's compute budget) |
| Cardano Refund | 1,195 B | 0.225 ADA (~2%) |
| Cardano Punish | 1,160 B | 0.214 ADA (~0.7%) |
| Zcash fund / sweep (each) | 9,165 B | 0.0001 ZEC; proving ≈0.8 s on a laptop-class CPU, checking ≈7 ms |
| Start-of-swap link proof | 61 KB, sent once off-chain | ≈0.5 s to make, ≈0.9 s to check both |

A swap costs about 0.4 ADA plus 0.0002 ZEC in total, whichever outcome happens.

## Two rules the software must follow (logged in decisions.md)

- **Alice signs the go-ahead only after checks.** Before signing, she confirms the right amount of ZEC is locked and deeply confirmed, that the claim expires before T1, and that it doesn't touch her other funds. She sees only the transaction body, never Bob's secret.
- **Bob broadcasts his claim only early enough to be sure it confirms before T1** (at least the delay bound Δ before T1). If his secret became public but the claim expired, Alice could take both coins. This rule is fine for an honest Bob, but it means everything depends on Δ being a true worst case for Cardano inclusion.

I also found and fixed two bugs in my own test tooling (S2-D12 and S2-D13). Neither touched the protocol. All reported results come from runs after the fixes.

## What's still open

- **Real-network behavior wasn't simulated.** That includes Zcash blocks, reorganizations, mempool and expiry, real Cardano congestion, and the two chains' clocks drifting apart. The timing rules carry over, but the actual T0/T1/T2 values (hours, not the seconds used here) have to be set from real-world delays.
- **Someone has to be online.** Alice must be online between T1 and T2 to refund. Otherwise she loses the ADA (the Punish trade-off). Bob must watch for the refund so he can recover his ZEC. In practice that means a watchtower or an always-on app.
- **No independent expert has reviewed the cryptography.** That covers the cross-chain link proof, the key-splitting/negation trick, and the contract. My tests show it behaves correctly. They don't prove there are no subtle mistakes.
- **The two alternative signing modes** (interactive joint signing and adaptor signatures) were only checked for validity. The tested path is "reveal the secret on Cardano, then sign alone".
- A minor step-1 note (D15, whether the time bounds are inclusive) is still open. The tests showed no gap or overlap between the claim and refund windows.

## Recommended next step

Get an independent cryptography and contract review before touching any funds, and alongside it run a test-network rehearsal: Cardano preprod plus the Zcash testnet, with worthless test coins and real-hour timelocks. That rehearsal would cover the real-network items the simulator can't.

## The one decision I need from you

**Do you approve moving to public test networks (Cardano preprod and the Zcash testnet), using only free test coins and fresh throwaway keys, still with no mainnet and no real money?** This is the first step that would send transactions outside the box, so it needs your explicit OK. If you'd rather have the expert review finished first, say so, and the testnet step will wait for it.
