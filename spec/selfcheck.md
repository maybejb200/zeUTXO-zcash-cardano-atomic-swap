# step 8 self-check (NOT independent — same author as the code)
- Contract v0.7: aiken check 71/71; 30/30 mutants killed (results/mutation_step8.log). Each Notice clause (phase, Alice
  lower ≥ T1, Bob lower ≥ T2, signer, 6 h cap, t4 from upper, exact tail, output phase) and each RefundReveal/Forfeit
  clause has a killing test.
- State machine reviewed for: re-Notice (blocked: Notice only on phase 0), Commit/Reveal/Escape on Refunding (blocked),
  RefundReveal/Forfeit on Open/Claimed (blocked; t4 = 0 there), double satisfaction (one escrow input per tx), unbounded
  upper bound (rejected), skim on Notice (exact value).
- Wallet gates: 58 probes in tests/gates8_test.mjs, 0 fail open.
- Things I could have got wrong and an outside reviewer should check: (1) the ledger's slot→POSIX conversion used by
  the sim equals the real node's for the Notice upper bound (t4 depends on it); (2) the fork model in ledger.mjs fork()
  (single competing block at T1 − 2 s); (3) R-1 censorship residual sizing; (4) use_qsk derivation vs real Zebra.
