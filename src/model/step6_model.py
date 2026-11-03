"""zeUTXO path1 step6 — R3-H1 (NU7 transition), R3-H2 (Cardano congestion), R3-H3 (value cap), R3-M1/M3.
ANALYSIS ONLY. First-principles models; every market/network input is a dated observation (2026-11-02) or a ZIP value.
The DAA-recovery curve is a MODEL fitted to ZIP 218's stated recovery figures, not a simulation of Zebra's DAA."""
import json, math, random
from math import comb
from scipy.stats import gamma
import numpy as np

def rosenfeld(q, n):
    if q >= 0.5: return 1.0
    p = 1 - q   # same Rosenfeld sum, written with the negative-binomial pmf so large n does not overflow
    from scipy.stats import nbinom
    m = np.arange(0, n + 1)
    return float(1 - np.sum(nbinom.pmf(m, n, p) * (1 - (q / p) ** (n - m))))
def q_eff(q, stale): return q / (q + (1 - q) * (1 - stale))      # honest stales waste honest work only (review3 R3-H3)
def min_depth(q, eps):
    n = 1
    while rosenfeld(q, n) > eps and n < 3000: n += 1
    return n
bud = lambda k, mean: max(2.5 * k * mean, gamma.ppf(0.999, k, scale=mean))

# ---------------- R3-H3 value cap ----------------
EPS = 1e-3
vc = {}
for stale in [0.0, 0.0326, 0.0486, 0.05]:
    for q in [0.30, 0.33, 0.35, 0.40]:
        qe = q_eff(q, stale); vc[f"q={q},stale={stale}"] = {"q_eff": round(qe, 4), "Z_min_eps1e-3": min_depth(qe, EPS), "P_at_Z64": rosenfeld(qe, 64), "P_at_Z69": rosenfeld(qe, 69)}
# rule: v1 needs q_gate = max(largest pool, 0.35) with stale 5% (ZIP 218 devnet 4.86%, rounded up) -> Z
Z_V1 = min_depth(q_eff(0.35, 0.05), EPS)
Z_V1_326 = min_depth(q_eff(0.35, 0.0326), EPS)
# top-2 coalition: the gate refuses top-2 > 50% (any such coalition can reverse with prob 1); between 35% and 50% we refuse too
top2 = {f"top2={t}": {"Z_min": min_depth(q_eff(t, 0.05), EPS) if t < 0.5 else None} for t in [0.40, 0.45, 0.478, 0.50]}
# ---- exposure counter: per-counterparty lifetime budget so that P(any reversal) <= 1%
n_swaps_1pct = math.floor(math.log(1 - 0.01) / math.log(1 - EPS))

# ---------------- R3-H1 NU7 transition (block-time recovery model) ----------------
# ZIP 218: averaging window 17 -> 102 (x6); with window 17 activation spacing ~56.8 s, <=30 s after 30 blocks.
# Model: mean spacing s(n) = 25 + 31.8 * exp(-n / tau), tau fitted so s(6*30) = 30 s (window 102 needs ~6x the blocks).
tau = 180 / math.log(31.8 / 5.0)
s_of = lambda n: 25 + 31.8 * math.exp(-n / tau)
def recov_time(n_blocks):   # seconds from activation until block n (mean)
    return sum(s_of(i) for i in range(n_blocks))
recovery = {"tau_blocks": round(tau, 1), "s(0)": round(s_of(0), 1), "s(102)": round(s_of(102), 1), "s(180)": round(s_of(180), 1), "s(300)": round(s_of(300), 1),
            "mins_until_spacing<=37.5s(1.5x)": round(recov_time(next(n for n in range(10000) if s_of(n) <= 37.5)) / 60, 1),
            "blocks_until_spacing<=37.5s": next(n for n in range(10000) if s_of(n) <= 37.5),
            "hours_until_spacing<=26.25s": round(recov_time(next(n for n in range(10000) if s_of(n) <= 26.25)) / 3600, 2)}
