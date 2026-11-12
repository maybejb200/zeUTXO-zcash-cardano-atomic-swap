# Security exclusions

This repository is a curated copy of the zeUTXO working tree on the research box. Before it was made public (Nov 12, 2026), every branch and the full git history were scanned again for keys, seeds, wallet files, tokens, credentials and personal paths; nothing secret was found. The following were **deliberately left out**.

| Category excluded | Examples in the working tree | Why |
|---|---|---|
| Per-run key material | every `runs/` and `runs-*/` dir: `alice/secret.json`, `bob/secret.json`, `reveal.json`, `joint_note.json`, `dleq.bin`, `view.json`, `params.json` | Contains adaptor secret shares (a, b), DLEQ blinders and nonces, viewing keys and note openings. The keys are throwaways, but never publish secret material. |
| Wallet files | `runs/*/bob/wallet.json`, `fund.tx`, `chain.json` | Spending keys, simulated chain state |
| Signing nonces, witnesses, spending keys (sk, nk, ask, qsk), seeds/mnemonics, `.skey`, keystores, `.env`, API tokens, passwords, cookies | none found outside `runs/`; `.gitignore` blocks them anyway | Secret by definition |
| R1/R2 private material on GGLori | testnet wallet keys, DPAPI envelopes, note witnesses, unsafe Groth16 setups / proving keys | Never copied. Only 22 summary `.md` files were copied, then cleaned (see below). |
| Build outputs and caches | `target/` (Rust, ~0.5–0.6 GB per crate copy), `node_modules/`, `__pycache__/`, `build/`, `npm_install.log` | Reproducible; large |
| Duplicated per-step code | `step2/`–`step8/` and `review*/work/` source copies | Superseded by the step 9 code; summarised in `docs/timeline.md` and `docs/path1/` |
| Large raw logs / timestamped run JSONs | most `results/e2e*-<timestamp>.json`, `rerun-all.log`, `mutation*.log`, `review*/sim` | Size and noise. Only small summaries were kept. |
| Third-party documents | `prior-art/*.pdf`, `rapidash.txt`, `SwapCreator.sol`, `step*/research/zip-*.html/txt` | Others' copyright. Linked from the notes instead. |
| Compiled blueprint for old versions | `plutus.json` from steps 1–8 and reviews | Build output. Only step 9's `src/ada/onchain/plutus.json` is kept, so the script hash can be checked. |
| Personal / machine data | Windows user names and home paths in R1/R2 docs and the audit | Replaced with `<WIN_HOME>`, `<WSL_HOME>`, `<user>`. `/workspace/...` and `/home/box/...` box paths were left as they are (generic, no personal user name). |

## What *is* included that looks like key material (reviewed, kept)

- `tests/review4/qsk_vectors.rs`: ZIP 2005 use_qsk cross-check vectors with sk = `0x20..0x3f` and `0x40..0x5f` (sequential-byte test seeds). These are public test vectors published by ZcashFoundation frost-tools / zafe-core. They are not anyone's key.
- `va` / `vb` constants in the Aiken escrow tests (`src/ada/onchain/validators/escrow.ak`, `tests/feasibility/test_c_aiken/…`, `tests/review4/aiken_twophase/…`). `va` is the digits of π. `vb` is a throwaway scalar printed by the step 1 DLEQ test (`results/feasibility/test_b_dleq_run_output.txt`, `AIKEN_VECTOR`) and used only as a unit-test vector for the "revealed share matches commitment" check. It never guarded funds on any chain. **Judgment call:** kept, because removing it would break the validator's unit tests.
- `src/ada/vectors.json`: Ed25519 go-message signature vectors (public keys and signatures only; the signing key is generated fresh by `gen_vectors.mjs` and not saved).
- Hex strings in results and logs: swap ids, simulated txids, public keys, public points, the note commitment / nullifier from a simulated run, and Aiken property-test PRNG `seed` values. All are public by nature.
- R1 testnet transaction ids in `docs/history/R1/` (public Zcash testnet / regtest). They are not secrets. They link only to R1's throwaway test wallets, so they were kept for the public release.

## Scan performed before committing
- `rg` over the whole tree for: `skey|mnemonic|seed|private|secret|BEGIN .* KEY|xprv|xsk|password|api_key|token` and 64+-hex strings near `sk`/`secret`/`nonce`. Every hit was reviewed by hand (results listed above).
- `gitleaks detect --no-git` (v8.21.2) over the working tree, then `gitleaks detect` over the git history.
