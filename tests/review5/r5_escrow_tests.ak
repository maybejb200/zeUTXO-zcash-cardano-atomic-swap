
// ======================= review5 adversarial tests (appended to a COPY of escrow v0.7) =======================
fn r5_in(n: Int, d: EscrowDatum) -> Input {
  let x: Data = d
  Input {
    output_reference: oref(n),
    output: Output {
      address: saddr(),
      value: assets.from_lovelace(1000000000),
      datum: InlineDatum(x),
      reference_script: None,
    },
  }
}

// R5-A1 (documents the T3 race): after T3 BOTH Reveal{b} and Escape are valid on the same Claimed UTxO.
// A Reveal broadcast near T3 hands b to Alice, who can sweep the ZEC and still win the UTxO with Escape.
test r5_a1_reveal_and_escape_both_valid_after_t3() {
  let tx_r = mk([esc_in(1, 1000000000)], [], t3 + 1000, t3 + 3600000, [bob])
  let tx_e = mk([esc_in(1, 1000000000)], [], t3 + 1000, t3 + 3600000, [alice])
  and {
    run(dat(1), Reveal { b: vb }, tx_r),
    run(dat(1), Escape, tx_e),
  }
}

// R5-A2 (safe): a Commit cannot be bundled with a Reveal of ANOTHER escrow (two script inputs -> Commit fails).
test r5_a2_commit_bundled_with_other_escrow_reveal_rejected() {
  let tx =
    mk(
      [esc_in(1, 1000000000), r5_in(2, dat(1))],
      [claimed_out(dat(1), 1000000000)],
      t1 - 3600000,
      t1 - 1,
      [bob],
    )
  !run(dat(0), Commit { go_sig: sig_ok }, tx)
}

// R5-A3 (safe): a Notice cannot be bundled with a Forfeit/RefundReveal of another escrow.
test r5_a3_notice_bundled_with_other_escrow_rejected() {
  let d2 = EscrowDatum { ..dat(0), phase: 2, t4: t1 + 1 }
  let hi = t1 + 3600000
  let out = claimed_out(EscrowDatum { ..dat(0), phase: 2, t4: hi + ( t3 - t1 ) }, 1000000000)
  let tx = mk([esc_in(1, 1000000000), r5_in(2, d2)], [out], t1, hi, [alice, bob])
  !run(dat(0), Notice, tx)
}

// R5-A4 (documents, harmless): the four terminal actions have no single-input rule, so ONE tx can drain several
// escrows (here: Bob's Reveal on E1 and Bob's Forfeit on E2). Each needs its own beneficiary's signature and the
// beneficiary chooses the outputs, so there is no double-satisfaction victim. Recorded so a future "pay to X" rule
// is not added without also adding a single-input check.
test r5_a4_reveal_and_forfeit_of_two_escrows_in_one_tx_accepted() {
  let d2 = EscrowDatum { ..dat(0), phase: 2, t4: t3 }
  let tx = mk([esc_in(1, 1000000000), r5_in(2, d2)], [], t3, t3 + 1000, [bob])
  and {
    run(dat(1), Reveal { b: vb }, tx),
    escrow.spend(Some(d2), Forfeit, oref(2), tx),
  }
}

// R5-A5 (safe): Bob's Notice can push t4 out by at most 6 h (hi - lo cap), never by another tail.
test r5_a5_bob_notice_max_t4_push_is_6h() {
  let lo = t2
  let hi = t2 + 21600000
  let out = claimed_out(EscrowDatum { ..dat(0), phase: 2, t4: hi + ( t3 - t1 ) }, 1000000000)
  let out_bad =
    claimed_out(EscrowDatum { ..dat(0), phase: 2, t4: hi + 1 + ( t3 - t1 ) }, 1000000000)
  and {
    run(dat(0), Notice, mk([esc_in(1, 1000000000)], [out], lo, hi, [bob])),
    !run(dat(0), Notice, mk([esc_in(1, 1000000000)], [out_bad], lo, hi + 1, [bob])),
  }
}
