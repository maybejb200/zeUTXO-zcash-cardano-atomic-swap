# zeUTXO Step 9: Project Assessment, Review 6 (Step 9 Audit), and Recommendations

**Date:** Nov 8, 2026  
**Scope:** Full architectural, cryptographic, game-theoretic, and code-level assessment of `zeUTXO` Path 1 (Spec v0.7, Escrow v0.7 `src/ada/onchain/validators/escrow.ak`, Zcash Ironwood crate `src/zec/`, Step 9 wallet policies `src/ada/policy9.mjs` + `src/ada/e2e9.mjs`, timing models `src/model/step9_model.py`, and `docs/rehearsal/proposal-v2.md`).

---

## 1. Executive Assessment

### Verdict: CONDITIONAL PASS — Sound Core Architecture & On-Chain Script; 4 Pre-Rehearsal Off-Chain Fixes Recommended

1. **Architectural Trajectory (`R1 -> R2 -> Optimistic Relay v1–v10 -> Path 1 v0.7`):**
   The project's pivot documented in [`docs/timeline.md`](../timeline.md) was the right engineering decision. Attempting to verify Zcash Equihash PoW headers on Cardano (`R1`/`R2`) or arbitrate Zcash claim-vs-refund races via an optimistic header relay (`Phase 3 v1–v10`) introduced massive circuit/prover complexity and a recurring surface of fraud-proof/dispute-game vulnerabilities. Moving to a **Farcaster/COMIT-style adaptor/split-key swap where Zcash holds a timeless 2-of-2 split key and Cardano holds all clocks in a single PlutusV3 validator** eliminates cross-chain state verification entirely.

2. **On-Chain Validator (`escrow.ak` v0.7, hash `0ed9e054…0087e0`):**
   The PlutusV3 validator in [`src/ada/onchain/validators/escrow.ak`](../../src/ada/onchain/validators/escrow.ak) is **sound and well-tested**. Its core design invariant—**no transaction with a short deadline carries a secret (`Commit`, `Notice`), and no transaction carrying a secret has a script deadline (`Reveal{b}`, `RefundReveal{a}`), facing only a 7-day fallback window (`Escape` at `T3`, `Forfeit` at `t4`)**—cleanly defeats the short-window mempool-sniffing + censorship theft attacks identified in academic literature (Winzer et al., MAD-HTLC, He-HTLC, Rapidash) and in Reviews 4 & 5.

3. **Step 9 Wallet & Simulator Code (`src/ada/e2e9.mjs`, `src/ada/policy9.mjs`):**
   While [`src/ada/policy9.mjs`](../../src/ada/policy9.mjs) correctly implements the fixes for Review 5's findings (`R5-H1` bounded 90-minute Reveal HOLD, `R5-M1` Refunding UTxO provenance, `R5-M2` node-derived era/spacing, `R5-M3` price-driven `Z`, `R5-L2` `T3 + 24h` blackout + Zebra EOS check, `R5-L4` min-ADA check), **this review identified four concrete code-level gaps in the off-chain wallet/simulator integration** that should be resolved before executing the testnet rehearsal on Cardano Preprod and Zcash Testnet.

---

## 2. Detailed Logic & Viability Review

### 2.1 Cryptographic Layer (`src/zec/src/dleq.rs` & `src/zec/src/main.rs`)

