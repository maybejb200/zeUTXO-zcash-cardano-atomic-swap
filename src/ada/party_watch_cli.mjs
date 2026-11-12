// zeUTXO path 1 — one party's secret watcher as its OWN process (step 11). It is given only that party's directory, the
// counterparty's datum point and a file with the transactions that party's node has seen (one CBOR hex per line).
//   node party_watch_cli.mjs role=alice dir=<alice's dir> point=<B_c hex> feed=<file>
// Prints { role, share } (share = hex, or null) and exits 0; exits 2 on a refusal (bad arguments, corrupt saved state).
import fs from "fs";
import { PartyView } from "./party.mjs";
const a = Object.fromEntries(process.argv.slice(2).map(s => { const i = s.indexOf("="); return [s.slice(0, i), s.slice(i + 1)]; }));
try {
  const feed = () => (a.feed && fs.existsSync(a.feed) ? fs.readFileSync(a.feed, "utf8").split("\n").map(s => s.trim()).filter(Boolean) : []);
  const x = new PartyView({ role: a.role, dir: a.dir, otherPoint: a.point, feed }).otherShare();
  console.log(JSON.stringify({ role: a.role, share: x === null ? null : x.toString(16) }));
} catch (e) { console.log(JSON.stringify({ role: a.role, refused: String(e.message) })); process.exit(2); }
