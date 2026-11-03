#!/usr/bin/env bash
# step6 S3: Zcash sim-node rule tests (NU6.3 / NU7). Fresh throwaway keys every run. SIMULATOR ONLY.
set -u
Z=$(dirname "$0")/target/release/zec
W=${1:-/tmp/zeutxo-s6-neg}; rm -rf "$W"; mkdir -p "$W"
r(){ python3 -c "import os;print(os.urandom($1).hex())"; }
PASS=0; FAIL=0; OUT="$W/results.jsonl"
mk(){ # mk name [branch] [nu7_height] [start_height]
  local d="$W/$1"; mkdir -p "$d"; local br=${2:-$((0x37a5165b))}
  cat > "$d/params.json" <<P
{"ada_network_id":0,"zec_network":"sim-ironwood","script_hash":"$(r 28)","lovelace":100000000,"zats":10000000,"t0":1,"t1":2,"t2":3,"t3":4,"k_depth":10,"z_depth":64,"alice_pkh":"$(r 28)","bob_pkh":"$(r 28)","alice_go_vk":"$(r 32)","zec_branch":$br}
P
  for p in alice bob; do $Z keygen dir=$d party=$p >/dev/null; done
  for p in alice bob; do $Z prove dir=$d party=$p >/dev/null; done
  for p in alice bob; do $Z reveal dir=$d party=$p >/dev/null; done
  for p in alice bob; do $Z setup dir=$d party=$p >/dev/null || echo "setup failed $1"; done
  $Z genesis dir=$d nu7_height=${3:-1000000000} start_height=${4:-1} >/dev/null
}
expect(){ # expect name want(accept|reject|refuse) regex cmd...
  local name=$1 want=$2 rx=$3; shift 3
  local o; o=$("$@" 2>&1); local rc=$?
  local got; if [ $rc -eq 0 ]; then got=accept; elif echo "$o" | grep -q '"accepted":false\|"valid":false'; then got=reject; else got=refuse; fi
  local ok=false; if [ "$got" = "$want" ] && echo "$o" | grep -Eq "$rx"; then ok=true; PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  python3 -c "import json,sys;print(json.dumps({'test':sys.argv[1],'want':sys.argv[2],'got':sys.argv[3],'ok':sys.argv[4]=='true','out':sys.argv[5][-400:]}))" "$name" "$want" "$got" "$ok" "$o" >> "$OUT"
  echo "$ok  $name ($got)"
}
fundsub(){ local d=$W/$1; shift; $Z fund dir=$d amount=10000000 out=$d/f.tx "$@" >$d/fund.out 2>&1 || { cat $d/fund.out; return 9; }; $Z submit dir=$d tx=$d/f.tx; }

