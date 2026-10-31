/* bot.js — rule bot + paper ledger. Long-only spot, no leverage, virtual money.
   Pure logic: all network access is injected (market data via binance.js, app data via app-reader.js). */
"use strict";
const AR = require("./app-reader.js");
const TFMS = AR.CONTRACT.tfMs, MIN = 60000, DAY = 864e5;

function newLedger(cfg, now) {
  return { v: 1, createdAt: now, startEquity: cfg.startEquity, cash: cfg.startEquity, peak: cfg.startEquity, halted: false, kill: false,
    day: { key: dayKey(now), startEquity: cfg.startEquity, realized: 0, opened: 0, aiCalls: 0 }, codeOff: {}, codeFrom: {}, open: [], closed: [], seen: {}, cooldown: {},
    equity: [[now - MIN, cfg.startEquity], [now, cfg.startEquity]], log: [], lastRun: now };
}
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
/* start of a round: a new UTC day resets the day counters (before any gate looks at them) */
function rollDay(L, now) { if (dayKey(now) !== L.day.key) L.day = { key: dayKey(now), startEquity: equityOf(L), realized: 0, opened: 0, aiCalls: 0 }; L.codeOff = L.codeOff || {}; L.codeFrom = L.codeFrom || {}; L.day.opened = L.day.opened || 0; L.day.aiCalls = L.day.aiCalls || 0; }
const equityOf = (L) => L.cash + L.open.reduce((a, p) => a + p.qty * (p.mark || p.entry), 0);
const fmtP = (p) => p.toFixed(p < 1 ? 5 : p < 100 ? 3 : 2);
const fmtR = (r) => (r >= 0 ? "+" : "") + r.toFixed(1) + "R";
const logAdd = (L, cfg, t, k, v) => { L.log.push({ t, k, v }); if (L.log.length > cfg.maxLog) L.log.splice(0, L.log.length - cfg.maxLog); };

/* ---- 1. who counts as "green" (assumption, see DATA-CONTRACT [KIỂM]): win rate beats the random-candle base rate by >= edge in BOTH
        periods (a = first 70 %, b = last 30 %), each judged on >= minN hits. Returns the weaker edge, or null. */
function greenEdge(val, tf, code, cfg) {
  try {
    const v = AR.validated(val, tf, code, cfg.cfg);
    if (!v || v.a.win == null || v.b.win == null || v.a.n < cfg.green.minN || v.b.n < cfg.green.minN) return null;
    const ba = AR.baseRate(val, tf, "a", cfg.cfg, "up"), bb = AR.baseRate(val, tf, "b", cfg.cfg, "up");
    if (ba.win == null || bb.win == null) return null;
    const e = Math.min(v.a.win - ba.win, v.b.win - bb.win);
    return e >= cfg.green.edge ? e : null;
  } catch (e) { return null; }
}

/* why a code is (not) green — for --verbose only. -> {green, why, a, b, base} */
function explainCode(val, tf, code, cfg) {
  try {
    const v = AR.validated(val, tf, code, cfg.cfg);
    if (!v) return { green: false, why: "no Validation row (coin/code outside the top-100 list or not judged)" };
    const ba = AR.baseRate(val, tf, "a", cfg.cfg, "up"), bb = AR.baseRate(val, tf, "b", cfg.cfg, "up"), pc = (x) => (x.win == null ? "n/a" : (x.win * 100).toFixed(1) + "%");
    const info = `70%: ${pc(v.a)} of ${v.a.n} (base ${pc(ba)}) · 30%: ${pc(v.b)} of ${v.b.n} (base ${pc(bb)})`;
    if (v.a.n < cfg.green.minN || v.b.n < cfg.green.minN) return { green: false, why: `too few judged hits (need ${cfg.green.minN}); ${info}` };
    const e = greenEdge(val, tf, code, cfg);
    return e == null ? { green: false, why: `edge below +${cfg.green.edge * 100} points; ${info}` } : { green: true, why: info };
  } catch (e) { return { green: false, why: "cannot read Validation: " + e.message }; }
}

/* entry candle = the candle that opens right after the signal candle closed. The app's `at` is the moment the signal candle CLOSED (observed on real files). */
const entryCandle = (at, tf) => at + (AR.CONTRACT.atIsCandleClose ? 0 : TFMS[tf]);

/* ---- 2. candidates from this round's app files. app = {signals, brief, validation} (parsed signals/brief, raw validation).
        Only signals whose entry candle E (see entryCandle) is already open. */
function findCandidates(app, cfg, L, now) {
  const out = [];
  for (const tf of cfg.tfs) {
    const sg = app.signals[tf], br = app.brief[tf];
    if (!sg || !br || sg.at !== br.at) continue;                     // files of different rounds -> do not mix
    const S = sg.at, E = entryCandle(S, tf);
    if (now < E || now - E > cfg.maxEntryDelayMin * MIN) { if (now >= E) out.push({ tf, late: true, S, E }); continue; }
    for (const c of sg.coins) {
      let best = null;
      for (const h of c.hits) { if (h.dir !== 1 || (L.codeOff && L.codeOff[h.code] > now)) continue; const e = greenEdge(app.validation, tf, h.code, cfg); if (e != null && (!best || e > best.edge)) best = { code: h.code, edge: e }; }
      if (!best) continue;
      const b = br.c[c.sym];
      if (!b || !(b.a > 0) || !(b.p > 0)) continue;
      out.push({ sym: c.sym, pair: c.pair, tf, rule: best.code, edge: best.edge, S, E, atr: (b.a / 100) * b.p, qv: c.qv, key: `${c.sym}|${tf}|${S}` });
    }
  }
  return out;
}

