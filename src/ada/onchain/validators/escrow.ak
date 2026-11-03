//// zeUTXO path 1 escrow v0.7 (STEP 8): two-step claim (Commit -> Reveal{b}) AND two-step refund (Notice -> RefundReveal{a}).
//// See step8/decisions.md D23-D32. Every tx that carries a secret has NO deadline; every deadline-bound tx carries NO secret.
////   Open      --Commit{go_sig}  (Bob sig + Alice go, upper <= T1-1)                          --> Claimed   (same address/value)
////   Open      --Notice          (Alice sig & lower >= T1, or Bob sig & lower >= T2; upper-lower <= 6 h)
////                                                                     --> Refunding, t4 := upper + (T3 - T1)  (same address/value)
////   Claimed   --Reveal{b}       (Bob sig, b*G1 = B_c, NO deadline)                          --> anywhere
////   Claimed   --Escape          (Alice sig, lower >= T3, NO secret)                         --> anywhere
////   Refunding --RefundReveal{a} (Alice sig, a*G1 = A_c, NO deadline)                        --> anywhere
////   Refunding --Forfeit         (Bob sig, lower >= t4, NO secret)                           --> anywhere
//// Step-7 Refund{a}-from-Open and Punish are removed (D25): censoring Alice's refund can no longer cost her anything,
//// because the only deadline after the Notice is >= 7 days away and Bob's T2 action (his own Notice) reveals nothing.

use aiken/builtin
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/crypto/bls12_381/g1
use aiken/interval.{
  Finite, Interval, IntervalBound, NegativeInfinity, PositiveInfinity,
}
use aiken/primitive/bytearray
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}

pub type EscrowDatum {
  alice: VerificationKeyHash,
  bob: VerificationKeyHash,
  alice_go_vk: ByteArray,
  network_id: Int,
  swap_id: ByteArray,
  a_c: ByteArray,
  b_c: ByteArray,
  t1: Int,
  t2: Int,
  t3: Int,
  // 0 = Open, 1 = Claimed, 2 = Refunding
  phase: Int,
  // step 8: Bob's Forfeit time, set by the Notice (0 while Open/Claimed)
  t4: Int,
}

pub type Action {
  Commit { go_sig: ByteArray }
  Reveal { b: Int }
  Notice
  RefundReveal { a: Int }
  Forfeit
  Escape
}

const share_bound: Int =
  7237005577332262213973186563042994240829374041602535252466099000494570602496

pub const go_domain: ByteArray = "zeUTXO/path1/go/v1"

/// D24: maximum width of a Notice's validity interval (6 h), so a griefer cannot push t4 out.
pub const notice_max_range: Int = 21600000

pub fn share_ok(s: Int, pt: ByteArray) -> Bool {
  and {
    s >= 0,
    s < share_bound,
    builtin.bls12_381_g1_equal(
      builtin.bls12_381_g1_scalar_mul(s, g1.generator),
      builtin.bls12_381_g1_uncompress(pt),
    ),
  }
}

pub fn go_message(
  d: EscrowDatum,
  script_hash: ByteArray,
  own: OutputReference,
  lovelace: Int,
) -> ByteArray {
  go_domain
    |> bytearray.concat(bytearray.from_int_big_endian(d.network_id, 1))
    |> bytearray.concat(d.swap_id)
    |> bytearray.concat(script_hash)
    |> bytearray.concat(own.transaction_id)
    |> bytearray.concat(bytearray.from_int_big_endian(own.output_index, 2))
    |> bytearray.concat(bytearray.from_int_big_endian(lovelace, 8))
    |> bytearray.concat(bytearray.from_int_big_endian(d.t1, 8))
}

fn upper_before(tx: Transaction, t: Int) -> Bool {
  when tx.validity_range.upper_bound.bound_type is {
    Finite(u) -> u <= t
    _ -> False
  }
}

fn lower_from(tx: Transaction, t: Int) -> Bool {
  when tx.validity_range.lower_bound.bound_type is {
    Finite(l) -> l >= t
    _ -> False
  }
}

fn signed(tx: Transaction, k: VerificationKeyHash) -> Bool {
  list.has(tx.extra_signatories, k)
}

