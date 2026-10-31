/* node test/short-manage.test.js — paper SHORT, break-even / trailing / target extension, AI stop-target management, performance stats. No network. */
"use strict";
const assert = require("assert"), B = require("../src/bot.js"), AD = require("../src/ai-decider.js"), SB = require("../src/state-builder.js"), { validate } = require("../src/state-contract.js"), { round, CFG } = require("../src/run.js");
const M = 6e4, S = Date.UTC(2026, 9, 29, 13, 0), NOW = S + 8 * M, near = (a, b, e = 1e-6) => assert(Math.abs(a - b) <= e * Math.max(1, Math.abs(b)), a + " !~ " + b);
const mk = () => { const c = JSON.parse(JSON.stringify(CFG)); c.ai.mode = "decide"; c.allowShort = true; return c; };
const book = { open: 100, bid: 99.98, ask: 100, asks: [[100, 5000], [100.1, 5000]], bids: [[99.98, 9999]] };
const cand = (side) => ({ sym: "AAA", pair: "AAAUSDT", tf: "1H", rule: "V8-01", edge: 0.1, S, E: S, atr: 4, qv: 3e9, key: "AAA|1H|" + S, side });
const kl = (rows) => async () => ({ ok: true, data: rows.map(([t, o, h, l, c]) => ({ t: S + t * M, o, h, l, c })) });