/* ---- 3. global gates for new entries -> reason or null ("temp" reasons just wait for a better moment) */
function gate(L, cfg, now, equity) {
  if (L.kill || cfg.killSwitch) return { reason: "kill", temp: true };
  if (L.halted) return { reason: "halted", temp: true };
  if (L.open.length >= cfg.maxPositions) return { reason: "max-positions", temp: true };
  if (L.day.realized <= -cfg.dayLossPct * L.day.startEquity) return { reason: "day-loss", temp: true };
  if (L.day.opened >= cfg.maxTradesPerDay) return { reason: "day-trades", temp: true };
  return null;
}
const openRisk = (L, equity) => L.open.reduce((a, p) => a + (p.entry - p.sl) * p.qty, 0) / equity;

/* ---- 4. try to open one position. market = {open (open of entry candle), bid, ask, asks}. -> {ok, pos} | {ok:false, reason, temp?} */
function tryEnter(L, cfg, cand, market, now, sizeMult = 1) {
  const eq = equityOf(L), g = gate(L, cfg, now, eq); if (g) return { ok: false, ...g };
  if (L.open.some((p) => p.sym === cand.sym)) return { ok: false, reason: "already-open" };
  if ((L.cooldown[cand.sym] || 0) > now) return { ok: false, reason: "cooldown", temp: true };
  const [sm, ratio] = cfg.cfg.split("-").map(Number), spread = (market.ask - market.bid) / market.bid;
  const info = { spreadPct: spread * 100, chaseAtr: (market.ask - market.open) / cand.atr };
  if (spread > cfg.maxSpreadPct) return { ok: false, reason: "spread", spread: true, info };
  if ((market.ask - market.open) > cfg.maxChaseAtr * cand.atr) return { ok: false, reason: "chase", info };
  const stopDist = sm * cand.atr, rough = market.open * (1 + spread / 2);
  if (stopDist / rough < cfg.minStopPct || stopDist / rough > cfg.maxStopPct) return { ok: false, reason: "stop-size", info };
  const riskAmt = eq * cfg.riskPct, perCoinLoss = stopDist + rough * cfg.feePct * 2;
  let qty = sizeMult * Math.min(riskAmt / perCoinLoss, (cfg.maxNotionalPct * eq) / rough, L.cash / (rough * (1 + cfg.feePct)));
  if (!(qty > 0)) return { ok: false, reason: "no-cash", temp: true };
  const avg = require("./binance.js").walkAsks(market.asks, qty * rough);
  if (avg == null) return { ok: false, reason: "depth", info };
  const slip = avg / market.asks[0][0] - 1, entry = market.open * (1 + spread / 2 + slip);
  qty = Math.min(qty, sizeMult * riskAmt / (stopDist + entry * cfg.feePct * 2), L.cash / (entry * (1 + cfg.feePct)));
  const sl = entry - stopDist, tp = entry + ratio * stopDist, fee = qty * entry * cfg.feePct;
  const pos = { id: cand.key, sym: cand.sym, pair: cand.pair, tf: cand.tf, rule: cand.rule, entryTime: cand.E, entry, qty, sl, tp,
    riskAmt: qty * (stopDist + entry * cfg.feePct * 2), entryFee: fee, expiry: cand.E + cfg.maxHoldCandles * TFMS[cand.tf], checkedUntil: cand.E, mark: entry, markAt: now };
  if (openRisk({ open: L.open.concat(pos) }, eq) > cfg.openRiskLimit + 1e-9) return { ok: false, reason: "open-risk", temp: true, info };
  info.slipPct = slip * 100; info.entry = entry; info.qty = qty; info.sl = sl; info.tp = tp; info.sizeMult = sizeMult;
  return { ok: true, pos, info };
}
function commitEntry(L, cfg, pos, now) {
  L.cash -= pos.qty * pos.entry + pos.entryFee; L.open.push(pos); L.day.opened++;
  logAdd(L, cfg, now, "open", { coin: pos.sym, tf: pos.tf, price: fmtP(pos.entry), risk: (cfg.riskPct * 100).toFixed(0) + "%" });
}

/* ---- 5. exits from 1-minute candles, in time order. A candle touching both stop and target counts as the stop.
        After maxHoldCandles the position leaves at the open of the next candle. getKlines(pair, from, to) -> {ok, data:[{t,o,h,l,c}]} */
