# Step 6 self-check — NOT INDEPENDENT
Written by the same executor that wrote the code. Treat it as a checklist for a real reviewer, not as a review.

## What I re-checked and how
| # | Claim | How checked | Result |
|---|---|---|---|
| 1 | Ironwood v6 txs are built/verified by real crates, not faked | Cargo.lock pins orchard 0.16.0, zcash_primitives 0.31.0, zcash_protocol 0.11.0; node check calls orchard BatchValidator with the PostNu6_3 VK; neg test "wrong VK (FixedPostNu6_2)" is rejected by the real verifier | holds |
| 2 | Orchard is withdraw-only after NU6.3 in our sim node | neg tests orchard_cross, orchard_v6_cross, orchard_inflow rejected; turnstile allowed only when forced | holds (rule is OUR node code reading ZIP 258, not zebrad) |
| 3 | ZIP 2005 use_qsk derivation is right | implemented from ZIP text; selftest checks internal consistency (ỹ=1 rejected by orchard, both parties derive identical FVK, rivk binds ak, differs from legacy rivk) | NOT cross-checked: no published vectors or crate. A bug here would give a wrong but self-consistent key. |
| 4 | Branch id is in the sighash; a pre-NU7 sweep dies at activation | nu7-cross test: built pre-NU7 (expiry nu7−1), rejected after, rebuilt + accepted under NU7 with +120 | holds in sim |
| 5 | minZ numbers | policy6.minZ (JS) and step6_model.py (Python, nbinom) agree: 58 / 64-65 / 69 at 0 / 3.26 / 5% stales, q = 0.35 | holds; both are mine (same formula, two codings) |
| 6 | FIFO spam cannot delay an admitted Redeem | congestion2: 49% pre-fill + flood after admission, settles 220 s before T1 | holds ONLY under my mempool model (single FIFO queue, capacity 2 blocks). Real Cardano relays per node; ordering across peers is not guaranteed. |
| 7 | Producer censorship is a real theft path | congestion3 CONTROL: Redeem censored until T1 → not settled; Alice read b from the mempool and sweeps the ZEC | reproduced (see memo §Open) |
| 8 | Old attacks still caught | full rerun 360/360, all step-5 groups included (l1…cap) | holds |
| 9 | Script unchanged | validators/*.ak byte-identical to step 5; aiken check 28/28 | holds |
| 10 | No old secrets reused | every swap calls newSwap (fresh keys, fresh nonces, fresh go key); no step1-5 runs/ files read | holds by construction; not separately audited |
| 11 | step1-5 / review1-3 untouched | `find … -newermt "2026-11-02 23:30"` returns nothing | holds |

## Things I am least sure about
- use_qsk (item 3) and the "PQ/recovery mode collapses 2-of-2 to 1-of-2" reading of ZIP 2005 (D3): based on my reading of a Draft ZIP.
- The DAA recovery curve s(n) = 25 + 31.8·e^(−n/97.3) is my fit, used for the 3,332-block post-activation blackout.
- Spam cost per block (4.38 ADA) uses current Conway fee parameters (44 lovelace/B + 155,381) and 16 KB txs.
- The 25% direct-stake threshold assumes Bob can submit straight to that many SPOs' relays; not tested on any network.
- Stale-rate 5% post-NU7 is from ZIP 218 devnet (4.86%), not mainnet.
- Test expectations were adjusted in this step (zexpiry tip+41, nu7 "far" height 4000→6000 because the window is 3,613 fast blocks, congestion fixes). Each change was to the test's arithmetic, not to a gate, but a reviewer should re-derive them.
