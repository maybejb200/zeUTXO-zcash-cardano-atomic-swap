# zeUTXO prior-art search

Searched 2026-11-03 (America/New_York). Web reads only: no accounts, no posting, no GitHub writes.

Legend: **[opened]** means the page, file or repo was read directly (WebFetch, curl or the public GitHub API). **[snippet]** means it was seen only in search-result snippets, so treat it as unverified. Dates come from the sources themselves; GitHub timestamps are converted from UTC to dates.

## Summary table

| # | Feature | Rating | Closest prior work |
|---|---|---|---|
| 1 | Adaptor-signature swap with shielded ZEC as the scriptless side | **Done before for Sapling. Partial for Orchard/Ironwood** (proposed but not shipped and verified) | ASMR (MerosCrypto, Sapling ZEC↔BTC, 2021). Hanh's Zwap design (2023). ZSwap ZCG grant (Sep 2026, rejected). Atheon Zwap (May 2026, claims disputed). Logos RFP appendix (May 2026) says no published RedPallas adaptor construction exists |
| 2 | Cardano as the scripted side of an adaptor or Farcaster-style swap | **Partial** | IOG CANS (Jul 2026): adaptor signatures, a Plutus validator that verifies BTC Schnorr, presigned timelocked refunds, no Punish. Perun BTC-LN↔Cardano (Catalyst F13, not funded). Everything else on Cardano is HTLC (zkFold, FluidTokens) |
| 3 | Cardano script checks a revealed secret *scalar* via CIP-0381 BLS12-381 builtins | **Not found** (the EVM analogue exists) | Athanor/ChainSafe ETH↔XMR `SwapCreator.sol` checks the revealed secp256k1 scalar on-chain with `mulVerify` (ecrecover trick). No Cardano or BLS12-381 equivalent found |
| 4 | Cross-group DLEQ, Pallas ↔ BLS12-381 | **Not found for this pair.** Generic constructions exist | MRL-0010; COPZ eprint 2022/1593; Serai `dleq` (cross-group, generic); noot/dleq-rs (COPZ); ASMR Jubjub↔secp256k1 DLEq; Atheon claims Pallas↔secp256k1 |
| 5 | Two-phase claim (commit without reveal, reveal with no deadline, long fallback reclaim) against miner censorship | **Partial.** The ingredients are known; this exact claim-side shape was not found | Rapidash (FC 2025, two-step refund plus burn); He-HTLC (NDSS 2023, refund parks in He-Col for *l* blocks); DEMBA (arXiv 2510.20645, two-phase commit/execute); Athanor `Ready`/t0/t1; Farcaster Cancel→Refund/Punish; MAD-HTLC; Timelocked Bribing; Winzer et al. |
| 6 | Escrow-bound signed "go" message checked by the script (not a presigned tx) | **Partial / known pattern** | Athanor `claimRelayer` verifies a signature over `RelaySwap{swap, fee, relayerHash, swapCreator}`, i.e. bound to the swap and contract; Athanor `setReady` is a similar go-signal but is sent as an on-chain call. On Cardano, signed messages bound to an outref are a documented generic pattern (oracle / "unchecked inputs" docs, snippet). Not found in a Cardano swap |
| 7 | Per-swap value caps from reorg cost, plus automatic refusal when one pool is too large | **Value scaling: done before. Pool-concentration auto-refusal: done manually by exchanges, not found inside a swap protocol** | THORChain value-scaled confirmation counting; pyrxd (Radiant) "value-scaled claim burial", fail-closed, Jun 2026; Budish bound; Skyhook thread discussion. Kraken paused XMR deposits when Qubic passed 50% (Aug 2025) |
| 8 | ZIP 2005 `use_qsk` with jointly generated `ak` (FROST / 2-of-2) | **Done before (non-swap)** | ZIP 2005 "Usage with FROST" specifies it; Zafe (FROST t-of-n Ironwood vault, mainnet beta, keys follow ZIP 2005); frost-tools PR #610 (use_qsk vectors, open, Oct 3 2026). Not found used in a swap |