async function applyExits(L, cfg, getKlines, now) {
  const still = [];
  for (const p of L.open) {
    const r = await getKlines(p.pair, p.checkedUntil, Math.min(now, p.expiry + 2 * MIN));
    if (!r.ok) { still.push(p); continue; }
    let done = null;
    for (const k of r.data) {
      if (k.t >= p.expiry) { done = { px: k.o * (1 - cfg.timeoutSlipPct), why: "time", t: k.t }; break; }
      if (k.l <= p.sl) { done = { px: p.sl * (1 - cfg.stopSlipPct), why: "stop", t: k.t + MIN }; break; }
      if (k.h >= p.tp) { done = { px: p.tp, why: "target", t: k.t + MIN }; break; }
    }
    if (r.data.length) { const last = r.data[r.data.length - 1]; p.checkedUntil = last.t + MIN; p.mark = last.c; p.markAt = last.t + MIN; }
    if (!done) { still.push(p); continue; }
    const gross = p.qty * (done.px - p.entry), exitFee = p.qty * done.px * cfg.feePct, pnl = gross - p.entryFee - exitFee;
    L.cash += p.qty * done.px - exitFee;
    const row = { t: done.t, coin: p.sym, tf: p.tf, rule: p.rule, r: pnl / p.riskAmt, pnl, why: done.why, entry: p.entry, exit: done.px, qty: p.qty, entryTime: p.entryTime, sl: p.sl, tp: p.tp, riskAmt: p.riskAmt, ai: p.ai || null };
    L.closed.push(row); L.day.realized += pnl; L.cooldown[p.sym] = done.t + cfg.cooldownCandles * TFMS[p.tf];
    logAdd(L, cfg, done.t, "close", { coin: p.sym, tf: p.tf, r: fmtR(row.r), why: done.why });
  }
  L.open = still;
}

/* ---- 5a. close one open position now at `bid` (the AI asked to cut it early). Only REDUCES risk; same fee/slip model as a stop. */
function closeEarly(L, cfg, sym, bid, now, why = "ai") {
  const p = L.open.find((x) => x.sym === sym); if (!p || !(bid > 0)) return null;
  const px = bid * (1 - cfg.timeoutSlipPct), gross = p.qty * (px - p.entry), exitFee = p.qty * px * cfg.feePct, pnl = gross - p.entryFee - exitFee;
  L.cash += p.qty * px - exitFee; L.open = L.open.filter((x) => x !== p);
  const row = { t: now, coin: p.sym, tf: p.tf, rule: p.rule, r: pnl / p.riskAmt, pnl, why, entry: p.entry, exit: px, qty: p.qty, entryTime: p.entryTime, sl: p.sl, tp: p.tp, riskAmt: p.riskAmt, ai: p.ai || null };
  L.closed.push(row); L.day.realized += pnl; L.cooldown[p.sym] = now + cfg.cooldownCandles * TFMS[p.tf];
  logAdd(L, cfg, now, "close", { coin: p.sym, tf: p.tf, r: fmtR(row.r), why }); return row;
}

/* ---- 5b. per-rule health: a V8 code whose LIVE paper results are poor is paused (the app's Validation is the past; this is the future).
        Looks at the last `window` closed trades of that code since its last pause; needs >= minTrades. -> list of newly paused codes */
function updateCodeGuard(L, cfg, now) {
  const g = cfg.codeGuard, out = [];
  rollDay(L, now);
  const byCode = {};
  for (const x of L.closed) if (x.rule && x.t >= (L.codeFrom[x.rule] || 0)) (byCode[x.rule] = byCode[x.rule] || []).push(x);
  for (const [code, rows] of Object.entries(byCode)) {
    if ((L.codeOff[code] || 0) > now) continue;
    const w = rows.slice(-g.window); if (w.length < g.minTrades) continue;
    const exp = w.reduce((a, x) => a + x.r, 0) / w.length;
    if (exp < g.minExpectancyR) { L.codeOff[code] = now + g.pauseHours * 36e5; L.codeFrom[code] = L.codeOff[code]; out.push({ code, trades: w.length, expectancyR: exp, until: L.codeOff[code] }); }
  }
  return out;
}

/* ---- 6. end of round: day roll-over, drawdown halt, equity curve */
function finishRound(L, cfg, now) {
  const eq = equityOf(L);
  rollDay(L, now);
  if (eq > L.peak) L.peak = eq;
  if ((L.peak - eq) / L.peak >= cfg.drawdownLimit) L.halted = true;
  const last = L.equity[L.equity.length - 1];
  L.equity.push([Math.max(now, last[0]), eq]);
  if (L.equity.length > cfg.maxEquityPoints) L.equity.splice(0, L.equity.length - cfg.maxEquityPoints);
  for (const k of Object.keys(L.seen)) if (now - L.seen[k] > 7 * DAY) delete L.seen[k];
  for (const k of Object.keys(L.cooldown)) if (L.cooldown[k] < now) delete L.cooldown[k];
  if (L.closed.length > 5000) L.closed.splice(0, L.closed.length - 5000);
  L.lastRun = now; return eq;
}

module.exports = { rollDay, updateCodeGuard, entryCandle, explainCode, newLedger, equityOf, greenEdge, findCandidates, gate, tryEnter, commitEntry, applyExits, closeEarly, finishRound, logAdd, openRisk, dayKey, fmtP };