/// Continuing-output rule (Commit and Notice): exactly one input from this script (no double satisfaction), and
/// exactly one output back to the SAME address with the SAME value, the expected datum inline, no reference script.
fn continues(
  tx: Transaction,
  me: Output,
  expected: EscrowDatum,
  script_hash: ByteArray,
) -> Bool {
  let n_in = list.count(
    tx.inputs,
    fn(i) { i.output.address.payment_credential == Script(script_hash) },
  )
  let outs = list.filter(tx.outputs, fn(o) { o.address == me.address })
  let exp: Data = expected
  when outs is {
    [o] -> and {
        n_in == 1,
        o.value == me.value,
        o.datum == InlineDatum(exp),
        o.reference_script == None,
      }
    _ -> False
  }
}

/// Notice: who may send it and when, and the t4 it must write (D23-D25).
fn notice_ok(
  tx: Transaction,
  me: Output,
  d: EscrowDatum,
  script_hash: ByteArray,
) -> Bool {
  when
    (
      tx.validity_range.lower_bound.bound_type,
      tx.validity_range.upper_bound.bound_type,
    )
  is {
    (Finite(lo), Finite(hi)) -> and {
        d.phase == 0,
        d.t3 > d.t1,
        or {
          and {
            signed(tx, d.alice),
            lo >= d.t1,
          },
          and {
            signed(tx, d.bob),
            lo >= d.t2,
          },
        },
        hi - lo <= notice_max_range,
        continues(
          tx,
          me,
          EscrowDatum { ..d, phase: 2, t4: hi + ( d.t3 - d.t1 ) },
          script_hash,
        ),
      }
    _ -> False
  }
}

validator escrow {
  spend(
    datum: Option<EscrowDatum>,
    action: Action,
    own: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d) = datum
    when action is {
      Commit { go_sig } -> {
        expect Some(me) = transaction.find_input(tx.inputs, own)
        expect Script(script_hash) = me.output.address.payment_credential
        let msg = go_message(
          d,
          script_hash,
          own,
          assets.lovelace_of(me.output.value),
        )
        and {
          d.phase == 0,
          builtin.verify_ed25519_signature(d.alice_go_vk, msg, go_sig),
          signed(tx, d.bob),
          upper_before(tx, d.t1 - 1),
          continues(tx, me.output, EscrowDatum { ..d, phase: 1 }, script_hash),
        }
      }
      Notice -> {
        expect Some(me) = transaction.find_input(tx.inputs, own)
        expect Script(script_hash) = me.output.address.payment_credential
        notice_ok(tx, me.output, d, script_hash)
      }
      Reveal { b } -> and {
          d.phase == 1,
          signed(tx, d.bob),
          share_ok(b, d.b_c),
        }
      Escape -> and {
          d.phase == 1,
          signed(tx, d.alice),
          lower_from(tx, d.t3),
        }
      RefundReveal { a } -> and {
          d.phase == 2,
          signed(tx, d.alice),
          share_ok(a, d.a_c),
        }
      Forfeit -> and {
          d.phase == 2,
          signed(tx, d.bob),
          lower_from(tx, d.t4),
        }
    }
  }

  else(_) {
    fail
  }
}

// ======================= tests (go vectors copied from step6 escrow.ak; message excludes t3/phase) ===========
const vb: Int =
  1536951685173436278485048062579777913997139112146137485195657728618292436409

const vb_c: ByteArray =
  #"a98d8d234f61eb37a907edc1391420b922e47ecfa17768d99b8f86585e5c137d16ad286d5298f60666bebe8f37add9f1"

const va: Int =
  3141592653589793238462643383279502884197169399375105820974944592307816406286

const alice: ByteArray =
  #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const bob: ByteArray =
  #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"

const t1: Int = 1800000000000

const t2: Int = 1800086400000

const t3: Int = 1800604800000

const go_vk: ByteArray =
  #"7dccf79b26fd69ee08f0301cbf27486dcd28386bc4d6ef9b09e77b14a7f2b971"

const sig_ok: ByteArray =
  #"ee8427570b5968206f3ac3f7ec94cadf0ddb8bfc40bbfd82baada31e945703afb7d241bf18c7f9f33bff1733c0d9094db62e7542413dc6805655cf0489ef3f04"

const swap_id: ByteArray =
  #"5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a"

