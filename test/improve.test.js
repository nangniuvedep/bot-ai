/* node test/improve.test.js — ranking, round/day limits, rule guard, AI veto gate, decision journal. No network. */
"use strict";
const assert = require("assert"), B = require("../src/bot.js"), AI = require("../src/ai-gate.js"), { validate } = require("../src/state-contract.js"), { round, CFG } = require("../src/run.js");
const H = 36e5, M = 6e4, S = Date.UTC(2026, 9, 29, 13, 0), NOW = S + 8 * M, E = B.entryCandle(S, "1H");
const mk = () => JSON.parse(JSON.stringify(CFG));
const row = (code, a, b) => ({ code, a: { n: 200, cfg: { "1-2": [a, 200 - a, 0] } }, b: { n: 200, cfg: { "1-2": [b, 200 - b, 0] } } });
const val = { v: 2, at: S, tf: { "1H": { base: { a: { "1-2": { up: [60, 140, 0], dn: [0, 0, 0] } }, b: { "1-2": { up: [60, 140, 0], dn: [0, 0, 0] } } },   // base 30 %
  rows: [row("V8-01", 90, 80), row("V8-02", 80, 70), row("V8-03", 70, 66), row("V8-04", 66, 65)] } } };                                              // edges .10 .05 .03 .025
const coin = (sym, code, qv) => ({ sym, pair: sym + "USDT", price: 100, qv, c24: 1, ch: 0.1, hits: [{ code, dir: 1 }] });
const brief = { "1H": { at: S, c: Object.fromEntries(["AAA", "BBB", "CCC", "DDD"].map((s) => [s, { a: 4, p: 100, tr: 1, rs: 55 }])) } };
const app = (coins) => ({ signals: { "1H": { at: S, scanned: 4, coins } }, brief, validation: val });
const four = [coin("AAA", "V8-04", 4e9), coin("BBB", "V8-01", 3e9), coin("CCC", "V8-03", 2e9), coin("DDD", "V8-02", 1e9)];   // liquidity order is the reverse of edge order
const flat = (from, n) => Array.from({ length: n }, (_, i) => ({ t: from + i * M, o: 100, h: 100.3, l: 99.8, c: 100 }));
const fetchFn = (candles = () => flat(E, 8)) => async (url) => { const u = new URL(url);
  if (u.pathname === "/api/v3/depth") return { ok: true, json: async () => ({ bids: [["99.98", "9999"]], asks: [["100", "5000"], ["100.1", "5000"]] }) };
  const from = +u.searchParams.get("startTime"), to = +u.searchParams.get("endTime"); return { ok: true, json: async () => candles(u.searchParams.get("symbol")).filter((k) => k.t >= from && k.t <= to).map((k) => [k.t, k.o, k.h, k.l, k.c, 1, k.t + 59999]) }; };
const run = (o) => round({ cfg: mk(), now: NOW, fetchFn: fetchFn(), readApp: async () => app(four), ...o });

