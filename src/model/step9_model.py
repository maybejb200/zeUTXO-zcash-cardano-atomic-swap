"""zeUTXO path1 STEP 9 — post-NU7 timing (escrow v0.7 unchanged) + Z-from-price table + Bob's reveal hold cap.
Same derivation as step8_model.budgets8 (imported). New in step 9:
  * Post-NU7 block reward to miners: NU6 subsidy 1.5625 ZEC x 80% (20% lockbox/dev fund) = 1.25 ZEC at 75 s;
    NU7 (ZIP 218 spacing 75 s -> 25 s) divides the per-block subsidy by 3 so issuance per unit time is unchanged:
    R = 1.25 / 3 = 0.41667 ZEC per block. Fees ignored (conservative: smaller R -> larger Z).
  * Economic depth: a reorg-for-profit attacker forgoes ~honest reward on the blocks he must out-mine; requiring
    Z >= 2 V / (R P) blocks (V = swap USD value, P = ZEC/USD from the live feed) makes the rewards an attacker has to
    burn at least twice the swap value. Z = max(security(q, eps, stale), ceil(2V/(R P)), floor); floors: nu7 30.
  * Bob's reveal: hold at most HOLD_CAP = 90 min after his Commit settles (<=10% of tail), then broadcast regardless;
    after T3 - 2 d broadcast with a loud warning. Lock-ups unchanged (the hold sits inside the 7 d tail)."""
import json, math, subprocess, sys
sys.argv = ["x"]; import io, contextlib
with contextlib.redirect_stdout(io.StringIO()): from step8_model import budgets8
R = 1.25 / 3
V1 = budgets8(zmean=37.5, sigma=0.25)                       # v1 post-NU7 gate (25 s nominal, 1.5x slow gate)
NOM = budgets8(zmean=25.0)
REH = budgets8(Kc=15, Zz=30, Dz_blocks=6, zmean=37.5, sigma=0.25, t3_days=2 / 24)   # rehearsal post-NU7: K15 Z30, tail 2 h
js = """import {zNeeded9} from '../ada/policy9.mjs'; const o={};
for (const p of [300,500,800,1043,1254.54,2000]) o[p]={v1_15000:zNeeded9({usd:15000,zecUsd:p,era:'nu7',tier:'v1',q:0.33}),
 v1_5000:zNeeded9({usd:5000,zecUsd:p,era:'nu7',tier:'v1',q:0.33}), rehearsal_500:zNeeded9({usd:500,zecUsd:p,era:'nu7',tier:'rehearsal',q:0.33})};
console.log(JSON.stringify(o));"""
ztab = json.loads(subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, cwd=".").stdout)
day = 1440
out = {"derivation": __doc__, "miner_reward_zec_per_block_nu7": round(R, 5),
       "econ_Z_hand_check_15000usd_at_1254.54": math.ceil(2 * 15000 / (R * 1254.54)),
       "Z_by_price": ztab, "v1_gate_37.5s_sigma0.25_min": V1, "v1_nominal_25s_min": NOM, "rehearsal_nu7_K15_Z30_tail2h_min": REH,
       "bob_reveal": {"hold_cap_min_real": 90, "late_cutoff": "T3 - 2 d", "hold_cap_frac_of_tail": round(90 / (7 * day), 4),
                      "rehearsal_hold_cap_min": 12, "rehearsal_late_cutoff_min_before_T3": 34},
       "lockups_v1_days": {"bob_commits_then_stalls_alice": round(V1["T3"] / day, 2), "alice_notices_then_stalls_bob": round(V1["t4_alice_notice"] / day, 2),
                           "worst_case_any_party": round(max(V1["T3"], V1["t4_bob_notice"]) / day, 2)},
       "rehearsal_wall_clock_min": {"happy_path_to_T1": REH["T1"], "T3": REH["T3"], "t4_bob_notice": REH["t4_bob_notice"]},
       "nu7_blackout_v1_s": round(V1["T2"] * 60 + 7 * 86400 + 86400)}
print(json.dumps({k: v for k, v in out.items() if k != "derivation"}, indent=1))
json.dump(out, open("../results/step9_model.json", "w"), indent=1)
