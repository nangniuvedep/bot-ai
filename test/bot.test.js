/* node test/bot.test.js — rule bot + ledger with fake data. No network. */
"use strict";
const assert = require("assert"), B = require("../src/bot.js"), BN = require("../src/binance.js"), SB = require("../src/state-builder.js"), { validate } = require("../src/state-contract.js"), { round, CFG } = require("../src/run.js");
const H = 36e5, M = 6e4, NOW0 = Date.UTC(2026, 9, 29, 13, 8);               // 13:08 UTC; the app's `at` = 13:00 = when the signal candle closed = entry candle open
const S = Date.UTC(2026, 9, 29, 13, 0), E = B.entryCandle(S, "1H"), cfg = JSON.parse(JSON.stringify(CFG));

/* app files: SOL has green V8-01; DOGE has a hit but its validation is not green; ETH green but spread is wide */
const sig = (coins) => ({ "1H": { at: S, scanned: 3, coins } });
const coin = (sym, code) => ({ sym, pair: sym + "USDT", price: 100, qv: 1e9, c24: 1, ch: 0.1, hits: [{ code, dir: 1 }] });
const brief = { "1H": { at: S, c: { SOL: { a: 4, p: 100 }, DOGE: { a: 4, p: 100 }, ETH: { a: 4, p: 100 } } } };
const val = { v: 2, at: S, tf: { "1H": { base: { a: { "1-2": { up: [30, 70, 0], dn: [0, 0, 0] } }, b: { "1-2": { up: [30, 70, 0], dn: [0, 0, 0] } } }, rows: [
  { code: "V8-01", a: { n: 200, cfg: { "1-2": [45, 55, 0] } }, b: { n: 100, cfg: { "1-2": [40, 60, 0] } } },          // 45% / 40% vs 30% base -> green
  { code: "V8-09", a: { n: 200, cfg: { "1-2": [31, 69, 0] } }, b: { n: 100, cfg: { "1-2": [45, 55, 0] } } },          // a only +1 -> not green
  { code: "V8-07", a: { n: 30, cfg: { "1-2": [20, 10, 0] } }, b: { n: 100, cfg: { "1-2": [45, 55, 0] } } }] } } };   // n < 50 -> not green
const app = (coins) => ({ signals: sig(coins), brief, validation: val });

/* fake Binance: open candle of E, book, and 1m history built per test */
const book = (ask, bid) => ({ ok: true, data: { bid, ask, asks: [[ask, 5000], [ask * 1.001, 5000]] } });
const mkFetch = ({ path, spreadFor = {}, candles = () => [] }) => async (url) => {
  const u = new URL(url), sym = u.searchParams.get("symbol") || "";
  if (u.pathname === "/api/v3/depth") { const w = spreadFor[sym] || 0.0002; return { ok: true, json: async () => ({ bids: [[(100 * (1 - w)).toString(), "9999"]], asks: [["100", "5000"], ["100.1", "5000"]] }) }; }
  if (u.pathname === "/api/v3/klines") { const from = +u.searchParams.get("startTime"), to = +u.searchParams.get("endTime"), rows = candles(sym).filter((k) => k.t >= from && k.t <= to); return { ok: true, json: async () => rows.map((k) => [k.t, k.o, k.h, k.l, k.c, 1, k.t + 59999]) }; }
  return { ok: false, status: 404 };
};
const flat = (from, n, o = 100, h = 100.3, l = 99.8) => Array.from({ length: n }, (_, i) => ({ t: from + i * M, o, h, l, c: o }));

