//// zeUTXO path 1 escrow (Farcaster-style). Throwaway test vectors only.
use aiken/builtin
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/crypto/bls12_381/g1
use aiken/interval.{Finite, IntervalBound}
use cardano/transaction.{OutputReference, Transaction}
use aiken/interval.{Interval, NegativeInfinity, PositiveInfinity}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{Input, NoDatum, Output}

pub type EscrowDatum {
  alice: VerificationKeyHash,
  bob: VerificationKeyHash,
  // 48-byte compressed BLS12-381 G1 points A_c = a*G1, B_c = b*G1 (DLEQ-linked to the Pallas shares)
  a_c: ByteArray,
  b_c: ByteArray,
  t1: Int,
  t2: Int,
}

pub type Action {
  // Bob reveals his share b; needs Alice's go-signature (her key in extra_signatories) and tx valid only before T1
  Redeem { b: Int }
  // Alice reveals her share a; only from T1 on (stays open after T2)
  Refund { a: Int }
  // Bob takes the ADA from T2 on without revealing anything (Alice silent)
  Punish
}

/// 2^252: shares are restricted to [0, 2^252) so the integer is the same scalar in Pallas and BLS12-381.
const share_bound: Int =
  7237005577332262213973186563042994240829374041602535252466099000494570602496

/// Core share check: 0 <= s < 2^252 and s*G1 == decompress(pt)
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

/// Variant: compress the computed point and compare bytes (no decompression of the datum point).
pub fn share_ok_compress(s: Int, pt: ByteArray) -> Bool {
  and {
    s >= 0,
    s < share_bound,
    builtin.bls12_381_g1_compress(builtin.bls12_381_g1_scalar_mul(s, g1.generator)) == pt,
  }
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

validator escrow {
  spend(
    datum: Option<EscrowDatum>,
    action: Action,
    _own: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d) = datum
    when action is {
      // upper bound is exclusive-ish: we require u <= t1 - 1 so the tx cannot land at/after T1
      Redeem { b } ->
        and {
          signed(tx, d.alice),
          signed(tx, d.bob),
          upper_before(tx, d.t1 - 1),
          share_ok(b, d.b_c),
        }
      Refund { a } ->
        and {
          signed(tx, d.alice),
          lower_from(tx, d.t1),
          share_ok(a, d.a_c),
        }
      Punish ->
        and {
          signed(tx, d.bob),
          lower_from(tx, d.t2),
        }
    }
  }

  else(_) {
    fail
  }
}

// ======================= tests =======================

// Fresh throwaway vector from test_b_dleq (x < 2^252; Q = x*G1, the Q side of the cross-group DLEQ)
const vb: Int =
  1536951685173436278485048062579777913997139112146137485195657728618292436409

const vb_c: ByteArray =
  #"a98d8d234f61eb37a907edc1391420b922e47ecfa17768d99b8f86585e5c137d16ad286d5298f60666bebe8f37add9f1"

// a: a second throwaway scalar for Alice; its point is computed in-test (cost of constructing it excluded below
// by using a constant computed once -> we just reuse a fixed small-ish random constant and its point)
const va: Int =
  3141592653589793238462643383279502884197169399375105820974944592307816406286

const alice: ByteArray = #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const bob: ByteArray = #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"

const t1: Int = 1800000000000

const t2: Int = 1800086400000

fn datum(a_c: ByteArray) -> EscrowDatum {
  EscrowDatum { alice, bob, a_c, b_c: vb_c, t1, t2 }
}

fn own() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000001",
    output_index: 0,
  }
}

