# Step #3: Zcash light-client proving benchmarks (read-only research)

Written Sun Nov 1, 2026, ~11:55 PM ET. Web and repo research only. I contacted no one and posted nothing.

**Verdict: INCONCLUSIVE, leaning FAIL for now.** No published per-header proving time, RAM figure or full-history cost exists for any Zcash header prover (Zoro or a zkVM). The pass criterion from the research report needed those figures ("genesis→checkpoint ≤ 1 week CPU on 63 GiB, Groth16 wrapper plausible"), so it can't be evaluated from public data. Per the report's own fail rule, this track is **parked**: the relay (#1) starts from a trusted checkpoint until better data exists.

## 1. Zoro (StarkWare-Bitcoin, Cairo + STWO)

### Facts

| Item | Finding | Source |
|---|---|---|
| Repo activity | Created Nov 17, 2025. Last push Dec 18, 2025 (no code since, about 10.5 months). 7 PRs, all closed; 0 open issues; 6 stars. | GitHub API, `repos/starkware-bitcoin/zoro` |
| Status | README: "Early-stage prototype. Expect rapid iteration." | [README](https://github.com/starkware-bitcoin/zoro) |
| What it proves | Header linkage, difficulty/median-time, **Equihash (200,9)**, ZIP-221 MMR, ZIP-244 commitments, in batches ("assumevalid") with recursion | [forum spec](https://forum.zcashcommunity.com/t/zoro-a-stark-proven-zcash-light-client-in-cairo/53220), [zoro-assumevalid README](https://github.com/starkware-bitcoin/zoro/tree/main/crates/zoro-assumevalid) |
| **Equihash cost in Cairo steps** | PR #4 (Dec 2025): "Current savings estimate: 40,277,059 steps -> 859,899 steps (~98%)" per header. This is the authors' *estimate*. The ~0.86M figure needs the **Blake2b opcode**, behind a `blake2b` feature flag; by default the slower Cairo-1 Blake2b is used. | [PR #4](https://github.com/starkware-bitcoin/zoro/pull/4) |
| Blake2b opcode toolchain | Requires the forked `zoro-proving-stack` (forks of the Cairo compiler, VM, Scarb and stwo-cairo). Its AIR generator `stwo-air-infra` is in a **private repository**, "required for the stwo-cairo air generation". | [zoro-proving-stack README](https://github.com/Ztarknet/zoro-proving-stack) |
| Prover parameters | blake2s channel, `pow_bits` 26, `log_blowup_factor` 1, `n_queries` 70 | `packages/assumevalid/prover_params.json` |
| Proof size | Spec projects "50–200 KiB". A reviewer measured 8.2 MB → 2.4 MB → 848 KB → 717 KB bzipped (Nov 2025). The author called the 50–200 KiB figure a projection. | [forum](https://forum.zcashcommunity.com/t/zoro-a-stark-proven-zcash-light-client-in-cairo/53220) |
| Proving time / RAM | **Not published.** `scripts/benchmark.sh` benchmarks only Blake2 and Fibonacci test programs, and no results are committed. | [benchmark.sh](https://github.com/Ztarknet/zoro-proving-stack/blob/main/scripts/benchmark.sh) |
| Public services | `staging.zoro.wtf` and `rpc.mainnet.ztarknet.cash` were unreachable from the box on Nov 1, 2026 (curl returned 000) | my check |

### Rough scale (my arithmetic, ESTIMATE ONLY)
- Zcash is at about height 3.54M (NU7 activates at 3,543,405).
- Proving every header from genesis at 0.86M steps per header (Equihash only, the opcode build) is about 3.0 × 10^12 Cairo steps.
- Without the opcode it's about 40M steps per header, roughly 47× more.
- I found no figure for STWO steps per second on this workload, so **wall time can't be estimated from sources.**

### Closest analog data (other projects; not Zcash and not STWO)
- **ZeroSync assumevalid on Bitcoin** (2023, older prover):
  - 967,717 steps → prover 1:26, 1.99 GB peak RAM;
  - 3.56M steps → 5:37, 5.82 GB;
  - 31.3M steps → 46:27, 46.32 GB.
  - Source: [ZeroSync roadmap](https://github.com/ZeroSync/ZeroSync/blob/main/docs/roadmap.md).
  - **[analysis]** If you naively assumed STWO is no faster than this, one header (~0.86M steps) would take around a minute and ~2 GB. Over all history that would be ~6.7 CPU-years single-stream. STWO is reportedly far faster, but I found no comparable figure, so treat this purely as an upper-bound flavor, not a prediction.
- **Raito v0.1** (Zoro's Bitcoin sibling): proves headers in batches of 6k with a recursive chain proof, and the full Bitcoin header chain verifies in <50 ms ([release](https://github.com/starkware-bitcoin/raito/releases/tag/v0.1.0)). It publishes no proving time. **[analysis]** It shows a genesis-to-tip header proof is operationally doable for Bitcoin (SHA-256d PoW). Equihash is much heavier per header.
- **STWO on another task:** STWO-Cairo proved a secp256k1 ECDSA + SHA-256 statement in 8 s with 6 GB, proof 5.6 MB ([BlockstreamResearch/pq-p2pkh](https://github.com/BlockstreamResearch/pq-p2pkh)). Same table: RISC Zero 2 min / 1.2 GB, SP1 1 min / 16 GB.

## 2. SP1 / RISC Zero for Equihash or Zcash headers
- I found **no project or benchmark** proving Equihash or Zcash headers in SP1 or RISC Zero. Searches returned only general zkVM docs and Bitcoin header-chain guests, e.g. the Clementine header-chain circuit on RISC Zero ([doc](https://github.com/blackvul/clementine--022/blob/42031582/docs/header-chain-circuit.md)).
- **[analysis]** A Zcash version is a straightforward port of that pattern, swapping SHA-256d proof-of-work for an Equihash verifier (e.g. Zebra's Rust `equihash` crate). Equihash(200,9) needs 512 BLAKE2b leaf hashes per header (Zoro PR #4 mentions "512 leaf hashes"). Neither zkVM had a BLAKE2b precompile that I could confirm **[unverified]**, so cycle counts are unknown.
- **Unverified; this would need a measurement.**

## 3. AMD RX 6600M (RDNA2, gfx1032) for ZK proving
- **ROCm:** gfx1032 is **not officially supported**. An AMD staff answer said "gfx1032 is not supported" ([ROCm #2685](https://github.com/ROCm/ROCm/issues/2685), for this exact GPU). AMD's HIP SDK table marks the RX 6600/6600 XT/6650 XT (gfx1032) unsupported ([AMD](https://rocm.docs.amd.com/projects/install-on-windows/en/latest/reference/system-requirements.html)).
  - The unofficial `HSA_OVERRIDE_GFX_VERSION=10.3.0` workaround works for some ML apps ([legacy-rocm-build #1698](https://github.com/ROCm/legacy-rocm-build/issues/1698)). It failed to compile for the 6600M in ROCm #2685, and AMD called forcing ISA "risky".
- **ZK GPU libraries:**
  - sppark HIP is tested on gfx90a/gfx1100/gfx1101/gfx1201, not RDNA2 ([PR 82](https://github.com/supranational/sppark/pull/82)).
  - ICICLE is CUDA-first (Metal experimental, Vulkan in progress) ([FAQ](https://dev.ingonyama.com/start/integration-&-support/faq_and_troubleshooting)).
  - The RISC Zero HIP fork is tested on the RDNA4 RX 9070 XT ([hemilabs](https://github.com/hemilabs/risc0/commit/af3dc8798eaad82eef505c0345a78be0ec9f846f)).
- **Vendor-neutral routes:** Ligero runs on WebGPU in Chromium (22 s on the pq-p2pkh task), which could in principle use the AMD GPU through Vulkan ([pq-p2pkh](https://github.com/BlockstreamResearch/pq-p2pkh)). That isn't a Zcash header prover. No OpenCL ZK prover relevant to this stack was found.
- **Conclusion:** plan on **CPU only** (the ~63 GiB host). The GPU is a non-factor unless you replace it with an RDNA3/4 or NVIDIA card **[analysis]**.

## 4. What I would ask the Zoro/Ztarknet maintainers (NOT sent; needs your OK)
1. Measured STWO proving time and peak RAM for 1, 10 and 100 Zcash headers with the `blake2b` opcode build, on what CPU?
2. Is `stwo-air-infra` (private) needed just to *build* the Blake2b-opcode prover, or only to regenerate AIRs? Will it be published?
3. Has any genesis→tip recursive Zcash receipt been produced? What did it cost, and how big is the final recursive proof?
4. Is there a path to wrap the final STWO receipt in a Groth16/BLS12-381 proof (Cardano-verifiable), or a known size/cost for a STWO verifier circuit?
5. Is the project still maintained? There have been no commits since Dec 18, 2025, and the hosted endpoints are unreachable.

## 5. What this means for the plan
- The **trusted checkpoint stays** in path #1 for now. Upgrading to a "proven checkpoint" is blocked on data that only a measurement or the maintainers can provide.
- The cheapest future measurement, once you approve a build, is running Zoro's `assumevalid` **without** the private opcode (the public Cairo-1 Blake2b path, ~40M steps/header) on a 1–2 header batch on the box. That gives a real upper-bound time and RAM per header. I did *not* do it here, because step #3 was scoped as reading-only and step #1 has priority on box time.