**Closest prior work overall:** (a) the Farcaster / COMIT BTC↔XMR protocol (Gugger, eprint 2020/1126) as the template; (b) ASMR, which already ran that template with *shielded Sapling ZEC* as the scriptless side; (c) IOG CANS, which already has *Cardano Plutus* as a party in an adaptor-signature swap; (d) the ZSwap ZCG proposal (Sep 2026), which is the same Orchard/Ironwood RedPallas-adaptor + FROST 2-of-2 + "like Farcaster" idea, but against an EVM/BTC counter-chain and never funded. No single source combines shielded Orchard/Ironwood ZEC, a Cardano Aiken Refund/Punish script, a BLS12-381 scalar check and a Pallas↔BLS DLEQ.

---

## 1. Adaptor-signature swap with shielded ZEC on the scriptless side

- **ASMR**, MerosCrypto (kayabaNerve). https://github.com/MerosCrypto/asmr **[opened]**. The repo was created 2020-08-16; the ZEC code is from June 2021. It implements the Gugger BTC↔XMR protocol generically, with `src/coins/zec` (Sapling via `zcash_primitives`, a split `ask`), a Jubjub engine, `dl_eq.rs` (bitwise ring DLEq, 251 shared bits) and BTC↔ZEC tests. It is a PoC and unaudited. On 2023-06-15 kayabaNerve wrote in the Zwap thread that he "did shielded ZEC-BTC atomic swaps years ago". **Closeness: high for the ZEC side (Sapling, not Orchard/Ironwood).**
- **Zwap (Hanh)**, forum 2023-06-14. https://forum.zcashcommunity.com/t/zwap-atomic-cross-chain-btc-zec-swaps/44864 **[opened]**. A shielded ZEC↔BTC P2TR adaptor design with the DLEQ proven in zk. The replies criticise MRL-0010 without Schnorr PoKs and recommend COPZ. Design only.
- **ZSwap grant (Stallion Labs)**, created 2026-09-29, rejected by ZCG 2026-10-14. https://forum.zcashcommunity.com/t/zswap-a-shielded-atomic-swap-specification-for-zcash-grant-application-request-for-review/57884 **[opened]**. A RedPallas adaptor via orchard PCZT `apply_signature`, then a FROST 2-of-2 lock plus a presigned timelocked refund, "like Farcaster". strahncryptography raised a frontrunning / miner-bribe objection. **Closeness: very high in concept for the ZEC side; spec only.**
- **Atheon Zwap**, forum 2026-05-27. https://forum.zcashcommunity.com/t/zwap-trustless-shielded-atomic-swaps-for-zcash-early-access/55874 **[opened]**. Claims Orchard-native ZEC↔ETH/Base with a ZwapHtlc EVM contract, a Pallas↔secp256k1 DLEQ and a ProveKit "hashbind" proof, capped at $1–$100 per swap. The forum disputed it (Orchard has no scripts), and the app was reported unreachable by Aug 2026. The whitepaper was not opened.
- **Logos RFP appendix "Zcash atomic swap primitives"** (May 2026). https://github.com/logos-co/rfp/blob/master/appendix/zcash-atomic-swap-primitives.md **[opened, raw]**. States there is no production shielded swap and that "no published paper or code specifically constructs an adaptor pre-signature against Sapling or Orchard spend authorization". Raises the α re-randomization wrinkle. Lists ZBXCAT (2017, transparent HTLC), transparent Zwap (2025), Maya TSS (transparent) and Universal Atomic Swaps (eprint 2021/1612) as the generic framework.
- **Skyhook**, forum 2026-09-26. https://forum.zcashcommunity.com/t/we-just-did-a-fully-trustless-shielded-zec-to-evm-atomic-swap-with-no-new-signing-primitives-and-yes-it-is-programmable/57827 **[opened]**. A different approach: ZIP-244 txid prediction plus an on-EVM Equihash/SPV check. Not adaptor signatures.
- **Ironwood FROST signing exists:** frost-tools issue #591 (2026-07-15) / PR #593 (merged 2026-08-12), a 2-of-3 rerandomized FROST signature authorising an Ironwood testnet spend (tx a5533fe7…487d) **[opened via GitHub API]**. This is relevant because it shows the joint-key Ironwood spend path works with upstream tooling.
- Snippet-only: Zswap (PETS 2022, Midnight; needs a hard fork); transparent Zwap thread 55104 (Apr 2026).

