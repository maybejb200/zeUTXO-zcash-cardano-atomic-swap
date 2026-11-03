#!/usr/bin/env python3
"""zeUTXO path 1, step 3 state model (explicit-state BFS). Extends step-1 foc_model.py with:
  * Cardano settlement: a tx mined at m can be ROLLED BACK by the adversary until it is final
    (final when t >= m+S, or, for an honest owner's tx that stayed valid, t >= s+D+S).
    A rolled-back honest tx returns to the mempool if still valid under the current params; a
    malicious owner's rolled-back tx may vanish (double-spend of its inputs).
  * One adversary-timed protocol-parameter change (epoch boundary, if E=1): every Cardano tx built
    under the old params that is not yet mined (or is later rolled back) is dropped. Honest parties
    rebuild; under the OLD design (mutant go_pins_body) Bob cannot rebuild Redeem without a fresh
    go-signature from Alice.
  * Zcash depth: Bob's funding note is 'tent' until Z ticks after mining; a malicious Bob can reorg
    (double-spend) it away while tentative. Alice's go needs a FINAL (depth >= Z) note.
Delay bound (bounded mode): an honest, still-valid Cardano tx is mined within D of submission and
final within D+S; honest Zcash txs mined within DZ.
"""
import sys, json, itertools
from collections import deque

