/* state-builder.js — ledger (+ this round's candidate statuses) -> bot-state.json (docs/STATE-CONTRACT.md v1). Keys and numbers only. */
"use strict";
const B = require("./bot.js");

function build(L, cfg, now, sigRows) {
  const eq = B.equityOf(L), pos = (p) => { const pnl = p.qty * ((p.mark || p.entry) - p.entry) - p.entryFee; return { coin: p.sym, tf: p.tf, entry: p.entry, price: p.mark || p.entry, qty: p.qty, sl: p.sl, tp: p.tp, pnl, pnlPct: (pnl / (p.qty * p.entry)) * 100 }; };
  const eqPts = L.equity.length >= 2 ? L.equity : [[now - 6e4, L.startEquity], [now, eq]];
  const dayLimit = cfg.dayLossPct * L.day.startEquity;
  return {
    v: 1, updatedAt: now, mode: "paper", status: L.halted || L.kill || cfg.killSwitch ? "halted" : "running",
    start: L.startEquity, todayPnl: eq - L.day.startEquity, equity: eqPts,
    risk: { dayLoss: Math.max(0, -L.day.realized), dayLimit, positions: L.open.length, maxPositions: cfg.maxPositions, openRisk: B.openRisk(L, eq), openRiskLimit: cfg.openRiskLimit,
      drawdown: Math.max(0, (L.peak - eq) / L.peak), drawdownLimit: cfg.drawdownLimit, killSwitch: !!(L.halted || L.kill || cfg.killSwitch) },
    open: L.open.map(pos),
    closed: L.closed.slice(-cfg.maxClosedInState).map((x) => ({ t: x.t, coin: x.coin, tf: x.tf, r: x.r, pnl: x.pnl })),
    signals: (sigRows || []).slice(0, 12),
    log: L.log.slice(-cfg.maxLog)
  };
}
module.exports = { build };
