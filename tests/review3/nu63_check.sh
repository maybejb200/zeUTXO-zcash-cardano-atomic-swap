#!/bin/sh
# R3-C1 reproduction (static, box-only): the step-5 Zcash leg is built and validated under pre-NU6.3 rules.
# ZIP 258 (NU6.3, mainnet height 3,428,143 / testnet 4,134,000): every Orchard-pool Action must have
# enableCrossAddress=0 (enforced by the circuit verifying key, v5 txs too) and valueBalanceOrchard >= 0.
SRC=../work/zec/src/main.rs
echo "branch used to build/verify txs:"; grep -n "const BRANCH" $SRC
echo "tx version:"; grep -n "TxVersion::V5" $SRC | head -2
echo "Bob's fund tx: spends his own wallet note and pays the NEW joint Orchard address (cross-address transfer):"; grep -n "let (bytes, info) = build_tx(vec!\[(FullViewingKey::from(&sk)" $SRC | cut -c1-220
echo "sweep: spends the joint note to a different address (cross-address again):"; grep -n "vec!\[(to, note.value().inner() - fee)\]" $SRC | cut -c1-160
echo "does the simulated node enforce any NU6.3 rule (enableCrossAddress / Orchard pool balance >= 0 / Ironwood)?"
if grep -qiE "cross_?address|ironwood|Nu6_3|OrchardPoolBalance" $SRC; then echo "  some reference found"; else echo "  NONE -> all 269 checks validate against superseded consensus rules"; fi
echo "orchard crate:"; grep -n '^orchard' ../work/zec/Cargo.toml
