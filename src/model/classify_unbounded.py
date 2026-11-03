#!/usr/bin/env python3
"""Classify every unbounded-delay loss trace by WHICH honest transaction was delayed beyond D.
Consistency check: a loss trace with no over-delayed honest tx would be a bounded-mode bug (must be 0)."""
import re, json
from collections import Counter
from foc_model import make
from collections import deque

def all_violations(p, hA, hB):
    init, succ, outcome, TEND, forced = make(p)
    s0 = init(); parent = {s0: None}; q = deque([s0]); out = []
    while q:
        st = q.popleft(); nxt = succ(st, hA, hB)
        honest_due = any(l.startswith(('A:', 'B:')) for l, _ in nxt)
        if st[0] == TEND and not honest_due:
            a_ok, b_ok, d = outcome(st)
            if (hA and not a_ok) or (hB and not b_ok):
                tr = []; x = st
                while parent[x] is not None: x, l = parent[x][0], parent[x][1]; tr.append(l)
                out.append((('ALICE' if hA and not a_ok else '') + ('BOB' if hB and not b_ok else ''), d, tr[::-1]))
        for l, n in nxt:
            if n not in parent: parent[n] = (st, l); q.append(n)
    return out

def late_honest(tr, D, hA, hB, TEND):
    t = 0; sub = {}; mined = {}
    for l in tr:
        m = re.match(r'tick->(\d+)', l)
        if m: t = int(m.group(1)); continue
        m = re.match(r'([AB]):(\w+)$', l)
        if m and m.group(2) not in ('gosig', 'CRASH'): sub[m.group(2)] = t
        m = re.match(r'mine:(\w+)@\d+', l)
        if m: mined[m.group(1)] = t
    late = []
    for tx, s in sub.items():
        if mined.get(tx, TEND + 10**6) - s > D: late.append(tx)
    return tuple(sorted(late))

D = 1; p = dict(D=1, T0=3, T1=5, T2=7, bounded=False)
summary = {}
for hA, hB in ((True, True), (True, False), (False, True)):
    v = all_violations(p, hA, hB)
    c = Counter((who, late_honest(tr, D, hA, hB, p['T2'] + D + 2)) for who, d, tr in v)
    key = f"A={'H' if hA else 'M'},B={'H' if hB else 'M'}"
    summary[key] = {f"{who} loses | over-delayed honest tx: {','.join(l) or 'NONE(!)'}": n for (who, l), n in sorted(c.items())}
    print(key, 'loss traces:', len(v))
    for k, n in summary[key].items(): print('   ', n, k)
json.dump(summary, open('unbounded_classification.json', 'w'), indent=1)

# Minimal-cause check: every Alice loss has her lock or refund over-delayed; every Bob loss has his redeem or punish over-delayed.
ok = True
for key, d in summary.items():
    for k in d:
        who, late = k.split(' loses | over-delayed honest tx: ')
        late = set(late.split(','))
        if 'ALICE' in who and not late & {'lock', 'refund'}: ok = False; print('UNEXPLAINED', key, k)
        if 'BOB' in who and not late & {'redeem', 'punish'}: ok = False; print('UNEXPLAINED', key, k)
print('minimal-cause check (Alice: lock|refund late; Bob: redeem|punish late):', 'PASS' if ok else 'FAIL')