fn tx(lo: Int, hi: Int, sigs: List<ByteArray>) -> Transaction {
  let script_addr =
    Address {
      payment_credential: Script(
        #"5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c",
      ),
      stake_credential: None,
    }
  let bob_addr =
    Address { payment_credential: VerificationKey(bob), stake_credential: None }
  Transaction {
    ..transaction.placeholder,
    inputs: [
      Input {
        output_reference: own(),
        output: Output {
          address: script_addr,
          value: assets.from_lovelace(1000000000),
          datum: NoDatum,
          reference_script: None,
        },
      },
    ],
    outputs: [
      Output {
        address: bob_addr,
        value: assets.from_lovelace(999800000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    fee: 200000,
    validity_range: Interval {
      lower_bound: IntervalBound { bound_type: Finite(lo), is_inclusive: True },
      upper_bound: IntervalBound { bound_type: Finite(hi), is_inclusive: True },
    },
    extra_signatories: sigs,
  }
}

fn a_c() -> ByteArray {
  builtin.bls12_381_g1_compress(builtin.bls12_381_g1_scalar_mul(va, g1.generator))
}

// ---------- core share check only ----------
test c0_share_check_decompress() {
  share_ok(vb, vb_c)
}

test c0_share_check_compress() {
  share_ok_compress(vb, vb_c)
}

// harness baseline: the same constants, no crypto (to subtract)
test c0_baseline_constants() {
  vb > 0 && builtin.length_of_bytearray(vb_c) == 48
}

// ---------- full validator, Redeem branch (worst case: real-sized tx context built in the test) ----------
const a_c_const: ByteArray =
  #"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"

test c1_redeem_ok() {
  escrow.spend(
    Some(datum(a_c_const)),
    Redeem { b: vb },
    own(),
    tx(t1 - 3600000, t1 - 1, [alice, bob]),
  )
}

test c1_baseline_tx_build_only() {
  let t = tx(t1 - 3600000, t1 - 1, [alice, bob])
  t.fee == 200000 && datum(a_c_const).t1 == t1
}

test c2_refund_ok() {
  let ac = a_c()
  escrow.spend(
    Some(datum(ac)),
    Refund { a: va },
    own(),
    tx(t1, t1 + 3600000, [alice]),
  )
}

test c3_punish_ok() {
  escrow.spend(Some(datum(a_c_const)), Punish, own(), tx(t2, t2 + 3600000, [bob]))
}

// ---------- negatives (must all be rejected) ----------
test n1_redeem_wrong_b() {
  !escrow.spend(
    Some(datum(a_c_const)),
    Redeem { b: vb + 1 },
    own(),
    tx(t1 - 3600000, t1 - 1, [alice, bob]),
  )
}

test n2_redeem_b_plus_r_out_of_range() fail {
  // b + r (BLS group order) maps to the same point but is >= 2^252: must be rejected by the range check
  let r = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001
  escrow.spend(
    Some(datum(a_c_const)),
    Redeem { b: vb + r },
    own(),
    tx(t1 - 3600000, t1 - 1, [alice, bob]),
  )
}

test n3_redeem_negative_b() fail {
  escrow.spend(
    Some(datum(a_c_const)),
    Redeem { b: vb - 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001 },
    own(),
    tx(t1 - 3600000, t1 - 1, [alice, bob]),
  )
}

test n4_redeem_without_go_sig() {
  !escrow.spend(
    Some(datum(a_c_const)),
    Redeem { b: vb },
    own(),
    tx(t1 - 3600000, t1 - 1, [bob]),
  )
}

test n5_redeem_at_t1() {
  !escrow.spend(
    Some(datum(a_c_const)),
    Redeem { b: vb },
    own(),
    tx(t1 - 3600000, t1, [alice, bob]),
  )
}

test n6_redeem_unbounded_upper() {
  let t =
    Transaction {
      ..tx(t1 - 3600000, t1 - 1, [alice, bob]),
      validity_range: Interval {
        lower_bound: IntervalBound { bound_type: NegativeInfinity, is_inclusive: True },
        upper_bound: IntervalBound { bound_type: PositiveInfinity, is_inclusive: True },
      },
    }
  !escrow.spend(Some(datum(a_c_const)), Redeem { b: vb }, own(), t)
}

test n7_refund_before_t1() {
  let ac = a_c()
  !escrow.spend(
    Some(datum(ac)),
    Refund { a: va },
    own(),
    tx(t1 - 1, t1 + 3600000, [alice]),
  )
}

test n8_refund_wrong_a() {
  let ac = a_c()
  !escrow.spend(
    Some(datum(ac)),
    Refund { a: va + 1 },
    own(),
    tx(t1, t1 + 3600000, [alice]),
  )
}

test n9_punish_before_t2() {
  !escrow.spend(
    Some(datum(a_c_const)),
    Punish,
    own(),
    tx(t2 - 1, t2 + 3600000, [bob]),
  )
}

test n10_punish_without_bob_sig() {
  !escrow.spend(
    Some(datum(a_c_const)),
    Punish,
    own(),
    tx(t2, t2 + 3600000, [alice]),
  )
}

test n11_no_datum() fail {
  escrow.spend(None, Punish, own(), tx(t2, t2 + 3600000, [bob]))
}

test n12_bad_point_bytes() fail {
  // 48 bytes that do not decode to a G1 point -> uncompress errors -> script fails
  share_ok(vb, #"ff0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000")
}
