#!/usr/bin/env python3
"""Explicit-state BFS model checker for zeUTXO path 1 (Farcaster-on-Cardano, FoC).

Abstract protocol (see ../spec.md):
  Alice (ADA holder) locks ADA in a Cardano script with branches
    Redeem  (Bob, needs Alice's go-sig, validity upper bound < T1, reveals b)
    Refund  (Alice, validity lower bound >= T1, reveals a; stays open after T2)
    Punish  (Bob,   validity lower bound >= T2)
  Bob (ZEC holder) funds a 2-of-2 Orchard note (spend key a+b). Whoever learns
  the other share can sweep the note alone (no Zcash timelocks at all).
Adversary = the malicious party/parties + the network: reads mempools instantly,
orders txs freely, delays every tx (bounded mode: an honest tx submitted at s that
is still valid is mined by s+DELTA; unbounded: any delay, possibly never).
Time is discrete ticks. Honest parties react within the tick in which a condition
becomes true (their reaction latency is folded into DELTA).
"""
import sys, itertools, json
from collections import deque

def make(params):
    D, T0, T1, T2 = params['D'], params['T0'], params['T1'], params['T2']
    TEND = T2 + D + 2
    bounded = params['bounded']
    mut = params.get('mutant')            # model-sanity mutants (deliberately broken variants)
    allow_crash = params.get('crash', False)

    # ---- state: tuple of fields ----
    # t, esc, note, pend(frozenset of (tx, s)), subm(frozenset tx), kAb, kBa, gosig, crA, crB, ever(frozenset of mined cardano branches)
    def init():
        return (0, 'none', 'none', frozenset(), frozenset(), False, False, False, False, False, frozenset())

    def valid(tx, st):
        t, esc, note = st[0], st[1], st[2]
        if tx == 'lock':   return esc == 'none'
        if tx == 'fund':   return note == 'none'
        if tx == 'redeem':
            hi = T1 + 1 if mut == 'redeem_window_overlaps' else T1
            return esc == 'locked' and t < hi
        if tx == 'refund':
            lo = T1 - 1 if mut == 'redeem_window_overlaps' else T1
            if mut == 'refund_closes_at_T2' and t >= T2: return False
            return esc == 'locked' and t >= lo
        if tx == 'punish': return esc == 'locked' and t >= T2
        if tx == 'sweepA' or tx == 'sweepB': return note == 'live'
        raise KeyError(tx)

    def can_ever_be_valid(tx, st):
        t, esc, note = st[0], st[1], st[2]
        if tx == 'redeem':
            hi = T1 + 1 if mut == 'redeem_window_overlaps' else T1
            return esc in ('none', 'locked') and t < hi
        if tx in ('refund', 'punish'): return esc in ('none', 'locked') and not (mut == 'refund_closes_at_T2' and tx=='refund' and t >= T2)
        if tx == 'lock': return esc == 'none'
        if tx == 'fund': return note == 'none'
        return note in ('none', 'live')

    def with_(st, **kw):
        names = ['t','esc','note','pend','subm','kAb','kBa','gosig','crA','crB','ever']
        l = list(st)
        for k, v in kw.items(): l[names.index(k)] = v
        return tuple(l)

    def submit(st, tx):
        # node mempool admission: must be valid *now* (validity lower bounds are enforced by nodes)
        if tx in st[4] or not valid(tx, st):
            return None
        kAb, kBa = st[5], st[6]
        if tx == 'redeem': kAb = True          # b is visible in the mempool immediately
        if tx == 'refund': kBa = True          # a is visible in the mempool immediately
        return with_(st, pend=st[3] | {(tx, st[0])}, subm=st[4] | {tx}, kAb=kAb, kBa=kBa)

    def mine(st, item):
        tx, s = item
        pend = st[3] - {item}
        if not valid(tx, st):
            return with_(st, pend=pend) if not can_ever_be_valid(tx, st) else None
        esc, note, ever = st[1], st[2], st[10]
        if tx == 'lock': esc = 'locked'
        elif tx == 'fund': note = 'live'
        elif tx in ('redeem', 'refund', 'punish'):
            esc = {'redeem':'redeemed','refund':'refunded','punish':'punished'}[tx]; ever = ever | {tx}
        elif tx == 'sweepA': note = 'sweptA'
        elif tx == 'sweepB': note = 'sweptB'
        return with_(st, esc=esc, note=note, pend=pend, ever=ever)

    def alice_due(st, honestA):
        """Honest Alice's policy: list of due actions (each a (label, newstate))."""
        t, esc, note, pend, subm, kAb, kBa, gosig = st[:8]
        out = []
        if t == 0 and 'lock' not in subm: out.append('lock')
        go_ok = (note == 'live') if mut != 'alice_gosig_without_funding' else True
        if esc == 'locked' and go_ok and not gosig and t <= T0: out.append('gosig')
        if kAb and note == 'live' and 'sweepA' not in subm: out.append('sweepA')
        refund_from = T2 - D if mut == 'alice_refunds_late' else T1
        if esc == 'locked' and t >= refund_from and 'refund' not in subm: out.append('refund')
        return out

    def bob_due(st):
        t, esc, note, pend, subm, kAb, kBa, gosig = st[:8]
        out = []
        if esc == 'locked' and 'fund' not in subm and t + D <= T0: out.append('fund')
        last = T1 - D if mut == 'bob_redeems_late' else T1 - 1 - D
        if gosig and esc == 'locked' and note == 'live' and 'redeem' not in subm and t <= last: out.append('redeem')
        if kBa and note == 'live' and 'sweepB' not in subm: out.append('sweepB')
        if esc == 'locked' and t >= T2 and 'punish' not in subm: out.append('punish')
        return out

    def do(st, act):
        if act == 'gosig':
            return with_(st, gosig=True) if not st[7] else None
        return submit(st, act)

    def successors(st, honestA, honestB):
        t = st[0]
        res = []
        crA, crB = st[8], st[9]
        # honest due actions (may be interleaved arbitrarily with adversarial moves within the tick)
        dueA = [] if (not honestA or crA) else [a for a in alice_due(st, honestA) if do(st, a) is not None]
        dueB = [] if (not honestB or crB) else [a for a in bob_due(st) if do(st, a) is not None]
        for a in dueA: res.append(('A:' + a, do(st, a)))
        for a in dueB: res.append(('B:' + a, do(st, a)))
        # malicious moves: any enabled action at any time
        if not honestA:
            for a in ['lock', 'gosig', 'refund', 'sweepA'] + ([] if mut else []):
                if a == 'sweepA' and not st[5]: continue
                n = do(st, a)
                if n is not None: res.append(('A*:' + a, n))
        if not honestB:
            for a in ['fund', 'redeem', 'punish', 'sweepB']:
                if a == 'sweepB' and not st[6]: continue
                if a == 'redeem' and not st[7]: continue       # needs Alice's go-signature
                n = do(st, a)
                if n is not None: res.append(('B*:' + a, n))
        # crashes of honest parties (informational runs only)
        if allow_crash:
            if honestA and not crA: res.append(('A:CRASH', with_(st, crA=True)))
            if honestB and not crB: res.append(('B:CRASH', with_(st, crB=True)))
        # network: mine or drop any pending tx, any order
        for item in sorted(st[3]):
            n = mine(st, item)
            if n is not None: res.append(('mine:%s@%d' % item, n))
        # time tick
        if t < TEND:
            forced = bounded and any(s + D <= t and valid(tx, st) and (tx_owner_honest(tx, honestA, honestB, st))
                                     for (tx, s) in st[3])
            # honest parties must have performed their due actions before time moves on
            if not dueA and not dueB and not forced:
                # unbounded mode: invalid-forever txs linger harmlessly; prune dead ones on tick
                pend = frozenset(i for i in st[3] if can_ever_be_valid(i[0], with_(st, t=t+1)))
                res.append(('tick->%d' % (t + 1), with_(st, t=t + 1, pend=pend)))
        return res

    def tx_owner_honest(tx, hA, hB, st):
        owner = {'lock':'A','refund':'A','sweepA':'A','fund':'B','redeem':'B','punish':'B','sweepB':'B'}[tx]
        # the delay bound is a network property: it applies to every tx an honest party submitted,
        # even if that party crashed afterwards. Malicious parties' txs may be delayed arbitrarily.
        return hA if owner == 'A' else hB

    def outcome(st):
        """Worst-case settlement at the horizon. Returns (alice_ok, bob_ok, details)."""
        t, esc, note, pend, subm, kAb, kBa = st[:7]
        p = {tx for tx, _ in pend}
        if 'lock' in p and esc == 'none': esc = 'locked'
        if 'fund' in p and note == 'none': note = 'live'
        # ADA: who ends with it (locked at horizon >= T2 => contested => nobody safe)
        ada = {'none': 'A', 'refunded': 'A', 'redeemed': 'B', 'punished': 'B', 'locked': None}[esc]
        if esc == 'none' and 'lock' not in subm: ada = 'A'
        # ZEC
        if note == 'none': zec = 'B'
        elif note == 'sweptA': zec = 'A'
        elif note == 'sweptB': zec = 'B'
        else:
            holders = [x for x, k in (('A', kAb), ('B', kBa)) if k]
            zec = holders[0] if len(holders) == 1 else (None if holders else 'frozen')
        a_ok = ada == 'A' or zec == 'A'
        b_ok = ada == 'B' or zec == 'B'
        return a_ok, b_ok, {'ada': ada, 'zec': zec, 'esc': esc, 'note': note}

    def forced(st, hA, hB):
        return any(s + D <= st[0] and valid(tx, st) and tx_owner_honest(tx, hA, hB, st) for (tx, s) in st[3])

    return init, successors, outcome, TEND, forced

