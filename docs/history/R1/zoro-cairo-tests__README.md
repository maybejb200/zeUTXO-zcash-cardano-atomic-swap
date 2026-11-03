# Executable Cairo compatibility work

Scarb/Cairo 2.12.2 is installed only inside the Linux project. The official x86_64 Linux release archive matches SHA-256 `de71c82f95e5b16a8bba87432235f90e920502293fb42f0ca084be975e20e750`; toolchain-report.json records the release URL and executed version. No global PATH or services changed.

Two isolated workspaces derive from Zoro commit e04c1f6724e0d42154b7285ed9cbae8ad5719c91:

- `work/zoro-cairo-tests`: consensus/utils packages with narrowed workspace members and five observation tests. The recursive proving stack is excluded.
- `work/zoro-cairo-compat`: separate local compatibility patch. The original upstream checkout and active R1 implementation are unchanged.

Results so far:

- Seventeen upstream difficulty tests passed.
- Five helper-level observations passed: both equivalent compact encodings are accepted upstream; a different target rejects; the lower timestamp helper has no upper bound; the unused upper helper rejects an 80-minute median gap; and its separate local-clock boundary behaves as written. Passing these observations reproduces incompatibilities, not approval of a relay.
- The full augmented consensus suite aborted at the 3,500,000 KiB virtual-memory cap during the Equihash 200,9 portion, requesting an additional 1,342,177,280 bytes. Earlier individual cases passed, but no complete-suite pass is claimed.
- Seven focused compatibility-patch cases passed. See patched-compatibility-report.json.
- The isolated upstream Equihash 200,9 case passed at the 8,500,000 KiB cap: 25,843,568 VM steps. Despite its name, this fixture uses the short ASCII message "block header" and a nonce, not a serialized 140-byte header prefix.
- The complete compatibility-patched suite passed all 104 tests at the larger cap in 136.53 seconds, peak resident 3,471,804 KiB.
- A third isolated workspace, `work/zoro-cairo-cached`, shares the pure-Cairo Blake2b prefix state across Equihash leaves. Its first native differential run failed four of seven cases: the upstream update routine discarded retained bytes on a second call and compressed a final full buffer too early. The local prototype now retains that buffer until additional bytes arrive or finalization. All seven native boundary vectors pass, including repeated reuse of each prepared state. Failed evidence is retained.
- The shared-prefix prototype passes all 104 consensus tests in 132.19 seconds, peak resident 3,135,820 KiB. The same short-message 200,9 case uses 22,085,744 steps (14.54% fewer), but its single compile-plus-test time was slightly longer. This is not evidence of proving throughput.
- Both versions pass an identical existing mined regtest header with the real 140-byte prefix. Steps drop from 37,848,494 to 22,223,492; peak resident memory drops from 4,961,996 to 3,094,624 KiB. Single compile-plus-run times are 36.53 and 30.71 seconds. See mined-header-comparison.json and mined-header-fixture.json. No new mining or transaction is involved.
- All 50 utility tests pass, including 16 native differential hash cases. Nine added cases cover multiple-block suffixes, reuse with a different suffix, and independent native comparisons of the one-shot route. See cached-utils-suite-report.json and streaming-native-vectors.json.

An additional isolated `zoro-cairo-rotations` copy tests direct constant rotations in the Blake2b mixing function. The first version passes 54 utility checks and the mined-header case but increases header steps to 22,887,461, so it is not adopted as a performance improvement. Its source is preserved in rotation-v1-blake2b.cairo. The revised version reuses quotient and remainder from one division; all 54 utility tests and 105 consensus tests pass. Mined-header steps fall to 21,311,525. A separately verified 64-hash proof comparison reduces compile/execution/proving time from 75.11 to 62.38 seconds and peak resident memory from 6,050,624 to 5,553,212 KiB. These are single comparisons, not a full Equihash proof or throughput guarantee. No active R1 circuit or upstream checkout has been changed.

The patch requires exact compact bits using the existing target_to_compact conversion, changes the median upper limit to 90 minutes, and connects a height-activated mainnet median-time check to validate_header. It preserves mainnet height 1's upper-bound exception and the strict lower bound. It does not implement Testnet activation/retarget exceptions, recursive proof compatibility, historical maximum-time binding, the R1 history format, or a Cardano verifier. No full-header attack or secure STARK proof is demonstrated.

Pinned Zebra's zebra-state/src/service/check.rs requires exact nBits equality and applies the 90-minute bound from mainnet height 2 / testnet height 653606. The isolated patch remains mainnet-only because the upstream package is mainnet-only.

One initial observation-test setup stopped at an integer-literal guard, and an old runner then selected zero tests. That report is explicitly invalidated; the original runner output is preserved. The corrected fixture checks the literal equals 2^232, and the runner now rejects a zero-test success. The actual five-case run is helper-compatibility-v2-report.json.
