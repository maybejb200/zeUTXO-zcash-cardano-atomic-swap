# zeUTXO path 1 — protocol spec (one page, v0.1, 2026-11-02)

**Goal.** Trustless swap of shielded ZEC (an Orchard note) for ADA. No relay, no committee. Farcaster/COMIT layout.
**Parties.** **Alice** has ADA and wants ZEC. **Bob** has ZEC and wants ADA. Alice locks first.

**Keys (fresh for each swap).**
- Alice picks a share `a` and Bob picks a share `b`, each uniform in `[0, 2^252)`.
- Each party publishes the same integer in two groups:
  - on Pallas: `A_p = a·G`, `B_p = b·G`, where G = Orchard's SpendAuthSig base, `hash_to_curve("z.cash:Orchard")("G")`;
  - on BLS12-381 G1: `A_c = a·G1`, `B_c = b·G1`.
- Each publishes a cross-group DLEQ proof that both points hold the same integer. The proof uses 252-bit decomposition, AOS rings and Schnorr PoKs in both groups, and is bound to the swap context.
- **Joint Orchard key.** `K = A_p + B_p`. If the ỹ (sign) bit of K is 1, set σ = −1, otherwise σ = +1. Then `ak = σK` and `ask = σ(a+b)`. The normalization is done off-chain; the shares stay < 2^252.
- `nk` and `rivk` are derived from both parties' commit-reveal contributions. That gives a joint FVK = (ak, nk, rivk) and a joint address `addr_J`.
- Both parties hold the FVK, so both can see the note and compute its nullifier. Neither party alone knows `ask`.

**Setup (off-chain).** The parties exchange the keys and proofs above and agree on:
- the amounts, the Zcash funding depth `Z`, and the delay bound Δ;
- the deadlines `T0 < T1 < T2`, which must satisfy `T2 − max(T1,Δ) ≥ Δ+1`, `T0 ≥ 2Δ` and `T1 ≥ 3Δ+1` (the model's rules, in units of Δ-slots);
- a pre-built Redeem tx body (outputs to Bob).

**Cardano.** One script UTxO holds the ADA. Its datum is `{alice_pkh, bob_pkh, A_c, B_c, T1, T2}`. It has three branches (validators/escrow.ak, 779 B):

| Branch | Who | When (validity interval) | Reveals | Script checks |
|---|---|---|---|---|
| Redeem{b} | Bob, plus Alice's **go-sig** (her key signs the tx) | upper bound ≤ T1−1 | `b` | `0 ≤ b < 2^252`, `b·G1 == B_c`, both signatures |
| Refund{a} | Alice | lower bound ≥ T1 (stays open after T2) | `a` | `0 ≤ a < 2^252`, `a·G1 == A_c`, Alice's signature |
| Punish | Bob | lower bound ≥ T2 | nothing | Bob's signature |

The UTxO can be spent only once, so **at most one share is ever revealed**.

**Zcash (Orchard).** Orchard has no script and no timelock, so all timing lives on Cardano.
- Bob funds an ordinary Orchard note to `addr_J`. The note commitment `cm` is the usual one over `(addr_J, v, ρ, rseed)`, and the nullifier is `nf = DeriveNullifier_nk(ρ, ψ, cm)`.
- Alice checks for herself that `cmx` is in the tree at depth ≥ Z: she trial-decrypts with the joint ivk and recomputes nf.
- Nobody pre-signs anything. Whoever ends up knowing `a+b` sweeps with a fresh tx:
  - it picks a fresh α, so `rk = ak + α·G` and `rsk = σ(a+b) + α`;
  - it builds the Halo2 proof using the FVK, and signs the SpendAuth with rsk.

**Messages and order.**
1. Alice locks the ADA (t ≤ Δ).
2. Bob checks that the lock is confirmed. He funds the note only if `t+Δ ≤ T0`.
3. Alice sees the note at depth Z and t ≤ T0, then sends her go-sig over the Redeem body. Otherwise she sends nothing and refunds at T1.
4. Bob submits Redeem only if `t ≤ T1−1−Δ`. The moment it hits the mempool, `b` is public.
5. Alice reads `b`, so she knows `a+b`, and sweeps the ZEC to her own address.
6. Fallbacks:
   - If Bob never redeems, Alice submits Refund at T1. That reveals `a`, so Bob sweeps his ZEC back.
   - If Alice is silent after funding, Bob submits Punish at T2 and takes the ADA. The ZEC stays locked forever in the 2-of-2, so Bob is "paid in ADA".

**Who learns what, and when.**

| Event | Alice learns | Bob learns | Public learns |
|---|---|---|---|
| Setup | B_p, B_c, the FVK | A_p, A_c, the FVK | nothing |
| Bob funds the note | the note and nf | — | a shielded note (unlinkable) |
| Redeem enters the mempool | `b`, so she knows ask | — | `b` and the Cardano datum. The Zcash link stays hidden: rk is re-randomized and nf is only computable with nk. |
| Refund | — | `a`, so he knows ask | `a` |
| Punish | — | — | nothing |

**Assumptions.**
- (1) Each honest party's critical tx (Alice's lock and Refund, Bob's Redeem and Punish) is mined within Δ.
- (2) Alice is online during `[T1, T2−Δ)`.
- (3) Z covers Zcash reorgs.
- (4) DLEQ soundness, and the 2^252 range check on both chains.
- (5) Cardano finality is folded into Δ.
