#!/usr/bin/env node
/* Local server for the Bot AI page (standalone, no app needed). No dependencies.
   node tools/serve.js                         -> http://localhost:8080/  (built-in sample data)
   node tools/serve.js --dump-sample f.json    -> write the sample state to f.json and exit (a starting point for the bot's output)
   node tools/serve.js --state f.json          -> serve f.json as /state.json and point the page at it (re-read on every request,
                                                  so edit the file and press Refresh). Same shape as docs/STATE-CONTRACT.md.
   Options: --port 9000   --prices (also read live prices from data.bubblelayer.com; use with a REAL state file) */
const http = require("http"), fs = require("fs"), path = require("path"), vm = require("vm");
const ui = path.join(__dirname, "..", "ui"), a = process.argv, arg = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
if (arg("--dump-sample")) {
  const w = { }; w.window = w; vm.runInNewContext(fs.readFileSync(path.join(ui, "sample-state.js"), "utf8"), w);
  fs.writeFileSync(arg("--dump-sample"), JSON.stringify(w.BOTAI.sample, null, 1) + "\n"); console.log("wrote", arg("--dump-sample")); process.exit(0);
}
const state = arg("--state"), port = +arg("--port") || 8080;
if (state && !fs.existsSync(state)) { console.error("state file not found: " + state); process.exit(1); }
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
http.createServer((q, r) => {
  const p = decodeURIComponent(new URL(q.url, "http://x").pathname), hd = { "cache-control": "no-store" };
  if (state && p === "/state.json") { r.writeHead(200, { ...hd, "content-type": "application/json" }); return r.end(fs.readFileSync(state)); }
  if (state && p === "/config.js") {
    r.writeHead(200, { ...hd, "content-type": "text/javascript" });
    const px = a.includes("--prices") ? "https://data.bubblelayer.com/universe-slim-top.json" : ""; /* off by default: a dumped sample does not match real prices */
    return r.end("window.BOTAI=window.BOTAI||{};window.BOTAI.config=" + JSON.stringify({ stateUrl: "/state.json", priceUrl: px, priceMaxAgeMin: 15, supportedStateVersions: [1], staleAfterMin: 45, refreshSec: 10, timeoutMs: 5000 }) + ";");
  }
  const f = path.join(ui, p === "/" ? "index.html" : p);
  if (!f.startsWith(ui) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404, hd); return r.end("not found"); }
  r.writeHead(200, { ...hd, "content-type": T[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f));
}).listen(port, () => console.log("Bot AI page: http://localhost:" + port + "/" + (state ? "   (state: " + state + ")" : "   (sample data)")));