def make(P):
    D, S, DZ, Z, E = P['D'], P['S'], P['DZ'], P['Z'], P['E']
    T0, T1, T2 = P['T0'], P['T1'], P['T2']
    DA = D + S
    mut = P.get('mutant')
    bob_margin = P.get('bob_margin', (1 + E) * DA)       # Bob's last first-broadcast: T1-1-bob_margin
    LAST = T1 - 1 - bob_margin
    bounded = P['bounded']; allow_crash = P.get('crash', False)
    TEND = T2 + 2 * DA + DZ + 2
    F = ['t','esc','note','nm','items','zp','subm','kAb','kBa','go','crA','crB','ep']
    I = {k: i for i, k in enumerate(F)}
    def w(st, **kw):
        l = list(st)
        for k, v in kw.items(): l[I[k]] = v
        return tuple(l)
    def init(): return (0, 'none', 'none', -1, frozenset(), frozenset(), frozenset(), False, False, -1, False, False, 0)
    OWN = {'lock':'A','refund':'A','sweepA':'A','fund':'B','redeem':'B','punish':'B','sweepB':'B'}
    CARD = ('lock', 'redeem', 'refund', 'punish')
    def honest_owner(tx, hA, hB): return hA if OWN[tx] == 'A' else hB
    def valid_now(tx, st, ep=None):
        t, esc, note = st[0], st[1], st[2]
        if tx == 'lock': return esc == 'none'
        if tx == 'redeem': return esc == 'locked' and t < T1
        if tx == 'refund': return esc == 'locked' and t >= T1
        if tx == 'punish': return esc == 'locked' and t >= T2
        if tx == 'fund': return note == 'none'
        if tx in ('sweepA', 'sweepB'): return note == 'live'
    def final(it, st, hA, hB):
        tx, s, ep, m = it
        if m < 0: return False
        t = st[0]
        return t >= m + S or (honest_owner(tx, hA, hB) and t >= s + DA)
    def lock_final(st, hA, hB):
        return st[1] != 'none' and not any(i[0] == 'lock' and not final(i, st, hA, hB) for i in st[4])
    def submit(st, tx):
        if tx in st[6] or not valid_now(tx, st): return None
        kAb, kBa = st[7], st[8]
        if tx == 'redeem': kAb = True           # b readable from the mempool at once
        if tx == 'refund': kBa = True
        if tx in CARD:
            return w(st, items=st[4] | {(tx, st[0], st[12], -1)}, subm=st[6] | {tx}, kAb=kAb, kBa=kBa)
        return w(st, zp=st[5] | {(tx, st[0])}, subm=st[6] | {tx})
    def apply_card(st, tx, sign):
        esc = st[1]
        if sign > 0: esc = {'lock': 'locked', 'redeem': 'redeemed', 'refund': 'refunded', 'punish': 'punished'}[tx]
        else: esc = 'none' if tx == 'lock' else 'locked'
        return w(st, esc=esc)
    def drop(st, it):   # tx removed from mempool for good; owner may rebuild (subm cleared)
        return w(st, items=st[4] - {it}, subm=st[6] - {it[0]})
    def mine_card(st, it):
        tx, s, ep, m = it
        if not valid_now(tx, st) or ep != st[12]: return drop(st, it)
        st2 = apply_card(st, tx, +1)
        return w(st2, items=(st[4] - {it}) | {(tx, s, ep, st[0])})
    def rollback(st, it, hA, hB):
        tx, s, ep, m = it
        st2 = apply_card(st, tx, -1)
        if (not honest_owner(tx, hA, hB)) or ep != st[12] or not valid_now(tx, st2):
            return w(st2, items=st[4] - {it}, subm=st[6] - {tx})
        return w(st2, items=(st[4] - {it}) | {(tx, s, ep, -1)})
    def mine_z(st, item):
        tx, s = item
        zp = st[5] - {item}
        if not valid_now(tx, st): return w(st, zp=zp)
        if tx == 'fund': return w(st, zp=zp, note='tent' if Z > 0 else 'live', nm=st[0])
        return w(st, zp=zp, note='sweptA' if tx == 'sweepA' else 'sweptB')
    def go_ok_for_redeem(st):
        return st[9] >= 0 and (mut != 'go_pins_body' or st[9] == st[12])
    def alice_due(st, hA, hB):
        t, esc, note = st[0], st[1], st[2]; out = []
        if t == 0 and 'lock' not in st[6] and esc == 'none': out.append('lock')
        note_ok = note in ('tent', 'live') if mut == 'alice_go_shallow' else note == 'live'
        need_go = st[9] < 0 or (mut == 'go_pins_body' and st[9] != st[12])
        if esc == 'locked' and note_ok and need_go and t <= T0: out.append('go')
        if st[7] and note == 'live' and 'sweepA' not in st[6]: out.append('sweepA')
        rfrom = P.get('refund_from', T1)
        if esc == 'locked' and t >= rfrom and 'refund' not in st[6]: out.append('refund')
        return out
    def bob_due(st, hA, hB):
        t, esc, note = st[0], st[1], st[2]; out = []
        lock_ok = (esc == 'locked') if mut == 'bob_funds_tentative_lock' else (esc == 'locked' and lock_final(st, hA, hB))
        if lock_ok and 'fund' not in st[6] and t + DZ + Z <= T0: out.append('fund')
        # first broadcast needs a final funded note and t <= LAST; once b is public (kAb) Bob keeps
        # rebuilding/resubmitting while Redeem can still be valid, whatever happened to the note.
        if go_ok_for_redeem(st) and esc == 'locked' and 'redeem' not in st[6] and t < T1 and ((note == 'live' and t <= LAST) or st[7]):
            out.append('redeem')
        if st[8] and note == 'live' and 'sweepB' not in st[6]: out.append('sweepB')
        if esc == 'locked' and t >= T2 and 'punish' not in st[6]: out.append('punish')
        return out
    def do(st, a):
        if a == 'go': return w(st, go=st[12])
        return submit(st, a)
    def forced(st, hA, hB):
        t = st[0]
        for it in st[4]:
            tx, s, ep, m = it
            if m < 0 and honest_owner(tx, hA, hB) and t >= s + D and valid_now(tx, st) and ep == st[12]: return True
        for tx, s in st[5]:
            if honest_owner(tx, hA, hB) and t >= s + DZ and valid_now(tx, st): return True
        return False
    def succ(st, hA, hB):
        t = st[0]; res = []
        crA, crB = st[10], st[11]
        dA = [] if (not hA or crA) else [a for a in alice_due(st, hA, hB) if do(st, a) is not None]
        dB = [] if (not hB or crB) else [a for a in bob_due(st, hA, hB) if do(st, a) is not None]
        for a in dA: res.append(('A:' + a, do(st, a)))
        for a in dB: res.append(('B:' + a, do(st, a)))
        if not hA:
            for a in ('lock', 'go', 'refund', 'sweepA'):
                if a == 'sweepA' and not st[7]: continue
                if a == 'lock' and t > 1: continue      # a later lock adds states but no new behaviour
                if a == 'go' and st[9] == st[12]: continue
                n = do(st, a)
                if n is not None: res.append(('A*:' + a, n))
        if not hB:
            for a in ('fund', 'redeem', 'punish', 'sweepB'):
                if a == 'sweepB' and not st[8]: continue
                if a == 'redeem' and not go_ok_for_redeem(st): continue
                n = do(st, a)
                if n is not None: res.append(('B*:' + a, n))
            if st[2] == 'tent': res.append(('B*:zreorg', w(st, note='none', nm=-1)))
        if allow_crash:
            if hA and not crA: res.append(('A:CRASH', w(st, crA=True)))
            if hB and not crB: res.append(('B:CRASH', w(st, crB=True)))
        for it in sorted(st[4]):
            if it[3] < 0:
                n = mine_card(st, it); res.append(('mine:%s@%d' % (it[0], it[1]), n))
                if not honest_owner(it[0], hA, hB) or not valid_now(it[0], st) or it[2] != st[12]:
                    pass
            elif not final(it, st, hA, hB) and not (it[0] == 'lock' and any(j[0] != 'lock' and j[3] >= 0 for j in st[4])):
                # a chain rollback undoes newer txs first: the lock can only be rolled back once no spend of it is on chain
                res.append(('ROLLBACK:%s' % it[0], rollback(st, it, hA, hB)))
        for it in sorted(st[5]): res.append(('zmine:%s' % it[0], mine_z(st, it)))
        if E and st[12] == 0:   # epoch boundary: unmined old-param txs leave the mempool at once
            old = frozenset(i for i in st[4] if i[3] < 0)
            res.append(('PARAM_CHANGE', w(st, ep=1, items=st[4] - old, subm=st[6] - {i[0] for i in old})))
        if t < TEND and not dA and not dB and not (bounded and forced(st, hA, hB)):
            nt = t + 1
            note, nm = st[2], st[3]
            if note == 'tent' and nt >= nm + Z: note = 'live'
            # unmined txs that can never become valid again are pruned (expired Redeem, old-epoch)
            items = frozenset(i for i in st[4] if not (i[3] < 0 and (i[2] != st[12] or (i[0] == 'redeem' and nt >= T1))))
            sub = st[6] - {i[0] for i in st[4] - items}
            res.append(('tick->%d' % nt, w(st, t=nt, note=note, nm=nm, items=items, subm=sub)))
        return res
    def outcome(st):
        esc, note, kAb, kBa = st[1], st[2], st[7], st[8]
        ada = {'none': 'A', 'refunded': 'A', 'redeemed': 'B', 'punished': 'B', 'locked': None}[esc]
        if note == 'none': zec = 'B'
        elif note == 'sweptA': zec = 'A'
        elif note == 'sweptB': zec = 'B'
        else:
            h = [x for x, k in (('A', kAb), ('B', kBa)) if k]
            zec = h[0] if len(h) == 1 else (None if h else 'frozen')
        return ada == 'A' or zec == 'A', ada == 'B' or zec == 'B', {'ada': ada, 'zec': zec, 'esc': esc, 'note': note}
    return init, succ, outcome, TEND, forced

