"""zeUTXO path1 STEP 8 — timing for escrow v0.7 (two-step claim AND two-step refund), from first principles.
ANALYSIS ONLY; same block/inclusion models as step6/7 (S = settlement of K blocks, D = inclusion bound, DA = D + S).
  T0 >= DA + Zcash funding budget; LAST_COMMIT = T1 - 1 - Mc; T1 >= T0 + 1 + R + Mc            [unchanged from step 7]
  Notice (Alice, no secret): any time >= T1 while Open. No deadline (D25/D26). REFUND_START/LAST_REFUND are gone.
  Commit (upper <= T1-1) and Notice (lower >= T1) are disjoint in time, so they can only meet in a fork that
     branches before T1; Alice reveals a only once her Notice is K deep (same assumption as Bob's reveal rule).
  t4 = Notice upper + (T3 - T1) (tail, real 7 d); Notice validity range <= 6 h (wallet uses 1 h).
  RefundReveal{a}: any time <= t4 - M (no other deadline). Forfeit (Bob): >= t4, only if a never seen.
  T2 >= T1 + S + 1 + R + Mc: from T2 Bob may Notice himself (liveness against a silent Alice; reveals nothing).
  T3 = T1 + 7 d (Escape from Claimed)."""
import json, math
from scipy.stats import gamma
bud = lambda k, mean: max(2.5 * k * mean, gamma.ppf(0.999, k, scale=mean))
def opt_value(minutes, sigma_ann=1.0): return 0.4 * sigma_ann * math.sqrt(minutes / (365 * 24 * 60))
def budgets8(Kc=15, Dc_blocks=3, Zz=69, Dz_blocks=6, zmean=25.0, R_s=300, E=1, sigma=None, t3_days=7, notice_ttl_s=3600):
    S = bud(Kc, 20)
    D = bud(Dc_blocks, 20) if sigma is None else max(bud(Dc_blocks, 20), gamma.ppf(0.999, 3, scale=20 / sigma))
    DA = D + S; M = (1 + E) * DA; Mc = (1 + E) * D
    zfund = bud(Dz_blocks + Zz, zmean)
    T0 = DA + zfund; T1 = T0 + 1 + R_s + Mc; LAST_COMMIT = T1 - 1 - Mc
    T2 = T1 + S + 1 + R_s + Mc; tail = t3_days * 86400; T3 = T1 + tail
    notice_settled = T1 + Mc + S                       # Alice Notices at T1; included within Mc, K deep after S
    t4_alice = T1 + notice_ttl_s + tail                # upper bound of a Notice sent at T1 (+1 h TTL) + tail
    refund_done = notice_settled + DA                  # RefundReveal sent once Notice is K deep, settles within DA
    t4_bob = T2 + notice_ttl_s + tail                  # Bob Notices at T2 (Alice silent)
    r = dict(D=D, S=S, M=M, Mc=Mc, R=R_s, zec_funding_budget=zfund, T0=T0, LAST_COMMIT=LAST_COMMIT, T1=T1, T2=T2, T3=T3,
             refund_notice_settled=notice_settled, refund_done_honest=refund_done, reveal_deadline_after_alice_notice=t4_alice - M,
             t4_alice_notice=t4_alice, t4_bob_notice=t4_bob)
    return {k: round(v / 60, 1) for k, v in r.items()}
V1 = budgets8(zmean=37.5, sigma=0.25); NOM = budgets8(zmean=25.0); REH = budgets8(Zz=10, Dz_blocks=2, zmean=112.5, sigma=0.25)
opts = {"alice_withhold_go_min": V1["T0"], "alice_pct": round(100 * opt_value(V1["T0"]), 3),
        "bob_commit_window_min": round(V1["T1"] - V1["T0"], 1), "bob_pct": round(100 * opt_value(V1["T1"] - V1["T0"]), 3),
        "alice_after_notice_pct": "0 in practice: after her Notice the only outcomes are her own refund or (if she stays silent) losing the ADA; she cannot get the ZEC (no b)",
        "note": "unchanged from step 7: Alice's pre-go option bounded by T0, Bob's by T1 - T0; premium stays removed."}
day = 1440
lock = {"happy_path_alice_ada_min": round(V1["LAST_COMMIT"] + V1["S"], 1),
        "honest_refund_alice_ada_min (Bob never commits)": V1["refund_done_honest"],
        "bob_commits_then_stalls_alice_ada_days": round(V1["T3"] / day, 2),
        "alice_notices_then_stalls_bob_ada_days (Bob's ZEC lost)": round(V1["t4_alice_notice"] / day, 2),
        "alice_silent_bob_notices_at_T2_days": round(V1["t4_bob_notice"] / day, 2),
        "worst_case_any_party_days": round(max(V1["T3"], V1["t4_bob_notice"]) / day, 2),
        "stacking": "impossible: Claimed (T3 clock) and Refunding (t4 clock) are exclusive successor states of Open; each 7-day lock happens at most once",
        "usd_capital_cost_7d_at_15000_5pct_pa": round(15000 * 0.05 * 7 / 365, 2)}
out = {"derivation": __doc__, "v1_gate_37.5s_sigma0.25_min": V1, "v1_nominal_25s_min": NOM, "rehearsal_now_Z10_75s_min": REH,
       "options": opts, "lockups": lock, "nu7_blackout_swap_seconds_v1": round(V1["T2"] * 60 + 86400)}
print(json.dumps(out, indent=1))
import os; _d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../results"); os.makedirs(_d, exist_ok=True)   # step 10: cwd-independent (was box layout)
json.dump(out, open(os.path.join(_d, "step8_model.json"), "w"), indent=1)