mk ok;          expect "honest Ironwood->Ironwood v6 NU6.3 funding accepted" accept '"accepted":true' fundsub ok
mk xo;          expect "Orchard cross-address transfer (v5, NU6.3 branch, enableCrossAddress proof) rejected" reject 'proof_ok=false' fundsub xo cheat=orchard_cross
mk xo6;         expect "library refuses to write Orchard cross-address flags into v6" refuse 'LIBRARY REFUSED|builder refused|add_output|serialize' $Z fund dir=$W/xo6 amount=10000000 out=$W/xo6/f.tx cheat=orchard_v6_cross
mk inflow;      expect "Orchard inflow (valueBalanceOrchard<0) rejected" reject 'Orchard inflow' fundsub inflow cheat=orchard_inflow
mk turn;        expect "direct Orchard->Ironwood funding refused by wallet policy" refuse 'REFUSE \(wallet policy\)' $Z fund dir=$W/turn amount=10000000 out=$W/turn/f.tx cheat=orchard_turnstile
mk turn2;       expect "forced Orchard->Ironwood turnstile crossing is consensus-valid" accept '"accepted":true' fundsub turn2 cheat=allow_turnstile
mk vk;          expect "Ironwood proof made with pre-NU6.3 (FixedPostNu6_2) key rejected" reject 'proof_ok=false' fundsub vk cheat=wrong_vk
mk wb;          expect "NU7 branch id before NU7 activation rejected" reject 'wrong consensus branch' fundsub wb cheat=wrong_branch
mk n62;         expect "old-wallet v5 NU6.2 tx rejected after NU6.3" reject 'wrong consensus branch' fundsub n62 cheat=nu62_v5
mk e0;          expect "expiry_height 0 rejected" reject 'ExpiryZero' fundsub e0 expiry=0
mk ex;          expect "tx expiring at tip rejected (TxExpired)" reject 'TxExpired' fundsub ex expiry=1
# NU7 era: chain at 100, NU7 at 101
mk n7 $((0x77190ad9)) 101 100
expect "post-NU7: honest v6 NU7 funding accepted" accept '"branch":"Nu7"' fundsub n7
mk n7b $((0x77190ad9)) 101 100
expect "post-NU7: NU6.3-branch tx rejected" reject 'wrong consensus branch' fundsub n7b cheat=wrong_branch
mk n7v4 $((0x77190ad9)) 101 100; $Z v4probe out=$W/n7v4/v4.tx >/dev/null
expect "post-NU7: v4 transaction rejected" reject 'v4 transactions are invalid' $Z submit dir=$W/n7v4 tx=$W/n7v4/v4.tx
# expiry cap: chain at 80, NU7 at 100: default expiry must be 99 (not 121)
mk cap $((0x37a5165b)) 100 80
expect "expiry capped at nu7_height-1 for a pre-NU7 tx" accept '"default_expiry":99,.*"expiry_capped_at_nu7":true|"expiry_capped_at_nu7":true' $Z status dir=$W/cap
mk cap2 $((0x37a5165b)) 300 80
expect "post-NU7 default expiry delta 120 / pre-NU7 40" accept '"default_expiry":121' $Z status dir=$W/cap2
# a sweep built and signed just before NU7 cannot be mined after activation (branch id is in the sighash)
mk sw $((0x37a5165b)) 70 1
fundsub sw >/dev/null; $Z mine dir=$W/sw n=65 >/dev/null   # tip 67; next block 68 still NU6.3
$Z watch dir=$W/sw party=bob amount=10000000 min_depth=64 >/dev/null
AX=$(python3 -c "import json;print(json.load(open('$W/sw/alice/secret.json'))['x'])")
$Z sweep dir=$W/sw party=bob mode=solo other_share=$AX expiry=200 out=$W/sw/s_late.tx >/dev/null
$Z sweep dir=$W/sw party=bob mode=solo other_share=$AX out=$W/sw/s_def.tx >/dev/null
expect "pre-NU7 wallet-default sweep expiry is capped at nu7_height-1 (=69)" accept '"default_expiry":69' $Z status dir=$W/sw
$Z mine dir=$W/sw n=3 >/dev/null                             # tip 70: NU7 active for block 71
expect "NU6.3-signed sweep (forced expiry 200) rejected after NU7 activation" reject 'wrong consensus branch' $Z submit dir=$W/sw tx=$W/sw/s_late.tx
expect "NU6.3-signed sweep (default capped expiry) rejected after NU7 activation" reject 'wrong consensus branch|TxExpired' $Z submit dir=$W/sw tx=$W/sw/s_def.tx
expect "rebuilt sweep (NU7 branch, +120 expiry) accepted" accept '"branch":"Nu7"' bash -c "$Z sweep dir=$W/sw party=bob mode=solo other_share=$AX out=$W/sw/s2.tx >/dev/null && $Z submit dir=$W/sw tx=$W/sw/s2.tx"
# signature/proof cheats on the Ironwood sweep (carried over from step 5)
mk ch $((0x37a5165b))
fundsub ch >/dev/null; $Z mine dir=$W/ch n=64 >/dev/null; $Z watch dir=$W/ch party=bob amount=10000000 min_depth=64 >/dev/null
AX2=$(python3 -c "import json;print(json.load(open('$W/ch/alice/secret.json'))['x'])")
for c in one_share wrong_share no_negation wrong_sighash; do
  expect "Ironwood sweep cheat $c rejected (bad spend-auth sig)" reject 'bad spend-auth sigs at actions \[[0-9]' bash -c "$Z sweep dir=$W/ch party=bob mode=solo other_share=$AX2 cheat=$c out=$W/ch/$c.tx >/dev/null && $Z submit dir=$W/ch tx=$W/ch/$c.tx"
done
expect "Ironwood sweep with tampered proof rejected" reject 'proof_ok=false' bash -c "$Z sweep dir=$W/ch party=bob mode=solo other_share=$AX2 cheat=tamper_proof out=$W/ch/tp.tx >/dev/null && $Z submit dir=$W/ch tx=$W/ch/tp.tx"
expect "solo sweep with a wrong revealed share refused before signing" refuse 'REFUSE: revealed share' $Z sweep dir=$W/ch party=bob mode=solo other_share=$(python3 -c "print('01'+'00'*31)") out=$W/ch/x.tx
expect "adaptor-completed Ironwood sweep accepted" accept '"accepted":true' bash -c "$Z sweep dir=$W/ch party=bob mode=adaptor out=$W/ch/ad.tx >/dev/null && $Z check dir=$W/ch tx=$W/ch/ad.tx && $Z submit dir=$W/ch tx=$W/ch/ad.tx"
expect "replay of the spent joint note rejected (double spend)" reject 'double spend' bash -c "$Z sweep dir=$W/ch party=bob mode=joint out=$W/ch/j.tx >/dev/null; $Z submit dir=$W/ch tx=$W/ch/j.tx"
expect "Bob's balance has the swept note (Ironwood)" accept '"unspent_ironwood_zats":99980000' $Z balance dir=$W/ch party=bob
expect "use_qsk / ak normalisation selftest" accept '"ok":true' $Z selftest
echo "PASS=$PASS FAIL=$FAIL"; echo "{\"pass\":$PASS,\"fail\":$FAIL}" > $W/summary.json