const script_h: ByteArray =
  #"5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c"

fn a_c() -> ByteArray {
  builtin.bls12_381_g1_compress(
    builtin.bls12_381_g1_scalar_mul(va, g1.generator),
  )
}

fn dat(phase: Int) -> EscrowDatum {
  EscrowDatum {
    alice,
    bob,
    alice_go_vk: go_vk,
    network_id: 0,
    swap_id,
    a_c: a_c(),
    b_c: vb_c,
    t1,
    t2,
    t3,
    phase,
    t4: 0,
  }
}

fn oref(n: Int) -> OutputReference {
  OutputReference {
    transaction_id: bytearray.concat(
      #"00000000000000000000000000000000000000000000000000000000000000",
      bytearray.from_int_big_endian(n, 1),
    ),
    output_index: 0,
  }
}

fn saddr() -> Address {
  Address { payment_credential: Script(script_h), stake_credential: None }
}

fn baddr() -> Address {
  Address { payment_credential: VerificationKey(bob), stake_credential: None }
}

fn esc_in(n: Int, lovelace: Int) -> Input {
  Input {
    output_reference: oref(n),
    output: Output {
      address: saddr(),
      value: assets.from_lovelace(lovelace),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn claimed_out(d: EscrowDatum, lovelace: Int) -> Output {
  let x: Data = d
  Output {
    address: saddr(),
    value: assets.from_lovelace(lovelace),
    datum: InlineDatum(x),
    reference_script: None,
  }
}

fn mk(
  ins: List<Input>,
  outs: List<Output>,
  lo: Int,
  hi: Int,
  sigs: List<ByteArray>,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: ins,
    outputs: outs,
    fee: 200000,
    validity_range: Interval {
      lower_bound: IntervalBound { bound_type: Finite(lo), is_inclusive: True },
      upper_bound: IntervalBound { bound_type: Finite(hi), is_inclusive: True },
    },
    extra_signatories: sigs,
  }
}

fn commit_tx(outs: List<Output>) -> Transaction {
  mk([esc_in(1, 1000000000)], outs, t1 - 3600000, t1 - 1, [bob])
}

fn run(d: EscrowDatum, a: Action, tx: Transaction) -> Bool {
  escrow.spend(Some(d), a, oref(1), tx)
}

// ---- positives ----
test p1_commit_ok() {
  run(
    dat(0),
    Commit { go_sig: sig_ok },
    commit_tx([claimed_out(dat(1), 1000000000)]),
  )
}

test p2_reveal_ok_long_after_t1_and_t2() {
  // the tx carrying b has NO deadline: still valid a day after T2
  run(
    dat(1),
    Reveal { b: vb },
    mk([esc_in(1, 1000000000)], [], t2 + 86400000, t2 + 90000000, [bob]),
  )
}

test p3_escape_ok_at_t3_without_secret() {
  run(
    dat(1),
    Escape,
    mk([esc_in(1, 1000000000)], [], t3, t3 + 3600000, [alice]),
  )
}

// ---- the censorship property ----

test x2_escape_before_t3_rejected() {
  !run(
    dat(1),
    Escape,
    mk([esc_in(1, 1000000000)], [], t3 - 1, t3 + 3600000, [alice]),
  )
}

test x3_escape_from_open_rejected() {
  !run(
    dat(0),
    Escape,
    mk([esc_in(1, 1000000000)], [], t3, t3 + 3600000, [alice]),
  )
}

test x5_reveal_on_open_rejected() {
  // b can only be published after Commit is on-chain (Bob's wallet waits K blocks before revealing)
  !run(
    dat(0),
    Reveal { b: vb },
    mk([esc_in(1, 1000000000)], [], t1 - 3600000, t1 - 1, [bob]),
  )
}

test x6_reveal_wrong_b_or_no_bob_sig() {
  and {
    !run(
      dat(1),
      Reveal { b: vb + 1 },
      mk([esc_in(1, 1000000000)], [], t1, t1 + 1, [bob]),
    ),
    !run(
      dat(1),
      Reveal { b: vb },
      mk([esc_in(1, 1000000000)], [], t1, t1 + 1, [alice]),
    ),
  }
}

test x7_escape_needs_alice_sig() {
  !run(dat(1), Escape, mk([esc_in(1, 1000000000)], [], t3, t3 + 1, [bob]))
}

// ---- Commit continuing-output / double-satisfaction negatives ----
test c1_commit_at_t1_rejected() {
  !run(
    dat(0),
    Commit { go_sig: sig_ok },
    mk(
      [esc_in(1, 1000000000)],
      [claimed_out(dat(1), 1000000000)],
      t1 - 3600000,
      t1,
      [bob],
    ),
  )
}

test c2_commit_without_continuing_output() {
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([]))
}

test c3_commit_skims_value() {
  !run(
    dat(0),
    Commit { go_sig: sig_ok },
    commit_tx([claimed_out(dat(1), 999999999)]),
  )
}

test c4_commit_output_still_open_phase() {
  !run(
    dat(0),
    Commit { go_sig: sig_ok },
    commit_tx([claimed_out(dat(0), 1000000000)]),
  )
}

test c5_commit_output_changes_t3() {
  !run(
    dat(0),
    Commit { go_sig: sig_ok },
    commit_tx([claimed_out(EscrowDatum { ..dat(1), t3: t1 }, 1000000000)]),
  )
}

test c6_commit_output_with_ref_script() {
  let o = Output {
    ..claimed_out(dat(1), 1000000000),
    reference_script: Some(script_h),
  }
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([o]))
}

