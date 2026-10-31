#!/usr/bin/env node
/* Browser test (needs playwright). Usage: node tools/test-ui.js [--catalog] [--shots <dir>]
   Opens every screen in sample / live / stale / bad-version / unreachable modes, desktop + phone; fails on any JS error,
   and (with --catalog) rewrites ui/i18n-strings.json from what the page really asks to translate. */
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const ui = path.join(__dirname, "..", "ui"), url = "file://" + path.join(ui, "index.html"), argv = process.argv;
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : null;
const PAGES = ["overview", "positions", "history", "decisions", "signals", "risk", "log", "settings"], STATE = "https://state.example.workers.dev/state.json", PRICE = "https://data.example.test/universe-slim-top.json";
(async () => {
  const b = await chromium.launch(), errs = [], T = new Set(), S = new Set(); let n = 0;
  async function run(label, w, h, page, tweak, expect) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on("pageerror", (e) => errs.push(label + " " + page + ": " + e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errs.push(label + " " + page + " console: " + m.text()); });
    await p.addInitScript(() => { let f; Object.defineProperty(window, "__t", { configurable: true, set(g) { f = g; }, get() { if (!f) return f; return function (s, v) { (window.__tlog = window.__tlog || []).push(s); return f(s, v); }; } }); });
    if (tweak) await tweak(p);
    await p.goto(url + "#" + page); await p.waitForTimeout(350);
    const r = await p.evaluate(() => {
      const st = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { if (n.parentElement.closest(".ai div,script,style,[translate=no],svg")) continue; const t = n.textContent.trim(); if (/[A-Za-z]{2,}/.test(t) && !/\d/.test(t) && !/^[A-Z]{2,5}$/.test(t)) st.add(t); }
      document.querySelectorAll("[title],[aria-label]").forEach((el) => ["title", "aria-label"].forEach((a) => { const t = el.getAttribute(a); if (t) st.add(t); }));
      return { s: [...st], t: window.__tlog || [], body: document.getElementById("scroll").innerText, over: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    r.s.forEach((x) => S.add(x)); r.t.forEach((x) => T.add(x)); n++;
    if (expect && !expect.test(r.body)) errs.push(label + " " + page + ": expected " + expect + " got: " + r.body.slice(0, 80));
    if (r.over) errs.push(label + " " + page + ": horizontal overflow");
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.screenshot({ path: path.join(shots, label + "-" + page + ".png") }); }
    await p.close();
  }
  const withState = (mut, status, px) => async (p) => {
    await p.route(PRICE + "*", (r) => px === "bad" ? r.fulfill({ status: 500, body: "x" }) : px ? r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(px()) }) : r.abort());
    await p.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.BOTAI=window.BOTAI||{};window.BOTAI.config={stateUrl:"${STATE}",supportedStateVersions:[1],staleAfterMin:45,refreshSec:60,timeoutMs:3000,priceUrl:"${PRICE}",priceMaxAgeMin:15};` }));
    await p.route(STATE + "*", async (r) => {
      if (status) return r.fulfill({ status, body: "x" });
      const s = await p.evaluate(() => JSON.parse(JSON.stringify(window.BOTAI.sample))); mut(s); r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(s) });
    });
    await p.route("**/sample-state.js", async (r) => { const t = fs.readFileSync(path.join(ui, "sample-state.js"), "utf8"); r.fulfill({ contentType: "text/javascript", body: t }); });
  };
  for (const [w, h, tag] of [[1366, 820, "d"], [390, 800, "m"]]) {
    for (const pg of PAGES) await run("sample-" + tag, w, h, pg, null, pg === "overview" ? /Equity/i : null);
    await run("live-" + tag, w, h, "overview", withState((s) => { s.updatedAt = Date.now(); }), /\$10,631\.32/);
    await run("nosig-" + tag, w, h, "signals", withState((s) => { s.signals = []; }), /No candidates/);
    await run("nolog-" + tag, w, h, "log", withState((s) => { s.log = []; }), /No activity/);
    await run("price-" + tag, w, h, "positions", withState(() => {}, 0, () => ({ timestamp: Date.now(), data: [{ symbol: "sol", current_price: 180, market_cap_rank: 5 }, { symbol: "SOL", current_price: 1, market_cap_rank: 900 }, { symbol: "link", current_price: 14.667, market_cap_rank: 20 }] })), /180\.000[\s\S]*\+\$533\.\d\d/);
    await run("oldprice-" + tag, w, h, "positions", withState(() => {}, 0, () => ({ timestamp: Date.now() - 3 * 36e5, data: [{ symbol: "sol", current_price: 180, market_cap_rank: 5 }] })), /169\.506/);
    await run("badprice-" + tag, w, h, "positions", withState(() => {}, 0, "bad"), /169\.506/);
    await run("stale-" + tag, w, h, "overview", withState((s) => { s.updatedAt -= 3 * 36e5; }), /Equity/i);
    await run("version-" + tag, w, h, "overview", withState((s) => { s.v = 99; }), /not supported/);
    await run("down-" + tag, w, h, "overview", withState(() => {}, 503), /unavailable/);
    await run("empty-" + tag, w, h, "positions", withState((s) => { s.open = []; s.risk.positions = 0; }), /No open positions/);
    await run("empty2-" + tag, w, h, "history", withState((s) => { s.closed = []; }), /No closed trades/);
    await run("hostile-" + tag, w, h, "log", withState((s) => { s.log.push({ t: Date.now(), k: "open", v: { coin: "<img src=x onerror=alert(1)>", tf: "1H", price: "1", risk: "1%" } }, { t: Date.now(), k: "unknown-future-key", v: {} }); }), /Opened/);
  }
  if (argv.includes("--catalog")) {
    const tpl = [...T].filter((x) => /\{\w+\}/.test(x)).sort(), st = [...new Set([...S, ...[...T].filter((x) => !/\{\w+\}/.test(x))])].sort();
    fs.writeFileSync(path.join(ui, "i18n-strings.json"), JSON.stringify({ _note: "English source strings of the Bot AI page (static text + __t templates with {slots}). Translate with ops/i18n/nap.js, check with ops/i18n/kiem.js. Regenerate: node tools/test-ui.js --catalog", static: st, templates: tpl }, null, 1) + "\n");
    console.log("catalog:", st.length, "static,", tpl.length, "templates");
  }
  console.log(errs.length ? errs.join("\n") : "PASS " + n + " page loads, no JS errors"); await b.close(); process.exit(errs.length ? 1 : 0);
})();