def explore(P, hA, hB, cap=12_000_000):
    init, succ, outcome, TEND, forced = make(P)
    s0 = init(); parent = {s0: None}; q = deque([s0])
    viol, crash, terms, done = [], [], 0, 0
    while q:
        st = q.popleft(); nxt = succ(st, hA, hB)
        due = any(l.startswith(('A:', 'B:')) and not l.endswith('CRASH') for l, _ in nxt)
        if st[0] == TEND and not due and not (P['bounded'] and forced(st, hA, hB)):
            terms += 1
            a_ok, b_ok, d = outcome(st)
            if d['ada'] == 'B' and d['zec'] == 'A': done += 1
            bad, cb = [], []
            if hA and not st[10] and not a_ok: bad.append('HONEST_ALICE_LOSS')
            if hB and not st[11] and not b_ok: bad.append('HONEST_BOB_LOSS')
            if hA and st[10] and not a_ok: cb.append('CRASHED_ALICE_LOSS')
            if hB and st[11] and not b_ok: cb.append('CRASHED_BOB_LOSS')
            if hA and hB and not st[10] and not st[11]:
                if not ((d['ada'] == 'B' and d['zec'] == 'A') or (d['ada'] == 'A' and d['zec'] == 'B')): bad.append('L1_NOT_CLEAN')
                if st[7] and st[8] and d['note'] in ('live', 'tent'): bad.append('S2_BOTH_KNOW_KEY')
            if bad: viol.append((bad, st, d))
            if cb: crash.append((cb, st, d))
        for l, n in nxt:
            if n not in parent:
                parent[n] = (st, l); q.append(n)
                if len(parent) > cap: raise RuntimeError('state cap')
    def tr(st):
        o = []
        while parent[st] is not None: p, l = parent[st]; o.append(l); st = p
        return o[::-1]
    return {'states': len(parent), 'terminals': terms, 'completed': done,
            'violations': [(b, d, tr(s)) for b, s, d in viol], 'crash': [(b, d, tr(s)) for b, s, d in crash]}