**Verdict:** Shielded-ZEC adaptor swaps were **done before on Sapling** (ASMR PoC). For Orchard/Ironwood RedPallas they are **proposed but not shipped and verified**. A working Ironwood adaptor swap would be a first as far as these sources show.

## 2. Cardano as the scripted side

- **IOG CANS (Cyclic Atomic N-party Swap)**, blog 2026-07-07. https://www.iog.io/news/introducing-the-cans-protocol **[opened]**; repo https://github.com/input-output-hk/cyclic-atomic-swap (created 2026-05-19, README "Trustless Cross-chain Swaps via Adaptor Signatures") **[opened via API/raw]**. A BTC↔ADA (N-party) swap using adaptor signatures, where a Plutus validator verifies Bitcoin Schnorr signatures. Every party holds a fully signed, timelocked refund before locking, and the refunds are staggered. **No Punish branch, no privacy coin, no DLEQ across curves.** **Closeness: high for "Cardano in an adaptor swap".**
- **PolyCrypt/Perun "Secure Cross-Chain Bitcoin Lightning & Cardano Channels"**, Catalyst F13 **[opened]**. Adaptor-signature based, not approved.
- **zkFold "Bitcoin <> Cardano Atomic Swaps"**, Catalyst F14 **[opened]**. HTLC, in progress.
- Snippet-only: FluidTokens `ft-cardano-fluidswaps-sc` (Aiken HTLC); ronakgupta11/cardano-swap; reddit "first trustless Cardano Bitcoin swap on mainnet"; PayMo (eprint 2020/1441) mentions Cardano as a possible Monero-swap partner.
- No Cardano↔XMR or Cardano↔ZEC Farcaster-style (Cancel/Refund/Punish) implementation was found.

**Verdict:** **Partial.** Cardano-in-an-adaptor-swap now exists (CANS). An Aiken script with Farcaster-style Refund/Punish against a scriptless privacy chain was not found.

## 3. On-chain check of a revealed scalar with CIP-0381 BLS12-381

- **Athanor Labs (ex-ChainSafe/noot) ETH↔XMR**: https://github.com/AthanorLabs/atomic-swap (created 2021-10-22) **[opened]**. `SwapCreator.sol` `claim`/`refund` call `verifySecret(secret, commitment)` → `mulVerify`, which checks on-chain that the revealed scalar matches the committed secp256k1 public key, combined with an ed25519↔secp256k1 DLEQ. **This is the direct EVM analogue of feature 3.**
- CIP-0381 and Aiken's stdlib `bls12_381` exist **[snippet]**. The Cardano docs describe BLS signatures, VRFs and credentials **[snippet]**. No swap or adaptor project that uses them to check a revealed scalar was found; the Cardano swaps found use `sha2_256` hashlocks (FluidTokens, snippet).

**Verdict:** **Not found on Cardano.** The idea (verifying the revealed scalar against a curve point on-chain) has an EVM precedent (Athanor).

## 4. Cross-group DLEQ between Pallas and BLS12-381