def explore(params, honestA, honestB, max_states=2_000_000):
    init, succ, outcome, TEND, forced = make(params)
    bounded_flag = params['bounded']
    s0 = init()
    parent = {s0: None}
    q = deque([s0])
    violations, terminals, edges, completed = [], 0, 0, 0
    crash_losses = []
    while q:
        st = q.popleft()
        nxt = succ(st, honestA, honestB)
        edges += len(nxt)
        if not nxt or (st[0] == TEND and all(l.startswith('tick') is False for l, _ in nxt) and False):
            pass
        # Horizon state: no honest due action left and (bounded) no forced honest tx left.
        # Pending txs are then settled worst-case by outcome(); in unbounded mode this is how
        # 'never mined' is represented.
        honest_due = any(l.startswith(('A:', 'B:')) and not l.endswith('CRASH') for l, _ in nxt)
        is_terminal = st[0] == TEND and not honest_due and not (bounded_flag and forced(st, honestA, honestB))
        if is_terminal:
            terminals += 1
            a_ok, b_ok, d = outcome(st)
            if d['ada'] == 'B' and d['zec'] == 'A': completed += 1
            bad = []
            if honestA and not st[8] and not a_ok: bad.append('HONEST_ALICE_LOSS')
            if honestB and not st[9] and not b_ok: bad.append('HONEST_BOB_LOSS')
            crashed_bad = []
            if honestA and st[8] and not a_ok: crashed_bad.append('CRASHED_ALICE_LOSS')
            if honestB and st[9] and not b_ok: crashed_bad.append('CRASHED_BOB_LOSS')
            if len(st[10]) > 1: bad.append('S5_TWO_BRANCHES')
            if honestA and honestB and not st[8] and not st[9]:
                # S2 / L1: all-honest runs end in a clean swap or a clean mutual refund
                if not ((d['ada'] == 'B' and d['zec'] == 'A') or (d['ada'] == 'A' and d['zec'] == 'B')):
                    bad.append('L1_NOT_CLEAN')
                if st[5] and st[6] and d['note'] == 'live': bad.append('S2_BOTH_KNOW_KEY')
            if bad: violations.append((bad, st, d))
            if crashed_bad: crash_losses.append((crashed_bad, st, d))
        for lbl, n in nxt:
            if n not in parent:
                parent[n] = (st, lbl)
                q.append(n)
                if len(parent) > max_states: raise RuntimeError('state cap')
    def trace(st):
        out = []
        while parent[st] is not None:
            p, l = parent[st]; out.append(l); st = p
        return list(reversed(out))
    return {'states': len(parent), 'edges': edges, 'terminals': terminals, 'completed_terminals': completed,
            'violations': [(b, d, trace(s)) for b, s, d in violations],
            'crash_losses': [(b, d, trace(s)) for b, s, d in crash_losses]}

