# Joined proof and Cardano verifier milestone

Verified 2026-09-10T03:03:40.557573+00:00. The resumed 1,024-cell joined transcript/memory proof succeeded. The earlier timeout is preserved; no unchanged full-memory attempt was repeated.

- 2,387,930 constraints; compile 30.97 seconds, random research setup 2295.75 seconds, proof 100.10 seconds. Total 2429.78 seconds; peak child RSS 5120860 KiB under the unchanged cap.
- Native proof verification and four negative controls pass. Setup/proving keys remained in protected process memory and were not persisted.
- The exact proof and matching public verification key pass all 36 Aiken tests, including each of twelve changed public inputs, noncanonical memory-sum limbs, altered proof/commitment/knowledge points, and length checks.
- Compiled fixed-proof offline cost diagnostic: CPU 4668240938, memory 38117, accepted under saved Preview epoch 1415 limits. Explicit and default parameter costs match. Dynamic probe 3,176 bytes, fixed profiler 2,331 bytes. This is not a ledger transaction or complete swap budget.

The public interface is eight post-nonce transcript digest u32 words and four partial-memory sum M31 limbs. It does not yet expose and enforce the application's twenty header outputs. Memory covers only 1,024 of 21,250 fixed program cells. Full claim/AIR/FRI verification remains absent. This is a joined verifier component with an unsafe research setup, not a full recursive STWO verifier or public swap.

Next bounded integration step: add an explicit application-output binding component for the reusable header executable's twenty outputs (eight hash words, eight parent words, timestamp, nBits, target low/high 128-bit limbs), derive these from the same canonical public-memory values mixed into the transcript, and test actual native statements plus altered/overflow/limb-alias cases using compiled constraints. Keep the current successful proof and adapter unchanged. Review the native fixture encoding before implementation. No need for another heavy setup just to test this binding. Full memory setup scaling, full AIR/FRI integration, general chain context and sustained relay remain subsequent gates.

No active proof job. Sprint 3 estimate remains approximately 60% (rough judgment). Last included allowance check: 82% remaining; credits unchanged at 1642.847636. Heartbeat continues under user authorization and 5% reserve; no mainnet, paid services, secret exports or reset use.
