#!/usr/bin/env node
/* run.js — one bot round. node src/run.js [--ledger data/ledger.json] [--state data/bot-state.json] [--decisions data/decisions.jsonl] [--dry] [--verbose]
   1 exits   2 pause rules that do badly live   3 read the app (any doubt -> no NEW entries)   4 rank candidates, enter at most maxNewPerRound
   5 optional AI veto   6 save ledger + state + decision journal. One round at a time (workflow concurrency). */
"use strict";
const fs = require("fs"), path = require("path");
const AR = require("./app-reader.js"), BN = require("./binance.js"), B = require("./bot.js"), SB = require("./state-builder.js"), AI = require("./ai-gate.js"), AD = require("./ai-decider.js"), { validate } = require("./state-contract.js");
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/bot-config.json"), "utf8"));

async function round({ ledger, cfg = CFG, now = Date.now(), fetchFn = fetch, readApp, aiFn = null, env = process.env, say = () => {}, verbose = false }) {
  const L = ledger || B.newLedger(cfg, now), md = (f) => (pair, from, to) => BN.klines1m(pair, from, to, now, f), decisions = [];
  const dec = (c, action, reason, extra = {}) => decisions.push({ t: now, key: c.key, coin: c.sym, tf: c.tf, rule: c.rule, edgePts: c.edge != null ? +(c.edge * 100).toFixed(2) : undefined, action, reason, ...extra });
  const once = (c, reason) => { const k = c.key + "|w:" + reason; if (L.seen[k]) return false; L.seen[k] = now; return true; };
  B.rollDay(L, now);
  await B.applyExits(L, cfg, md(fetchFn), now);                                   // exits first, always
  for (const g of B.updateCodeGuard(L, cfg, now)) { say(`rule ${g.code} paused until ${new Date(g.until).toISOString()}: expectancy ${g.expectancyR.toFixed(2)}R over ${g.trades} live trades`); decisions.push({ t: now, action: "rule-paused", rule: g.code, trades: g.trades, expectancyR: +g.expectancyR.toFixed(3), until: g.until }); }
  let app = null, why = null;
  try { app = await (readApp ? readApp() : readAppFiles(fetchFn, now)); } catch (e) { why = String((e && e.message) || e); }
  const rows = [], counts = { a: 0, b: 0, c: 0 }; let fresh = 0;
  if (!app) say("no new entries this round: " + why);
  else if (cfg.ai.mode === "decide") {
    if (verbose) diagnose(app, cfg, now, say);
    try { await AD.decideRound({ L, cfg, app, now, fetchFn, env, aiFn, say, decisions, rows, counts }); }
    catch (e) { say("AI round failed, no new entries: " + String((e && e.message) || e)); decisions.push({ t: now, action: "wait", reason: "ai-error", detail: String((e && e.message) || e).slice(0, 200) }); }
  } else {
    if (verbose) diagnose(app, cfg, now, say);
    const all = B.findCandidates(app, cfg, L, now);
    all.filter((c) => c.late).forEach((c) => say(`${c.tf}: entry candle too old, skipped`));
    const cands = all.filter((c) => !c.late).sort((x, y) => y.edge - x.edge || y.qv - x.qv);   // best edge first, then liquidity
    const row = (c, val, st) => rows.push({ coin: c.sym, tf: c.tf, rule: c.rule, val, st });
    for (const c of cands) {
      if (L.open.find((p) => p.id === c.key)) { counts.a++; counts.c++; row(c, "both", "watch"); continue; }
      if (L.seen[c.key]) continue;                                                // already handled this signal
      counts.a++;
      if (!L.seen[c.key + "|c"]) { L.seen[c.key + "|c"] = now; B.logAdd(L, cfg, now, "cand", { coin: c.sym, tf: c.tf, rule: c.rule }); }
      const refuse = (res) => {
        say(`${c.sym} ${c.tf}: not entered (${res.reason})`);
        if (res.temp) { counts.b++; row(c, "both", "wait"); if (once(c, res.reason)) dec(c, "wait", res.reason, res.info ? { info: res.info } : {}); }
        else { L.seen[c.key] = now; row(c, res.spread ? "spread" : "both", "skip"); if (res.spread) B.logAdd(L, cfg, now, "skip", { coin: c.sym }); dec(c, "skip", res.reason, res.info ? { info: res.info } : {}); }
      };
      if (fresh >= cfg.maxNewPerRound) { refuse({ reason: "round-limit", temp: true }); continue; }
      const g = B.gate(L, cfg, now); if (g) { refuse(g); continue; }
      const [k, bk] = await Promise.all([BN.klines1m(c.pair, c.E, c.E + 60000, now, fetchFn), BN.book(c.pair, cfg.depthLevels, fetchFn)]);
      if (!k.ok || !k.data.length || !bk.ok) { say(`${c.sym} ${c.tf}: market data unavailable (${k.reason || bk.reason || "no candle"}), will retry`); continue; }
      const market = { open: k.data[0].o, ...bk.data };
      let res = B.tryEnter(L, cfg, c, market, now), ai = null;
      if (res.ok && cfg.ai.mode === "veto") {
        if (L.day.aiCalls >= cfg.ai.maxCallsPerDay) { refuse({ reason: "ai-budget", temp: true, info: res.info }); continue; }
        L.day.aiCalls++;
        const r = await AI.consult(aiFn, AI.buildPacket(c, app.brief[c.tf].c[c.sym], res.info, now), cfg);
        if (r.status === "unavailable") { refuse({ reason: "ai-unavailable", temp: true, info: res.info }); say("  AI: " + r.why); continue; }
        if (r.status === "invalid") { say("  AI: invalid answer (" + r.why + ") -> signal skipped"); refuse({ reason: "ai-invalid", info: res.info }); continue; }
        ai = r.verdict;
        if (ai.action === "skip") { refuse({ reason: "ai-skip", info: res.info }); decisions[decisions.length - 1].ai = ai; continue; }
        if (ai.action === "shrink") res = B.tryEnter(L, cfg, c, market, now, ai.size);
      }
      if (res.ok) { B.commitEntry(L, cfg, res.pos, now); L.seen[c.key] = now; fresh++; counts.c++; row(c, "both", "watch"); dec(c, "open", "rules", { info: res.info, ...(ai ? { ai } : {}) }); }
      else refuse(res);
    }
  }
  L.recent = (L.recent || []).concat(decisions.filter((d) => d.action && d.action !== "rule-paused").map((d) => ({ t: d.t, coin: d.coin, tf: d.tf, rule: d.rule, action: d.action, reason: d.reason, side: d.side,
    why: String((d.ai && d.ai.why) || d.detail || (d.action === "close" && d.reason) || (d.action === "ai-view" && d.reason) || "").slice(0, 200), conf: d.ai && d.ai.confidence != null ? d.ai.confidence : undefined, conv: d.ai && d.ai.conviction, provider: d.provider, model: d.model }))).slice(-80);
  B.logAdd(L, cfg, now, "run", counts);
  B.finishRound(L, cfg, now);
  const state = SB.build(L, cfg, now, rows), v = validate(state);
  if (!v.ok) throw new Error("built an invalid state: " + v.errors.join("; "));
  return { ledger: L, state, decisions };
}

