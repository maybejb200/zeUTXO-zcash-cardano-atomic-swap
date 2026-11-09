# zeUTXO

**Research toward a fully trustless, private swap between shielded Zcash (ZEC) and Cardano (ADA).**

Alice has ADA and wants ZEC. Bob has ZEC and wants ADA. They should be able to trade directly: no exchange, custodian, bridge, oracle or relay to trust, with the ZEC kept inside Zcash's shielded pool. Either both get paid, or each gets compensated without the other's help.

## Current status (Nov 3, 2026)

- **Design:** "Path 1", a Farcaster/COMIT-style adaptor-signature swap. Spec **v0.7** (escrow contract v0.7) is in [`spec/spec.md`](spec/spec.md).
- **Validation:** simulator only. Step 9 passes **683/683** end-to-end checks, 76 Aiken tests (71 + 5 review-5 tests), 13/13 + 58/58 wallet-gate probes and 10/10 PoK checks.
- **Reviews:** five adversarial reviews, plus a **Review 6 project assessment & pre-rehearsal audit** in [`docs/reviews/review6-assessment-and-recommendations.md`](docs/reviews/review6-assessment-and-recommendations.md). Review 5 gave a CONDITIONAL PASS; its High finding (H1) and Medium findings were fixed in step 9. Review 6 assesses the overall viability, audits the step 9 wallet code, and details tiered recommendations.
- **Next:** a testnet rehearsal (Zcash testnet + Cardano preprod, throwaway keys, faucet coins only) is approved and starts **after Nov 9, 2026**. See [`docs/rehearsal/proposal-v2.md`](docs/rehearsal/proposal-v2.md).
- **Earlier efforts:** R1 (archived Sept 10, no-go), R2 (paused Sept 27), and an optimistic-relay design v1–v10 (dropped Nov 2). Their history is in [`docs/timeline.md`](docs/timeline.md).

## Honesty caveats (please read)

- **Simulator only.** No swap has run on any real chain. The Zcash side uses real libraries (orchard 0.16 / zcash_primitives 0.31, real proofs) checked by a *simulated* node. The Cardano side runs in a local emulator.
- **Internal reviews only.** All five attack reviews were done by AI agents working on the box. They were separate passes, but **none is an independent third-party audit.**
- **`use_qsk` is not yet validated against real Zebra.** The ZIP 2005 Ironwood key derivation is our own code. It matches two independent but unofficial third-party vectors. No real Zebra node has accepted a transaction built with it yet. The rehearsal is the first test of that.
- Timing safety assumes honest transactions get mined within stated bounds. Censorship of Cardano transactions is the main residual risk; it is bounded, not eliminated.
- Not for real funds.

## Architecture at a glance

```
 Zcash (Ironwood shielded pool)                Cardano (one Aiken escrow, all the clocks)
 ------------------------------                ------------------------------------------
 Bob funds an ordinary shielded note          Alice locks ADA first.
 to a joint 2-of-2 key  ak = a·G + b·G        Datum: A_c = a·G_c, B_c = b·G_c, T1, T2, T3 ...
 (nobody can spend it alone).                  
                                              Claim:  Commit (no secret; disables Refund)
 Cross-group DLEQ proves a, b are the                 → Reveal b  → ADA to Bob   (Escape after T3)
 same scalars on Pallas and BLS12-381.        Refund: Notice (no secret; disables Commit)
                                                      → RefundReveal a → ADA to Alice
 Whoever learns the other's share                     → Forfeit after t4 if Alice never reveals
 holds the whole key and sweeps the ZEC.     
```

- Only one share is ever revealed, because every branch spends the same UTxO. Whoever ends up with the whole key settles the ZEC, so **Cardano never needs to verify Zcash.** There is no relay or light client.
- Secrets are revealed only *after* a secret-free on-chain commitment (Commit/Notice). This defeats the censorship-theft attacks found in reviews 4 and 5.
- The trade-off we accepted: if Alice disappears, Bob is compensated in ADA (Forfeit). He does not get his original ZEC back.

## Repository map

| Path | What it is |
|---|---|
| `spec/` | Current design: `spec.md` (v0.7), `decisions.md` (D1–D46), step 9 `memo.md`, `selfcheck.md`, `progress.md`, NU7 research summary |
| `src/ada/` | Cardano side (step 9): Aiken validator `onchain/validators/escrow.ak`, emulator/ledger, wallet policies `policy6–9.mjs`, end-to-end simulators `e2e*.mjs` |
| `src/zec/` | Zcash side (step 9): Rust crate for split-key Ironwood txs, DLEQ, simulated node rules (`src/`, `examples/pok_isolated.rs`, `neg_tests.sh`) |
| `src/model/` | Python state-model checkers and timing models (steps 1–9) |
| `tests/feasibility/` | Step 1 crypto feasibility tests: (a) Orchard split-key signing, (b) cross-group DLEQ, (c) first Aiken escrow |
| `tests/step9/` | Wallet-gate behaviour probes (gates8, gates9) |
| `tests/review1..5/` | The adversarial tests each review wrote (attack scripts, Aiken tests, model checks, the two-phase escrow prototype) |
| `results/` | Selected small result summaries (test tables, logs, JSON), with no keys |
| `docs/timeline.md` | Trial-and-failure history: R1 → R2 → relay v1–v10 → Path 1 steps and reviews |
| `docs/R1-unshielded.md` | R1's unshielded / public-chain successes (Equihash, header proofs, recursive proof) |
| `docs/path1/stepN/` | Memos, specs and decisions for steps 1–8 (code is summarised; only step 9 code is included) |
| `docs/reviews/` | The five Path 1 attack reviews |
| `docs/relay-design/` | The superseded relay design: research, architecture, dispute design, reviews v6–v10, v10 report, reflection and plan, decisions log, audit |
| `docs/history/R1`, `docs/history/R2` | Cleaned copies of key R1/R2 summary docs (local paths scrubbed) |
| `docs/prior-art/` | Prior-art notes (Farcaster/COMIT, Athanor, Logos ...) |
| `docs/rehearsal/` | Testnet rehearsal proposals v1 and v2 |
| `SECURITY-EXCLUSIONS.md` | What was deliberately left out, and why |

### Running things (simulator)
These files were copied from a working tree. Some scripts still use absolute paths from the original box layout (`/workspace/...`) or expect `node_modules`, a built `zec` binary, or a local `aiken` binary, so expect to adjust paths.
- Cardano: `cd src/ada && npm ci && cd onchain && aiken check`; then e.g. `node e2e9.mjs all`
- Zcash: `cd src/zec && cargo build --release && cargo run --release --example pok_isolated`
- Model: `cd src/model && python3 step9_model.py`
All keys are generated fresh at runtime. None are stored in the repo.

## License

**No license has been chosen. All rights reserved.** Please don't reuse or redistribute this work without permission. Third-party ZIP texts and papers are not included; see the links in `docs/prior-art/`.