| Component | Implementation | Assessment |
|---|---|---|
| **Scalar Range & Cross-Curve Compatibility** | 252-bit secret shares $a, b \in [1, 2^{252})$ (`NBITS = 252` in `dleq.rs`; `share_bound = 2^252` in `escrow.ak`) | **Sound.** Because $2^{252} < \min(q_{\text{Pallas}}, q_{\text{BLS12-381}})$ where $q_{\text{Pallas}} \approx 2^{254}$ and $q_{\text{BLS12-381}} \approx 2^{255}$, there is zero modular reduction wrap-around between Pallas and BLS12-381 $G_1$. |
| **Cross-Group DLEQ ($\text{Pallas} \leftrightarrow \text{BLS12-381 } G_1$)** | [`src/zec/src/dleq.rs`](../../src/zec/src/dleq.rs) (`prove_raw`, `verify_opt`) | **Sound.** Uses NUMS generators $H_p, H_b$ via RFC 9380 `hash_to_curve` with distinct domain tags, zero-sum Pedersen bit commitments, 2-member AOS ring signatures with shared 248-bit challenges, weighted commitment sum checks ($\sum 2^i C_i = P$, $\sum 2^i D_i = Q$), and Schnorr Proofs of Knowledge of $\text{dlog}_{G_p}(P)$ and $\text{dlog}_{G_b}(Q)$ bound to `swap_id` and `role`. |
| **Zcash Ironwood 2-of-2 Split Key (`use_qsk`)** | [`src/zec/src/main.rs`](../../src/zec/src/main.rs) (`joint_keys`, `setup`, `sweep`) | **Sound (pending live Zebra validation in rehearsal).** Derives shared `sk` via commit-then-reveal contributions bound to `swap_id`; computes `nk`, `qsk`, `qk`, `rivk_ext` per ZIP 2005; normalizes $\text{ak} = \sigma(A_p + B_p)$ with $\sigma \in \{+1, -1\}$ so $\tilde{y}(\text{ak}) = 0$. Matches independent `zafe-core` / `frost-tools` vectors (`tests/review4/qsk_vectors.rs`). |
| **Cardano On-Chain Scalar Verification** | [`src/ada/onchain/validators/escrow.ak`](../../src/ada/onchain/validators/escrow.ak) (`share_ok`) | **Sound.** Checks $0 \le s < 2^{252}$ and `bls12_381_g1_scalar_mul(s, g1.generator) == bls12_381_g1_uncompress(pt)` via CIP-0381 primitives. |
| **Escrow-Bound `go_msg` Signature** | [`escrow.ak`](../../src/ada/onchain/validators/escrow.ak) (`go_message`), [`src/ada/gomsg.mjs`](../../src/ada/gomsg.mjs) | **Sound.** Signs `"zeUTXO/path1/go/v1" \|\| network_id \|\| swap_id \|\| script_hash \|\| own.tx_id \|\| own.output_index \|\| lovelace \|\| t1` under a fresh per-swap Ed25519 key checked strictly via both `libsodium` and OpenSSL before Bob broadcasts `Commit`. |

### 2.2 On-Chain State Machine (`src/ada/onchain/validators/escrow.ak` v0.7)

```
                     Commit{go_sig} (Bob sig, upper <= T1 - 1, no secret)
            +--------------------------------------------------------------------+
            |                                                                    v
  [ Open (phase 0) ]                                                  [ Claimed (phase 1) ]
            |                                                            |              |
            | Notice (no secret; hi - lo <= 6h)                          | Reveal{b}    | Escape
            | (Alice sig & lo >= T1) OR (Bob sig & lo >= T2)             | (Bob sig,    | (Alice sig,
            v                                                            |  no deadline)|  lo >= T3)
  [ Refunding (phase 2, t4 = hi + (T3 - T1)) ]                           v              v
       |                             |                              (Bob gets ADA; (Alice gets ADA;
       | RefundReveal{a}             | Forfeit                       Alice sweeps   Bob lost ZEC if
       | (Alice sig, no deadline)    | (Bob sig, lo >= t4)           ZEC w/ a+b)    he stalled)
       v                             v
  (Alice gets ADA;              (Bob gets ADA;
   Bob sweeps ZEC w/ a+b)        ZEC stays locked)
```