(async () => {
  // --- 1. best edge first, at most maxNewPerRound new entries; the rest wait and enter next round (still inside the 30-min window)
  let r = await run({});
  assert.deepStrictEqual(r.ledger.open.map((p) => p.sym), ["BBB", "DDD"], "edge .10 then .05, NOT liquidity order");
  assert.deepStrictEqual(r.state.signals.map((x) => x.coin + ":" + x.st), ["BBB:watch", "DDD:watch", "CCC:wait", "AAA:wait"]);
  r = await run({ ledger: JSON.parse(JSON.stringify(r.ledger)), now: NOW + 15 * M });
  assert.deepStrictEqual(r.ledger.open.map((p) => p.sym), ["BBB", "DDD", "CCC", "AAA"], "waiting candidates enter later, best first");
  const waits = r.decisions.filter((d) => d.action === "wait"); assert.strictEqual(waits.length, 0, "a repeated wait is journaled only once");
  assert.deepStrictEqual(validate(r.state), { ok: true, errors: [] });

  // --- 2. trades per day, and the day roll-over resets the counter
  const cfg1 = mk(); cfg1.maxTradesPerDay = 1; cfg1.maxNewPerRound = 5;
  r = await run({ cfg: cfg1 }); assert.strictEqual(r.ledger.open.length, 1); assert(r.decisions.some((d) => d.action === "wait" && d.reason === "day-trades"));
  const L = B.newLedger(mk(), NOW); L.day.opened = 6; assert.strictEqual(B.gate(L, mk(), NOW).reason, "day-trades");
  B.rollDay(L, NOW + 24 * H); assert.strictEqual(L.day.opened, 0); assert.strictEqual(B.gate(L, mk(), NOW + 24 * H), null);

  // --- 3. rule guard: 12 live trades averaging -1R pause the code; others stay; a pause ends and starts clean
  const G = B.newLedger(mk(), NOW); for (let i = 0; i < 12; i++) G.closed.push({ t: NOW - (20 - i) * M, coin: "X", tf: "1H", rule: "V8-01", r: -1, pnl: -10 }); for (let i = 0; i < 12; i++) G.closed.push({ t: NOW - (20 - i) * M, coin: "Y", tf: "1H", rule: "V8-02", r: 0.5, pnl: 5 });
  const paused = B.updateCodeGuard(G, mk(), NOW); assert.deepStrictEqual(paused.map((x) => x.code), ["V8-01"]);
  assert.deepStrictEqual(B.findCandidates(app(four), mk(), G, NOW).map((c) => c.rule).sort(), ["V8-02", "V8-03", "V8-04"], "paused code is not traded");
  assert.deepStrictEqual(B.updateCodeGuard(G, mk(), NOW + H), [], "no double pause");
  const after = NOW + 73 * H; assert(G.codeOff["V8-01"] > NOW + 71 * H && !(G.codeOff["V8-01"] > after), "pause lasts pauseHours, then the code is free again");
  assert.deepStrictEqual(B.updateCodeGuard(G, mk(), after), [], "after the pause the old trades are not counted again");
  const few = B.newLedger(mk(), NOW); for (let i = 0; i < 5; i++) few.closed.push({ t: NOW, coin: "X", tf: "1H", rule: "V8-01", r: -1, pnl: -1 }); assert.deepStrictEqual(B.updateCodeGuard(few, mk(), NOW), [], "too few trades -> no verdict");

  // --- 4. AI verdict parsing: can only reduce
  const c = mk(); const p = (x) => AI.parseVerdict(x, c);
  assert.strictEqual(p('{"action":"take"}').verdict.size, 1); assert.strictEqual(p({ action: "skip" }).verdict.size, 0);
  assert.strictEqual(p('```json\n{"action":"shrink","size":0.5,"reason":"x"}\n```').verdict.size, 0.5);
  assert.strictEqual(p({ action: "shrink", size: 5 }).verdict.size, 1, "never above 1"); assert.strictEqual(p({ action: "shrink", size: 0.01 }).verdict.size, c.ai.minShrink);
  for (const bad of ["no json", { action: "buy" }, { action: "shrink" }, { action: "shrink", size: -1 }, null, 7]) assert(!p(bad).ok, "invalid: " + JSON.stringify(bad));
  assert.strictEqual((await AI.consult(null, {}, c)).status, "unavailable");
  assert.strictEqual((await AI.consult(async () => { throw new Error("503"); }, {}, c)).status, "unavailable");
  const slow = mk(); slow.ai.timeoutMs = 20; assert.strictEqual((await AI.consult(() => new Promise((ok) => setTimeout(() => ok({ action: "take" }), 300)), {}, slow)).status, "unavailable");
  assert.strictEqual((await AI.consult(async () => "garbage", {}, c)).status, "invalid");

  // --- 5. AI in the round (mode veto)
  const veto = mk(); veto.ai.mode = "veto"; veto.maxNewPerRound = 1; const one = () => [coin("BBB", "V8-01", 3e9)];
  const base = await run({ cfg: veto, readApp: async () => app(one()), aiFn: async () => ({ action: "take" }) }); const q0 = base.ledger.open[0].qty;
  assert.strictEqual(base.ledger.open.length, 1); assert.strictEqual(base.decisions.find((d) => d.action === "open").ai.action, "take");
  let calls = 0; const half = await run({ cfg: veto, readApp: async () => app(one()), aiFn: async () => { calls++; return { action: "shrink", size: 0.5 }; } });
  assert(Math.abs(half.ledger.open[0].qty / q0 - 0.5) < 0.01, "half size: " + half.ledger.open[0].qty / q0);
  const boost = await run({ cfg: veto, readApp: async () => app(one()), aiFn: async () => ({ action: "shrink", size: 9 }) }); assert(boost.ledger.open[0].qty <= q0 + 1e-9, "AI cannot raise size");
  calls = 0; let sk = await run({ cfg: veto, readApp: async () => app(one()), aiFn: async () => { calls++; return { action: "skip", reason: "x" }; } });
  assert.strictEqual(sk.ledger.open.length, 0); assert.strictEqual(sk.decisions.find((d) => d.reason === "ai-skip").ai.action, "skip");
  sk = await run({ cfg: veto, ledger: sk.ledger, now: NOW + 5 * M, readApp: async () => app(one()), aiFn: async () => { calls++; return { action: "take" }; } });
  assert.strictEqual(calls, 1, "a vetoed signal is never asked again"); assert.strictEqual(sk.ledger.open.length, 0);
  const inv = await run({ cfg: veto, readApp: async () => app(one()), aiFn: async () => "nonsense" }); assert.strictEqual(inv.ledger.open.length, 0); assert(inv.decisions.some((d) => d.reason === "ai-invalid"));
  let down = await run({ cfg: veto, readApp: async () => app(one()), aiFn: async () => { throw new Error("503"); } }); assert.strictEqual(down.ledger.open.length, 0);
  assert.strictEqual(down.state.signals[0].st, "wait", "provider down -> waits");
  down = await run({ cfg: veto, ledger: down.ledger, now: NOW + 5 * M, readApp: async () => app(one()), aiFn: async () => ({ action: "take" }) }); assert.strictEqual(down.ledger.open.length, 1, "retried and entered once the provider is back");
  const bud = mk(); bud.ai.mode = "veto"; bud.ai.maxCallsPerDay = 1; bud.maxNewPerRound = 5;
  const b2 = await run({ cfg: bud, aiFn: async () => ({ action: "take" }) }); assert.strictEqual(b2.ledger.open.length, 1); assert(b2.decisions.some((d) => d.reason === "ai-budget"));
  const none = await run({ cfg: veto, readApp: async () => app(one()), aiFn: null }); assert.strictEqual(none.ledger.open.length, 0, "veto mode without a provider never trades blind");

  // --- 6. journal content, and the close reason reaches the state
  const o = base.decisions.find((d) => d.action === "open"); assert(o.info.entry > 100 && o.info.sl < o.info.entry && o.info.spreadPct >= 0 && o.edgePts > 9 && o.key === "BBB|1H|" + S);
  const pos = base.ledger.open[0], lg = JSON.parse(JSON.stringify(base.ledger));
  await B.applyExits(lg, mk(), async () => ({ ok: true, data: [{ t: E + M, o: 100, h: 100.2, l: 80, c: 85 }] }), NOW + H);
  assert.strictEqual(lg.closed[0].rule, "V8-01"); assert.strictEqual(lg.log.filter((x) => x.k === "close")[0].v.why, "stop");
  console.log("improve: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
