# S1 research summary (web reads only, Nov 2-3, 2026 ET)

Sources: ZIP pages fetched from zips.z.cash (raw copies in this folder: zip-0229/2005/2006/0318/0326/0258/0218/0259/0244/0317/0203 .html/.txt);
crate sources downloaded read-only from static.crates.io (crates.io API listing checked).

## Library status (the important answer)
Published crates DO support building and verifying Ironwood v6 transactions:
| crate | version (date) | what it has |
|---|---|---|
| orchard | 0.16.0 (2026-09-30) | `BundleVersion::ironwood_v3()`, `OrchardCircuitVersion::PostNu6_3` (one VK for Orchard+Ironwood, constrains enableCrossAddress), `Flags::CROSS_ADDRESS_DISABLED`, `NoteVersion::V3` (lead byte 0x03), `FullViewingKey::from_bytes(ak||nk||rivk)` |
| zcash_primitives | 0.31.0 (2026-10-21) | `TxVersion::V6`, `sighash_v6.rs`, `Builder::add_ironwood_spend/output`, `BuildConfig::Standard{ironwood_anchor,..}`, `default_tx_expiry_delta(Nu7)=120` |
| zcash_protocol | 0.11.0 (2026-10-21) | `BranchId::Nu6_3 = 0x37a5165b`, `BranchId::Nu7 = 0x77190ad9`; mainnet NU6.3 3,428,143 / NU7 3,543,405; testnet 4,134,000 / 4,465,026 |
| zebra-chain / zebra-consensus / zebrad | 15.0.0 / 18.0.0 / 7.0.0 (2026-10-22) | NU6.3 + NU7 consensus; Ironwood module; halo2 verifier uses `PostNu6_3` VK; tests for cross-address rejection |
| zcashd | — | does not implement NU6.3 (ZIP 258) |

NOT in any published crate: the ZIP 2005 `use_qsk` key-derivation path (no `qsk`, `rivk_ext`, BLAKE3 qk in orchard 0.16.0,
zcash_keys 0.17.0, pczt 0.10.0 or zcash_primitives 0.31.0). We implement that derivation ourselves from the ZIP text
(BLAKE2b PRF^expand, BLAKE3 derive_key) and feed the result to orchard via `FullViewingKey::from_bytes`. No official
test vectors for use_qsk were found, so that derivation is "spec-implemented, not cross-checked".

Toolchain: orchard 0.16 needs MSRV 1.88; the box had rustc 1.85.1, so rustup stable (rustc 1.99.1) was installed under ~/.cargo (box only).

## Consensus facts used (with ZIP)
- ZIP 258/2006: from NU6.3 Orchard actions MUST have enableCrossAddress=0 (flagsOrchard bit 2 = 0), valueBalanceOrchard >= 0,
  no Orchard coinbase outputs; Ironwood is the live pool; single PostNu6_3 VK for both pools; proof input disableCrossAddress.
- ZIP 229: v6 tx, vgid 0xD884B698; Ironwood bundle after Orchard bundle; anchors move to auth data (sighash does not commit
  to the anchor); signatures commit to the consensus branch id.
- ZIP 2005: use_qsk path: nk = ToBase(PRF^expand_sk[0x07]); ak^P any secure method with ỹ(ak^P)=0; qsk = trunc32(PRF^expand_sk[0x0C]);
  qk = BLAKE3.derive_key("Zcash ZIP 2005 qk-derivation v1", qsk); rivk = ToScalar(PRF^expand_qk[0x0D||ak||nk]). FROST/DKG
  participants MUST agree sk privately. Ironwood notes lead byte 0x03; rcm/ψ/esk derived from ρ.
- ZIP 326: wallets must not send to external Orchard receivers after NU6.3; use_qsk keys must not be generated before NU6.3.
- ZIP 318: Orchard->Ironwood migration in canonical denominations; turnstile amounts public; delays in reference blocks (x3 after NU7).
- ZIP 259 (Proposed): NU7 branch 0x77190AD9; v4 invalid after NU7; v5/v6 unchanged in format but NOT valid across the
  boundary (branch id in sighash); un-upgraded nodes may follow a pre-NU7 branch.
- ZIP 218: 75 s -> 25 s; default expiry delta 40 -> 120; averaging window 17 -> 102 at NU7; with window 17 the spacing
  recovers to <=30 s after ~30 blocks (~21 min) and <=26.25 s after 62 blocks (~36 min); window 102 needs ~6x as many
  blocks (so roughly 2-4 h of slower-than-target blocks); first blocks limited by PoWMaxAdjustDown; activation spacing ~56.8 s.
  Theoretical stale rate at 25 s 3.26%, devnet measured 4.86%. Zebra MAX_REORG_LENGTH raised to >= 600.
  Action limits: global shielded budget 330/block; 330 Orchard, 330 Ironwood, 300 Sapling IO. Crowding the shielded
  budget costs about 0.009-0.0165 ZEC/block at ZIP 317 marginal fee.
- Pool shares (ZIP 218 citing ZecBlock, 21 Oct 2026): Ironwood 83.0%, Sapling 9.6%, Orchard 7.0%, Sprout 0.4%
  (shielded value pools, NOT mining pools; the R3-H3 gate concerns mining-pool hash share).
