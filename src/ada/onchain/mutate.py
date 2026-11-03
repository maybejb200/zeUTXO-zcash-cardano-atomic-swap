# step-7 mutation check: each mutant must make at least one test fail (be "killed"); original restored after.
import subprocess, json, shutil
A="/workspace/tools/aiken-x86_64-unknown-linux-musl/aiken"; P="validators/escrow.ak"
orig=open(P).read()
M=[("n_in == 1 -> True","        n_in == 1,","        True,"),
   ("payment-credential guard -> address-equality","fn(i) { i.output.address.payment_credential == Script(script_hash) }","fn(i) { i.output.address == me.address }"),
   ("Reveal phase == 1 -> True","      Reveal { b } -> and {\n          d.phase == 1,","      Reveal { b } -> and {\n          True,"),
   ("Escape phase == 1 -> True","      Escape -> and {\n          d.phase == 1,","      Escape -> and {\n          True,"),
   ("Commit phase == 0 -> True","        and {\n          d.phase == 0,\n          builtin","        and {\n          True,\n          builtin"),
   ("reference_script == None -> True","        o.reference_script == None,","        True,"),
   ("value == me.value -> True","        o.value == me.value,","        True,"),
   ("datum == expected -> True","        o.datum == InlineDatum(exp),","        True,"),
   ("Escape lower_from(t3) -> True","          lower_from(tx, d.t3),","          True,"),
   ("Escape signer -> True","          signed(tx, d.alice),\n          lower_from(tx, d.t3),","          True,\n          lower_from(tx, d.t3),"),
   ("Commit upper T1-1 -> T1","upper_before(tx, d.t1 - 1)","upper_before(tx, d.t1)"),
   ("Commit go_sig check -> True","          builtin.verify_ed25519_signature(d.alice_go_vk, msg, go_sig),","          True,"),
   ("Commit bob sig -> True","          signed(tx, d.bob),\n          upper_before","          True,\n          upper_before"),
   ("Reveal share_ok -> True","          share_ok(b, d.b_c),","          True,"),
   ("Reveal bob sig -> True","          signed(tx, d.bob),\n          share_ok(b, d.b_c),","          True,\n          share_ok(b, d.b_c),"),
   # ---- step 8: Notice / RefundReveal / Forfeit ----
   ("Notice phase == 0 -> True","        d.phase == 0,\n        d.t3 > d.t1,","        True,\n        d.t3 > d.t1,"),
   ("Notice alice lower >= t1 -> True","            lo >= d.t1,","            True,"),
   ("Notice bob lower >= t2 -> lower >= t1","            lo >= d.t2,","            lo >= d.t1,"),
   ("Notice alice sig -> True","            signed(tx, d.alice),\n            lo >= d.t1,","            True,\n            lo >= d.t1,"),
   ("Notice bob sig -> True","            signed(tx, d.bob),\n            lo >= d.t2,","            True,\n            lo >= d.t2,"),
   ("Notice range cap -> True","        hi - lo <= notice_max_range,","        True,"),
   ("Notice t4 from hi -> from lo","t4: hi + ( d.t3 - d.t1 )","t4: lo + ( d.t3 - d.t1 )"),
   ("Notice t4 tail -> tail - 1","t4: hi + ( d.t3 - d.t1 )","t4: hi + ( d.t3 - d.t1 ) - 1"),
   ("Notice output phase 2 -> 1","EscrowDatum { ..d, phase: 2,","EscrowDatum { ..d, phase: 1,"),
   ("RefundReveal phase == 2 -> True","      RefundReveal { a } -> and {\n          d.phase == 2,","      RefundReveal { a } -> and {\n          True,"),
   ("RefundReveal share_ok -> True","          share_ok(a, d.a_c),","          True,"),
   ("RefundReveal alice sig -> True","          signed(tx, d.alice),\n          share_ok(a, d.a_c),","          True,\n          share_ok(a, d.a_c),"),
   ("Forfeit phase == 2 -> True","      Forfeit -> and {\n          d.phase == 2,","      Forfeit -> and {\n          True,"),
   ("Forfeit lower >= t4 -> True","          lower_from(tx, d.t4),","          True,"),
   ("Forfeit bob sig -> True","          signed(tx, d.bob),\n          lower_from(tx, d.t4),","          True,\n          lower_from(tx, d.t4),"),
]
out=[]
try:
  for name,a,b in M:
    assert orig.count(a)==1, name
    open(P,"w").write(orig.replace(a,b))
    r=subprocess.run([A,"check"],capture_output=True,text=True)
    try: d=json.loads(r.stdout[r.stdout.index("{"):r.stdout.rindex("}")+1]); fails=[t["title"] for m in d["modules"] for t in m["tests"] if t["status"]!="pass"]
    except Exception as e: fails=["<compile error>"]
    out.append((name,fails)); print(("KILLED " if fails else "SURVIVED ")+name+" : "+", ".join(fails[:4]),flush=True)
finally:
  open(P,"w").write(orig)
r=subprocess.run([A,"check"],capture_output=True,text=True); d=json.loads(r.stdout[r.stdout.index("{"):r.stdout.rindex("}")+1])
t=[x for m in d["modules"] for x in m["tests"]]
print(f"restored: {sum(x['status']=='pass' for x in t)}/{len(t)} pass; killed {sum(1 for _,f in out if f)}/{len(out)}")