- **MRL-0010** (Noether, bitwise cross-group DLEQ) **[snippet]**.
- **COPZ**: Chase, Orrù, Perrin, Zaverucha, "Proofs of discrete logarithm equality across groups", eprint 2022/1593 https://eprint.iacr.org/2022/1593 **[abstract opened; PDF blocked by Cloudflare]**. A generic Σ-protocol across groups. A search snippet said it gives BLS12-381 parameters, but I could not confirm this in the PDF.
- **Serai `dleq`**: https://github.com/serai-dex/serai/tree/develop/crypto/dleq **[opened]**. Generic over `ff`/`group`, with an experimental cross-group MRL-0010 variant plus Schnorr PoKs. Benchmarked only on k256/ed25519. Unaudited.
- **noot/dleq-rs** (COPZ implementation, ed25519/secp256k1 examples, learning-only) **[opened]**.
- **ASMR `dl_eq.rs`** (Jubjub↔secp256k1, 2021) **[opened]**.
- Atheon Zwap claims Pallas↔secp256k1 **[forum post opened; whitepaper not opened]**.
- driemworks blog (2023-07-19): same-group BLS12-381 DLEQ only **[opened]**.

**Verdict:** **Not found for Pallas↔BLS12-381.** Generic schemes (MRL-0010 + PoK, COPZ) and generic code (Serai) would cover it, so this is new as an instantiation rather than as a technique.

## 5. Two-phase claim against miner censorship / bribery

Background attacks:
- Winzer, Herd, Faust, "Temporary Censorship Attacks in the Presence of Rational Miners", EuroS&PW 2019, eprint 2019/748 **[snippet + cited in DEMBA, opened]**.
- Tsabary, Yechieli, Manuskin, Eyal, "MAD-HTLC", IEEE S&P 2021, arXiv 2006.12031 **[snippet; summarised in DEMBA/Rapidash, opened]**.
- Nadahalli, Khabbazian, Wattenhofer, "Timelocked Bribing", FC 2021, eprint 2020/774 **[snippet]**.

Defences with a similar structure:
- **He-HTLC** (Wadhwa, Stoeter, Zhang, Nayak, NDSS 2023, eprint 2022/546) **[snippet; mechanism read in DEMBA]**. Bob's refund path first moves the funds into He-Col and reveals `pre_B`. Bob gets them only *l* blocks later, and during that window anyone holding both preimages can burn the funds. This is a **split, delayed refund**.
- **Rapidash** (Chung, Masserova, Shi, Thyagarajan, FC 2025) https://fc25.ifca.ai/preproceedings/126.pdf **[opened]**. The refund is split into "announce intent (reveal `pre_b`) after T1" and then "claim refund T2 later", plus a burn path. A "two-phase preparation" with a third hash `h_c` lets the parties tell a slow deposit from a malicious party. Claimed secure against arbitrary user-miner side contracts. **Closest academic match in spirit.**
- **DEMBA** (Awathare, arXiv 2510.20645, Oct 2025) https://arxiv.org/html/2510.20645v1 **[opened]**. Two phases: parties *commit* by revealing preimages in collateral contracts, then the exchange executes. A censored Alice can burn the deposit. Single-chain only; the author lists cross-chain as open.
- **Athanor ETH↔XMR**: `setReady` → Bob may claim until t1, after which Alice can refund **[opened]**. A go-signal followed by a bounded claim window. It still has a claim deadline.
- **Farcaster**: Lock → Cancel (timelocked) → Refund or Punish (second timelock). RFC 08-transactions https://github.com/farcaster-project/RFCs/blob/main/08-transactions.md **[snippet]**.
- Commit-reveal for front-running (ENS-style) is generic folklore **[snippet only]**.

**Difference:** all of these either keep a hard *claim* deadline (HTLC, Farcaster, Athanor t1) or add collateral and burn/punish games (MAD/He-HTLC, Rapidash, DEMBA). A *claim-side* "commit without revealing, which freezes the refund; reveal with no deadline; very long fallback reclaim" was not found. Rapidash's two-step refund and He-HTLC's delayed refund are the closest mirror images (they split the *refund* rather than the claim).

**Verdict:** **Partial.** The building blocks are published; the specific claim-side construction for cross-chain adaptor swaps appears new. It should be checked against Rapidash's model, including censorship of the *commit* transaction itself.