def rule_T(D, S, DZ, Z, E, slack2=1):
    """Deployment rule (step 3): DA = D+S (inclusion + settlement), M = (1+E)*DA.
    T0 >= DA + DZ + Z (lock settled, then funding mined and Z deep);
    T1 >= T0 + 1 + M  (Bob's last first-broadcast LAST = T1-1-M is not before Alice's go deadline);
    T2 >= T1 + M + slack2 (Alice's Refund, started at T1, is final before Punish opens)."""
    DA = D + S; M = (1 + E) * DA
    T0 = DA + DZ + Z; T1 = T0 + 1 + M; T2 = T1 + M + slack2
    return dict(D=D, S=S, DZ=DZ, Z=Z, E=E, T0=T0, T1=T1, T2=T2)

def summarize(name, P, hA, hB, r):
    kinds = sorted({k for b, _, _ in r['violations'] for k in b}); ck = sorted({k for b, _, _ in r['crash'] for k in b})
    ex = {}
    for b, d, t in r['violations'] + r['crash']:
        for k in b:
            if k not in ex or len(t) < len(ex[k][1]): ex[k] = (d, t)
    return {'name': name, 'who': f"A={'H' if hA else 'M'},B={'H' if hB else 'M'}", 'params': P, 'states': r['states'],
            'terminals': r['terminals'], 'completed': r['completed'], 'violations': len(r['violations']), 'kinds': kinds,
            'crash_losses': len(r['crash']), 'crash_kinds': ck, 'examples': {k: {'final': d, 'trace': ' ; '.join(t)} for k, (d, t) in ex.items()}}

def main():
    out = []
    configs = []
    for (D, S, Z, E) in [(1, 0, 1, 0), (1, 1, 1, 0), (1, 1, 2, 0), (1, 1, 1, 1), (2, 1, 1, 1), (1, 2, 2, 1)]:
        base = rule_T(D, S, 1, Z, E)
        configs.append((f'RULE_D{D}S{S}Z{Z}E{E}_bounded', dict(base, bounded=True)))
        configs.append((f'RULE_D{D}S{S}Z{Z}E{E}_crash', dict(base, bounded=True, crash=True)))
    rules = list(configs); configs = []
    unb = [('RULE_D1S1Z1E1_unbounded (liveness assumption dropped; losses expected)', dict(rule_T(1, 1, 1, 1, 1), bounded=False))]
    b = rule_T(1, 1, 1, 1, 1)
    # mutants: each MUST show a violation (the model can see the review's findings)
    configs.append(('MUTANT_C1_go_pins_body (old step-2 design)', dict(b, bounded=True, mutant='go_pins_body')))
    b22 = rule_T(2, 2, 1, 1, 0); b22e = rule_T(2, 2, 1, 1, 1)
    configs.append(('MUTANT_H1_bob_margin_inclusion_only (old rule T1-1-D; D=2,S=2)', dict(b22, bounded=True, bob_margin=2)))
    configs.append(('MUTANT_H1_bob_margin_ignores_param_change (margin DA with E=1; D=2,S=2)', dict(b22e, bounded=True, bob_margin=4)))
    configs.append(('MUTANT_H1_T2_too_close (T2=T1+DA-1; D=2,S=2)', dict(b22, T2=b22['T1'] + 3, bounded=True)))
    configs.append(('CONTROL_rule_D2S2Z1E0 (same params, correct rule)', dict(b22, bounded=True)))
    configs.append(('MUTANT_H2_alice_go_shallow', dict(rule_T(1, 1, 1, 2, 0), bounded=True, mutant='alice_go_shallow')))
    configs.append(('MUTANT_bob_funds_tentative_lock', dict(rule_T(1, 1, 1, 1, 0), bounded=True, mutant='bob_funds_tentative_lock')))
    group = sys.argv[2] if len(sys.argv) > 2 else 'rules'
    sel = {'rules': rules, 'mutants': configs, 'unbounded': unb}[group]
    for name, P in sel:
        for hA, hB in (((True, True),) if group == 'unbounded' else ((True, True), (True, False), (False, True))):
            r = explore(P, hA, hB); s = summarize(name, P, hA, hB, r); out.append(s)
            print(f"{name:58s} {s['who']} states={s['states']:7d} completed={s['completed']:5d} viol={s['violations']:5d} {s['kinds']} crash={s['crash_losses']} {s['crash_kinds']}", flush=True)
    json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else 'results3.json', 'w'), indent=1)

if __name__ == '__main__':
    main()