test c7_commit_output_to_other_address() {
  let o = Output { ..claimed_out(dat(1), 1000000000), address: baddr() }
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([o]))
}

test c8_double_satisfaction_two_escrows_one_output() {
  // two escrow inputs, one continuing output: rejected (n_in == 1)
  let t = mk(
    [esc_in(1, 1000000000), esc_in(2, 1000000000)],
    [claimed_out(dat(1), 1000000000)],
    t1 - 3600000,
    t1 - 1,
    [bob],
  )
  !run(dat(0), Commit { go_sig: sig_ok }, t)
}

test c9_commit_two_outputs_to_script() {
  !run(
    dat(0),
    Commit { go_sig: sig_ok },
    commit_tx([claimed_out(dat(1), 500000000), claimed_out(dat(1), 500000000)]),
  )
}

test c10_commit_on_claimed_rejected() {
  !run(
    dat(1),
    Commit { go_sig: sig_ok },
    commit_tx([claimed_out(dat(1), 1000000000)]),
  )
}

test c11_commit_without_bob_sig() {
  !run(
    dat(0),
    Commit { go_sig: sig_ok },
    mk(
      [esc_in(1, 1000000000)],
      [claimed_out(dat(1), 1000000000)],
      t1 - 3600000,
      t1 - 1,
      [alice],
    ),
  )
}

test c12_commit_bad_go_sig() {
  let bad = bytearray.concat(
    bytearray.drop(sig_ok, 1),
    bytearray.take(sig_ok, 1),
  )
  !run(
    dat(0),
    Commit { go_sig: bad },
    commit_tx([claimed_out(dat(1), 1000000000)]),
  )
}

test c13_commit_output_datum_hash_not_inline() {
  let o = Output { ..claimed_out(dat(1), 1000000000), datum: NoDatum }
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([o]))
}

// ======================= step 7: step-6 script tests ported to the Commit action =======================
const other_vk: ByteArray =
  #"455dc819489f82c9283bf6f7193ec8fe0bcedd7fa47387a77dfd1b918fd30a43"

const sig_other_outref: ByteArray =
  #"3398ec560c176cd1f75bf1ac33a54d48c360837b77db4b01a62226b757583844d644b6596add3d316d62a9e93428c0d57c158eeecf1ca8fc9359c423c731b500"

const sig_other_swap: ByteArray =
  #"7391914cf47c9ef173dcadb85baaa75c2daeaec0079cb4020ea3cd78caccdce2a0ab899f8d0ad7773677ed2021f0751f48a010af5d54bda3a1a38cd0c1f8eb0d"

const sig_other_net: ByteArray =
  #"7aae9be0ef0cf7c63378fe6e01d5f9b34b186a2a06be5091d4da52f3f68a7357b32fb2c4db0cef83bcda2d04ea261abc0866a77044c8d9127cb6ed532a6daf08"

