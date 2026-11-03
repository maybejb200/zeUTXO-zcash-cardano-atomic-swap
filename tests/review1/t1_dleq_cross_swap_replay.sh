#!/bin/bash
# T1: Is the DLEQ context bound to the swap the VERIFIER expects, or to whatever swap id the prover writes?
# Fresh throwaway keys only. Bob's proof is made for swap "OLD-SWAP"; Alice is in swap "NEW-SWAP".
set -u
Z=/workspace/zeutxo-path1/review1/sim/zec/target/release/zec
D=$(mktemp -d /workspace/zeutxo-path1/review1/sim/runs-t1-XXXX)
$Z keygen dir=$D party=alice swap=NEW-SWAP >/dev/null
$Z keygen dir=$D party=bob swap=OLD-SWAP >/dev/null
$Z reveal dir=$D party=alice >/dev/null; $Z reveal dir=$D party=bob >/dev/null
echo "alice pub swap: $(python3 -c "import json;print(json.load(open('$D/alice/pub.json'))['swap'])")  bob pub swap: $(python3 -c "import json;print(json.load(open('$D/bob/pub.json'))['swap'])")"
echo "Alice's setup result (expected ABORT if ctx were bound to Alice's own swap id):"
$Z setup dir=$D party=alice
echo "exit=$?"
