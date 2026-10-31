#!/usr/bin/env node
/* Validate a bot-state.json and send it to the state Worker.
   node tools/publish-state.js <state.json> [--check]       (--check = validate only, send nothing)
   Env: BOT_STATE_URL  = https://bot-ai-state.<you>.workers.dev      BOT_STATE_TOKEN = same value as the Worker's WRITE_TOKEN
   Exit 0 = sent (or valid with --check). A file that fails validation is never sent. */
"use strict";
const fs = require("fs"), path = require("path"), { validate } = require(path.join(__dirname, "../src/state-contract.js"));
const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error("usage: node tools/publish-state.js <state.json> [--check]"); process.exit(2); }
(async () => {
  let text, obj;
  try { text = fs.readFileSync(file, "utf8"); obj = JSON.parse(text); } catch (e) { console.error("cannot read/parse " + file + ": " + e.message); process.exit(1); }
  const r = validate(obj);
  if (!r.ok) { console.error("INVALID state, not sent:\n - " + r.errors.join("\n - ")); process.exit(1); }
  console.log("valid: " + obj.equity.length + " equity points, " + obj.open.length + " open, " + obj.closed.length + " closed");
  if (flags.includes("--check")) return;
  const base = process.env.BOT_STATE_URL, tok = process.env.BOT_STATE_TOKEN;
  if (!base || !tok) { console.error("set BOT_STATE_URL and BOT_STATE_TOKEN"); process.exit(2); }
  const res = await fetch(base.replace(/\/$/, "") + "/state", { method: "PUT", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(15000) });
  const body = await res.text();
  console.log(res.status + " " + body);
  process.exit(res.ok ? 0 : 1);
})().catch((e) => { console.error("failed: " + e.message); process.exit(1); });