- **Why the Zcash side needs no timelock or pre-signed refund:** Whoever learns the other party's scalar share ($b$ on `Reveal`, or $a$ on `RefundReveal`) holds the full discrete log $\sigma(a + b)$ of $\text{ak}$ and unilaterally signs a fresh v6 Ironwood transaction sweeping the ZEC note. Because the sweep transaction is constructed *after* the scalar is learned, it never suffers from Zcash `expiry_height` expiration or NU7 branch-ID invalidation during the Cardano escrow lifetime.
- **Continuing-output & double-satisfaction safety:** [`continues`](../../src/ada/onchain/validators/escrow.ak#L108-L129) enforces `n_in == 1` across all inputs sharing `Script(script_hash)` (regardless of stake credential), exact lovelace/multi-asset equality (`o.value == me.value`), exact inline datum match (`o.datum == InlineDatum(exp)`), and `o.reference_script == None`.

### 2.3 Practical Viability Assessment

- **Computational & On-Chain Cost Viability:** **High.** The compiled PlutusV3 validator is 2,445 bytes; transactions cost ~0.18–0.32 ADA (< 3% of Cardano per-tx CPU limits). Off-chain DLEQ proving/verification takes < 100 ms; Zcash Ironwood Halo2 proving takes ~2–4 seconds.
- **Latency & Capital Efficiency:** **Viable for P2P/OTC swaps; constrained for high-frequency market making.**
  - Happy-path completion takes ~45–60 minutes wall-clock time ($K=15$ Cardano blocks + $Z \ge 69$ Zcash blocks at 25 s).
  - Under adversarial stalling (`L3`), capital can be locked for up to **~7.2 days** at only transaction-fee cost to the staller.
  - Under silent-Alice abandonment after Bob funds ZEC, Bob is compensated in **ADA** via `Notice -> Forfeit` after ~7.2 days rather than recovering his original **ZEC** (his ZEC remains permanently unspendable in the 2-of-2 note since Alice never revealed $a$).

---

## 3. Review 6 Findings: Pre-Rehearsal Code Gaps in Step 9

Before running the testnet rehearsal ([`docs/rehearsal/proposal-v2.md`](../rehearsal/proposal-v2.md)), the following four issues in the Step 9 off-chain code should be addressed.

### R6-M1 (Medium): Real-Chain Slot-to-POSIXTime Quantization Hazard on `Notice` (`t4`)

- **Location:** [`src/ada/onchain/validators/escrow.ak`](../../src/ada/onchain/validators/escrow.ak#L132-L167) (`notice_ok`) vs. [`src/ada/e2e9.mjs`](../../src/ada/e2e9.mjs#L281-L285) (`refundingDatum`, `noticeTx`).
- **Mechanism:**
  In `escrow.ak`, `notice_ok` checks that the continuing output's inline datum sets:
  ```aiken
  EscrowDatum { ..d, phase: 2, t4: hi + ( d.t3 - d.t1 ) }
  ```
  where `Finite(hi)` is the upper bound of `tx.validity_range` inside the PlutusV3 `ScriptContext`.
  On Cardano Preprod and Mainnet, transaction validity intervals on the wire (`ttl`) are **slot numbers** (1 slot = 1,000 ms), which the Cardano ledger converts into `POSIXTime` (`slot * 1000`).
  In `e2e9.mjs`:
  ```js
  const refundingDatum = (S, to) => datumOf(S, { phase: 2n, t4: BigInt(to + TAIL) });
  const noticeTx = (S, from, { to = null, signer, utxo = null, out = null, lovelace = null } = {}) => (tx) => {
    const u = utxo ?? S.escrow; const hi = to ?? from + NOTICE_TTL;
    return tx.collectFrom([u], Notice).attach.SpendingValidator(SCRIPT).addSignerKey(pkhOf(signer ?? S.A))
      .pay.ToContract(S.scriptAddr, { kind: "inline", value: out ?? refundingDatum(S, hi) }, { lovelace: lovelace ?? BigInt(u.assets.lovelace) }).validFrom(from).validTo(hi); };
  ```
  In the simulator, `S.tSetup` is initialized at an exact 1,000 ms boundary (`L.now()`), and all offsets are multiples of 1,000 ms, so `hi % 1000 === 0`. On a real chain (or when `Date.now()` is used), if `t1`, `t3`, `from`, or `hi` has non-zero sub-second milliseconds (e.g., `...456 ms`), Lucid's `.validTo(hi)` converts `hi` to a whole-second slot, so the Plutus validator sees `Finite(Math.floor(hi / 1000) * 1000)` while `refundingDatum(S, hi)` wrote the unrounded `hi + (t3 - t1)` into `t4`. The byte-exact `InlineDatum(exp)` check in `continues` will then **fail on-chain**.
- **Fix:**
  Quantize all swap timestamps (`T0`, `T1`, `T2`, `T3`) at setup and all validity bounds (`from`, `hi`) in `commitTx` and `noticeTx` to exact 1,000 ms slot boundaries (`Math.floor(ms / 1000) * 1000`), and compute `refundingDatum(S, hiSlotMs)` from the slot-quantized timestamp.

### R6-M2 (Medium): Conway Map-Encoded Redeemers Not Handled in `decodeCreating`, `spendingRedeemer`, and `ledgerEd25519`

- **Location:**
  - [`src/ada/e2e9.mjs`](../../src/ada/e2e9.mjs#L388-L395) (`decodeCreating`)
  - [`src/ada/ledger.mjs`](../../src/ada/ledger.mjs#L226-L239) (`spendingRedeemer`)
  - [`src/ada/nodecheck.mjs`](../../src/ada/nodecheck.mjs#L15) (`ledgerEd25519`)
- **Mechanism:**
  In `decodeCreating` (which backs Step 9's `ownRefunding` provenance check `R5-M1`):
  ```js
  const reds = tx.witness_set().redeemers()?.as_arr_legacy_redeemer(), scriptRedeemers = [];
  ```
  Only legacy array-encoded redeemers (`as_arr_legacy_redeemer()`) are parsed. In the Conway era (PlutusV3), transaction builders and CBOR serializers frequently encode redeemers as a CBOR map (`as_map_redeemer_key_to_redeemer_val()`), which [`StrictLedger._check`](../../src/ada/ledger.mjs#L177-L180) handles, but `decodeCreating` and `spendingRedeemer` do not.
  If a transaction on Preprod/Mainnet uses map-encoded redeemers:
  1. `decodeCreating` returns `scriptRedeemers: []`, causing [`refundProvenance9`](../../src/ada/policy9.mjs#L127-L128) to fail with `"REFUSE: my lock was not spent with redeemer Notice"`, blocking Alice from ever revealing `a` to refund her ADA.
  2. `spendingRedeemer` returns `null`, blinding the mempool/chain watcher from extracting a revealed scalar `b` or `a` from a map-encoded `Reveal` or `RefundReveal` transaction!
- **Fix:**
  Support both `as_arr_legacy_redeemer()` and `as_map_redeemer_key_to_redeemer_val()` via a unified helper in `decodeCreating`, `spendingRedeemer`, and `ledgerEd25519`:
  ```js
  function extractSpendRedeemers(tx) {
    const rw = tx.witness_set().redeemers();
    if (!rw) return [];
    const out = [];
    const leg = rw.as_arr_legacy_redeemer();
    if (leg) {
      for (let k = 0; k < leg.len(); k++) {
        const r = leg.get(k);
        if (r.tag() === 0) out.push({ index: Number(r.index()), cborHex: r.data().to_cbor_hex() });
      }
    }
    const mapR = rw.as_map_redeemer_key_to_redeemer_val();
    if (mapR) {
      const ks = mapR.keys();
      for (let k = 0; k < ks.len(); k++) {
        const key = ks.get(k), val = mapR.get(key);
        if (key.tag() === 0) out.push({ index: Number(key.index()), cborHex: val.data().to_cbor_hex() });
      }
    }
    return out;
  }
  ```

### R6-M3 (Medium): Incomplete Wiring of `policy9.mjs` Gates into `e2e9.mjs` (`paramsCheck` and `bobChecksLock`)

- **Location:** [`src/ada/e2e9.mjs`](../../src/ada/e2e9.mjs#L128-L141) (`paramsCheck`) and [`src/ada/e2e9.mjs`](../../src/ada/e2e9.mjs#L200-L217) (`bobChecksLock`).
- **Mechanism:**
  Step 9 implemented `valueCap9` (`R5-M2`/`M3`), `minAdaLock9` (`R5-L4`), and extended the blackout window to `T3 + 24h` (`R5-L2` / `D42`) in [`src/ada/policy9.mjs`](../../src/ada/policy9.mjs). They are tested in `gates9_test.mjs` and in the dedicated `r9_era` / `r9_minada` test groups, **but were not wired into the main setup and lock-verification functions**:
  1. `paramsCheck(P)` (line 138) still calls `valueCap7({ ..., era: PROFILE.era, ... })` instead of `valueCap9({ ..., node: S.nodeEra, ... })`.
  2. `paramsCheck(P)` (line 139) still calls `upgradeBlackoutGate({ now, windowEnd: now + (P.t2 - P.t0) + T0_OFF, ... })`—checking only up to **`P.t2`** instead of **`P.t3`**!
  3. `bobChecksLock(S)` (lines 200–217) never calls `minAdaLock9({ lovelace: u.assets.lovelace, refundingDatumBytes })`.
- **Fix:**
  Update `paramsCheck` to pass `windowEnd: now + (P.t3 - P.t0) + T0_OFF` to `upgradeBlackoutGate` and call `valueCap9` with the node-derived era, and invoke `minAdaLock9` inside `bobChecksLock(S)` (and before Alice locks in `lock(S)`).

### R6-L1 (Low): Shared Simulator State `S.claimed` Used in Alice's `Escape` Path

- **Location:** [`src/ada/e2e9.mjs`](../../src/ada/e2e9.mjs#L279) (`escapeTx`, `claimedLive`) and [`src/ada/e2e9.mjs`](../../src/ada/e2e9.mjs#L326-L331) (`ownClaimed`).
- **Mechanism:**
  In `e2e9.mjs`, `S.claimed` is populated only when Bob runs `bobCommit` (`S.commitHash = cur.txHash; S.claimed = await ownClaimed(S);`). When Alice's wallet runs in a separate process on testnet and Bob commits and then vanishes until `T3`, Alice does not have Bob's in-memory `S.commitHash`.
- **Fix:**
  Add `discoverClaimed(S)` for Alice (analogous to `ownRefunding(S)`), which scans UTxOs at `S.scriptAddr` and verifies via `decodeCreating` that the creating transaction spent `S.escrow` (`lock` outref) with redeemer `Commit` (tag `0`) and produced the single continuing output with `datumOf(S, { phase: 1n })`.

---

## 4. Recommendations to Improve the Solution

### Tier 1: Privacy & Unlinkability Improvements (Wallet-Only, Zero On-Chain Changes)

#### 4.1 Break Cross-Chain Timing Correlation (`L6` / `D46`) via Randomized ZEC Sweep Delays
- **Context:** Decision `D46` notes that broadcasting the Zcash sweep immediately after `Reveal{b}` (or `RefundReveal{a}`) links the Cardano and Zcash legs by timestamp, and that Step 9's 90-minute `HOLD` cap (`D35`) slightly worsens timing correlation during busy periods.
- **Key Cryptographic Insight:**
  Once Bob's `Reveal{b}` settles on Cardano, **Bob never learns $a$** (because the `Claimed` UTxO is consumed, making `RefundReveal{a}` permanently impossible). Symmetrically, once Alice's `RefundReveal{a}` settles on Cardano, **Alice never learns $b$**.
  Therefore, the party who learns the counterparty's scalar share on Cardano becomes the **sole party in the world who knows $\sigma(a + b)$**, and there is **no timelock on the Zcash note**.
- **Recommendation:**
  Decouple **secret extraction** (which must happen immediately from the Cardano mempool/chain and be persisted to disk) from **Zcash sweep broadcast**. Add a configurable randomized delay (e.g., $\text{Uniform}(1\text{ h}, 24\text{ h})$) before broadcasting the Zcash `sweep` transaction (bounded only by the node's upgrade/EOS blackout window). Because the counterparty cannot spend the ZEC note, delaying the Zcash sweep carries **zero theft risk** while completely breaking cross-chain timestamp correlation.

#### 4.2 Break Zcash Action-Count & Nullifier Timing Linkability
- **Context:** Under ZIP 2005 `use_qsk`, both parties hold the joint `FullViewingKey` (`ak`, `nk`, `rivk_ext`). While the sweep uses `ovk = None` so the counterparty cannot decrypt the sweep destination (`D2`), the counterparty *can* compute the joint note's nullifier `nf` and observe the exact Zcash block in which the joint note is spent.
- **Recommendation:**
  1. Combine the randomized sweep delay (4.1) so the counterparty learns nothing about the sweeper's active hours.
  2. Optionally allow the sweeper's wallet to include an unrelated personal Ironwood input/output in the sweep transaction (changing `actions_ironwood` from `2` to `3+`) so external chain observers cannot match 2-action funding transactions to 2-action sweep transactions by action count.

---

### Tier 2: Operational & Engineering Hardening (Pre-v1)

#### 4.3 Separate Alice and Bob into Crash-Safe, Persistent State-Machine CLI Processes
- Extract the monolithic `S` object in [`src/ada/e2e9.mjs`](../../src/ada/e2e9.mjs) into two standalone role processes (`alice-daemon` and `bob-daemon`) backed by an append-only / atomic JSON or SQLite state file (`swap_state.json`) synced with `fsync` before every network action:
  - Persist `secret.json`, `view.json`, `params.json`, `lock_outref`, `go_sig`, `commit_txid`, `notice_txid`, and any extracted scalar (`a` or `b`) **before** broadcasting or advancing state.
  - On restart after a crash or power loss during the 7-day tail, the daemon should reconstruct its state purely from `swap_state.json` + live queries to Zebra and Cardano.

#### 4.4 Multi-Provider Cardano Fan-Out & Quorum Observation
- Review 5 (`R5-H1`) demonstrated that a single spoofed or eclipsed Cardano relay view can trick wallet gates.
- Configure the wallet to:
  1. **Broadcast** `Commit`, `Notice`, `Reveal`, and `RefundReveal` concurrently across multiple independent submission channels (e.g., local `cardano-node`, Koios, Blockfrost, and direct SPO submit endpoints).
  2. **Require quorum observation** (minimum confirmation count across $\ge 2$ independent providers) before treating the lock (`W.1`), `Commit` (`W.4`), or `Notice` (`W.7`) as $K$-deep settled.

#### 4.5 Compact Cross-Group DLEQ Serialization (~40%–80% Smaller Setup Transcript)
- [`src/zec/src/dleq.rs`](../../src/zec/src/dleq.rs) currently serializes 252 bitwise ring proofs at 240 bytes/bit (`60,624` bytes total).
- **Zero-math optimization:** Since challenges `e0` are 31-byte integers (`e0[31] == 0`), and `c` / `d` commitments can be hashed directly into the loop without storing redundant padding, simple encoding tightening reduces proof size cleanly.
- **v2 optimization:** Switching from 1-bit (2-member) rings to 2-bit (4-member) rings cuts the number of Pedersen commitment pairs $(C_i, D_i)$ in half (from 252 to 126), or adopting the batched COPZ (ePrint 2022/1593) Sigma protocol reduces the proof from ~60 KB to ~10–15 KB.

---

### Tier 3: Protocol & Economic Enhancements (For Spec v0.8 / v2)

If the on-chain validator (`escrow.ak`) is updated in a future v0.8/v2 iteration after the rehearsal, one compact mechanism can simultaneously solve **three** of the remaining open economic trade-offs (`D19` unpriced free option, `L3` 7.2-day free stalls, and Bob's 7-day ADA exchange-rate risk on `Forfeit`):

#### 4.6 The Split-Payout Security Margin ("In-Escrow Refundable Over-Collateralization")
- **The Three Open Economic Trade-offs in v0.7:**
  1. **Alice's Free Option (`D19`) & Silent-Alice Stall (`L3`):** Alice can lock ADA, wait for Bob to lock ZEC, and if ZEC drops in price (or if she wants to grief Bob), walk away. Bob must wait ~7.2 days (`T2 -> Notice -> Forfeit at t4`) to claim Alice's ADA.
  2. **Bob's Exchange-Rate Risk on `Forfeit`:** When Alice vanishes after Bob funds ZEC, Bob cannot recover his ZEC; he gets Alice's locked ADA at `t4` (7.2 days later). If ADA depreciated against ZEC during those 7.2 days, Bob suffers a principal loss in ZEC terms.
  3. **Why Review 4 (`F2`) Removed Upfront Premiums:** Paying an upfront unconditional premium to Bob before he funds ZEC allowed a malicious Bob to pocket the premium and never fund ZEC.
- **The Solution (10 Lines in `escrow.ak`):**
  Instead of an upfront payment to Bob, have Alice lock `lovelace = swap_lovelace + deposit_lovelace` (e.g., `105%` of the agreed ADA amount, where `deposit_lovelace` is 3%–5%) inside the **same** escrow UTxO:
  - **On `Reveal{b}` (Happy Path):** Require `tx.outputs` to pay `deposit_lovelace` back to `d.alice`! Bob receives `swap_lovelace`, and Alice gets her `deposit_lovelace` back automatically in the same transaction.
  - **On `RefundReveal{a}` (Bob Never Committed / Aborted):** Alice recovers the entire UTxO (`swap_lovelace + deposit_lovelace`). Bob gets nothing if he failed to fund ZEC or failed to commit!
  - **On `Escape` (Bob Committed Then Stalled 7 Days):** Alice recovers the entire UTxO (`swap_lovelace + deposit_lovelace`), and Bob loses his ZEC.
  - **On `Forfeit` (Alice Vanished After Bob Funded ZEC):** Bob claims the entire UTxO (`swap_lovelace + deposit_lovelace`), so the `deposit_lovelace` (3%–5%) compensates Bob for both the 7.2-day lockup and any adverse ADA/ZEC exchange-rate movement!
- **Why this works without new attack surface:**
  - Bob can **never** steal `deposit_lovelace` by walking away (if Bob doesn't fund ZEC, Alice never sends `go_sig` and gets 100% of `swap_lovelace + deposit_lovelace` back via `Notice -> RefundReveal{a}`).
  - Alice pays **zero** surcharge on an honest swap (`Reveal{b}` returns `deposit_lovelace` to Alice on-chain).
  - Alice only loses `deposit_lovelace` if Bob funded ZEC (orAlice gave `go_sig` and vanished) and Alice refuses to reveal `a` for 7 days until `Forfeit`.
