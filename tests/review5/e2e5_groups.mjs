// ===================== review5 adversarial groups (spliced into a COPY of e2e4.mjs as sim/ada/e2e5.mjs) =====================
// R5-H1: Bob's fail-closed Reveal HOLD lasts until T3 − M. An attacker who keeps the HOLD condition true (here: Bob's
// direct-reach probe is degraded/unknown; the same holds for sustained mempool fill) shrinks the censorship Alice needs
// from the whole tail (real 7 days) to ~M (real 55 min) before T3, then sweeps the ZEC with b AND Escapes with the ADA.
async function r5HoldToT3() {
  const R = new Results("r5_hold_to_t3"); console.log("== review5 R5-H1: HOLD until T3 − M, then short censorship → Alice takes both legs");
  { const S = await start("r5-hold", R); const bobX = secret(S, "bob");
    const c = await bobCommit(S, R); R.rec("Commit settles (K deep)", "accept", c.settled, c.why);
    S.directStake = undefined;   // attacker degrades Bob's direct-submission probe (eclipse/DoS of his relays) — or it just broke
    let holds = 0, firstGo = null;
    while (S.L.now() < S.T3 + 60_000) { const g = revealGate({ commitConfs: S.L.confirmations(S.commitHash), K, mempoolFill: S.L.mempoolFill(), directStake: S.directStake, now: bobNow(S), T3: S.T3, M });
      if (g === null) { firstGo = S.L.now(); break; } if (/^HOLD/.test(g)) holds++; await S.L.awaitBlock(1); }
    R.rec(`Bob's gate HOLDs b for ${holds} blocks; first allowed broadcast ${(S.T3 - firstGo) / 1000} s before T3 (M = ${M / 1000} s; tail = ${TAIL / 1000} s)`, "observe", firstGo !== null && S.T3 - firstGo <= M + BLOCK, `hold ${(firstGo - S.L.blocks[0].slot) }`);
    const censorFrom = S.L.now(); S.L.censor = (p) => /^reveal/.test(p.label) && S.L.now() < S.T3 + 600_000;
    const u = S.claimed; await signSubmit(S, await build(S, S.B, revealTx(S, bobX)), S.B, "reveal");
    await S.L.awaitBlock(2); const b = aliceSeesB(S);
    const swA = b !== null ? sweep(S, R, "alice", [`other_share=${leHex(b)}`], "Sweep (Alice, a+b) from mempool b") : { reason: "no b" };
    R.rec("Alice reads b from the mempool and sweeps the ZEC", "accept (attack step)", swA.accepted === true, swA.reason);
    await S.L.untilMs(S.T3);
    let esc = false, why; try { S.L.pending = S.L.pending.filter(p => !/^reveal/.test(p.label));   // bribed producers never held the Reveal
      const r = await signSubmit(S, await build(S, S.A, escapeTx(S, S.T3, { utxo: u })), S.A, "escape"); await S.L.awaitBlock(K + 1); esc = S.L.confirmations(r.txHash) >= K; } catch (e) { why = e.message; }
    const window = S.T3 - censorFrom;
    R.rec(`ATTACK: censorship lasting only ${(window / 1000).toFixed(0)} s (≈ M; NOT the ${TAIL / 1000} s tail) lets Alice Escape with the ADA after taking the ZEC → honest Bob loses both legs`, "observe (attack succeeds = finding confirmed)", swA.accepted === true && esc, why);
    R.rec(`real-profile scale: censorship needed ≈ M = 54.9 min (~165 blocks) instead of 7 days (~30,240 blocks): ~180× cheaper bribe`, "observe", window <= M + 2 * BLOCK);
    S.L.censor = null; }
  { // CONTROL: same absolute censorship window, but Bob reveals as soon as his Commit is K deep (no HOLD)
    const S = await start("r5-hold-ctl", R); const bobX = secret(S, "bob");
    const c = await bobCommit(S, R);
    S.L.censor = (p) => /^reveal/.test(p.label) && S.L.now() >= S.T3 - M && S.L.now() < S.T3 + 600_000;
    const r = await bobReveal(S, R, bobX);
    R.rec("CONTROL: Bob reveals right after Commit settles: Reveal settles long before the censorship window", "accept", c.settled && r.settled, r.why ?? r.refused);
    const { sw } = await aliceTakesZec(S, R); R.rec("CONTROL: Alice sweeps; swap completes, nobody loses", "accept", sw.accepted === true, sw.reason);
    S.L.censor = null; return { R, S }; }
}
// R5-M2: Alice's RefundReveal provenance check is keyed on the SIMULATOR'S tx label (/^(notice|bobnotice)/), not on the
// Notice spending her lock outref. Anyone can pay to the script with a datum byte-equal to her expected Refunding datum.
async function r5FakeRefunding() {
  const R = new Results("r5_fake_refunding"); console.log("== review5 R5-M2: a FAKE Refunding UTxO (plain payment to the script) makes Alice reveal a");
  const S = await start("r5-fake", R); const aliceX = secret(S, "alice");
  // Bob (never commits) pays V to the script with the datum Alice's wallet expects (all fields are public on-chain).
  const ttl = S.L.now() + 100_000; const lucid = await as(S, S.B);
  const fake = await lucid.newTx().pay.ToContract(S.scriptAddr, { kind: "inline", value: refundingDatum(S, ttl) }, { lovelace: BigInt(S.escrow.assets.lovelace) }).validTo(ttl).complete();
  const fr = await signSubmit(S, fake, S.B, "notice-lookalike");   // NOT a Notice: spends no escrow input
  await S.L.awaitBlock(K + 1);
  const fakeTx = CML.Transaction.from_cbor_hex(S.L.log.find(t => t.hash === fr.txHash).txHex);
  const spendsLock = [...Array(fakeTx.body().inputs().len()).keys()].some(i => { const x = fakeTx.body().inputs().get(i); return x.transaction_id().to_hex() === S.escrow.txHash && Number(x.index()) === S.escrow.outputIndex; });
  R.rec("the look-alike tx spends NO escrow input (it is a plain payment)", "observe", !spendsLock);
  S.L.censor = (p) => /^notice#/.test(p.label);   // Alice's real Notice is censored (it carries no secret, so this is 'harmless' per D30b)
  const n = await aliceNotice(S, R, { maxBlocks: 6 });
  R.rec("Alice's Notice procedure reports 'settled' on the look-alike although her own Notice never landed", "observe (finding)", n.settled && S.noticeHash === fr.txHash, n.why ?? n.refused);
  const rr = n.settled ? await aliceRefundReveal(S, R, aliceX, { maxBlocks: 6 }) : { refused: "n/a" };
  R.rec("…and her RefundReveal gate lets her publish a on a UTxO that is NOT her escrow (violates W.7 'never reveal a on any other UTxO')", "observe (finding)", !rr.refused && secretInMempool(S, aliceX), rr.refused ?? rr.why);
  R.rec("real escrow is still Open while a is public", "observe", !!S.L.entry(S.escrow.txHash + S.escrow.outputIndex));
  S.L.censor = null; return { R, S };
}