(async () => {
  // 1. short entry geometry + accounting
  const cfg = mk(), L = B.newLedger(cfg, NOW), r = B.tryEnter(L, cfg, cand(-1), book, NOW);
  assert(r.ok, JSON.stringify(r)); const p = r.pos; assert.strictEqual(p.side, -1); assert(p.sl > p.entry && p.tp < p.entry && p.entry < 100, "short sells at the bid side, stop above, target below");
  near(p.sl - p.entry, 4, 1e-9); near(p.entry - p.tp, 8, 1e-9);
  B.commitEntry(L, cfg, p, NOW); near(B.equityOf(L), cfg.startEquity - p.entryFee, 1e-9);
  assert(B.openRisk(L, B.equityOf(L)) > 0 && B.openRisk(L, B.equityOf(L)) <= cfg.openRiskLimit);
  const lg = B.newLedger(cfg, NOW), rl = B.tryEnter(lg, cfg, cand(1), book, NOW); assert(rl.ok && rl.pos.side === 1 && rl.pos.sl < rl.pos.entry);
  assert(Math.abs(p.qty / rl.pos.qty - 0.5) < 0.05, "shorts are half size");
  const off = mk(); off.allowShort = false; assert.strictEqual(B.tryEnter(B.newLedger(off, NOW), off, cand(-1), book, NOW).reason, "short-disabled");

  // 2. short hits target, short hits stop
  const eq0 = B.equityOf(L); await B.applyExits(L, cfg, kl([[0, 100, 100.5, 99, 99.5], [1, 99.5, 99.6, p.tp - 0.5, p.tp]]), NOW + 5 * M);
  assert.strictEqual(L.closed[0].why, "target"); assert(L.closed[0].pnl > 0 && L.closed[0].r > 1.2 && L.closed[0].side === -1); near(L.cash, cfg.startEquity + L.closed[0].pnl, 1e-9);
  const L2 = B.newLedger(cfg, NOW); const p2 = B.tryEnter(L2, cfg, cand(-1), book, NOW).pos; B.commitEntry(L2, cfg, p2, NOW);
  await B.applyExits(L2, cfg, kl([[0, 100, p2.sl + 0.2, 99.8, p2.sl]]), NOW + 5 * M); assert.strictEqual(L2.closed[0].why, "stop"); assert(L2.closed[0].r < -0.9 && L2.closed[0].r > -1.4, "short stop loses about -1R: " + L2.closed[0].r);
  near(L2.cash, cfg.startEquity + L2.closed[0].pnl, 1e-9);

  // 3. break-even: +1.2R then back to entry -> out at about 0R (fees only), reason breakeven
  const L3 = B.newLedger(cfg, NOW), c3 = B.tryEnter(L3, cfg, cand(1), book, NOW).pos; B.commitEntry(L3, cfg, c3, NOW);
  const R = c3.risk0, up = (x) => c3.entry + x * R;
  await B.applyExits(L3, cfg, kl([[0, c3.entry, up(1.2), c3.entry - 0.1 * R, up(1.1)], [1, up(1.1), up(1.15), up(-0.3), up(-0.2)]]), NOW + 5 * M);
  assert.strictEqual(L3.closed[0].why, "breakeven", JSON.stringify(L3.closed[0])); assert(L3.closed[0].r > -0.4 && L3.closed[0].r < 0.1, "about break-even: " + L3.closed[0].r);

  // 4. trailing: run to +1.7R, fall back -> locked profit, reason trail; same-candle move gives no look-ahead
  const L4 = B.newLedger(cfg, NOW), c4 = B.tryEnter(L4, cfg, cand(1), book, NOW).pos; B.commitEntry(L4, cfg, c4, NOW);
  await B.applyExits(L4, cfg, kl([[0, c4.entry, c4.entry + 1.7 * R, c4.entry - 0.2 * R, c4.entry + 1.6 * R], [1, c4.entry + 1.6 * R, c4.entry + 1.65 * R, c4.entry + 0.2 * R, c4.entry + 0.3 * R]]), NOW + 5 * M);
  assert.strictEqual(L4.closed[0].why, "trail"); assert(L4.closed[0].r > 0.4 && L4.closed[0].r < 1.0, "trail locks peak minus 1R (~0.7R): " + L4.closed[0].r); assert(L4.closed[0].mfeR >= 1.69);
  // the stop of a candle never helps that same candle: huge up-then-down candle at once must not exit via the not-yet-moved stop at +0.7R
  const L4b = B.newLedger(cfg, NOW), c4b = B.tryEnter(L4b, cfg, cand(1), book, NOW).pos; B.commitEntry(L4b, cfg, c4b, NOW);
  await B.applyExits(L4b, cfg, kl([[0, c4b.entry, c4b.entry + 1.7 * R, c4b.entry + 0.2 * R, c4b.entry + 0.3 * R]]), NOW + 5 * M); assert.strictEqual(L4b.closed.length, 0, "one candle cannot both trigger and use the trailing stop");
  assert(L4b.open[0].sl > c4b.entry, "...but the stop is moved for the next candle");

  // 5. target extension when price approaches the target while trailing (long and short)
  for (const d of [1, -1]) {
    const Lx = B.newLedger(cfg, NOW), px = B.tryEnter(Lx, cfg, cand(d), book, NOW).pos; B.commitEntry(Lx, cfg, px, NOW); const tp0 = px.tp, ex0 = px.expiry, g = (x) => px.entry + d * x * px.risk0;
    await B.applyExits(Lx, cfg, kl([[0, px.entry, d === 1 ? g(1.8) : px.entry, d === 1 ? px.entry : g(1.8), g(1.7)]]), NOW + 5 * M);
    const q = Lx.open[0]; assert(q && q.ext === 1 && d * (q.tp - tp0) > 0 && q.expiry > ex0, "target extended, side " + d); near(Math.abs(q.tp - tp0), cfg.manage.extendByR * px.risk0, 1e-9);
  }

  // 6. Governor for AI-managed levels
  const L6 = B.newLedger(cfg, NOW), c6 = B.tryEnter(L6, cfg, cand(1), book, NOW).pos; B.commitEntry(L6, cfg, c6, NOW); c6.mark = c6.entry + 1.4 * R;
  assert.strictEqual(B.adjustPosition(L6, cfg, "AAA", { stop: c6.sl - 1 }, NOW).reason, "stop-not-tighter");
  assert.strictEqual(B.adjustPosition(L6, cfg, "AAA", { stop: c6.mark + 1 }, NOW).reason, "stop-too-close");
  assert.strictEqual(B.adjustPosition(L6, cfg, "AAA", { target: c6.tp + 2 }, NOW).reason, "target-needs-profit-and-breakeven");
  assert(B.adjustPosition(L6, cfg, "AAA", { stop: c6.entry + 0.2 * R }, NOW).ok && c6.sl > c6.entry);
  assert.strictEqual(B.adjustPosition(L6, cfg, "AAA", { target: c6.tp - 1 }, NOW).reason, "target-not-further");
  assert(B.adjustPosition(L6, cfg, "AAA", { target: c6.tp + 2 }, NOW).ok);
  const Ls = B.newLedger(cfg, NOW), cs = B.tryEnter(Ls, cfg, cand(-1), book, NOW).pos; B.commitEntry(Ls, cfg, cs, NOW); cs.mark = cs.entry - 0.5 * R;
  assert.strictEqual(B.adjustPosition(Ls, cfg, "AAA", { stop: cs.sl + 1 }, NOW).reason, "stop-not-tighter"); assert(B.adjustPosition(Ls, cfg, "AAA", { stop: cs.entry }, NOW).ok && cs.sl === cs.entry);

  // 7. closeEarly: long sells at the bid, short buys back at the ask
  const Lc = B.newLedger(cfg, NOW), cc = B.tryEnter(Lc, cfg, cand(-1), book, NOW).pos; B.commitEntry(Lc, cfg, cc, NOW);
  const row = B.closeEarly(Lc, cfg, "AAA", { bid: 99, ask: 99.1 }, NOW + M, "ai"); near(row.exit, 99.1 * (1 + cfg.timeoutSlipPct), 1e-9); assert(row.side === -1 && row.pnl > 0);

  // 8. stats + state with a short (contract valid, UI fields)
  L.closed.push({ ...L.closed[0] }, { ...L2.closed[0] }); const st = SB.stats(L); assert.strictEqual(st.n, 3); assert(st.bySide.short.n === 3 && st.byWhy.target.n === 2 && st.byWhy.stop.n === 1); assert(st.profitFactor > 0);
  const L8 = B.newLedger(cfg, NOW), p8 = B.tryEnter(L8, cfg, cand(-1), book, NOW).pos; B.commitEntry(L8, cfg, p8, NOW); const state = SB.build(L8, cfg, NOW, []);
  assert.deepStrictEqual(validate(state), { ok: true, errors: [] }); const so = state.open[0]; assert(so.side === "SELL" && so.market === "paper-short" && so.slPct > 0 && so.tpPct < 0); assert.strictEqual(state.rules.side, "long-short");

  // 9. AI round: short candidate is shortlisted with the DOWN stats; AI opens it, then manages and later closes it
  const row2 = (code, a, b) => ({ code, a: { n: 200, cfg: { "1-2": [a, 200 - a, 0] } }, b: { n: 200, cfg: { "1-2": [b, 200 - b, 0] } } });
  const val = { v: 2, at: S, tf: { "1H": { base: { a: { "1-2": { up: [10, 190, 0], dn: [60, 140, 0] } }, b: { "1-2": { up: [10, 190, 0], dn: [60, 140, 0] } } }, rows: [row2("V8-05", 90, 80)] } } };
  const sig = (hits) => ({ sym: "AAA", pair: "AAAUSDT", price: 100, qv: 3e9, c24: -1, ch: -0.1, hits });
  const mkApp = (hits) => ({ signals: { "1H": { at: S, scanned: 1, coins: [sig(hits)] } }, brief: { "1H": { at: S, c: Object.fromEntries(["AAA", "BTC", "ETH"].map((s) => [s, { a: 4, p: 100, tr: -1, rs: 40, rd: 3, sd: 6 }])) } }, validation: val });
  const list = AD.shortlist(mkApp([{ code: "V8-05", dir: -1 }]), cfg, B.newLedger(cfg, NOW), NOW); assert.strictEqual(list.length, 1); assert(list[0].side === -1 && list[0].green && list[0].codes[0].baseA === 30, "short uses the DOWN base rate");
  const mixed = AD.shortlist(mkApp([{ code: "V8-05", dir: -1 }, { code: "V8-99", dir: 1 }]), cfg, B.newLedger(cfg, NOW), NOW); assert(mixed[0].side === -1 && mixed[0].mixed === true, "stronger green side wins when both directions fire");
  const offc = mk(); offc.allowShort = false; assert.strictEqual(AD.shortlist(mkApp([{ code: "V8-05", dir: -1 }]), offc, B.newLedger(offc, NOW), NOW).length, 0);
  const fetchFn = async (url) => { const u = new URL(url); if (u.pathname === "/api/v3/depth") return { ok: true, json: async () => ({ bids: [["99.98", "9999"], ["99.9", "9999"]], asks: [["100", "5000"], ["100.1", "5000"]] }) }; return { ok: true, json: async () => [] }; };
  const ai = (o) => async () => ({ ok: true, text: JSON.stringify(o), provider: "fake", model: "m", ms: 5 });
  const go = (o) => round({ cfg: mk(), now: NOW, fetchFn, readApp: async () => mkApp([{ code: "V8-05", dir: -1 }]), ...o });
  let rr = await go({ aiFn: ai({ marketView: "down", entries: [{ id: "c1", conviction: 2, confidence: 0.7, reason: "bear trend" }], close: [] }) });
  assert.strictEqual(rr.ledger.open.length, 1); const sp = rr.ledger.open[0]; assert(sp.side === -1 && sp.sl > sp.entry && sp.tp < sp.entry); assert(rr.decisions.some((d) => d.action === "open" && d.side === "short"));
  assert.deepStrictEqual(validate(rr.state), { ok: true, errors: [] }); assert.strictEqual(rr.state.open[0].side, "SELL");
  // later round: position at +1.4R, AI asks for break-even+ and a further target; a loosening request is refused
  sp.mark = sp.entry - 1.4 * sp.risk0; const newStop = sp.entry - 0.3 * sp.risk0, newTp = sp.tp - sp.risk0;
  rr = await go({ ledger: rr.ledger, now: NOW + 15 * M, readApp: async () => ({ signals: { "1H": { at: S, scanned: 0, coins: [] } }, brief: mkApp([]).brief, validation: val }),
    aiFn: ai({ entries: [], manage: [{ coin: "AAA", stop: newStop, target: newTp, reason: "trend intact" }, { coin: "ZZZ", stop: 1 }], close: [] }) });
  assert(rr.decisions.some((d) => d.action === "manage" && d.coin === "AAA"), JSON.stringify(rr.decisions)); const q = rr.ledger.open[0]; near(q.sl, newStop, 1e-9); near(q.tp, newTp, 1e-9);
  assert(rr.state.open[0].managed === true && rr.state.open[0].sl0 > rr.state.open[0].entry);
  rr = await go({ ledger: rr.ledger, now: NOW + 30 * M, readApp: async () => ({ signals: { "1H": { at: S, scanned: 0, coins: [] } }, brief: mkApp([]).brief, validation: val }), aiFn: ai({ entries: [], manage: [{ coin: "AAA", stop: q.sl + 1 }], close: [] }) });
  assert(rr.decisions.some((d) => d.action === "manage-refused" && d.reason === "stop-not-tighter"));
  rr = await go({ ledger: rr.ledger, now: NOW + 45 * M, readApp: async () => ({ signals: { "1H": { at: S, scanned: 0, coins: [] } }, brief: mkApp([]).brief, validation: val }), aiFn: ai({ entries: [], close: [{ coin: "AAA", reason: "resistance reclaimed" }] }) });
  assert.strictEqual(rr.ledger.open.length, 0); assert(rr.ledger.closed[rr.ledger.closed.length - 1].side === -1 && rr.state.closed[rr.state.closed.length - 1].side === "SELL");
  console.log("short-manage: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