def mc_time(start_n, k, trials=20000, seed=1):  # hypoexponential: k blocks starting at block start_n after activation
    rng = np.random.default_rng(seed); means = np.array([s_of(start_n + i) for i in range(k)])
    return float(np.quantile(rng.exponential(means, size=(trials, k)).sum(axis=1), 0.999))

# ---------------- timing budgets (real minutes) ----------------
def budgets(Kc=15, Dc_blocks=3, Zz=69, Dz_blocks=6, zmean=25.0, R_s=300, drift_s=60, E=1, sigma=None):
    S = bud(Kc, 20)
    D = bud(Dc_blocks, 20) if sigma is None else max(bud(Dc_blocks, 20), gamma.ppf(0.999, 3, scale=20 / sigma))   # R3-H2: inclusion only via directly-reached stake share sigma
    DA = D + S; M = (1 + E) * DA
    zfund = bud(Dz_blocks + Zz, zmean)
    T0 = DA + zfund; T1 = T0 + 1 + M + R_s; LAST = T1 - 1 - M
    T2 = T1 + 1 + R_s + M                        # R3-M3/H2: Alice's refund window [T1, LAST_REFUND = T2 - M] is >= R
    LAST_REFUND = T2 - M
    return {k: round(v / 60, 1) for k, v in dict(D=D, S=S, M=M, R=R_s, zec_funding_budget=zfund, T0=T0, LAST=LAST, T1=T1, LAST_REFUND=LAST_REFUND, T2=T2).items()}
B_step5 = budgets(Zz=60, zmean=25.0)          # for reference (step5 had T2 = T1 + M + 1; here T2 includes R)
B_nom = budgets(Zz=Z_V1, zmean=25.0)
B_gate = budgets(Zz=Z_V1, zmean=37.5)         # funding budget sized at the 1.5x gate: any start the gate allows fits
B_gate_sigma = budgets(Zz=Z_V1, zmean=37.5, sigma=0.25)
# does a start right after activation fit the gated budget?
zf_gate_s = bud(6 + Z_V1, 37.5)
post_act = {f"start_at_block_{n}": {"p99.9_min": round(mc_time(n, 6 + Z_V1) / 60, 1), "fits_gated_budget": mc_time(n, 6 + Z_V1) <= zf_gate_s, "measured_spacing_s": round(s_of(n), 1), "gate_allows": s_of(n) <= 37.5}
            for n in [0, 30, 60, 100, 150, 300, 1000]}