/* --verbose: what the app files contain right now and why each up-signal is or is not a candidate */
function diagnose(app, cfg, now, say) {
  const ago = (t) => Math.round((now - t) / 6e4) + " min ago", iso = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z";
  say(`now ${iso(now)}`);
  for (const tf of cfg.tfs) {
    const sg = app.signals[tf], br = app.brief[tf];
    if (!sg) { say(`[${tf}] no data in signals file`); continue; }
    const E = B.entryCandle(sg.at, tf), up = sg.coins.filter((c) => c.hits.some((h) => h.dir === 1));
    say(`[${tf}] file at=${iso(sg.at)} (${ago(sg.at)}) · entry candle opens ${iso(E)} · ${E <= now ? "opened " + ago(E) : "NOT OPEN YET"}${E <= now && now - E > cfg.maxEntryDelayMin * 6e4 ? " → TOO OLD for entries (window " + cfg.maxEntryDelayMin + " min; normal when run by hand)" : ""} · brief ${br ? (br.at === sg.at ? "same round" : "DIFFERENT round → timeframe skipped") : "missing"}`);
    say(`[${tf}] ${sg.coins.length} coins with signals, ${up.length} with an UP hit`);
    const green = [], no = {}, ex = [];
    for (const c of up) for (const h of c.hits.filter((x) => x.dir === 1)) {
      const x = B.explainCode(app.validation, tf, h.code, cfg);
      if (x.green) green.push(`${c.sym} ${h.code} (${x.why})${br && !(br.c[c.sym] && br.c[c.sym].a > 0) ? " [no ATR in brief]" : ""}`);
      else { const k = x.why.split(";")[0].replace(/\(need \d+\)/, ""); no[k] = (no[k] || 0) + 1; if (ex.length < 6) ex.push(`${c.sym} ${h.code}: ${x.why}`); }
    }
    say(`[${tf}] green up-signals: ${green.length} · not green: ${Object.entries(no).map(([k, n]) => n + "× " + k).join(" · ") || "0"}`);
    green.slice(0, 30).forEach((g) => say("   GREEN " + g));
    ex.forEach((g) => say("   no    " + g));
  }
}

