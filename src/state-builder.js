/* state-builder.js — ledger (+ this round's candidate statuses) -> bot-state.json (docs/STATE-CONTRACT.md v1, optional fields added in V6). Keys and numbers only,
   plus short AI reasons (the page escapes every value). */
"use strict";
const B = require("./bot.js");
const cl = (s, n) => (s ? String(s).slice(0, n) : undefined);

/* performance summary of closed trades (+ equity curve): the numbers a trader checks first. Pure function of the ledger. */
function stats(L) {
  const c = L.closed, n = c.length, wins = c.filter((x) => x.r > 0), loss = c.filter((x) => x.r <= 0), sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const grossW = sum(wins, (x) => x.pnl), grossL = -sum(loss, (x) => x.pnl), pf = grossL > 0 ? grossW / grossL : null;
  let peak = -Infinity, mdd = 0; for (const [, v] of L.equity) { if (v > peak) peak = v; if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak); }
  const grp = (key) => { const m = {}; for (const x of c) { const k = key(x); if (k == null) continue; (m[k] = m[k] || []).push(x); } return m; };
  const sm = (a) => ({ n: a.length, win: a.length ? a.filter((x) => x.r > 0).length / a.length : 0, expR: a.length ? sum(a, (x) => x.r) / a.length : 0, pnl: sum(a, (x) => x.pnl) });
  const sideOf = (x) => (x.side === -1 ? "short" : "long");
  let streak = 0, best = 0, worst = 0; for (const x of c) { if (x.r > 0) { streak = streak > 0 ? streak + 1 : 1; best = Math.max(best, streak); } else { streak = streak < 0 ? streak - 1 : -1; worst = Math.min(worst, streak); } }
  const mfe = c.filter((x) => typeof x.mfeR === "number");
  return { n, win: n ? wins.length / n : 0, expR: n ? sum(c, (x) => x.r) / n : 0, avgWinR: wins.length ? sum(wins, (x) => x.r) / wins.length : 0, avgLossR: loss.length ? sum(loss, (x) => x.r) / loss.length : 0,
    profitFactor: pf, maxDrawdown: mdd, avgHoldMin: n ? sum(c.filter((x) => x.entryTime), (x) => (x.t - x.entryTime) / 6e4) / Math.max(1, c.filter((x) => x.entryTime).length) : 0,
    bestStreak: best, worstStreak: -worst, avgMfeR: mfe.length ? sum(mfe, (x) => x.mfeR) / mfe.length : null,
    bySide: Object.fromEntries(Object.entries(grp(sideOf)).map(([k, a]) => [k, sm(a)])),
    byWhy: Object.fromEntries(Object.entries(grp((x) => x.why)).map(([k, a]) => [k, sm(a)])),
    byRule: Object.fromEntries(Object.entries(grp((x) => x.rule)).sort((a, b) => b[1].length - a[1].length).slice(0, 10).map(([k, a]) => [String(k).slice(0, 39), sm(a)])) };
}

