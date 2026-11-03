#!/usr/bin/env python3
"""Sweep timelock margins in bounded mode.
SAFETY: no honest-party loss for any adversary. LIVENESS: the all-honest run always ends in a completed swap.
Compares with rules derived by hand (times measured from Alice's lock submission at t=0):
   safety          <=>  T2 - max(T1, D) >= D + 1    (Alice's Refund, sent when T1 opens or when her lock
                                                     lands, whichever is later, is mined before Punish opens)
   swap completes  <=>  T0 >= 2D and T1 >= 3D + 1   (worst-case go-sig time is 2D: lock and funding each take <= D;
                                                     Bob needs go-sig by T1 - 1 - D. T1 >= T0 + D + 1 is the simple sufficient rule.)"""
from foc_model import explore
import json
rows = []; total_states = 0
for D in (1, 2, 3):
    for T0 in range(0, 3 * D + 2):
        for g1 in range(0, D + 3):
            for g2 in range(0, D + 3):
                T1, T2 = T0 + g1, T0 + g1 + g2
                p = dict(D=D, T0=T0, T1=T1, T2=T2, bounded=True)
                safe = True; live = None
                for hA, hB in ((True, True), (True, False), (False, True)):
                    r = explore(p, hA, hB); total_states += r['states']
                    kinds = {k for b, _, _ in r['violations'] for k in b}
                    if kinds & {'HONEST_ALICE_LOSS', 'HONEST_BOB_LOSS', 'S5_TWO_BRANCHES', 'S2_BOTH_KNOW_KEY'}: safe = False
                    if hA and hB:
                        # liveness: every terminal of the all-honest run is a completed swap
                        live = r['terminals'] > 0 and r['completed_terminals'] == r['terminals']
                rows.append(dict(D=D, T0=T0, T1=T1, T2=T2, safe=safe, live=live,
                                 pred_safe=(T2 - max(T1, D) >= D + 1), pred_live=(T0 >= 2 * D and T1 >= 3 * D + 1)))
ms = [r for r in rows if r['safe'] != r['pred_safe']]
ml = [r for r in rows if r['live'] != r['pred_live']]
print(f"configs={len(rows)} total_states_explored={total_states} safe={sum(r['safe'] for r in rows)} live={sum(bool(r['live']) for r in rows)}")
print(f"safety_rule_mismatches={len(ms)} liveness_rule_mismatches={len(ml)}")
for r in (ms + ml)[:20]: print('MISMATCH', r)
json.dump(rows, open('sweep_results.json', 'w'), indent=0)