def compact(tr):
    return ' ; '.join(tr)

def main():
    out = {}
    configs = []
    for D in (1, 2):
        T0 = 2 + D; T1 = T0 + D + 1; T2 = T1 + D + 1      # tight margins: exactly what the spec requires
        base = dict(D=D, T0=T0, T1=T1, T2=T2)
        for mode in ('bounded', 'unbounded'):
            configs.append((f'{mode}_D{D}', dict(base, bounded=(mode == 'bounded'))))
        configs.append((f'bounded_D{D}_crash', dict(base, bounded=True, crash=True)))
    # model-sanity mutants (each MUST produce a violation, proving the checker can see bugs)
    D = 1; base = dict(D=1, T0=3, T1=5, T2=7, bounded=True)
    for m in ('bob_redeems_late', 'alice_refunds_late', 'redeem_window_overlaps', 'alice_gosig_without_funding'):
        configs.append((f'MUTANT_{m}', dict(base, mutant=m)))
    configs.append(('VARIANT_refund_closes_at_T2', dict(base, mutant='refund_closes_at_T2')))
    lines = []
    for name, p in configs:
        for hA, hB in ((True, True), (True, False), (False, True)):
            r = explore(p, hA, hB)
            key = f"{name}|A={'H' if hA else 'M'},B={'H' if hB else 'M'}"
            kinds = sorted({k for b, _, _ in r['violations'] for k in b})
            ckinds = sorted({k for b, _, _ in r['crash_losses'] for k in b})
            out[key] = {'params': p, 'states': r['states'], 'edges': r['edges'], 'terminals': r['terminals'],
                        'violation_count': len(r['violations']), 'violation_kinds': kinds,
                        'crash_loss_count': len(r['crash_losses']), 'crash_loss_kinds': ckinds}
            # keep shortest example per kind
            ex = {}
            for b, d, tr in r['violations'] + r['crash_losses']:
                for k in b:
                    if k not in ex or len(tr) < len(ex[k][1]): ex[k] = (d, tr)
            out[key]['examples'] = {k: {'final': d, 'trace': compact(tr)} for k, (d, tr) in ex.items()}
            lines.append(f"{key:58s} states={r['states']:7d} terminals={r['terminals']:6d} violations={len(r['violations']):5d} {kinds} crash_losses={len(r['crash_losses'])} {ckinds}")
            print(lines[-1], flush=True)
    json.dump(out, open('results.json', 'w'), indent=1)

if __name__ == '__main__':
    main()