async function readAppFiles(fetchFn, now) {
  const get = async (k) => { const r = await AR.readFile(k, { fetchFn, now }); if (!r.ok) throw new Error(k + ": " + r.reason); return r.data; };
  const [s, b, v] = await Promise.all([get("signals"), get("brief"), get("validation")]);
  return { signals: AR.signals(s), brief: AR.brief(b), validation: v };
}

if (require.main === module) {
  const a = process.argv, arg = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d), dry = a.includes("--dry");
  const lp = arg("--ledger", "data/ledger.json"), sp = arg("--state", "data/bot-state.json"), dp = arg("--decisions", path.join(path.dirname(lp), "decisions.jsonl"));
  (async () => {
    let ledger = null, aiFn = null;
    if (fs.existsSync(lp)) { try { ledger = JSON.parse(fs.readFileSync(lp, "utf8")); } catch (e) { console.error("ledger is not valid JSON, refusing to overwrite: " + lp); process.exit(1); } }
    if (CFG.ai.mode === "decide") console.log("· AI mode = decide: providers " + CFG.ai.providers.map((p) => p.type + "/" + p.model + (require("./ai-provider.js").hasKey(p, process.env) ? "" : " (NO KEY)")).join(" → "));
    if (CFG.ai.mode === "veto") { console.log("· AI mode veto needs its own aiFn; the built-in providers serve mode \"decide\" — candidates will wait"); }
    const { ledger: L, state, decisions } = await round({ ledger, aiFn, verbose: a.includes("--verbose"), say: (m) => console.log("· " + m) });
    console.log(`round done · equity ${state.equity[state.equity.length - 1][1].toFixed(2)} · open ${state.open.length} · closed ${state.closed.length} · status ${state.status} · decisions ${decisions.length}`);
    if (dry) return console.log("(dry: nothing written)");
    for (const [p, o] of [[lp, L], [sp, state]]) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + ".tmp", JSON.stringify(o)); fs.renameSync(p + ".tmp", p); }
    if (decisions.length) fs.appendFileSync(dp, decisions.map((d) => JSON.stringify(d)).join("\n") + "\n");
  })().catch((e) => { console.error("round failed: " + e.message); process.exit(1); });
}
module.exports = { round, CFG };
