"""zeUTXO path1 step5 — timing budgets (Poisson block arrivals) + per-swap value cap model.
First principles only; all market inputs are dated web observations (see memo §value cap). SIMULATION / ANALYSIS ONLY."""
import json, math
from math import comb
from scipy.stats import gamma, nbinom

def rosenfeld(q, n):
    """P(attacker with share q ever reverses a tx buried under n blocks) — Rosenfeld 2014 (arXiv:1402.2009), exact
    negative-binomial race + gambler's-ruin catch-up. Valid for PoW; for Ouroboros-like PoS with small f the
    Kovalchuk et al. 2026 closed form (Cybersecurity 6(3):80) gives nearly identical values (checked below)."""
    if q >= 0.5: return 1.0
    p = 1 - q
    if n == 0: return 1.0
    s = sum(comb(m + n - 1, m) * (p**n * q**m - q**n * p**m) for m in range(0, n + 1))
    return 1 - s

# --- cross-check vs Kovalchuk et al. 2026 Table 3 (f = 0.05) ---
xcheck = {(0.30, 10): 0.065115, (0.35, 20): 0.053580, (0.40, 50): 0.043867, (0.30, 40): 1.9675e-4}
xc = {f"q={q},z={z}": {"rosenfeld": rosenfeld(q, z), "kovalchuk2026": v} for (q, z), v in xcheck.items()}

# --- timing: time for k blocks ~ Gamma(k, mean) (Poisson arrivals; Cardano slots Bernoulli f=0.05 -> NegBin, nearly Gamma)
def t_q(k, mean_s, pct):
    return gamma.ppf(pct, k, scale=mean_s)
def cardano_q(k, pct, f=0.05):          # exact: slots until k-th non-empty slot (1 s slots)
    return nbinom.ppf(pct, k, f) + k
def tail(k, mean_s, budget_s): return gamma.sf(budget_s, k, scale=mean_s)

chains = {"cardano": 20.0, "zcash_now": 75.0, "zcash_nu7": 25.0}
quant = {}
for nm, mean in chains.items():
    for k in [1, 3, 10, 15, 30, 60]:
        quant[f"{nm}:k={k}"] = {"mean_s": k * mean, "p99.9_s": round(t_q(k, mean, 0.999), 1), "p99.999_s": round(t_q(k, mean, 0.99999), 1),
                                "x2.5_s": 2.5 * k * mean, "P(> 2.5x mean)": float(tail(k, mean, 2.5 * k * mean))}
quant["cardano_exact_negbin:k=15"] = {"p99.9_s": float(cardano_q(15, 0.999)), "p99.999_s": float(cardano_q(15, 0.99999))}

# --- real-world timing budgets (spec v0.4 §T) ---
def budgets(Kc, Dc_blocks, Zz, Dz_blocks, zmean, R_s=300, drift_s=60, E=1):
    bud = lambda k, mean: max(2.5 * k * mean, t_q(k, mean, 0.999))   # 2.5x mean, never below the 99.9th percentile
    S = bud(Kc, 20); D = bud(Dc_blocks, 20); DA = D + S; M = (1 + E) * DA
    zfund = bud(Dz_blocks + Zz, zmean)                 # Bob's fund tx included + buried Z deep
    T0 = DA + zfund                                    # from Alice's lock broadcast: lock settles, then ZEC final
    T1 = T0 + 1 + M + R_s; T2 = T1 + M + 1; LAST = T1 - 1 - M
    return {k: round(v / 60, 1) for k, v in dict(D=D, S=S, DA=DA, M=M, R=R_s, drift=drift_s, zec_funding_budget=zfund, T0=T0, T1=T1, T2=T2, LAST=LAST,
            slack_after_late_go=LAST - T0, worst_case_refund_lock_time=T2).items()}

# --- value cap ---
PX = {"ZEC_usd": 1254.54, "ADA_usd": 0.188, "asof": "2026-11-02"}
ZEC_REWARD_NOW = 1.25         # ZEC to miners per block now (1,440 ZEC/day / 1,152 blocks) — cryptohall24, zips
ADA_REWARD_PER_BLOCK = 4.61e6 / 21600   # epoch rewards / blocks per epoch (cardanoscan, epoch 663)
THREAT = {"q_zcash": 0.35, "a_cardano": 0.15}   # largest pool ViaBTC 31-33%; largest Cardano operator Coinbase 12-13% (rounded up)
SAFETY = 10.0                  # attempt EV must be <= 1/10 of what a failed attempt forfeits
EPS = {"rehearsal": 0.25, "v1": 1e-3}
POLICY = {"rehearsal": 500.0}   # fixed ceiling for a first real-value rehearsal (affordable-to-lose)   # absolute ceiling on reversal probability by the largest single entity

