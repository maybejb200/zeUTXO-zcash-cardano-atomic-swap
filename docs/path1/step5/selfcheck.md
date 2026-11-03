# Step 5 adversarial self-check: **NOT INDEPENDENT**
The same agent that wrote the step-5 fixes wrote this check (Mon Nov 2, 2026, ~11 PM ET). Use it as a checklist for a real
independent review, not as a substitute. The step-3/4 self-check is kept in results/from_step4/selfcheck_step3_4.md.

| # | Question I tried to break | My answer | Evidence |
|---|---|---|---|
| 1 | Can any datum Bob accepts be read differently by the script? | Only if two different byte strings were both accepted. Bob accepts exactly one byte string (his own canonical rebuild), so no. | f1: 13 variants refused with specific reasons; honest control accepted; Data.to == hand-built CBOR |
| 2 | Could Bob's canonical rebuild differ from what an honest Alice's wallet writes, making honest swaps fail? | Yes, if Alice's wallet used another Plutus Data encoder (e.g. a definite-length list). That is a liveness failure (Bob refuses before funding), never a loss. Spec B.1 now fixes the encoding. | spec B.1; f1 "definite-length list" refused |
| 3 | Datum hash, stake credential, extra assets, 1 lovelace short? | All refused before funding. | f1 hash/stake/value |
| 4 | Is the review2 hostage still possible? | No: Bob refuses the t2-as-bytes lock, so no ZEC is ever at risk; Alice just refunds her own ADA. | hostage 2/2 |
| 5 | Forged go via identity-R or small-order go key? | Refused three ways: go key rejected at setup; Bob's strict check rejects small-order R; the node-equivalent ledger rejects even when the setup check is bypassed. The local UPLC evaluator alone still accepts both (shown as "observe"), which is why spec B.3 requires Bob's own node. | f2 18/18 |
| 6 | Are the two strict checks independent? | Partly. Both use libsodium (the ledger overlay only libsodium; Bob libsodium + OpenSSL + explicit rules). A libsodium bug would hit both in the sim. Real-world independence comes from Bob's own cardano-node. | decisions S5-D2 |
| 7 | Do the go-message negatives now prove each field is checked? | Yes for the 7 fields tested (network, domain, T1, index, swap id, lovelace, txid): real key, one change each, and the positive control is accepted. The reason string is still the generic script failure (no traces in the audited script). | gomsg 22/22 |
| 8 | Late go at exactly T0? | Bob still has LAST − T0 = R (79 s in the sim, 5 min real) and settled 260 s before T1 in the sim. | timing |
| 9 | Bob's clock wrong? | Slow by 120 s: chain-tip time catches it (refuses at true LAST+10 s, where wall-clock-only would reveal b). Fast: refuses early, Alice refunds, no loss. Residual: slow clock AND an unusually long block gap larger than DRIFT; LAST is still M before T1, so this eats into the settlement budget rather than causing a direct loss. Written up, not patched. | timing; decisions S5-D5 |
| 10 | Hex-case or non-canonical encodings to slip past the seen-list? | Rejected: upper-case reuse "already seen", mirrored points "duplicate", x+p, identity, cleared compression flag and infinity all refused. | seenhex 8/8 |
| 11 | Can a party push a swap above the value cap? | Both wallets refuse at setup and name the depth needed; the depth is bound into swap_id v3, so it cannot differ between the parties. | cap 7/7 |
| 12 | Is the cap itself trustworthy? | It is only as good as its inputs: price, pool shares (single-entity, no coalitions), and block rewards from public pages on Nov 2, 2026. The Rosenfeld formula matches a 2026 paper to 4 digits. A top-2 Zcash pool coalition (> 50 %) breaks the model completely. | model/step5_model.py; memo sources |
| 13 | New honest-loss flaw found? | None within the modelled bounds. Open risks: coalitions, global seen-list, price-feed staleness, and real-node integration. | memo open items |
