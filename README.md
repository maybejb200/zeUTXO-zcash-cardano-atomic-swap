# zeUTXO: trustless private atomic swaps between shielded Zcash and Cardano

**A research prototype of a cross-chain atomic swap between shielded Zcash (ZEC, Orchard / "Ironwood" pool) and Cardano (ADA), using adaptor signatures, a cross-group DLEQ proof (Pallas ↔ BLS12-381) and a single Aiken escrow contract.** No exchange, custodian, bridge, oracle, relay or light client is trusted, and the ZEC never leaves Zcash's shielded pool.

Alice has ADA and wants ZEC. Bob has ZEC and wants ADA. They trade directly: either both get paid, or each gets compensated without the other's help.

Keywords: atomic swap, cross-chain swap, Zcash, Cardano, shielded, Orchard, adaptor signatures, scriptless scripts, DLEQ, Farcaster / COMIT style swap, Aiken, Plutus, privacy, DEX.

> **Project status (Nov 12, 2026): paused, not maintained, looking for someone to pick it up.** Everything here runs in a simulator only. It has never moved real funds and has had no independent audit. Do not use it with real money. See [Picking this up](#picking-this-up) for what is done and what is left.

## Where it stands

- **Design:** "Path 1", a Farcaster/COMIT-style adaptor-signature swap. Spec **v0.7** (escrow contract v0.7) is in [`spec/spec.md`](spec/spec.md), with every design decision (D1–D50) in [`spec/decisions.md`](spec/decisions.md).
- **Code:** an Aiken escrow validator for Cardano, a Rust crate that builds split-key Zcash Orchard transactions and the cross-group DLEQ, JavaScript wallet logic and an end-to-end simulator, and Python timing / state models.
- **Validation (simulator only):** 727/727 end-to-end checks in both the simulator profile and the rehearsal profile (NU7, K = 15, Z = 30), the Aiken escrow tests, the wallet-gate probes (13/13, 58/58), the step 10 and step 11 regression tests (21/21, 30/30) and 10/10 proof-of-knowledge checks. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) rebuilds the escrow from source and checks it is byte-identical to the committed script hash.
- **Reviews:** seven AI-run reviews and assessments (`docs/reviews/`). The latest, [review 7](docs/reviews/review7-assessment.md), found no issue in the escrow or the cryptography and gave a conditional pass for a testnet rehearsal; its two wallet findings are fixed. None of these is an independent human audit.
- **Testnet:** a rehearsal on Zcash testnet and Cardano preprod (throwaway keys, faucet coins only) was planned and approved ([`docs/rehearsal/`](docs/rehearsal/)). No testnet results are recorded in this repo.
- **Earlier attempts that failed or were dropped:** R1 (a ZK light client of Zcash on Cardano, archived Sept 10), R2 (paused Sept 27) and an optimistic-relay design v1–v10 (dropped Nov 2). What was tried and why it failed is in [`docs/timeline.md`](docs/timeline.md). That history may save you weeks if you are considering a light-client or relay approach.

## Honesty caveats (please read)

- **Simulator only.** No swap has run on any real chain. The Zcash side uses real libraries (orchard 0.16 / zcash_primitives 0.31, real proofs) checked by a *simulated* node. The Cardano side runs in a local emulator.
- **Internal reviews only.** All seven reviews and assessments were done by AI agents. They were separate passes, but **none is an independent third-party audit.**
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

## Picking this up

If you want to continue this work, these are the open items, roughly in order. Each is described in more detail in [review 7](docs/reviews/review7-assessment.md) and [review 6](docs/reviews/review6-assessment-and-recommendations.md).

1. **Validate `use_qsk` against a real Zebra node.** The ZIP 2005 key derivation for the joint key is our own code. It matches two unofficial third-party vectors but no real node has accepted a transaction built with it. This is the biggest unknown, and a testnet rehearsal ([`docs/rehearsal/proposal-v2.md`](docs/rehearsal/proposal-v2.md) plus amendment 1) is the planned way to check it.
2. **Measure real inclusion and settlement times** on testnet, and check them against the timing model (`src/model/step9_model.py`). Safety depends on honest transactions being mined within the stated bounds.
3. **Split Alice and Bob into fully separate clients.** Step 11 gave each party its own view, state and secret watcher process, but transaction building and UTxO discovery still run in one simulator process.
4. **Remove the leftover absolute paths** (`/workspace/...`) in older scripts and tests so everything runs from a fresh clone.
5. **Design the price feed / value cap** and analyse coalition censorship on Cardano, the main residual risk.
6. **Get an independent human audit** before anything touches real funds.

Good places to start reading: [`spec/spec.md`](spec/spec.md) for the protocol, `src/ada/onchain/validators/escrow.ak` for the contract, `src/zec/src/dleq.rs` for the DLEQ, and `src/ada/e2e9.mjs` for the full flow and its attack scenarios. Related projects and papers are listed in [`docs/prior-art/prior-art.md`](docs/prior-art/prior-art.md).