const sig_other_domain: ByteArray =
  #"f984f5b15d4b4a99a917ba388aaab7182b9244ef2d7b09f6d6a314a5b184996a2be9e47b0b2d37da295aeb195d7b594a118b42ecac45143436445d658c14e409"

const sig_other_amount: ByteArray =
  #"2c79952223b3a73d4754210d6f5ff7742637575f6a9d5eb3513e5480cada27af488e1c48032708f4c26fb871d3f7ebbc7cfb5fd606f9d871de9b9714d8ad650f"

const sig_other_key: ByteArray =
  #"7a50081031044a809d97bf98e3fc8f9ef50534bad566f3be362bf72235cb5cdfb7d9da4b7ccf6a640fbe284756cc6eca2d7236d5080a25e6cfee7b357ee56805"

fn ctx(lo: Int, hi: Int, sigs: List<ByteArray>) -> Transaction {
  mk([esc_in(1, 1000000000)], [claimed_out(dat(1), 1000000000)], lo, hi, sigs)
}

fn commit(d: EscrowDatum, sig: ByteArray, t: Transaction) -> Bool {
  escrow.spend(Some(d), Commit { go_sig: sig }, oref(1), t)
}

fn cok() -> Transaction {
  ctx(t1 - 3600000, t1 - 1, [bob])
}

test m0_go_message_matches_offchain() {
  go_message(dat(0), script_h, oref(1), 1000000000) == #"7a655554584f2f70617468312f676f2f7631005a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c00000000000000000000000000000000000000000000000000000000000000010000000000003b9aca00000001a3185c5000"
}

test s1_commit_ok_rebuilt_other_fee_input_and_ttl() {
  let extra = Input {
    output_reference: oref(9),
    output: Output {
      address: baddr(),
      value: assets.from_lovelace(5000000),
      datum: NoDatum,
      reference_script: None,
    },
  }
  commit(
    dat(0),
    sig_ok,
    mk(
      [esc_in(1, 1000000000), extra],
      [claimed_out(dat(1), 1000000000)],
      t1 - 7200000,
      t1 - 60000,
      [bob],
    ),
  )
}

test g1_go_sig_for_other_escrow_outref_replayed() {
  !commit(dat(0), sig_other_outref, cok())
}

test g1b_go_sig_for_escrow1_used_on_escrow2() {
  let t = mk(
    [esc_in(2, 1000000000)],
    [claimed_out(dat(1), 1000000000)],
    t1 - 3600000,
    t1 - 1,
    [bob],
  )
  !escrow.spend(Some(dat(0)), Commit { go_sig: sig_ok }, oref(2), t)
}

test g2_go_sig_other_swap_id() {
  !commit(dat(0), sig_other_swap, cok())
}

test g3_go_sig_other_network() {
  !commit(dat(0), sig_other_net, cok())
}

test g4_go_sig_other_domain() {
  !commit(dat(0), sig_other_domain, cok())
}

test g5_go_sig_other_amount() {
  !commit(dat(0), sig_other_amount, cok())
}

test g5b_escrow_holds_other_amount_than_signed() {
  !commit(
    dat(0),
    sig_ok,
    mk(
      [esc_in(1, 999000000)],
      [claimed_out(dat(1), 999000000)],
      t1 - 3600000,
      t1 - 1,
      [bob],
    ),
  )
}

test g6_go_sig_by_other_key() {
  !commit(dat(0), sig_other_key, cok())
}

test g8_go_sig_wrong_length() fail {
  commit(dat(0), bytearray.take(sig_ok, 63), cok())
}

test g9_datum_go_vk_swapped_to_other_key() {
  let d = EscrowDatum { ..dat(0), alice_go_vk: other_vk }
  !escrow.spend(
    Some(d),
    Commit { go_sig: sig_ok },
    oref(1),
    mk(
      [esc_in(1, 1000000000)],
      [claimed_out(EscrowDatum { ..d, phase: 1 }, 1000000000)],
      t1 - 3600000,
      t1 - 1,
      [bob],
    ),
  )
}

test g10_front_runner_copies_go_sig_without_bob_sig() {
  !commit(dat(0), sig_ok, ctx(t1 - 3600000, t1 - 1, [alice]))
}