(async () => {
  assert.strictEqual(B.entryCandle(S, "1H"), S, "at = candle close = entry candle open (real files)");
  // --- greenEdge
  assert(B.greenEdge(val, "1H", "V8-01", cfg) > 0.09 && B.greenEdge(val, "1H", "V8-01", cfg) < 0.11);
  assert.strictEqual(B.greenEdge(val, "1H", "V8-09", cfg), null); assert.strictEqual(B.greenEdge(val, "1H", "V8-07", cfg), null); assert.strictEqual(B.greenEdge(val, "1H", "NOPE", cfg), null);

  // --- candidates: only green + same-round brief; not before entry candle, not too late
  const L0 = B.newLedger(cfg, NOW0);
  let c = B.findCandidates(app([coin("SOL", "V8-01"), coin("DOGE", "V8-09")]), cfg, L0, NOW0);
  assert.deepStrictEqual(c.map((x) => x.sym), ["SOL"]); assert.strictEqual(c[0].atr, 4); assert.strictEqual(c[0].E, E);
  assert.strictEqual(B.findCandidates(app([coin("SOL", "V8-01")]), cfg, L0, E - 1).length, 0, "entry candle not open yet");
  assert(B.findCandidates(app([coin("SOL", "V8-01")]), cfg, L0, E + 31 * M)[0].late, "too late");
  const mixed = app([coin("SOL", "V8-01")]); mixed.brief = { "1H": { at: S - H, c: brief["1H"].c } };
  assert.strictEqual(B.findCandidates(mixed, cfg, L0, NOW0).length, 0, "brief of another round");

  // --- one full round: SOL entered, DOGE ignored, ETH refused for spread
  const fetchFn = mkFetch({ spreadFor: { ETHUSDT: 0.01 }, candles: (s) => flat(E, 8) });
  let r = await round({ cfg, now: NOW0, fetchFn, readApp: async () => app([coin("SOL", "V8-01"), coin("DOGE", "V8-09"), coin("ETH", "V8-01")]) });
  let L = r.ledger; assert.strictEqual(L.open.length, 1); const p = L.open[0];
  assert.strictEqual(p.sym, "SOL"); assert(p.entry > 100 && p.entry < 100.2, "fill = open + half spread + slippage: " + p.entry);
  assert(Math.abs((p.entry - p.sl) - 4) < 1e-9 && Math.abs((p.tp - p.entry) - 8) < 1e-9, "stop 1 ATR, target 2 ATR");
  assert(Math.abs(p.riskAmt - 100) < 0.01, "risk 1% of 10000 incl. fees: " + p.riskAmt); assert(p.qty * p.entry <= 2500.01, "notional cap 25%");
  assert.deepStrictEqual(validate(r.state), { ok: true, errors: [] });
  assert.deepStrictEqual(r.state.signals.map((x) => [x.coin, x.val, x.st]), [["SOL", "both", "watch"], ["ETH", "spread", "skip"]]);
  assert(r.state.log.some((x) => x.k === "skip" && x.v.coin === "ETH") && r.state.log.some((x) => x.k === "open"));

  // --- the same signal never enters twice (re-run, even with the position closed and the ledger reloaded)
  r = await round({ cfg, now: NOW0 + 15 * M, fetchFn, ledger: JSON.parse(JSON.stringify(L)), readApp: async () => app([coin("SOL", "V8-01")]) });
  assert.strictEqual(r.ledger.open.length, 1, "no second entry"); assert.strictEqual(r.ledger.log.filter((x) => x.k === "open").length, 1);

  // --- exits
  const exitOf = async (candles, now) => { const l = JSON.parse(JSON.stringify(L)); await B.applyExits(l, cfg, (pair, a, b) => BN.klines1m(pair, a, b, now, mkFetch({ candles: () => candles })), now); return l; };
  let l = await exitOf(flat(E, 3).concat([{ t: E + 3 * M, o: 100, h: 112, l: 100, c: 105 }]), NOW0 + 2 * H);
  assert.strictEqual(l.closed[0].exit, p.tp); assert(l.closed[0].pnl > 0 && l.closed[0].r > 1.5 && l.closed[0].r < 2, "target ~ +2R minus fees: " + l.closed[0].r); assert.strictEqual(l.open.length, 0);
  l = await exitOf(flat(E, 3).concat([{ t: E + 3 * M, o: 100, h: 112, l: 90, c: 100 }]), NOW0 + 2 * H);   // touches both -> stop
  assert(l.closed[0].exit < p.sl && l.closed[0].pnl < 0 && l.closed[0].r < -1, "stop wins a double touch: r=" + l.closed[0].r);
  l = await exitOf(flat(E, 3), NOW0 + 2 * H); assert.strictEqual(l.open.length, 1, "nothing touched -> still open");
  const exp = E + 10 * H; l = await exitOf(flat(E, 600).concat([{ t: exp, o: 100.5, h: 100.6, l: 100.4, c: 100.5 }]), exp + 2 * M);   // time exit at next open
  assert.strictEqual(l.closed.length, 1); assert(Math.abs(l.closed[0].exit - 100.5 * (1 - cfg.timeoutSlipPct)) < 1e-9);
  assert((l.cooldown.SOL || 0) > exp, "cooldown after close");
  const eqAfter = B.equityOf(l); assert(Math.abs(eqAfter - (10000 + l.closed[0].pnl)) < 1e-6, "cash accounting: " + eqAfter);
  const failing = JSON.parse(JSON.stringify(L)); await B.applyExits(failing, cfg, async () => ({ ok: false, reason: "HTTP 503" }), NOW0 + 2 * H); assert.strictEqual(failing.open.length, 1, "kline error keeps the position");

  // --- gates
  const full = B.newLedger(cfg, NOW0); full.open = Array.from({ length: 5 }, (_, i) => ({ sym: "X" + i, entry: 1, sl: 0.99, qty: 1, mark: 1 }));
  assert.strictEqual(B.tryEnter(full, cfg, c[0], { open: 100, bid: 99.99, ask: 100, asks: [[100, 9999]] }, NOW0).reason, "max-positions");
  const lost = B.newLedger(cfg, NOW0); lost.day.realized = -301; assert.strictEqual(B.tryEnter(lost, cfg, c[0], { open: 100, bid: 99.99, ask: 100, asks: [[100, 9999]] }, NOW0).reason, "day-loss");
  const cd = B.newLedger(cfg, NOW0); cd.cooldown.SOL = NOW0 + 1; assert.strictEqual(B.tryEnter(cd, cfg, c[0], { open: 100, bid: 99.99, ask: 100, asks: [[100, 9999]] }, NOW0).reason, "cooldown");
  assert.strictEqual(B.tryEnter(B.newLedger(cfg, NOW0), cfg, c[0], { open: 100, bid: 102.99, ask: 103, asks: [[103, 9999]] }, NOW0).reason, "chase");
  assert.strictEqual(B.tryEnter(B.newLedger(cfg, NOW0), cfg, c[0], { open: 100, bid: 99.99, ask: 100, asks: [[100, 1]] }, NOW0).reason, "depth");
  const ks = B.newLedger(cfg, NOW0); ks.kill = true; assert.strictEqual(B.tryEnter(ks, cfg, c[0], { open: 100, bid: 99.99, ask: 100, asks: [[100, 9999]] }, NOW0).reason, "kill");
  const dd = B.newLedger(cfg, NOW0); dd.cash = 8900; B.finishRound(dd, cfg, NOW0); assert(dd.halted, "drawdown >= 10% halts");
  assert.strictEqual(SB.build(dd, cfg, NOW0, []).status, "halted");

  // --- a broken app file: no entries, but exits and state still work
  r = await round({ cfg, now: NOW0, fetchFn, ledger: null, readApp: async () => { throw new Error("signals: too old: 200 min"); } });
  assert.strictEqual(r.ledger.open.length, 0); assert.deepStrictEqual(validate(r.state), { ok: true, errors: [] });
  // --- verbose diagnostics explain themselves
  const lines = []; await round({ cfg, now: NOW0, fetchFn, ledger: null, verbose: true, say: (m) => lines.push(m), readApp: async () => app([coin("SOL", "V8-01"), coin("DOGE", "V8-09"), coin("XRP", "V8-07"), coin("ADA", "V8-77")]) });
  const txt = lines.join("\n");
  assert(/4 coins with signals, 4 with an UP hit/.test(txt) && /GREEN SOL V8-01/.test(txt) && /no\s+DOGE V8-09: edge below/.test(txt) && /XRP V8-07: too few/.test(txt) && /ADA V8-77: no Validation row/.test(txt) && /green up-signals: 1 ·/.test(txt), txt);
  console.log("bot: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
