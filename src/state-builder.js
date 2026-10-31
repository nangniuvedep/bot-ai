/* state-builder.js — ledger (+ this round's candidate statuses) -> bot-state.json (docs/STATE-CONTRACT.md v1, optional fields added in V6). Keys and numbers only,
   plus short AI reasons (the page escapes every value). */
"use strict";
const B = require("./bot.js");
const cl = (s, n) => (s ? String(s).slice(0, n) : undefined);

function build(L, cfg, now, sigRows) {
  const eq = B.equityOf(L), [sm, ratio] = cfg.cfg.split("-").map(Number);
  const pos = (p) => {
    const mark = p.mark || p.entry, pnl = p.qty * (mark - p.entry) - p.entryFee, a = p.ai || {};
    return { coin: p.sym, tf: p.tf, entry: p.entry, price: mark, qty: p.qty, sl: p.sl, tp: p.tp, pnl, pnlPct: (pnl / (p.qty * p.entry)) * 100,
      side: "BUY", market: "spot", leverage: 1, status: "open", entryTime: p.entryTime, expiry: p.expiry, notional: p.qty * p.entry, riskAmt: p.riskAmt,
      slPct: (p.sl / p.entry - 1) * 100, tpPct: (p.tp / p.entry - 1) * 100, pnlR: p.riskAmt ? pnl / p.riskAmt : 0, rule: p.rule, by: p.by || "rules",
      aiWhy: cl(a.why, 200), aiConf: a.conf != null ? a.conf : undefined, aiConv: a.conv, aiModel: a.model ? cl(a.provider + "/" + a.model, 60) : undefined };
  };
  const closed = (x) => ({ t: x.t, coin: x.coin, tf: x.tf, r: x.r, pnl: x.pnl, side: "BUY", leverage: 1, entry: x.entry, exit: x.exit, qty: x.qty, entryTime: x.entryTime, why: x.why, rule: x.rule, sl: x.sl, tp: x.tp,
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
    rules: { market: "spot", side: "long", leverage: 1, stopAtr: sm, targetAtr: ratio, maxHoldCandles: cfg.maxHoldCandles, riskPct: cfg.riskPct, maxNotionalPct: cfg.maxNotionalPct, maxPositions: cfg.maxPositions,
      dayLossPct: cfg.dayLossPct, drawdownLimit: cfg.drawdownLimit, feePct: cfg.feePct, maxTradesPerDay: cfg.maxTradesPerDay, maxNewPerRound: cfg.maxNewPerRound, tfs: cfg.tfs, decider: cfg.ai.mode === "decide" ? "ai" : "rules" },
    ai: cfg.ai.mode === "decide" ? { mode: "decide", providers: (cfg.ai.providers || []).map((p) => cl(p.type + "/" + p.model, 60)), last: ai ? { t: ai.t, ok: ai.ok, provider: ai.provider, model: cl(ai.model, 60), ms: ai.ms, view: cl(ai.view, 200), noTrade: cl(ai.noTrade, 200), why: cl(ai.why, 160), candidates: ai.candidates, picked: ai.picked, calls: ai.calls } : null } : { mode: cfg.ai.mode },
    decisions: (L.recent || []).slice(-40)
  };
}
module.exports = { build };
