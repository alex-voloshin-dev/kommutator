#!/usr/bin/env node
// Post one message into a Claude Code inbox socket and print whatever comes back.
//
//   node post.mjs --socket /tmp/cc-socks-501/xyz.sock [--token T] [--from spike01] \
//                 (--text "hello" [--shape N] | --raw '{"type":"…"}')
//
// --shape N picks one of the candidate line formats below (the real one is unknown until
// discover-format.sh says otherwise); --raw sends the line verbatim.

import { connect } from "node:net";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? ""] : [])).filter((x) => x.length),
);

const socket = args.socket;
if (!socket) {
  console.error("usage: node post.mjs --socket <path> [--token T] [--from F] --text T [--shape N] | --raw JSON");
  process.exit(1);
}
const from = args.from ?? "spike01";
const text = args.text ?? "ping from spike01 — please reply with pong";
const shape = Number(args.shape ?? 1);

const candidates = [
  () => ({ type: "message", from, text }),
  () => ({ type: "message", from, content: text }),
  () => ({ type: "peer_message", from, text }),
  () => ({ type: "message", sender: from, message: text }),
  () => ({ type: "message", from: { name: from }, text }),
  () => ({ from, text }),
];

const line = args.raw ?? JSON.stringify(candidates[shape - 1]?.() ?? candidates[0]());
const lines = [];
if (args.token) lines.push(JSON.stringify({ type: "auth", token: args.token }));
lines.push(line);

console.log(`→ ${socket}`);
for (const l of lines) console.log(`→ ${l.replace(/"token":"[^"]+"/, '"token":"…"')}`);

const sock = connect(socket);
const started = Date.now();
sock.setEncoding("utf8");
sock.on("connect", () => sock.write(lines.join("\n") + "\n"));
sock.on("data", (d) => process.stdout.write(`← ${d}`));
sock.on("error", (e) => {
  console.error("socket error:", e.message);
  process.exit(2);
});
sock.on("close", () => {
  console.log(`closed by peer after ${Date.now() - started} ms`);
  process.exit(0);
});
// Give Claude Code a moment to answer, then hang up ourselves.
setTimeout(() => {
  console.log("no close from peer within 8 s; ending");
  sock.end();
}, 8000);
