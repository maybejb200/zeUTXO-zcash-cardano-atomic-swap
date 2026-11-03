//// review4 PROTOTYPE (not step6 code): two-phase Commit/Reveal escrow ("design X") that removes the
//// congestion3 censorship-theft. Throwaway vectors only (reuses step6's go-message test vectors).
////   Open    --Commit{go_sig}  (Bob sig + Alice go, upper <= T1-1, NO secret)--> Claimed (same address/value)
////   Claimed --Reveal{b}       (Bob sig, b*G1 = B_c, NO deadline)            --> anywhere (Bob's choice)
////   Claimed --Escape          (Alice sig, lower >= T3, NO secret)           --> anywhere (Alice's choice)
////   Open    --Refund{a}       (Alice sig, lower >= T1, a*G1 = A_c)          --> anywhere
////   Open    --Punish          (Bob sig, lower >= T2)                        --> anywhere
//// Why it works: the only tx that can be censored around a deadline (Commit) carries no secret, so censoring
//// it only aborts the swap (Alice refunds with a, Bob recovers his ZEC). The tx that carries b (Reveal) has no
//// deadline until T3 (days), and Alice's T3 escape does NOT reveal a, so a Bob who never reveals forfeits his
//// own ZEC: not revealing is strictly dominated, so Bob gets no free option and no bond is needed.

use aiken/builtin
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/crypto/bls12_381/g1
use aiken/interval.{Finite, Interval, IntervalBound}
use aiken/primitive/bytearray
use cardano/address.{Address, Script, VerificationKey}
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
  // new: Alice's no-secret escape from the Claimed state (T3 >> T2, e.g. T1 + 7 days)
  t3: Int,
  // new: 0 = Open, 1 = Claimed
  phase: Int,
}

pub type Action {
  Commit { go_sig: ByteArray }
  Reveal { b: Int }
  Refund { a: Int }
  Punish
  Escape
}

const share_bound: Int =
  7237005577332262213973186563042994240829374041602535252466099000494570602496

pub const go_domain: ByteArray = "zeUTXO/path1/go/v1"

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

/// Commit's continuing-output rule: exactly one input from this script (no double satisfaction), and exactly
/// one output back to the SAME address with the SAME value, the Claimed datum inline, and no reference script.
fn continues_claimed(tx: Transaction, me: Output, d: EscrowDatum) -> Bool {
  let n_in =
    list.count(tx.inputs, fn(i) { i.output.address == me.address })
  let outs = list.filter(tx.outputs, fn(o) { o.address == me.address })
  let expected: Data = EscrowDatum { ..d, phase: 1 }
  when outs is {
    [o] -> and {
        n_in == 1,
        o.value == me.value,
        o.datum == InlineDatum(expected),
        o.reference_script == None,
      }
    _ -> False
  }
}