## 6. Escrow-bound signed "go" message checked by the script

- **Athanor `claimRelayer`** **[opened]**: the contract verifies `ecrecover(keccak(abi.encode(RelaySwap)))` against the claimer, where RelaySwap includes the full `Swap` (so the swap id), the fee, a relayer hash and `swapCreator == address(this)`. This is a signed authorisation bound to the escrow, checked by the script and not presigned. It is used for gasless relaying, not as a go-signal.
- **Athanor `setReady`** **[opened]**: functionally a "go" message, but sent as an on-chain call from the owner, not as a signature verified inside the claim.
- Cardano docs / Plutus `verifySignedMessageConstraints`, "unchecked inputs" guidance: signed messages that include a unique outref to prevent replay are a known generic pattern **[snippet]**.
- Farcaster, CANS and ZSwap all use presigned transactions instead.

**Verdict:** **Partial / known pattern.** Escrow-bound signed authorisations exist on EVM (Athanor) and as a generic Cardano pattern. Using one as the swap's go-signal on Cardano, instead of presigned txs, was not found.

## 7. Value caps from reorg cost; pool-concentration refusal

- **THORChain confirmation counting** https://dev.thorchain.org/chain-clients/utxo.html **[opened]**: "THORChain dynamically delays finality based on transaction value and miner incentives". `blockReward` = subsidy + fees, and ZEC is a supported chain. The formula (confirmations ≈ value / (multiplier × block reward)) was **[snippet]** from the overview page.
- **pyrxd (MudwoodLabs, Radiant SDK)** commit 321dbdf, 2026-06-13 **[opened via API]**: "value-scaled claim burial — fail-closed". The swap coordinator requires burial ≥ ceil(value × factor / reorg_cost_per_block) and refuses at setup unless economic inputs are given. It cites THORChain and a Trail-of-Bits 25%-cost method. **Very close to feature 7, but it scales depth rather than capping value.**
- **Budish**, "The Economic Limits of Bitcoin and the Blockchain" (NBER w24717) **[snippet]**: security spend must scale with the value at stake.
- **Skyhook thread** (Sep 2026) **[opened]**: participants argued that attack cost must exceed reward and that depth should scale with usage.
- Sompolinsky/Zohar confirmation analysis: not re-checked this session.
- **Pool concentration:** Kraken paused Monero deposits after Qubic claimed >50% hashrate (Crypto Briefing, 2025-08-16) **[opened]**; the article does not say whether this was automatic. No swap protocol that automatically refuses based on pool share was found.

**Verdict:** value-scaled finality is **done before** (THORChain, pyrxd). Expressing it as a *per-swap cap*, combined with *automatic* refusal on pool concentration, was not found inside a swap protocol.

## 8. ZIP 2005 `use_qsk` with a jointly generated `ak`

- **ZIP 2005** https://zips.z.cash/zip-2005 **[opened]** (Created 2025-03-31, Proposed). The "Usage with FROST" section specifies this exactly: ak comes from the DKG, participants privately agree on `sk`, and use `use_qsk = true`.
- **Zafe** https://github.com/zafe-cash/zafe **[opened]** (repo created 2026-09-30): a t-of-n FROST shielded vault. "Keys follow ZIP 2005 (quantum-recoverable derivation) for the Ironwood pool". Mainnet beta (Android), unaudited.
- **frost-tools PR #610** (opened 2026-10-03, still open) **[opened via API]**: ZIP 2005 `use_qsk` derivation vectors generated with zafe-core. It notes that `zcash-sign` itself still uses the non-quantum-recoverable `from_sk_ak_…` path.
- Snippet-only: forum thread 58172, "Interoperable FROST co-signing for shielded ZEC".

**Verdict:** **Done before** for FROST multisig wallets (Zafe). Using it for a 2-of-2 *swap* lock key was not found. A swap-specific detail worth noting: under ZIP 2005 every participant learns `qsk`, and the ZIP warns that a quantum adversary holding qsk may steal funds.
