#!/usr/bin/env python3
"""T6: byte-level privacy inspection of the real v5 Orchard txs from a FRESH review1 happy-path run.
Parses ZIP-225 v5 tx encoding and checks whether anything public on Cardano (b, A_c, B_c) or any swap key
(A_p, B_p, ak = sigma*(A_p+B_p), the joint FVK parts) appears on the Zcash side. Throwaway keys only."""
import json, struct, sys, glob, os
run = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob(os.path.join(os.path.dirname(__file__), '../sim/runs/happy-*')))[-1]
J = lambda p: json.load(open(os.path.join(run, p)))
va, vb = J('alice/view.json'), J('bob/view.json')
assert va['fvk'] == vb['fvk']
b_le = bytes.fromhex(J('bob/secret.json')['x']); a_le = bytes.fromhex(J('alice/secret.json')['x'])
fvk = bytes.fromhex(va['fvk']); ak = fvk[:32]; nk = fvk[32:64]; rivk = fvk[64:]
neg = lambda p: p[:31] + bytes([p[31] ^ 0x80])
needles = {'b (revealed on Cardano)': b_le, 'a': a_le, 'A_c (Cardano datum)': bytes.fromhex(va['A_c']), 'B_c (Cardano datum)': bytes.fromhex(va['B_c']),
           'A_p': bytes.fromhex(va['A_p']), 'B_p': bytes.fromhex(va['B_p']), 'ak': ak, '-ak (= the other sign of A_p+B_p)': neg(ak), 'nk': nk, 'rivk': rivk,
           'joint address (raw 43B)': bytes.fromhex(va['addr_j'])}
def cs(b, i):
    v = b[i]
    if v < 0xfd: return v, i + 1
    if v == 0xfd: return struct.unpack_from('<H', b, i + 1)[0], i + 3
    if v == 0xfe: return struct.unpack_from('<I', b, i + 1)[0], i + 5
    return struct.unpack_from('<Q', b, i + 1)[0], i + 9
def parse(b):
    hdr, vgid, br, lock, exp = struct.unpack_from('<IIIII', b, 0); i = 20
    nin, i = cs(b, i); assert nin == 0; nout, i = cs(b, i); assert nout == 0
    nss, i = cs(b, i); nso, i = cs(b, i); assert nss == 0 and nso == 0
    na, i = cs(b, i); acts = []
    for _ in range(na):
        a = b[i:i + 820]; acts.append({'cv': a[0:32], 'nf': a[32:64], 'rk': a[64:96], 'cmx': a[96:128], 'epk': a[128:160]}); i += 820
    flags = b[i]; i += 1; vb_, = struct.unpack_from('<q', b, i); i += 8; anchor = b[i:i + 32]; i += 32
    np_, i = cs(b, i); i += np_; sigs = [b[i + 64 * k:i + 64 * k + 64] for k in range(na)]; i += 64 * na; i += 64
    assert i == len(b), (i, len(b))
    return dict(version=hdr & 0x7fffffff, overwintered=hdr >> 31, branch=hex(br), lock_time=lock, expiry_height=exp, transparent_in=nin, transparent_out=nout,
                sapling=nss + nso, actions=na, flags=flags, valueBalanceOrchard=vb_, acts=acts, sigs=sigs, proof_len=np_)
rep = {'run': os.path.relpath(run), 'txs': {}}
for f in ['fund.tx', 'Sweep_Alice_a_b_.tx', 'alt_joint.tx', 'alt_adaptor.tx']:
    p = os.path.join(run, f)
    if not os.path.exists(p): continue
    raw = open(p, 'rb').read(); t = parse(raw)
    hits = [k for k, n in needles.items() if n in raw]
    rks = [a['rk'].hex() for a in t['acts']]
    rep['txs'][f] = {k: v for k, v in t.items() if k not in ('acts', 'sigs')} | {'bytes': len(raw), 'leaked_needles': hits,
                    'rk_equals_ak_or_neg': any(a['rk'] in (ak, neg(ak)) for a in t['acts']), 'rks': rks}
sw = rep['txs'].get('Sweep_Alice_a_b_.tx', {}); alt = rep['txs'].get('alt_joint.tx', {})
rep['rk_fresh_per_build'] = bool(sw and alt and set(sw['rks']).isdisjoint(alt['rks']))
print(json.dumps(rep, indent=1))