test g11_front_runner_copies_b_from_mempool_reveal_without_bob_sig() {
  !run(
    dat(1),
    Reveal { b: vb },
    mk([esc_in(1, 1000000000)], [], t1, t1 + 1, [alice]),
  )
}

test n2_reveal_b_plus_r_out_of_range() fail {
  let r = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001
  run(
    dat(1),
    Reveal { b: vb + r },
    mk([esc_in(1, 1000000000)], [], t1, t1 + 1, [bob]),
  )
}

test n3_reveal_negative_b() fail {
  let r = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001
  run(
    dat(1),
    Reveal { b: vb - r },
    mk([esc_in(1, 1000000000)], [], t1, t1 + 1, [bob]),
  )
}

test n6_commit_unbounded_upper() {
  let t = Transaction {
    ..cok(),
    validity_range: Interval {
      lower_bound: IntervalBound {
        bound_type: NegativeInfinity,
        is_inclusive: True,
      },
      upper_bound: IntervalBound {
        bound_type: PositiveInfinity,
        is_inclusive: True,
      },
    },
  }
  !commit(dat(0), sig_ok, t)
}

test n12_bad_point_bytes() fail {
  share_ok(
    vb,
    #"ff0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  )
}

// ---- step 7 own review: new negatives ----
test s2_double_satisfaction_other_stake_credential() {
  // a second escrow input at the SAME script but under another stake credential, with its own continuing output:
  // the step-7 guard counts every input locked by this script, so one Commit cannot move two escrows.
  let other = Input {
    output_reference: oref(2),
    output: Output {
      address: Address {
        payment_credential: Script(script_h),
        stake_credential: Some(Inline(VerificationKey(alice))),
      },
      value: assets.from_lovelace(1000000000),
      datum: NoDatum,
      reference_script: None,
    },
  }
  !commit(
    dat(0),
    sig_ok,
    mk(
      [esc_in(1, 1000000000), other],
      [claimed_out(dat(1), 1000000000)],
      t1 - 3600000,
      t1 - 1,
      [bob],
    ),
  )
}

test s3_commit_output_changes_bob_or_b_c() {
  and {
    !commit(
      dat(0),
      sig_ok,
      mk(
        [esc_in(1, 1000000000)],
        [claimed_out(EscrowDatum { ..dat(1), bob: alice }, 1000000000)],
        t1 - 3600000,
        t1 - 1,
        [bob],
      ),
    ),
    !commit(
      dat(0),
      sig_ok,
      mk(
        [esc_in(1, 1000000000)],
        [claimed_out(EscrowDatum { ..dat(1), b_c: a_c() }, 1000000000)],
        t1 - 3600000,
        t1 - 1,
        [bob],
      ),
    ),
  }
}

test s4_commit_output_extra_token_rejected() {
  let o = Output {
    ..claimed_out(dat(1), 1000000000),
    value: assets.add(assets.from_lovelace(1000000000), script_h, "x", 1),
  }
  !commit(
    dat(0),
    sig_ok,
    mk([esc_in(1, 1000000000)], [o], t1 - 3600000, t1 - 1, [bob]),
  )
}

test s5_escape_reveals_nothing_redeemer_has_no_fields() {
  // Escape carries no field at all: there is nothing in it that could encode a
  run(
    dat(1),
    Escape,
    mk([esc_in(1, 1000000000)], [baddr_out()], t3 + 1, t3 + 2, [alice]),
  )
}

fn baddr_out() -> Output {
  Output {
    address: baddr(),
    value: assets.from_lovelace(999800000),
    datum: NoDatum,
    reference_script: None,
  }
}

// ======================= step 8: two-step refund (Notice -> RefundReveal / Forfeit) =======================
const tail: Int = t3 - t1

fn refunding(hi: Int) -> EscrowDatum {
  EscrowDatum { ..dat(0), phase: 2, t4: hi + tail }
}

fn notice_tx(
  lo: Int,
  hi: Int,
  out: EscrowDatum,
  sigs: List<ByteArray>,
) -> Transaction {
  mk([esc_in(1, 1000000000)], [claimed_out(out, 1000000000)], lo, hi, sigs)
}

fn notice(d: EscrowDatum, t: Transaction) -> Bool {
  escrow.spend(Some(d), Notice, oref(1), t)
}

const h1: Int = 3600000

test q1_notice_by_alice_at_t1() {
  notice(dat(0), notice_tx(t1, t1 + h1, refunding(t1 + h1), [alice]))
}

test q2_notice_by_bob_at_t2() {
  notice(dat(0), notice_tx(t2, t2 + h1, refunding(t2 + h1), [bob]))
}

test q3_refund_reveal_ok_long_after_t4() {
  // the tx carrying a has NO deadline
  run(
    refunding(t1 + h1),
    RefundReveal { a: va },
    mk(
      [esc_in(1, 1000000000)],
      [],
      t3 + 30 * 86400000,
      t3 + 30 * 86400000 + 1,
      [alice],
    ),
  )
}

test q4_forfeit_ok_at_t4() {
  let d = refunding(t1 + h1)
  run(d, Forfeit, mk([esc_in(1, 1000000000)], [], d.t4, d.t4 + h1, [bob]))
}

test q5_alice_notice_before_t1_rejected() {
  !notice(dat(0), notice_tx(t1 - 1, t1 + h1, refunding(t1 + h1), [alice]))
}

test q6_bob_notice_between_t1_and_t2_rejected() {
  !notice(dat(0), notice_tx(t2 - 1, t2 + h1, refunding(t2 + h1), [bob]))
}

test q7_notice_without_party_sig_rejected() {
  !notice(dat(0), notice_tx(t2, t2 + h1, refunding(t2 + h1), [script_h]))
}

test q8_notice_t4_one_ms_short_rejected() {
  !notice(
    dat(0),
    notice_tx(
      t1,
      t1 + h1,
      EscrowDatum { ..refunding(t1 + h1), t4: t1 + h1 + tail - 1 },
      [alice],
    ),
  )
}

test q9_notice_t4_from_lower_bound_rejected() {
  !notice(dat(0), notice_tx(t1, t1 + h1, refunding(t1), [alice]))
}

test q10_notice_range_over_6h_rejected() {
  let hi = t1 + 21600001
  !notice(dat(0), notice_tx(t1, hi, refunding(hi), [alice]))
}

test q11_notice_range_exactly_6h_ok() {
  let hi = t1 + 21600000
  notice(dat(0), notice_tx(t1, hi, refunding(hi), [alice]))
}

test q12_notice_unbounded_upper_rejected() {
  let t = Transaction {
    ..notice_tx(t1, t1 + h1, refunding(t1 + h1), [alice]),
    validity_range: Interval {
      lower_bound: IntervalBound { bound_type: Finite(t1), is_inclusive: True },
      upper_bound: IntervalBound {
        bound_type: PositiveInfinity,
        is_inclusive: True,
      },
    },
  }
  !notice(dat(0), t)
}

test q13_notice_skims_value_rejected() {
  !notice(
    dat(0),
    mk(
      [esc_in(1, 1000000000)],
      [claimed_out(refunding(t1 + h1), 999999999)],
      t1,
      t1 + h1,
      [alice],
    ),
  )
}

test q14_notice_on_claimed_rejected() {
  !notice(dat(1), notice_tx(t1, t1 + h1, refunding(t1 + h1), [alice]))
}

test q15_renotice_on_refunding_to_extend_t4_rejected() {
  !notice(
    refunding(t1 + h1),
    notice_tx(t2, t2 + h1, refunding(t2 + h1), [alice]),
  )
}

test q16_notice_double_satisfaction_two_escrows_rejected() {
  !notice(
    dat(0),
    mk(
      [esc_in(1, 1000000000), esc_in(2, 1000000000)],
      [claimed_out(refunding(t1 + h1), 1000000000)],
      t1,
      t1 + h1,
      [alice],
    ),
  )
}

test q17_notice_output_wrong_phase_rejected() {
  and {
    !notice(
      dat(0),
      notice_tx(
        t1,
        t1 + h1,
        EscrowDatum { ..refunding(t1 + h1), phase: 0 },
        [alice],
      ),
    ),
    !notice(
      dat(0),
      notice_tx(
        t1,
        t1 + h1,
        EscrowDatum { ..refunding(t1 + h1), phase: 1 },
        [alice],
      ),
    ),
  }
}

test q18_notice_output_changes_other_field_rejected() {
  and {
    !notice(
      dat(0),
      notice_tx(
        t1,
        t1 + h1,
        EscrowDatum { ..refunding(t1 + h1), bob: alice },
        [alice],
      ),
    ),
    !notice(
      dat(0),
      notice_tx(
        t1,
        t1 + h1,
        EscrowDatum { ..refunding(t1 + h1), a_c: vb_c },
        [alice],
      ),
    ),
  }
}

test q19_notice_output_ref_script_or_other_address_rejected() {
  let o = claimed_out(refunding(t1 + h1), 1000000000)
  and {
    !notice(
      dat(0),
      mk(
        [esc_in(1, 1000000000)],
        [Output { ..o, reference_script: Some(script_h) }],
        t1,
        t1 + h1,
        [alice],
      ),
    ),
    !notice(
      dat(0),
      mk(
        [esc_in(1, 1000000000)],
        [Output { ..o, address: baddr() }],
        t1,
        t1 + h1,
        [alice],
      ),
    ),
  }
}

test q20_commit_on_refunding_rejected() {
  !run(
    refunding(t1 + h1),
    Commit { go_sig: sig_ok },
    commit_tx(
      [claimed_out(EscrowDatum { ..refunding(t1 + h1), phase: 1 }, 1000000000)],
    ),
  )
}

test q21_reveal_b_or_escape_on_refunding_rejected() {
  and {
    !run(
      refunding(t1 + h1),
      Reveal { b: vb },
      mk([esc_in(1, 1000000000)], [], t2, t2 + 1, [bob]),
    ),
    !run(
      refunding(t1 + h1),
      Escape,
      mk([esc_in(1, 1000000000)], [], t3, t3 + 1, [alice]),
    ),
  }
}

test q22_refund_reveal_on_open_or_claimed_rejected() {
  // the step-6/7 congestion3 path: a revealed on a non-Refunding state never pays out
  and {
    !run(
      dat(0),
      RefundReveal { a: va },
      mk([esc_in(1, 1000000000)], [], t2, t2 + 1, [alice]),
    ),
    !run(
      dat(1),
      RefundReveal { a: va },
      mk([esc_in(1, 1000000000)], [], t2, t2 + 1, [alice]),
    ),
  }
}

test q23_refund_reveal_wrong_a_or_not_alice_rejected() {
  and {
    !run(
      refunding(t1 + h1),
      RefundReveal { a: va + 1 },
      mk([esc_in(1, 1000000000)], [], t2, t2 + 1, [alice]),
    ),
    !run(
      refunding(t1 + h1),
      RefundReveal { a: va },
      mk([esc_in(1, 1000000000)], [], t2, t2 + 1, [bob]),
    ),
  }
}

test q24_forfeit_before_t4_or_not_bob_rejected() {
  let d = refunding(t1 + h1)
  and {
    !run(
      d,
      Forfeit,
      mk([esc_in(1, 1000000000)], [], d.t4 - 1, d.t4 + h1, [bob]),
    ),
    !run(d, Forfeit, mk([esc_in(1, 1000000000)], [], d.t4, d.t4 + h1, [alice])),
  }
}

test q25_forfeit_on_open_or_claimed_rejected_even_though_t4_is_zero() {
  and {
    !run(dat(0), Forfeit, mk([esc_in(1, 1000000000)], [], t2, t2 + 1, [bob])),
    !run(dat(1), Forfeit, mk([esc_in(1, 1000000000)], [], t3, t3 + 1, [bob])),
  }
}

test q26_no_datum() fail {
  escrow.spend(
    None,
    Forfeit,
    oref(1),
    mk([esc_in(1, 1000000000)], [], t3, t3 + 1, [bob]),
  )
}

test q27_notice_by_bob_with_alice_window_but_bob_sig_rejected() {
  // lower in [T1, T2) signed only by Bob: the Alice branch needs Alice's signature
  !notice(dat(0), notice_tx(t1, t1 + h1, refunding(t1 + h1), [bob]))
}

test q28_commit_output_must_keep_t4_zero() {
  !run(
    dat(0),
    Commit { go_sig: sig_ok },
    commit_tx([claimed_out(EscrowDatum { ..dat(1), t4: 1 }, 1000000000)]),
  )
}
