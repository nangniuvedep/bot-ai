/* sample-state.js — demo data in the exact shape of the real state file (docs/STATE-CONTRACT.md). */
(function () {
  "use strict";
  var B = (window.BOTAI = window.BOTAI || {}), now = Date.now(), H = 36e5, M = 6e4, r = 7;
  function rnd() { r = (r * 9301 + 49297) % 233280; return r / 233280; }
  var eq = [], v = 10000, i, raw = [];
  for (i = 0; i < 120; i++) { v += (rnd() - 0.46) * 55 + (i > 70 ? 6 : 0); raw.push(v); }
  var off = 10631.32 - raw[119];
  for (i = 0; i < 120; i++) eq.push([now - (119 - i) * 6 * H, +(raw[i] + off).toFixed(2)]);
  var closed = [], names = ["SOL", "AVAX", "NEAR", "DOGE", "LINK", "INJ"], j, w, R;
  for (j = 0; j < 34; j++) {
    w = rnd() < 0.324; R = w ? 1.5 : -1;
    closed.push({ t: now - Math.floor(j / 2) * 24 * H - 5 * H, coin: names[j % 6], tf: j % 3 ? "1H" : "4H", r: R, pnl: +(R * 100 * (0.8 + rnd() * 0.4)).toFixed(2) });
  }
  B.sample = {
    v: 1, updatedAt: now - 2 * M, mode: "paper", status: "running", start: 10000, todayPnl: 305.13, equity: eq,
    risk: { dayLoss: 0, dayLimit: 300, positions: 3, maxPositions: 5, openRisk: 0.03, openRiskLimit: 0.05, drawdown: 0.006, drawdownLimit: 0.1, killSwitch: false },
    open: [
      { coin: "SOL", tf: "1H", entry: 167.496, price: 169.506, qty: 42.64, sl: 163.2, tp: 175.5, pnl: 85.71, pnlPct: 1.2 },
      { coin: "LINK", tf: "4H", entry: 14.8, price: 14.667, qty: 241.7, sl: 14.2, tp: 16.1, pnl: -32.14, pnlPct: -0.9 },
      { coin: "INJ", tf: "1H", entry: 22.668, price: 23.144, qty: 232.2, sl: 22.0, tp: 24.0, pnl: 110.53, pnlPct: 2.1 }],
    closed: closed,
    signals: [
      { coin: "NEAR", tf: "1H", rule: "V8-05", val: "both", st: "wait" },
      { coin: "AVAX", tf: "4H", rule: "V8-02", val: "both", st: "watch" },
      { coin: "DOGE", tf: "1H", rule: "V8-01", val: "spread", st: "skip" }],
    log: [
      { t: now - 22 * M, k: "run", v: { a: 6, b: 1, c: 2 } },
      { t: now - 38 * M, k: "cand", v: { coin: "NEAR", tf: "1H", rule: "V8-05" } },
      { t: now - 82 * M, k: "open", v: { coin: "INJ", tf: "1H", price: "22.600", risk: "1%" } },
      { t: now - 3 * H, k: "skip", v: { coin: "DOGE" } },
      { t: now - 3 * H - 2 * M, k: "open", v: { coin: "SOL", tf: "1H", price: "168.000", risk: "1%" } },
      { t: now - 7 * H, k: "close", v: { coin: "AVAX", tf: "4H", r: "+1.5R", why: "target" } },
      { t: now - 9 * H, k: "close", v: { coin: "NEAR", tf: "1H", r: "-1.1R", why: "stop" } },
      { t: now - 11 * H, k: "close", v: { coin: "DOGE", tf: "4H", r: "+0.2R", why: "time" } }]
  };
  /* V6 fields (all optional in the contract) */
  B.sample.open.forEach(function (x, k) {
    x.side = "BUY"; x.market = "spot"; x.leverage = 1; x.status = "open"; x.entryTime = now - (k + 1) * 47 * M; x.expiry = x.entryTime + 10 * (x.tf === "4H" ? 4 : 1) * H; x.notional = x.qty * x.entry; x.riskAmt = 100;
    x.slPct = (x.sl / x.entry - 1) * 100; x.tpPct = (x.tp / x.entry - 1) * 100; x.pnlR = x.pnl / 100; x.rule = "V8-" + (11 + k * 7); x.by = "ai"; x.aiConf = 0.6 + k * 0.05; x.aiConv = k % 2 + 1; x.aiModel = "gemini/gemini-2.5-flash";
    x.aiWhy = ["Green rule with +4.1 pt edge, BTC trend up, 6% room to resistance.", "Trend and ADX agree, volume 1.8x average.", "Strong edge on 1H, no overlap with open positions."][k % 3];
  });
  B.sample.closed.forEach(function (x, k) { x.side = "BUY"; x.leverage = 1; x.why = x.r > 0 ? "target" : k % 5 === 0 ? "time" : k % 7 === 0 ? "ai" : "stop"; x.entry = 100; x.exit = x.r > 0 ? 102 : 99; x.sl = 99; x.tp = 102; x.entryTime = x.t - (x.tf === "4H" ? 9 : 3) * H; x.by = "ai"; x.rule = "V8-11"; if (x.why === "ai") x.aiWhy = "Trend flipped against the position, cutting early."; });
  B.sample.rules = { market: "spot", side: "long", leverage: 1, stopAtr: 1, targetAtr: 2, maxHoldCandles: 10, riskPct: 0.01, maxNotionalPct: 0.25, maxPositions: 5, dayLossPct: 0.03, drawdownLimit: 0.1, feePct: 0.001, maxTradesPerDay: 6, maxNewPerRound: 2, tfs: ["1H", "4H"], decider: "ai" };
  B.sample.ai = { mode: "decide", providers: ["gemini/gemini-2.5-flash", "workers-ai/@cf/openai/gpt-oss-120b"], last: { t: now - 3 * M, ok: true, provider: "gemini", model: "gemini-2.5-flash", ms: 2100, view: "BTC range-bound, alts mixed: be selective.", noTrade: null, candidates: 6, picked: 1, calls: 12 } };
  B.sample.decisions = [
    { t: now - 3 * M, action: "ai-view", reason: "BTC range-bound, alts mixed: be selective.", provider: "gemini", model: "gemini-2.5-flash" },
    { t: now - 3 * M, coin: "SOL", tf: "1H", rule: "V8-11", action: "open", reason: "ai", why: "Green rule with +4.1 pt edge, BTC trend up.", conf: 0.7, conv: 2, provider: "gemini" },
    { t: now - 3 * M, coin: "DOGE", tf: "1H", rule: "V8-09", action: "skip", reason: "ai-skip", why: "Rule not green; resistance only 1.2 ATR away.", provider: "gemini" },
    { t: now - 18 * M, coin: "AVAX", tf: "4H", rule: "V8-21", action: "skip", reason: "day-trades", why: "AI wanted it, daily limit reached.", conf: 0.55, provider: "gemini" },
    { t: now - 33 * M, action: "wait", reason: "ai-unavailable", why: "gemini HTTP 429 | workers-ai paused" }
  ];
})();