def chain_cap(q, n, reward_usd_per_block, extra_blocks=0):
    P = rosenfeld(q, n)
    lost = q / (1 - q) * (n + extra_blocks) * reward_usd_per_block   # private blocks orphaned if the attempt fails
    return P, lost, lost / (SAFETY * P) if P > 0 else float("inf")

def cap(K, Z, era="nu7", tier="v1"):
    rz = ZEC_REWARD_NOW * (1 if era == "now" else 1/3) * PX["ZEC_usd"]
    ra = ADA_REWARD_PER_BLOCK * PX["ADA_usd"]
    pz, lz, cz = chain_cap(THREAT["q_zcash"], Z, rz)
    pa, la, ca = chain_cap(THREAT["a_cardano"], K, ra)
    ok_p = pz <= EPS[tier] and pa <= EPS[tier]
    outright = Z * rz                                   # renting a hash majority for Z block-times at revenue parity
    usd = min(POLICY.get(tier, float("inf")), 0.5 * outright, cz, ca) if ok_p else 0.0
    return {"K": K, "Z": Z, "era": era, "tier": tier, "P_zcash": pz, "P_cardano": pa, "zec_forfeit_usd": round(lz), "ada_forfeit_usd": round(la),
            "half_outright_rewrite_usd": round(0.5 * outright), "cap_zcash_usd": round(cz), "cap_cardano_usd": round(ca), "prob_ceiling_ok": ok_p, "cap_usd": round(usd)}

def min_depth(q, eps):
    n = 1
    while rosenfeld(q, n) > eps: n += 1
    return n

out = {"crosscheck": xc, "quantiles": quant,
       "budgets_rehearsal_now_K15_Z10": budgets(15, 3, 10, 2, 75), "budgets_rehearsal_nu7_K15_Z30": budgets(15, 3, 30, 6, 25), "budgets_v1_nu7_K15_Z60": budgets(15, 3, 60, 6, 25), "budgets_v1_nu7_K15_Z96": budgets(15, 3, 96, 6, 25),
       "rewrite_cost": {
           "zcash_usd_per_block_now": ZEC_REWARD_NOW * PX["ZEC_usd"], "zcash_usd_per_block_nu7": ZEC_REWARD_NOW / 3 * PX["ZEC_usd"],
           "zcash_rent_majority_10_blocks_usd_now": 10 * ZEC_REWARD_NOW * PX["ZEC_usd"],
           "zcash_rent_majority_10+8_blocks_usd_now": 18 * ZEC_REWARD_NOW * PX["ZEC_usd"],
           "cardano_usd_per_block_rewards": ADA_REWARD_PER_BLOCK * PX["ADA_usd"],
           "cardano_majority_stake_usd": 0.5 * 21.5e9 * PX["ADA_usd"]},
       "reversal_prob": {f"q={q}": {f"n={n}": rosenfeld(q, n) for n in [3, 10, 15, 30, 60]} for q in [0.05, 0.13, 0.15, 0.20, 0.25, 0.33, 0.35, 0.47]},
       "min_depth_eps1e-3": {f"q={q}": min_depth(q, 1e-3) for q in [0.13, 0.15, 0.2, 0.25, 0.33, 0.35]},
       "caps": [cap(K, Z, era, tier) for (K, Z, era, tier) in [(15, 10, "now", "rehearsal"), (15, 10, "now", "v1"), (15, 30, "nu7", "rehearsal"), (15, 30, "nu7", "v1"),
                 (15, 60, "nu7", "v1"), (15, 96, "nu7", "v1"), (15, 30, "now", "v1"), (15, 60, "now", "v1"), (30, 60, "nu7", "v1"), (30, 90, "nu7", "v1"), (30, 120, "nu7", "v1")]],
       "inputs": {"prices": PX, "threat": THREAT, "safety": SAFETY, "eps": EPS, "ada_reward_per_block": ADA_REWARD_PER_BLOCK, "zec_reward_now": ZEC_REWARD_NOW}}
print(json.dumps(out, indent=1, default=float))
json.dump(out, open("../results/step5_model.json", "w"), indent=1, default=float)