## Repository map

| Path | What it is |
|---|---|
| `spec/` | Current design: `spec.md` (v0.7), `decisions.md` (D1–D50), step 9 `memo.md`, `selfcheck.md`, `progress.md`, NU7 research summary |
| `src/ada/` | Cardano side (step 9): Aiken validator `onchain/validators/escrow.ak`, emulator/ledger, wallet policies `policy6–9.mjs`, end-to-end simulators `e2e*.mjs` |
| `src/zec/` | Zcash side (step 9): Rust crate for split-key Ironwood txs, DLEQ, simulated node rules (`src/`, `examples/pok_isolated.rs`, `neg_tests.sh`) |
| `src/model/` | Python state-model checkers and timing models (steps 1–9) |
| `tests/feasibility/` | Step 1 crypto feasibility tests: (a) Orchard split-key signing, (b) cross-group DLEQ, (c) first Aiken escrow |
| `tests/step9/` | Wallet-gate behaviour probes (gates8, gates9) |
| `tests/step10/`, `tests/step11/` | Regression tests for the Nov 8 audit, review 6 and the Nov 9 assessment (watchers, per-party view and state) |
| `tests/review1..5/` | The adversarial tests each review wrote (attack scripts, Aiken tests, model checks, the two-phase escrow prototype) |
| `results/` | Selected small result summaries (test tables, logs, JSON), with no keys |
| `docs/timeline.md` | Trial-and-failure history: R1 → R2 → relay v1–v10 → Path 1 steps and reviews |
| `docs/R1-unshielded.md` | R1's unshielded / public-chain successes (Equihash, header proofs, recursive proof) |
| `docs/path1/stepN/` | Memos, specs and decisions for steps 1–8 (code is summarised; only step 9 code is included) |
| `docs/reviews/` | The Path 1 attack reviews 1–5, review 6 (project assessment and recommendations) and the Nov 9 assessment (review 7) |
| `docs/relay-design/` | The superseded relay design: research, architecture, dispute design, reviews v6–v10, v10 report, reflection and plan, decisions log, audit |
| `docs/history/R1`, `docs/history/R2` | Cleaned copies of key R1/R2 summary docs (local paths scrubbed) |
| `docs/prior-art/` | Prior-art notes (Farcaster/COMIT, Athanor, Logos ...) |
| `docs/rehearsal/` | Testnet rehearsal proposals v1 and v2, and amendment 1 (3-hour refund tail) |
| `SECURITY-EXCLUSIONS.md` | What was deliberately left out, and why |

## How to run it (simulator)

Tested with Node 22, Rust stable, Python 3 and Aiken v1.1.24. The quickest way to see exactly what runs, and in which order, is [`.github/workflows/ci.yml`](.github/workflows/ci.yml): CI rebuilds the escrow, checks its hash, and runs every suite below on each PR.

These files were copied from a working tree. Some scripts still use absolute paths from the original box layout (`/workspace/...`) or expect `node_modules`, a built `zec` binary, or a local `aiken` binary, so expect to adjust paths.
- Cardano: `cd src/ada && npm ci && cd onchain && aiken check`; then e.g. `node e2e9.mjs all`
- Zcash: `cd src/zec && cargo build --release && cargo run --release --example pok_isolated`
- Model: `cd src/model && python3 step9_model.py`
- Step 10 (Nov 8 audit fixes), from a fresh clone, after `npm ci` in `src/ada` and `cargo build --release` in `src/zec`:
  - `node tests/step10/fixes_test.mjs` (regression tests for audit findings A1–A4) and `node tests/step9/gates9_test.mjs`
  - `cd src/ada && node e2e9.mjs all` (step 9 sim profile) and `E2E_PROFILE=rehearsal node e2e9.mjs all` (NU7, K=15, Z=30)
  - Review 6 follow-up (R6-M2, R6-M3): `cd src/ada && node e2e9.mjs r10_review6`; its pre-fix output is `results/step10/before_r10_review6.txt`.
  - Summaries are in `results/step10/`. `aiken check` was not re-run in step 10 (the escrow is unchanged).
- Step 11 (Nov 9 assessment fixes W-1, W-2; per-party view and state; CI):
  - `node tests/step11/party_test.mjs` (verified secret watchers, redeemer/input pairing, per-party state, the watcher as a separate process per party)
  - `cd src/ada && node e2e9.mjs r11_decoy`; its pre-fix output is `results/step11/before_r11_decoy.txt`.
  - CI (`.github/workflows/ci.yml`) rebuilds the escrow with Aiken v1.1.24, checks it is byte-identical to `plutus.json` with the pinned hash, and runs every suite above. `e2e9.mjs` and the gate probes exit non-zero on failure.
All keys are generated fresh at runtime. None are stored in the repo.

## License

Released under the [MIT License](LICENSE). Third-party ZIP texts and papers are not included; see the links in `docs/prior-art/`.