validator escrow2 {
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
        let msg =
          go_message(d, script_hash, own, assets.lovelace_of(me.output.value))
        and {
          d.phase == 0,
          builtin.verify_ed25519_signature(d.alice_go_vk, msg, go_sig),
          signed(tx, d.bob),
          upper_before(tx, d.t1 - 1),
          continues_claimed(tx, me.output, d),
        }
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
      Refund { a } -> and {
          d.phase == 0,
          signed(tx, d.alice),
          lower_from(tx, d.t1),
          share_ok(a, d.a_c),
        }
      Punish -> and {
          d.phase == 0,
          signed(tx, d.bob),
          lower_from(tx, d.t2),
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

const a_c_const: ByteArray =
  #"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"

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
  escrow2.spend(Some(d), a, oref(1), tx)
}

// ---- positives ----
test p1_commit_ok() {
  run(dat(0), Commit { go_sig: sig_ok }, commit_tx([claimed_out(dat(1), 1000000000)]))
}

test p2_reveal_ok_long_after_t1_and_t2() {
  // the tx carrying b has NO deadline: still valid a day after T2
  run(dat(1), Reveal { b: vb }, mk([esc_in(1, 1000000000)], [], t2 + 86400000, t2 + 90000000, [bob]))
}

test p3_escape_ok_at_t3_without_secret() {
  run(dat(1), Escape, mk([esc_in(1, 1000000000)], [], t3, t3 + 3600000, [alice]))
}

test p4_refund_ok_open() {
  run(dat(0), Refund { a: va }, mk([esc_in(1, 1000000000)], [], t1, t1 + 3600000, [alice]))
}

test p5_punish_ok_open() {
  run(dat(0), Punish, mk([esc_in(1, 1000000000)], [], t2, t2 + 3600000, [bob]))
}

// ---- the censorship property ----
test x1_claimed_refund_impossible_even_with_a() {
  // after Commit, Alice cannot take the ADA back at T1 (the congestion3 theft path) even revealing a
  !run(dat(1), Refund { a: va }, mk([esc_in(1, 1000000000)], [], t1, t1 + 3600000, [alice]))
}

test x2_escape_before_t3_rejected() {
  !run(dat(1), Escape, mk([esc_in(1, 1000000000)], [], t3 - 1, t3 + 3600000, [alice]))
}

test x3_escape_from_open_rejected() {
  !run(dat(0), Escape, mk([esc_in(1, 1000000000)], [], t3, t3 + 3600000, [alice]))
}

test x4_punish_on_claimed_rejected() {
  !run(dat(1), Punish, mk([esc_in(1, 1000000000)], [], t2, t2 + 3600000, [bob]))
}

test x5_reveal_on_open_rejected() {
  // b can only be published after Commit is on-chain (Bob's wallet waits K blocks before revealing)
  !run(dat(0), Reveal { b: vb }, mk([esc_in(1, 1000000000)], [], t1 - 3600000, t1 - 1, [bob]))
}

test x6_reveal_wrong_b_or_no_bob_sig() {
  and {
    !run(dat(1), Reveal { b: vb + 1 }, mk([esc_in(1, 1000000000)], [], t1, t1 + 1, [bob])),
    !run(dat(1), Reveal { b: vb }, mk([esc_in(1, 1000000000)], [], t1, t1 + 1, [alice])),
  }
}

test x7_escape_needs_alice_sig() {
  !run(dat(1), Escape, mk([esc_in(1, 1000000000)], [], t3, t3 + 1, [bob]))
}

// ---- Commit continuing-output / double-satisfaction negatives ----
test c1_commit_at_t1_rejected() {
  !run(dat(0), Commit { go_sig: sig_ok }, mk([esc_in(1, 1000000000)], [claimed_out(dat(1), 1000000000)], t1 - 3600000, t1, [bob]))
}

test c2_commit_without_continuing_output() {
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([]))
}

test c3_commit_skims_value() {
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([claimed_out(dat(1), 999999999)]))
}

test c4_commit_output_still_open_phase() {
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([claimed_out(dat(0), 1000000000)]))
}

test c5_commit_output_changes_t3() {
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([claimed_out(EscrowDatum { ..dat(1), t3: t1 }, 1000000000)]))
}

test c6_commit_output_with_ref_script() {
  let o = Output { ..claimed_out(dat(1), 1000000000), reference_script: Some(script_h) }
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([o]))
}

test c7_commit_output_to_other_address() {
  let o = Output { ..claimed_out(dat(1), 1000000000), address: baddr() }
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([o]))
}

test c8_double_satisfaction_two_escrows_one_output() {
  // two escrow inputs, one continuing output: rejected (n_in == 1)
  let t = mk([esc_in(1, 1000000000), esc_in(2, 1000000000)], [claimed_out(dat(1), 1000000000)], t1 - 3600000, t1 - 1, [bob])
  !run(dat(0), Commit { go_sig: sig_ok }, t)
}

test c9_commit_two_outputs_to_script() {
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([claimed_out(dat(1), 500000000), claimed_out(dat(1), 500000000)]))
}

test c10_commit_on_claimed_rejected() {
  !run(dat(1), Commit { go_sig: sig_ok }, commit_tx([claimed_out(dat(1), 1000000000)]))
}

test c11_commit_without_bob_sig() {
  !run(dat(0), Commit { go_sig: sig_ok }, mk([esc_in(1, 1000000000)], [claimed_out(dat(1), 1000000000)], t1 - 3600000, t1 - 1, [alice]))
}

test c12_commit_bad_go_sig() {
  let bad = bytearray.concat(bytearray.drop(sig_ok, 1), bytearray.take(sig_ok, 1))
  !run(dat(0), Commit { go_sig: bad }, commit_tx([claimed_out(dat(1), 1000000000)]))
}

test c13_commit_output_datum_hash_not_inline() {
  let o = Output { ..claimed_out(dat(1), 1000000000), datum: NoDatum }
  !run(dat(0), Commit { go_sig: sig_ok }, commit_tx([o]))
}
