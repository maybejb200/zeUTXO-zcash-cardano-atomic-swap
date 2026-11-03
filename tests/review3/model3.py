# review3 adversarial value/timing model (box-only arithmetic; no network).
from math import comb, exp, log
from scipy.stats import gamma

def nb(m, z, q):            # P(attacker finds m blocks while honest finds z)  (negative binomial)
    p = 1 - q
    return comb(m + z - 1, m) * p**z * q**m

def p_success(q, z, lead=0, mmax=4000):
    """Attacker (share q) wins a private race: honest chain must gain z blocks after the target tx;
    attacker starts with `lead` private blocks. Success iff attacker ever gets ahead (Rosenfeld-style)."""
    if q >= 0.5: return 1.0
    p = 1 - q; r = q / p; s = 0.0
    for m in range(mmax):
        d = z - m - lead              # deficit after honest's z blocks
        w = nb(m, z, q)
        s += w * (1.0 if d < 0 else r ** (d + 1))
        if m > z and w < 1e-30: break
    return min(1.0, s)

def q_eff(q, stale):        # honest work wasted on stales raises attacker's effective share
    return q / (q + (1 - q) * (1 - stale))

def p_reach_lead(q, L):     # one selfish-mining attempt reaches private lead L before falling behind
    p = 1 - q; a = p / q
    return (a - 1) / (a ** (L + 1) - 1)

out = []
pr = lambda *a: (print(*a), out.append(" ".join(str(x) for x in a)))
pr("== Rosenfeld-style reversal probability at Zcash depth Z")
for q in (0.25, 0.30, 0.35, 0.40, 0.45, 0.478, 0.49):
    pr(f"q={q:.3f}  Z=30:{p_success(q,30):.2e}  Z=58:{p_success(q,58):.2e}  Z=60:{p_success(q,60):.2e}  Z=96:{p_success(q,96):.2e}")
pr("q=0.62 (top-3 coalition) / 0.68 (ViaBTC Feb-2026 peak): P=1 at every depth")
pr("\n== stale rate raises effective q (NU7 25 s blocks; 3-5% stale)")
for s in (0.0, 0.03, 0.05):
    qe = q_eff(0.35, s); pr(f"stale={s:.2f}: q_eff={qe:.4f}  P(Z=60)={p_success(qe,60):.2e}")
pr("\n== pre-mined private lead (selfish-mining start; costless-ish for q>1/3)")
for L in (0, 5, 10, 15, 20):
    pr(f"q=0.35 lead={L:2d}: P(Z=60)={p_success(0.35,60,L):.2e}   P(one attempt reaches lead)={p_reach_lead(0.35,L):.2e}  expected attempts={1/p_reach_lead(0.35,L):.0f}")
pr("\n== compounding: N swaps at per-swap eps")
for eps in (1e-3, 8e-4):
    for N in (10, 100, 1000):
        pr(f"eps={eps:.0e} N={N}: P(at least one reversal)={1-(1-eps)**N:.3f}")
pr("\n== EV check for a 35% pool, $15k swap, Z=60, $523/block")
P = p_success(0.35, 60); V = 15000; forfeit = 0.35/0.65*60*523
pr(f"P={P:.2e}  EV gain={P*V:.1f} USD  naive forfeited-revenue cost ~{forfeit:.0f} USD (attacker who abandons early pays far less)")
pr("\n== Gamma time for Z blocks (memo budget for ZEC leg = 68.8 min at Z=60)")
for bt in (25, 30, 45, 57, 75):
    for Z in (60,):
        m = Z*bt/60; q999 = gamma.ppf(0.999, Z, scale=bt)/60
        pr(f"block {bt:2d}s Z={Z}: mean {m:5.1f} min  99.9% {q999:5.1f} min  budget max(2.5*mean,99.9%)={max(2.5*m,q999):5.1f} min  {'MISS vs 68.8' if q999>68.8 else 'ok'}")
pr("\n== Cardano FIFO spam cost to fill blocks (90,112 B body, 16,384 B tx, 44 lovelace/B + 155,381)")
per_tx = 16384*44 + 155381; per_block = 90112/16384*per_tx/1e6
for ada in (0.188,):
    for win in (240, 1800):
        blocks = win/20
        pr(f"window {win}s ~{blocks:.0f} blocks: {per_block*blocks:.1f} ADA = ${per_block*blocks*ada:.1f} (ADA ${ada})")
open(__file__.replace('.py','.out.txt'),'w').write("\n".join(out)+"\n")
