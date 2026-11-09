// zeUTXO path 1 — one party's own wallet view and durable state (step 11; review 6 §4.3, Nov 9 2026 assessment item 4).
//
// Until step 10 "Alice" and "Bob" were functions in one script reading one shared object. This module is the part of each
// wallet that must NOT be shared: what the party has itself seen on Cardano, and what it has saved to disk.
//   PartyStore  durable key/value state in the party's OWN directory (atomic write + fsync, so a crash never leaves a
//               half-written file; reloaded on restart).
//   PartyView   the party's own chain view: a feed of the transactions ITS node has seen (mempool or chain), and the
//               verified watcher for the counterparty's share (watch.revealedShare). A share is written to the store
//               BEFORE it is returned, so nothing acts on a secret that a crash could lose (review 6 §4.1/4.3).
// A view needs only: the party's role, its directory, the counterparty's datum point, and a feed. It never reads the other
// party's files or state, so it runs unchanged in a separate process (see party_watch_cli.mjs).
import fs from "fs";
import path from "path";
import { revealedShare, shareMatches, REVEAL, REFUND_REVEAL } from "./watch.mjs";

const hex = (n) => n.toString(16);

export class PartyStore {
  constructor(dir, file = "state.json") { this.dir = dir; this.file = path.join(dir, file); }
  load() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (e) { if (e.code === "ENOENT") return {}; throw new Error(`party state unreadable (${this.file}): ${e.message}`); } }
  get(key) { return this.load()[key]; }
  /** Durable write: temp file in the same directory, fsync, atomic rename. Returns only after the value is on disk. */
  set(key, value) {
    const st = this.load(); st[key] = value; st.updated_ms = Date.now();
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`; const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeSync(fd, JSON.stringify(st, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
    return value;
  }
}

export class PartyView {
  /** role: "alice" (looks for b in a Reveal) or "bob" (looks for a in a RefundReveal). otherPoint: the counterparty's
   *  datum point (B_c for Alice, A_c for Bob), 48-byte compressed hex. feed: () => this party's seen txs ([{ txHex }] or hex). */
  constructor({ role, dir, otherPoint, feed }) {
    if (role !== "alice" && role !== "bob") throw new Error("PartyView: role must be alice or bob");
    if (typeof otherPoint !== "string" || !/^[0-9a-fA-F]{96}$/.test(otherPoint)) throw new Error("PartyView: counterparty point missing or malformed");
    if (typeof feed !== "function") throw new Error("PartyView: feed missing");
    this.role = role; this.otherPoint = otherPoint.toLowerCase(); this.feed = feed; this.store = new PartyStore(dir);
    this.constr = role === "alice" ? REVEAL : REFUND_REVEAL;
  }
  /** The counterparty's share if this party has EVER seen it (saved state first, then its feed), else null.
   *  A saved value is re-verified against the point on every load: a tampered or stale state file is refused, not trusted. */
  otherShare() {
    const saved = this.store.get("other_share");
    if (saved !== undefined) {
      const ok = saved?.point === this.otherPoint && typeof saved.x === "string" && /^[0-9a-f]+$/.test(saved.x) && shareMatches(BigInt("0x" + saved.x), this.otherPoint);
      if (!ok) throw new Error(`REFUSE: saved counterparty share in ${this.store.file} does not open this swap's point`);
      return BigInt("0x" + saved.x);
    }
    const x = revealedShare(this.feed(), this.constr, this.otherPoint);
    if (x === null) return null;
    this.store.set("other_share", { x: hex(x), point: this.otherPoint, seen_ms: Date.now() });   // on disk BEFORE anyone acts on it
    return x;
  }
  sawOtherShare() { return this.otherShare() !== null; }
}
