/* bot.js — rule bot + paper ledger. Virtual money, no leverage. Long (spot-like) and SIMULATED short (paper perpetual, 1x; funding cost modelled).
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
const dirOf = (p) => (p && p.side === -1 ? -1 : 1);
const equityOf = (L) => L.cash + L.open.reduce((a, p) => a + dirOf(p) * p.qty * (p.mark || p.entry), 0);
const fmtP = (p) => p.toFixed(p < 1 ? 5 : p < 100 ? 3 : 2);
const fmtR = (r) => (r >= 0 ? "+" : "") + r.toFixed(1) + "R";
const logAdd = (L, cfg, t, k, v) => { L.log.push({ t, k, v }); if (L.log.length > cfg.maxLog) L.log.splice(0, L.log.length - cfg.maxLog); };

/* ---- 1. who counts as "green" (assumption, see DATA-CONTRACT [KIỂM]): win rate beats the random-candle base rate by >= edge in BOTH
        periods (a = first 70 %, b = last 30 %), each judged on >= minN hits. Returns the weaker edge, or null. */
function greenEdge(val, tf, code, cfg, dir = 1) {
  try {
    const v = AR.validated(val, tf, code, cfg.cfg);
    if (!v || v.a.win == null || v.b.win == null || v.a.n < cfg.green.minN || v.b.n < cfg.green.minN) return null;
    const dn = dir === -1 ? "dn" : "up", ba = AR.baseRate(val, tf, "a", cfg.cfg, dn), bb = AR.baseRate(val, tf, "b", cfg.cfg, dn);
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
/* risk still at stake = distance to the CURRENT stop (0 once a stop sits at/over break-even) */
const openRisk = (L, equity) => L.open.reduce((a, p) => a + Math.max(0, dirOf(p) * (p.entry - p.sl)) * p.qty, 0) / equity;

/* ---- 4. try to open one position. market = {open (open of entry candle), bid, ask, asks}. -> {ok, pos} | {ok:false, reason, temp?} */
function tryEnter(L, cfg, cand, market, now, sizeMult = 1) {
  const eq = equityOf(L), g = gate(L, cfg, now, eq); if (g) return { ok: false, ...g };
  const dir = cand.side === -1 ? -1 : 1, BN = require("./binance.js");
  if (dir === -1 && !cfg.allowShort) return { ok: false, reason: "short-disabled" };
  if (L.open.some((p) => p.sym === cand.sym)) return { ok: false, reason: "already-open" };
  if ((L.cooldown[cand.sym] || 0) > now) return { ok: false, reason: "cooldown", temp: true };
  if (dir === -1) sizeMult *= (cfg.shortSizeMult || 0.5);
  const [sm, ratio] = cfg.cfg.split("-").map(Number), spread = (market.ask - market.bid) / market.bid;
  const info = { side: dir === 1 ? "long" : "short", spreadPct: spread * 100, chaseAtr: dir * ((dir === 1 ? market.ask : market.bid) - market.open) / cand.atr };
  if (spread > cfg.maxSpreadPct) return { ok: false, reason: "spread", spread: true, info };
  if (info.chaseAtr > cfg.maxChaseAtr) return { ok: false, reason: "chase", info };
  const stopDist = sm * cand.atr, rough = market.open * (1 + dir * spread / 2);
  if (stopDist / rough < cfg.minStopPct || stopDist / rough > cfg.maxStopPct) return { ok: false, reason: "stop-size", info };
  const riskAmt = eq * cfg.riskPct, perCoinLoss = stopDist + rough * cfg.feePct * 2;
  let qty = sizeMult * Math.min(riskAmt / perCoinLoss, (cfg.maxNotionalPct * eq) / rough, dir === 1 ? L.cash / (rough * (1 + cfg.feePct)) : Infinity);
  if (!(qty > 0)) return { ok: false, reason: "no-cash", temp: true };
  const book = dir === 1 ? market.asks : market.bids; if (!book) return { ok: false, reason: "depth", info };
  const avg = (dir === 1 ? BN.walkAsks : BN.walkBids)(book, qty * rough);
  if (avg == null) return { ok: false, reason: "depth", info };
  const slip = Math.abs(avg / book[0][0] - 1), entry = market.open * (1 + dir * spread / 2 + dir * slip);
  qty = Math.min(qty, sizeMult * riskAmt / (stopDist + entry * cfg.feePct * 2), dir === 1 ? L.cash / (entry * (1 + cfg.feePct)) : Infinity);
  const sl = entry - dir * stopDist, tp = entry + dir * ratio * stopDist, fee = qty * entry * cfg.feePct;
  const pos = { id: cand.key, sym: cand.sym, pair: cand.pair, tf: cand.tf, rule: cand.rule, side: dir, entryTime: cand.E, entry, qty, sl, tp, sl0: sl, risk0: stopDist, peak: entry, ext: 0,
    riskAmt: qty * (stopDist + entry * cfg.feePct * 2), entryFee: fee, expiry: cand.E + cfg.maxHoldCandles * TFMS[cand.tf], checkedUntil: cand.E, mark: entry, markAt: now };
  if (openRisk({ open: L.open.concat(pos) }, eq) > cfg.openRiskLimit + 1e-9) return { ok: false, reason: "open-risk", temp: true, info };
  info.slipPct = slip * 100; info.entry = entry; info.qty = qty; info.sl = sl; info.tp = tp; info.sizeMult = sizeMult;
  return { ok: true, pos, info };
}
function commitEntry(L, cfg, pos, now) {
  L.cash -= dirOf(pos) * pos.qty * pos.entry + pos.entryFee; L.open.push(pos); L.day.opened++;
  logAdd(L, cfg, now, "open", { coin: pos.sym, tf: pos.tf, price: fmtP(pos.entry), risk: (cfg.riskPct * 100).toFixed(0) + "%", side: dirOf(pos) === 1 ? "BUY" : "SELL" });
}

/* ---- 5. exits from 1-minute candles, in time order. A candle touching both stop and target counts as the stop.
        After maxHoldCandles the position leaves at the open of the next candle. getKlines(pair, from, to) -> {ok, data:[{t,o,h,l,c}]}
        TRADE MANAGEMENT (cfg.manage): once the open profit reaches breakevenAtR the stop moves to entry (+ fees); from trailAtR it trails the best price by trailDistR;
        when price gets close to the target while trailing, the target is extended (up to maxExtends times) and the hold time with it. The stop only ever tightens.
        All updates use a candle AFTER it was checked against the old levels (no same-candle look-ahead). */
function manageStep(p, k, cfg) {
  const m = cfg.manage; if (!m || !m.enabled || !(p.risk0 > 0)) return;
  const d = dirOf(p), best = d === 1 ? k.h : k.l; if (d * (best - p.peak) > 0) p.peak = best;
  const R = d * (p.peak - p.entry) / p.risk0, tight = (v) => { if (d * (v - p.sl) > 0) { p.sl = v; p.slMoved = true; } };
  if (R >= m.breakevenAtR) tight(p.entry * (1 + d * (m.breakevenOffsetPct != null ? m.breakevenOffsetPct : cfg.feePct * 2)));
  if (R >= m.trailAtR) {
    tight(p.peak - d * m.trailDistR * p.risk0); p.trailOn = true;
    if ((p.ext || 0) < m.maxExtends && d * (p.tp - p.peak) / p.risk0 < m.extendWhenWithinR) { p.tp += d * m.extendByR * p.risk0; p.ext = (p.ext || 0) + 1; p.expiry += m.extendHoldCandles * TFMS[p.tf]; }
  }
}
const exitFeeOf = (p, px, cfg, t) => px * p.qty * cfg.feePct + (p.side === -1 ? px * p.qty * (cfg.shortFundingPctPerDay || 0) * Math.max(0, t - p.entryTime) / DAY : 0);
function closeRow(L, cfg, p, px, t, why) {
  const d = dirOf(p), gross = d * p.qty * (px - p.entry), exitFee = exitFeeOf(p, px, cfg, t), pnl = gross - p.entryFee - exitFee;
  L.cash += d * p.qty * px - exitFee;
  const row = { t, coin: p.sym, tf: p.tf, rule: p.rule, side: d, r: pnl / p.riskAmt, pnl, why, entry: p.entry, exit: px, qty: p.qty, entryTime: p.entryTime, sl: p.sl, tp: p.tp, sl0: p.sl0, riskAmt: p.riskAmt, mfeR: p.risk0 ? d * (p.peak - p.entry) / p.risk0 : null, ai: p.ai || null };
  L.closed.push(row); L.day.realized += pnl; L.cooldown[p.sym] = t + cfg.cooldownCandles * TFMS[p.tf];
  logAdd(L, cfg, t, "close", { coin: p.sym, tf: p.tf, r: fmtR(row.r), why }); return row;
}
async function applyExits(L, cfg, getKlines, now) {
  const still = [];
  for (const p of L.open) {
    const d = dirOf(p), r = await getKlines(p.pair, p.checkedUntil, Math.min(now, p.expiry + 2 * MIN + (cfg.manage && cfg.manage.enabled ? (cfg.manage.maxExtends || 0) * (cfg.manage.extendHoldCandles || 0) * TFMS[p.tf] : 0)));
    if (!r.ok) { still.push(p); continue; }
    let done = null;
    for (const k of r.data) {
      if (k.t >= p.expiry) { done = { px: k.o * (1 - d * cfg.timeoutSlipPct), why: "time", t: k.t }; break; }
      if (d === 1 ? k.l <= p.sl : k.h >= p.sl) { done = { px: p.sl * (1 - d * cfg.stopSlipPct), why: p.slMoved ? (p.trailOn ? "trail" : "breakeven") : "stop", t: k.t + MIN }; break; }
      if (d === 1 ? k.h >= p.tp : k.l <= p.tp) { done = { px: p.tp, why: "target", t: k.t + MIN }; break; }
      manageStep(p, k, cfg);
    }
    if (r.data.length) { const last = r.data[r.data.length - 1]; p.checkedUntil = last.t + MIN; p.mark = last.c; p.markAt = last.t + MIN; }
    if (!done) { still.push(p); continue; }
    closeRow(L, cfg, p, done.px, done.t, done.why);
  }
  L.open = still;
}

/* ---- 5a. close one open position now (the AI asked to cut it early). `quote` = a number (the bid, kept for old callers) or {bid, ask}:
        a long sells at the bid, a short buys back at the ask. Only REDUCES risk; same fee/slip model as a stop. */
function closeEarly(L, cfg, sym, quote, now, why = "ai") {
  const p = L.open.find((x) => x.sym === sym); if (!p) return null;
  const d = dirOf(p), q = typeof quote === "number" ? quote : (d === 1 ? quote && quote.bid : quote && quote.ask); if (!(q > 0)) return null;
  L.open = L.open.filter((x) => x !== p);
  return closeRow(L, cfg, p, q * (1 - d * cfg.timeoutSlipPct), now, why);
}

/* ---- 5c. the AI (or a rule) asks to move the stop and/or target of an open position. Governor: a stop may only TIGHTEN (never loosen) and must stay on the
        safe side of the current price; a target may only be pushed FURTHER and only while the position is already >= +1R with the stop at/over break-even. */
function adjustPosition(L, cfg, sym, ask, now) {
  const p = L.open.find((x) => x.sym === sym); if (!p) return { ok: false, reason: "no-position" };
  const d = dirOf(p), mark = p.mark || p.entry, out = {};
  if (ask.stop != null) {
    const v = Number(ask.stop); if (!(v > 0)) return { ok: false, reason: "bad-stop" };
    if (!(d * (v - p.sl) > 0)) return { ok: false, reason: "stop-not-tighter" };
    if (!(d * (mark - v) > mark * 0.001)) return { ok: false, reason: "stop-too-close" };
    out.stop = [p.sl, v]; p.sl = v; p.slMoved = true; p.aiMoved = true;
  }
  if (ask.target != null) {
    const v = Number(ask.target); if (!(v > 0)) return { ok: false, reason: "bad-target" };
    const R = p.risk0 ? d * (mark - p.entry) / p.risk0 : 0;
    if (!(d * (v - p.tp) > 0)) return { ok: false, reason: "target-not-further" };
    if (!(R >= 1) || !(d * (p.sl - p.entry) >= -1e-9)) return { ok: false, reason: "target-needs-profit-and-breakeven" };
    if (d * (v - p.entry) / p.risk0 > 8) return { ok: false, reason: "target-too-far" };
    out.target = [p.tp, v]; p.tp = v; p.aiMoved = true; p.expiry += (cfg.manage && cfg.manage.extendHoldCandles || 0) * TFMS[p.tf];
  }
  if (!out.stop && !out.target) return { ok: false, reason: "nothing-to-change" };
  return { ok: true, changes: out };
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

module.exports = { rollDay, updateCodeGuard, entryCandle, explainCode, newLedger, equityOf, greenEdge, findCandidates, gate, tryEnter, commitEntry, applyExits, closeEarly, adjustPosition, dirOf, finishRound, logAdd, openRisk, dayKey, fmtP };
