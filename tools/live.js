#!/usr/bin/env node
/* One command to watch the bot on the real page:  node tools/live.js [--no-open] [--port 8080]
   runs a round now, serves the page (with live prices) on http://localhost:<port>, opens the browser, then runs a round
   at :08 :23 :38 :53 of every hour (after the app's scanner has written its files). Ctrl+C stops everything. Paper money only. */
"use strict";
const { spawn, spawnSync } = require("child_process"), path = require("path"), fs = require("fs");
const root = path.join(__dirname, ".."), a = process.argv, port = a.includes("--port") ? a[a.indexOf("--port") + 1] : "8080", state = path.join(root, "data", "bot-state.json");
const round = () => { console.log("\n== round " + new Date().toLocaleTimeString() + " =="); spawnSync(process.execPath, [path.join(root, "src/run.js")], { cwd: root, stdio: "inherit" }); };
round();
if (!fs.existsSync(state)) { console.error("The round did not produce data/bot-state.json (see the message above). Fix that and run again."); process.exit(1); }
const server = spawn(process.execPath, [path.join(__dirname, "serve.js"), "--state", state, "--prices", "--port", port], { cwd: root, stdio: "inherit" });
server.on("exit", (c) => { console.log("server stopped"); process.exit(c || 0); });
const url = "http://localhost:" + port + "/";
if (!a.includes("--no-open")) setTimeout(() => { const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", url]] : ["xdg-open", [url]]; try { spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch (e) {} }, 800);
console.log("\nPage: " + url + "  (next rounds at :08 :23 :38 :53 — Ctrl+C to stop)");
const SLOTS = [8, 23, 38, 53];
(function next() {
  const n = new Date(), m = n.getUTCMinutes() * 60 + n.getUTCSeconds(); let wait = 3600;
  for (const s of SLOTS) { const d = s * 60 - m; if (d > 0 && d < wait) wait = d; }
  if (wait === 3600) wait = SLOTS[0] * 60 + 3600 - m;
  setTimeout(() => { round(); next(); }, wait * 1000);
})();
process.on("SIGINT", () => { server.kill(); process.exit(0); });