# blackout in heights: 24 h before activation at 75 s = 1152 blocks; 24 h after at recovering spacing
blk_after_24h = next(n for n in range(100000) if recov_time(n) >= 86400)
blackout = {"pre_blocks": 24 * 3600 // 75, "post_blocks": blk_after_24h, "mainnet_nu7_height": 3543405, "refuse_heights": [3543405 - 1152, 3543405 + blk_after_24h]}

# ---------------- R3-H2 Cardano congestion ----------------
BODY, TXMAX, FA, FB, ADA_USD = 90112, 16384, 44, 155381, 0.188
tx_per_block = BODY // TXMAX
fill_ada_per_block = tx_per_block * (FA * TXMAX + FB) / 1e6      # cheapest full-block spam (max-size txs)
fill_usd_per_s = fill_ada_per_block * ADA_USD / 20
def stall_cost_usd(seconds): return fill_usd_per_s * seconds
# mempool: cardano-node default capacity = 2 x max block body. FIFO, no fee priority. Once a tx is ADMITTED at a block
# producer, at most ~2 blocks' worth of bytes are ahead of it there, so later spam cannot push it back.
cong = {"tx_per_block": tx_per_block, "fill_ada_per_block": round(fill_ada_per_block, 2), "fill_usd_per_min": round(fill_usd_per_s * 60, 2),
        "stall_cost_usd_for_M_step5_32.5min": round(stall_cost_usd(32.5 * 60), 0),
        "stall_hours_needed_for_cost>=500": round(500 / fill_usd_per_s / 3600, 1), "stall_hours_needed_for_cost>=15000": round(15000 / fill_usd_per_s / 3600, 1),
        "inclusion_p99.9_min_after_admission_at_stake_sigma": {f"sigma={s}": round(gamma.ppf(0.999, 3, scale=20 / s) / 60, 1) for s in [0.05, 0.10, 0.25, 0.50, 1.0]}}
# Monte Carlo: FIFO mempools at N producers with stake shares, attacker refills every mempool to capacity each slot;
# Bob submits directly to producers holding stake >= sigma; b is public once any producer admits it. Measure P(not included
# within the D_adv budget | admitted). Capacity 2 blocks, so Bob waits for the producers holding it to make <= 3 blocks.
def spam_mc(sigma, budget_s, trials=20000, f=0.05, seed=7):
    rng = random.Random(seed); late = 0
    for _ in range(trials):
        # Bob's tx is admitted at time 0 at producers with total stake sigma (it becomes head-of-queue behind <=2 blocks)
        made = 0; t = 0
        while made < 3:
            t += 1
            if rng.random() < f * sigma: made += 1     # a slot led by one of Bob's producers (others are full of spam)
            if t > budget_s: late += 1; break
    return late / trials
D_adv = gamma.ppf(0.999, 3, scale=20 / 0.25)
cong["mc_P_late_sigma0.25_within_D_adv"] = spam_mc(0.25, D_adv)
cong["mc_P_late_sigma0.10_within_D_adv(0.25)"] = spam_mc(0.10, D_adv)
cong["D_adv_s(sigma=0.25)"] = round(D_adv, 0)
# economic rule search: Alice gains V if Bob's ADMITTED Redeem misses T1. Spam cannot do it (FIFO after admission).
# Spam CAN prevent admission (Bob's tool then never reveals b: liveness loss, both refund). The theft route that remains is
# producer bribery (exclude an admitted tx for > D_adv), whose cost is not bounded by any on-chain fee: no economic rule
# under the caps bounds it. Griefing cost (keep mempools full from go to LAST):
grief = {"usd_to_block_admission_for_R_5min": round(stall_cost_usd(300), 1), "usd_to_block_until_LAST_v1": round(stall_cost_usd((B_gate_sigma['LAST'] - B_gate_sigma['T0']) * 60), 1)}

# ---------------- R3-M1 free option ----------------
def opt_value(minutes, sigma_ann=1.0): return 0.4 * sigma_ann * math.sqrt(minutes / (365 * 24 * 60))
fo = {"alice_option_minutes_v1": B_gate_sigma["T0"], "value_pct": round(100 * opt_value(B_gate_sigma["T0"]), 3),
      "usd_at_15000": round(15000 * opt_value(B_gate_sigma["T0"]), 0), "usd_at_500": round(500 * opt_value(B_gate_sigma["T0"]), 1),
      "bob_option_minutes": round(B_gate_sigma["LAST"] - B_gate_sigma["T0"], 1), "bob_value_pct": round(100 * opt_value(B_gate_sigma["LAST"] - B_gate_sigma["T0"]), 3),
      "mitigation": "Alice pays Bob a non-refundable premium = option value (rounded up to 0.5% v1 / 0.5% rehearsal) in a separate Cardano payment that Bob sees settled (K deep) BEFORE he funds; Bob's tool refuses to fund otherwise. Abort rate-limit per counterparty."}
out = {"value_cap": {"q_eff_table": vc, "Z_v1_stale5pct": Z_V1, "Z_v1_stale3.26pct": Z_V1_326, "top2": top2, "exposure_swaps_per_counterparty_for_1pct": n_swaps_1pct},
       "nu7": {"recovery_model": recovery, "post_activation_starts": post_act, "blackout": blackout, "zfund_gate_budget_min": round(zf_gate_s / 60, 1)},
       "budgets_min": {"step5_reference_Z60": B_step5, "v1_nominal_25s": B_nom, "v1_gate_37.5s": B_gate, "v1_gate_37.5s_sigma0.25": B_gate_sigma,
                       "rehearsal_now_Z10_75s_gate112.5": budgets(Zz=10, Dz_blocks=2, zmean=112.5, sigma=0.25)},
       "congestion": cong, "griefing": grief, "free_option": fo}
print(json.dumps(out, indent=1, default=float))
json.dump(out, open("../results/step6_model.json", "w"), indent=1, default=float)
