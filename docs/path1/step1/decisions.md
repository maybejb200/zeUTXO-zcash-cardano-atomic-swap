# zeUTXO path 1: decisions log (2026-11-02)
I made each decision myself from first principles. Each entry gives the decision, then the reason.

**D1. Roles: Alice (ADA) locks first and Bob (ZEC) funds second.**
Only Cardano can enforce time. The party whose chain has the timelocks has to lock first, so that the Refund and Punish branches exist before any ZEC is at risk.

**D2. Shares are restricted to [0, 2^252) and both chains range-check them.**
The same integer must mean the same scalar on Pallas (order ≈ 2^254) and on BLS12-381 (order ≈ 2^254.9), with no wraparound. The script rejects `b+r` and negative values (Aiken tests n2 and n3).

**D3. Orchard's ỹ sign rule is applied off-chain.**
- The joint point K = A_p + B_p might have its sign bit set. In that case ak = −K and ask = −(a+b).
- Both parties compute σ from public data.
- The shares themselves are never negated, so the range proofs stay valid.
- Test (a) exercises both σ = +1 and σ = −1, and shows that signing without the negation fails.

**D4. nk and rivk are derived jointly by commit-reveal.**
Both parties need the FVK so they can watch the note and the nullifier, and neither party should be able to grind the address. Hashing both parties' contributions after a commit phase achieves both.

**D5. The go-sig is Alice's ordinary Cardano signature on the exact Redeem tx.**
- Her signature covers the tx body, which pins the input outref and Bob's outputs.
- The body's script_data_hash commits to the redeemer.
- So the go-sig can't be reused on another UTxO.
- Without the go-sig, Bob could reveal b and take the ADA before funding any ZEC. The model mutant alice_gosig_without_funding shows the resulting loss.

**D6. Refund stays open after T2.**
- If Alice is late, she and Bob race between Refund and Punish. The model shows this is safe for an honest Alice who acts by T1+Δ.
- The variant where Refund closes at T2 is also safe within the bound.
- Keeping Refund open loses nothing and helps a slightly late Alice.

**D7. Timing rules come from the model, not from intuition.**
- Safety holds if and only if T2 − max(T1, Δ) ≥ Δ+1.
- The swap completes if and only if T0 ≥ 2Δ and T1 ≥ 3Δ+1.
- A 676-configuration sweep found no mismatch with either rule.
- The simple sufficient deployment rule is T1 ≥ T0+Δ+1 and T2 ≥ T1+Δ+1, with Δ covering inclusion plus Cardano settlement.

**D8. The Zcash funding depth Z is a consensus assumption, outside the model.**
- Alice treats the note as funded only once it is Z blocks deep.
- A reorg deeper than Z is out of scope, as for any cross-chain swap.

**D9. The DLEQ includes mandatory Schnorr PoKs of dlog(P) and dlog(Q), bound to the transcript.**
- My first harness had a bug that made the "shifted points" attack (F7) look rejected. Once I fixed the harness, the naive verifier (commitments + rings + weighted sums, but no PoKs) ACCEPTED published points P' = xG + ρH and Q' = xG1 + σH'. Their discrete logs differ and are unknown to everyone.
- In the protocol, that attack lets a cheater publish a share nobody can use. For example, Bob proves a bogus B, then redeems with b: the script check passes, but a+b is not Alice's Zcash key, so Alice loses.
- Farcaster's DLEQ has pok_0/pok_1 for exactly this reason. Adding them is a fix to my own test implementation following the established design, not a protocol patch.
- With the PoKs, N5 is rejected. N25 (tampered PoK) and N26 (PoK transplanted from another proof) are also rejected.

**D10. Both signing modes are tested in (a).**
- Path 1 only needs one party to sign alone with the full key after learning the other share. That party is the sweeper.
- I also tested a commit-reveal 2-of-2 joint signature and an adaptor pre-signature with extraction, for later variants.
- Every signature goes through reddsa's standard verifier and through orchard 0.15.5's PCZT apply_signature with the real alpha and rk from build_for_pczt.

**D11. orchard version: =0.15.5.**
- 0.16 needs rustc 1.88; the box has 1.85.1. 0.11 is yanked.
- I used BundleVersion::orchard_v2 and NoteVersion::V2. The SpendAuth logic doesn't depend on the version.
- I left out the circuit feature, so **no Halo2 proof was built**. Spend proving is standard wallet functionality and needs only the FVK, which both parties have.

**D12. The sighash is a random 32-byte stand-in, not ZIP-244.**
The signature math doesn't depend on what is hashed. Real tx assembly comes in the next phase.

**D13. Crash semantics in the model.**
- A crashed party stops acting.
- In bounded mode, txs it already submitted still land within Δ.
- Losses suffered by a crashed party are reported separately and are not counted as protocol failures.
- Result: Alice must be online during [T1, T2−Δ). If she isn't, a malicious Bob punishes her. This is the intended Farcaster trade-off.

**D14. The Aiken validator checks points by uncompressing the datum point and comparing for equality.**
- Compressing the computed point and comparing bytes is cheaper: 1.33% vs 1.84% CPU of the tx budget.
- I kept uncompress for the reference version because it fails loudly on a malformed datum. Either option is well under 5%.
- The datum points should still be validated off-chain at lock time.

**D15. The validity-interval checks ignore the is_inclusive flags.**
They require Redeem's upper bound ≤ T1−1 and Refund's/Punish's lower bound ≥ T1/T2. That is conservative by 1 ms. Cleaning this up is fine for the next phase.

**D16. Unbounded-delay losses are documented as the liveness assumption, not patched (per the stop rule).**
Every such loss needs an honest critical tx to be over-delayed: Alice's lock or Refund, or Bob's Redeem or Punish. No loss happens without one.
