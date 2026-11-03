# ZEUTXO I5 — independent adversarial self-review (Nov 2, 2026, ~1:12 AM ET)
I read this as a reviewer, not the author. Scope: the cross-curve adaptor/DLEQ (py/dleq.py, py/bip340_adaptor.py,
redpallas_adaptor/), the dispute game (anchor3/dispute3/settle3 in zeutxo-step1-relay-cost/e2e/core.ak) and the
MMR branch prototype (mmr/). Tags: [M] measured on the box, [E] estimate/derived, [A] assumption.
All keys/nonces are fresh OS-random test values. No R1/R2 material, no network, no chain, no GGLori.

## Verdicts
| # | Attack | Verdict | Fix / status |
|---|---|---|---|
| F7 | **DLEQ without proof of knowledge**: Bob picks Pallas blinders with sum sigma != 0 so T_p = t·Gp + sigma·Hp. v1 verifier accepts; Bob claims ADA (t opens T_s); the revealed t does not open T_p, so Alice can't complete the Orchard claim; Bob refunds ZEC. **Theft of Alice's ADA.** | **BROKEN in v1** (demo: v1_accepts_malicious_Tp=true, t_opens_malicious_T_p=false [M]) | dleq2.py: Schnorr PoKs of log_G(T_s), log_Gp(T_p) (as Farcaster's pok_0/pok_1) + strong Fiat–Shamir (ctx, T_s, T_p, bit index in each challenge). Demo: v2 rejects the malicious proof, the wrong ctx and the swapped statement; honest proof valid [M]. Size 56,829 B vs 56,700 B (+129 B) [M]. D-28 |
| — | Weak Fiat–Shamir (v1 challenge omits statement and index) | Weak (enables statement malleability; combined with F7 it is fatal) | fixed in dleq2 (D-28) |
| — | Secret leakage via DLEQ | OK [A: ROM, NUMS H] | CDS OR-proofs are HVZK and Schnorr PoKs are ZK in the ROM; 128-bit challenges → 2^-128 soundness per bit. Only leak: t < 2^252 range. H_s/H_p must stay hash-to-curve NUMS (nobody knows log H). T must be fresh per swap, ctx must carry a swap id (D-34) |
| — | **Nonce reuse** (BIP-340 presig; 2-party RedPallas share) | Fatal if it happens: key recovered in both demos [M] | D-33: OS-random nonce per (session, message), never deterministic in 2-party signing, never resume an aborted session; FROST commit() hedges the RNG with the share |
| — | Concurrent 2-party RedPallas sessions without FROST binding factors (ROS / Wagner) | Risk only if sessions run in parallel with the same key | D-32: sessions strictly sequential and per-swap keys; long-term: FROST-style binding factors in the adaptor |
| F6 | Confirmation inflation: merkle_verify ignores index bits above the path length; settle3 computes conf from an unbound hindex | **BROKEN in v2/settle3** (I4 tests PASS on index+8 / +8000 [M]) | fixed in MMR prototype (D-24); D-31: settle3 must not be used until the MMR port |
| F8 | Dispute against the wrong entry: Open2 accepts any batch root above canonical in entry idx, including batches introduced by an earlier entry k<idx; a fraud win drops idx.. but leaves k | Minor (honest challengers can dispute k directly; no theft) | D-30: require br.end_height > height of entry idx-1 (or canonical when idx=0) |
| — | **Griefing → Fallback theft**: Bob's Claim tx in the Cardano mempool reveals t; if it does not land before t_a, Alice claims ZEC with t, then stalls the relay with disputes until t_fb so Bob's ProveC can't land, and takes Fallback | Real but bounded | Cost to stall [E]: ~250 ADA per ~12.5 h (W_c+τ), ~3,600 ADA for 7.5 days. Fixes: D-29 (escalating challenger bond 250·2^(k-1) per consecutive dispute on the same entry, and the window pauses instead of resetting; 15 disputes then cost ~8.2M ADA [E]); D-35 (Bob must submit Claim ≥ 6 h before t_a and may resubmit; Zcash refund locktime > t_a + Alice claim window). With those, the attack needs ~6 h of Cardano censorship of Bob |
| — | Bond exhaustion (fill queue with fake entries) | OK | each fake entry burns 1,000 ADA proposer bond; honest challengers need 8×250 = 2,000 ADA of float to clear a full queue and profit from each win |
| — | Censorship within windows (W_c 6.5 h, τ 6 h) | OK under [A] honest-majority stake | Ouroboros includes honest txs well within hours; risks are watcher DoS and congestion → several independent watchers, fee headroom |
| — | Fake fork without real PoW (fake Equihash, sha256d target ground) | Caught by the dispute game | sha256d target grinding is cheap relative to Equihash: per-block work at h≈3,538,900 is 2.24e12 hashes [M from chainwork]; box Python 1 core 1.32M sha256d/s [M] → ~472 core-h per fake header [E]; GPUs far faster (not measured). So the optimistic dispute is load-bearing: needs ≥1 honest watcher within W_c |
| — | Fake fork with rented real hashpower / reorg beyond 330 | Residual assumption [A] | Equals a Zcash 51% attack sustained for 330 blocks (~6.9 h at 75 s). The relay can't do better than the heaviest chain. Mitigation: per-swap value caps; depth stays 330. No rental-cost figure (not measured, not invented) |
| F1–F5 | double satisfaction, forged dispute UTxO, payout piggyback, challenger self-reveal, stale anchor payouts | Fixed in I3, differential mutants confirm F2/F4 [M] | D-16..D-21 |

## FROST / RedPallas 2-of-2 off-chain simulation — PASS [M]
Library: ZcashFoundation **reddsa 0.5.2**, feature `frost` (`reddsa::frost::redpallas`), on frost-core 3.0.0 /
frost-rerandomized 3.0.0 (https://github.com/ZcashFoundation/reddsa, https://github.com/ZcashFoundation/frost).
Project: /workspace/zeutxo-adaptor-proto/frost_2of2 (offline build, CARGO_BUILD_JOBS=2). DKG 2-of-2 (Alice id 1,
Bob id 2) → into_even_y (Orchard ak), rerandomized signing with randomizer → aggregate → verifies under rk
(VerificationKey<SpendAuth>); fails under the unrandomized ak and for another message; a second session works with
a fresh rk; a tampered share is rejected with InvalidSignatureShare and Bob is named as culprit. run1/run2 ALL_OK=true.
**Gap:** reddsa FROST has no adaptor offset (no way to add T_p to the group nonce), so the Orchard adaptor claim
still uses the custom 2-party code. Options: (a) fork frost-core round-2 to add T_p to the group commitment and
verify z_b against R_b + T_p (needs external review); (b) keep the custom 2-party scheme, sequential sessions only.
No real Orchard transaction was built (needs librustzcash/orchard + a node — out of scope).

## Artifacts
review/dleq_attack.py + dleq_attack.json, review/nonce_reuse.py + nonce_reuse.json, py/dleq2.py,
frost_2of2/ (src/main.rs, run1.txt, run2.txt). Not externally reviewed; research only.
