/* node test/ai-decide.test.js — AI decides entries/closes, provider rotation, parser, Governor still binding. No network. */
"use strict";
const assert = require("assert"), B = require("../src/bot.js"), AD = require("../src/ai-decider.js"), AP = require("../src/ai-provider.js"), { validate } = require("../src/state-contract.js"), { round, CFG } = require("../src/run.js");
const M = 6e4, S = Date.UTC(2026, 9, 29, 13, 0), NOW = S + 8 * M;
const mk = () => { const c = JSON.parse(JSON.stringify(CFG)); c.ai.mode = "decide"; return c; };
const row = (code, a, b) => ({ code, a: { n: 200, cfg: { "1-2": [a, 200 - a, 0] } }, b: { n: 200, cfg: { "1-2": [b, 200 - b, 0] } } });
const val = { v: 2, at: S, tf: { "1H": { base: { a: { "1-2": { up: [60, 140, 0], dn: [0, 0, 0] } }, b: { "1-2": { up: [60, 140, 0], dn: [0, 0, 0] } } }, rows: [row("V8-01", 90, 80), row("V8-09", 62, 61)] } } };
const coin = (sym, code) => ({ sym, pair: sym + "USDT", price: 100, qv: 3e9, c24: 1, ch: 0.1, hits: [{ code, dir: 1 }] });
const brief = { "1H": { at: S, c: Object.fromEntries(["AAA", "BBB", "BTC", "ETH"].map((s) => [s, { a: 4, p: 100, tr: 1, rs: 55, rd: 6, sd: 3 }])) } };
const app = () => ({ signals: { "1H": { at: S, scanned: 4, coins: [coin("AAA", "V8-01"), coin("BBB", "V8-09")] } }, brief, validation: val });
const fetchFn = async (url) => { const u = new URL(url);
  if (u.pathname === "/api/v3/depth") return { ok: true, json: async () => ({ bids: [["99.98", "9999"]], asks: [["100", "5000"], ["100.1", "5000"]] }) };
  return { ok: true, json: async () => [] }; };
const ai = (obj) => async () => ({ ok: true, text: typeof obj === "string" ? obj : JSON.stringify(obj), provider: "fake", model: "m", ms: 5 });
const go = (o) => round({ cfg: mk(), now: NOW, fetchFn, readApp: async () => app(), ...o });