function build(L, cfg, now, sigRows) {
  const eq = B.equityOf(L), [sm, ratio] = cfg.cfg.split("-").map(Number);
  const pos = (p) => {
    const d = B.dirOf(p), mark = p.mark || p.entry, pnl = d * p.qty * (mark - p.entry) - p.entryFee, a = p.ai || {};
    return { coin: p.sym, tf: p.tf, entry: p.entry, price: mark, qty: p.qty, sl: p.sl, tp: p.tp, pnl, pnlPct: (pnl / (p.qty * p.entry)) * 100,
      side: d === 1 ? "BUY" : "SELL", market: d === 1 ? "spot" : "paper-short", leverage: 1, status: "open", sl0: p.sl0, managed: !!p.slMoved, peakR: p.risk0 ? d * ((p.peak || p.entry) - p.entry) / p.risk0 : undefined, entryTime: p.entryTime, expiry: p.expiry, notional: p.qty * p.entry, riskAmt: p.riskAmt,
      slPct: (p.sl / p.entry - 1) * 100, tpPct: (p.tp / p.entry - 1) * 100, pnlR: p.riskAmt ? pnl / p.riskAmt : 0, rule: p.rule, by: p.by || "rules",
      aiWhy: cl(a.manageWhy ? a.why + " · manage: " + a.manageWhy : a.why, 200), aiConf: a.conf != null ? a.conf : undefined, aiConv: a.conv, aiModel: a.model ? cl(a.provider + "/" + a.model, 60) : undefined };
  };
  const closed = (x) => ({ t: x.t, coin: x.coin, tf: x.tf, r: x.r, pnl: x.pnl, side: x.side === -1 ? "SELL" : "BUY", leverage: 1, mfeR: typeof x.mfeR === "number" ? x.mfeR : undefined, sl0: x.sl0, entry: x.entry, exit: x.exit, qty: x.qty, entryTime: x.entryTime, why: x.why, rule: x.rule, sl: x.sl, tp: x.tp,
    riskAmt: x.riskAmt, by: x.ai ? "ai" : "rules", aiWhy: cl(x.ai && (x.ai.closeWhy || x.ai.why), 200) });
  const eqPts = L.equity.length >= 2 ? L.equity : [[now - 6e4, L.startEquity], [now, eq]];
  const dayLimit = cfg.dayLossPct * L.day.startEquity, ai = L.aiInfo;
  return {
    v: 1, updatedAt: now, mode: "paper", status: L.halted || L.kill || cfg.killSwitch ? "halted" : "running",
    start: L.startEquity, todayPnl: eq - L.day.startEquity, equity: eqPts,
    risk: { dayLoss: Math.max(0, -L.day.realized), dayLimit, positions: L.open.length, maxPositions: cfg.maxPositions, openRisk: B.openRisk(L, eq), openRiskLimit: cfg.openRiskLimit,
      drawdown: Math.max(0, (L.peak - eq) / L.peak), drawdownLimit: cfg.drawdownLimit, killSwitch: !!(L.halted || L.kill || cfg.killSwitch) },
    open: L.open.map(pos),
    closed: L.closed.slice(-cfg.maxClosedInState).map(closed),
    signals: (sigRows || []).slice(0, 12),
    log: L.log.slice(-cfg.maxLog),
    rules: { market: cfg.allowShort ? "spot + paper short" : "spot", side: cfg.allowShort ? "long-short" : "long", leverage: 1, manage: cfg.manage && cfg.manage.enabled ? { breakevenAtR: cfg.manage.breakevenAtR, trailAtR: cfg.manage.trailAtR, trailDistR: cfg.manage.trailDistR, maxExtends: cfg.manage.maxExtends } : null, shortSizeMult: cfg.allowShort ? cfg.shortSizeMult : undefined, stopAtr: sm, targetAtr: ratio, maxHoldCandles: cfg.maxHoldCandles, riskPct: cfg.riskPct, maxNotionalPct: cfg.maxNotionalPct, maxPositions: cfg.maxPositions,
      dayLossPct: cfg.dayLossPct, drawdownLimit: cfg.drawdownLimit, feePct: cfg.feePct, maxTradesPerDay: cfg.maxTradesPerDay, maxNewPerRound: cfg.maxNewPerRound, tfs: cfg.tfs, decider: cfg.ai.mode === "decide" ? "ai" : "rules" },
    ai: cfg.ai.mode === "decide" ? { mode: "decide", providers: (cfg.ai.providers || []).map((p) => cl(p.type + "/" + p.model, 60)), last: ai ? { t: ai.t, ok: ai.ok, provider: ai.provider, model: cl(ai.model, 60), ms: ai.ms, view: cl(ai.view, 200), noTrade: cl(ai.noTrade, 200), why: cl(ai.why, 160), candidates: ai.candidates, picked: ai.picked, calls: ai.calls } : null } : { mode: cfg.ai.mode },
    stats: stats(L),
    decisions: (L.recent || []).slice(-40)
  };
}
module.exports = { build, stats };