(async () => {
  // shortlist: green first, ids assigned, data for the AI present
  const L0 = B.newLedger(mk(), NOW), list = AD.shortlist(app(), mk(), L0, NOW);
  assert.deepStrictEqual(list.map((c) => [c.id, c.sym, c.green]), [["c1", "AAA", true], ["c2", "BBB", false]]);
  const pk = AD.buildPacket(app(), mk(), L0, NOW, list); assert(pk.candidates[0].upCodes[0].edgePts > 0 && pk.market.BTC["1H"].trend === 1);

  // 1. AI enters one (conviction 1 = half size) and declines the other
  let r = await go({ aiFn: ai({ marketView: "up", entries: [{ id: "c1", conviction: 1, confidence: 0.7, reason: "green rule" }], close: [] }) });
  assert.deepStrictEqual(r.ledger.open.map((p) => p.sym), ["AAA"]);
  assert.strictEqual(r.ledger.open[0].entryTime, Math.floor(NOW / M) * M, "priced at decision time, not at the old candle open");
  const o = r.decisions.find((d) => d.action === "open"); assert(o.ai.why === "green rule" && o.provider === "fake");
  assert(r.state.signals.some((x) => x.coin === "BBB" && x.st === "skip")); assert.deepStrictEqual(validate(r.state), { ok: true, errors: [] });
  const st = r.state.open[0]; assert.strictEqual(st.side, "BUY"); assert.strictEqual(st.leverage, 1); assert(st.slPct < 0 && st.tpPct > 0 && st.entryTime && st.aiWhy === "green rule" && st.by === "ai" && st.riskAmt > 0);
  assert.strictEqual(r.state.rules.leverage, 1); assert.strictEqual(r.state.ai.last.provider, "fake"); assert(r.state.decisions.some((d) => d.action === "open" && d.why === "green rule") && r.state.decisions.some((d) => d.reason === "ai-skip" && d.coin === "BBB"));
  const full = (await go({ aiFn: ai({ entries: [{ id: "c1", conviction: 2 }] }) })).ledger.open[0].qty; assert(Math.abs(r.ledger.open[0].qty / full - 0.5) < 0.02, "conviction 1 = half of 2");

  // 2. never asks twice about the same signal; AI cannot invent a coin or id
  let calls = 0; const again = await go({ ledger: r.ledger, now: NOW + 15 * M, aiFn: async () => { calls++; return { ok: true, text: "{}" }; } }); assert.strictEqual(calls, 1, "open position is reviewed, signals already judged are not re-asked");
  r = await go({ aiFn: ai({ entries: [{ id: "c9" }, { id: "BTC" }] }) }); assert.strictEqual(r.ledger.open.length, 0);

  // 3. parser: prose + braces, two objects (last wins), <think>, confidence 0-100, bad text
  const p = (t) => AD.parse(t, list, L0, mk());
  assert.strictEqual(p('ok {not json} here: {"entries":[{"id":"c1","confidence":80}],"close":[]} done').entries[0].confidence, 0.8);
  assert.strictEqual(p('{"entries":[{"id":"c1"}],"close":[]} then {"entries":[],"close":[]}').entries.length, 0, "last valid object wins");
  assert.strictEqual(p('<think>{"entries":[{"id":"c1"}],"close":[]}</think>{"entries":[],"close":[]}').entries.length, 0);
  assert.strictEqual(p("buy everything").ok, false);
  r = await go({ aiFn: ai("buy everything") }); assert.strictEqual(r.ledger.open.length, 0); assert(r.decisions.some((d) => d.reason === "ai-invalid")); assert(!r.ledger.seen["AAA|1H|" + S + "|ai"], "format failure is retried next round");

  // 4. AI down => no trade, signals wait
  r = await go({ aiFn: async () => ({ ok: false, why: "gemini HTTP 429" }) }); assert.strictEqual(r.ledger.open.length, 0); assert(r.decisions.some((d) => d.reason === "ai-unavailable"));

  // 5. Governor still binds: day-trade limit blocks even if the AI says yes
  const c5 = mk(); c5.maxTradesPerDay = 0; r = await go({ cfg: c5, aiFn: ai({ entries: [{ id: "c1" }] }) }); assert.strictEqual(r.ledger.open.length, 0); assert(r.decisions.some((d) => d.action === "skip" && d.reason === "day-trades"));

  // 6. AI closes an open position early (only risk-reducing action)
  const open = (await go({ aiFn: ai({ entries: [{ id: "c1" }] }) })).ledger; assert.strictEqual(open.open.length, 1);
  r = await go({ ledger: open, now: NOW + 15 * M, aiFn: ai({ entries: [], close: [{ coin: "AAA", reason: "trend broke" }, { coin: "ZZZ" }] }) });
  assert.strictEqual(r.ledger.open.length, 0); assert.strictEqual(r.ledger.closed[0].why, "ai"); const cs = r.state.closed[0]; assert(cs.entry > 0 && cs.exit > 0 && cs.entryTime && cs.sl < cs.entry && cs.by === "ai" && cs.aiWhy === "trend broke", JSON.stringify(cs)); assert(r.decisions.some((d) => d.action === "close" && d.coin === "AAA"));

  // 7. providers: priority order, missing key skipped, 429 rotates and pauses the failed one
  const cfg = mk(), L = B.newLedger(cfg, NOW), seen = [];
  const f = async (url) => { seen.push(url); if (url.includes("generativelanguage")) return { ok: false, status: 429, text: async () => "quota" };
    return { ok: true, json: async () => ({ result: { response: '{"entries":[],"close":[]}' } }) }; };
  const env = { GEMINI_API_KEY: "k", CF_ACCOUNT_ID: "acc", CF_API_TOKEN: "t" };
  let x = await AP.call(cfg, { system: "s", user: "u" }, { env, fetchFn: f, L, now: NOW }); assert(x.ok && x.provider === "workers-ai", JSON.stringify(x)); assert(seen[0].includes("generativelanguage") && seen[1].includes("api.cloudflare.com"));
  seen.length = 0; x = await AP.call(cfg, { system: "s", user: "u" }, { env, fetchFn: f, L, now: NOW + M }); assert(!seen.some((u) => u.includes("generativelanguage")), "gemini is paused after its 429");
  x = await AP.call(cfg, { system: "s", user: "u" }, { env: {}, fetchFn: f, L: B.newLedger(cfg, NOW), now: NOW }); assert.strictEqual(x.ok, false); assert(/no-key/.test(x.why));
  // 8. worker-ai provider (our proxy Worker) + the Worker itself
  const seen2 = []; const f2 = async (url, o) => { seen2.push([url, o.headers.authorization]); return { ok: true, json: async () => ({ result: { response: '{"entries":[],"close":[]}' } }) }; };
  x = await AP.call(cfg, { system: "s", user: "u" }, { env: { AI_PROXY_URL: "https://llm.example/", AI_PROXY_TOKEN: "pw" }, fetchFn: f2, L: B.newLedger(cfg, NOW), now: NOW });
  assert(x.ok && x.provider === "worker-ai" && seen2[0][0] === "https://llm.example/" && seen2[0][1] === "Bearer pw", JSON.stringify(x));
  const W = (await import("../worker/ai-worker.mjs")).default, env2 = { AI_TOKEN: "pw", AI: { run: async (m, i) => ({ response: "hi " + m + " " + i.messages.length }) } };
  const rq = (h, b, m = "POST") => new Request("https://x/", { method: m, headers: h, body: b && JSON.stringify(b) }), okb = { model: "@cf/openai/gpt-oss-120b", messages: [{ role: "user", content: "a" }] };
  assert.strictEqual((await W.fetch(rq({}, okb), env2)).status, 401); assert.strictEqual((await W.fetch(rq({ authorization: "Bearer bad" }, okb), env2)).status, 401);
  assert.strictEqual((await W.fetch(rq({ authorization: "Bearer pw" }, { ...okb, model: "gpt-4" }), env2)).status, 400); assert.strictEqual((await W.fetch(rq({}, null, "GET"), env2)).status, 405);
  const good = await W.fetch(rq({ authorization: "Bearer pw" }, okb), env2); assert.strictEqual(good.status, 200); assert.strictEqual((await good.json()).result.response, "hi @cf/openai/gpt-oss-120b 1");
  console.log("ai-decide: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
