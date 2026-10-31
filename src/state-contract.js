/* state-contract.js — validates a bot-state.json object against docs/STATE-CONTRACT.md (v1).
   validate(obj) -> { ok, errors: [string] }. The bot calls it before publishing; a bad file is never sent. */
"use strict";
const LOG_KEYS = ["run", "cand", "open", "skip", "close"];
const num = (x) => typeof x === "number" && Number.isFinite(x);
const str = (x) => typeof x === "string" && x.length > 0 && x.length < 40;

function validate(s) {
  const e = [], need = (c, m) => { if (!c) e.push(m); };
  if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, errors: ["not an object"] };
  need(s.v === 1, "v must be 1");
  need(num(s.updatedAt) && s.updatedAt > 1e12, "updatedAt must be epoch ms");
  need(s.mode === "paper", 'mode must be "paper"');
  need(s.status === "running" || s.status === "halted", 'status must be "running" or "halted"');
  need(num(s.start), "start must be a number");
  need(num(s.todayPnl), "todayPnl must be a number");
  if (!Array.isArray(s.equity) || s.equity.length < 2) e.push("equity needs >= 2 points");
  else s.equity.forEach((p, i) => {
    need(Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]), "equity[" + i + "] must be [ms, number]");
    if (i && Array.isArray(p) && Array.isArray(s.equity[i - 1])) need(p[0] >= s.equity[i - 1][0], "equity[" + i + "] is older than the previous point (oldest first)");
  });
  const r = s.risk;
  if (!r || typeof r !== "object") e.push("risk missing");
  else {
    ["dayLoss", "dayLimit", "positions", "maxPositions", "openRisk", "openRiskLimit", "drawdown", "drawdownLimit"].forEach((k) => need(num(r[k]), "risk." + k + " must be a number"));
    need(typeof r.killSwitch === "boolean", "risk.killSwitch must be boolean");
  }
  const list = (name, fn) => { if (!Array.isArray(s[name])) e.push(name + " must be an array"); else s[name].forEach((x, i) => { if (!x || typeof x !== "object") e.push(name + "[" + i + "] must be an object"); else fn(x, name + "[" + i + "].", (c, m) => need(c, m)); }); };
  list("open", (x, p, n) => { n(str(x.coin), p + "coin"); n(str(x.tf), p + "tf"); ["entry", "price", "qty", "sl", "tp", "pnl", "pnlPct"].forEach((k) => n(num(x[k]), p + k + " must be a number")); n(num(x.qty) && x.qty > 0, p + "qty must be > 0"); });
  list("closed", (x, p, n) => { n(num(x.t), p + "t"); n(str(x.coin), p + "coin"); n(str(x.tf), p + "tf"); n(num(x.r), p + "r"); n(num(x.pnl), p + "pnl"); });
  list("signals", (x, p, n) => { n(str(x.coin), p + "coin"); n(str(x.tf), p + "tf"); n(str(x.rule), p + "rule"); n(x.val === "both" || x.val === "spread", p + 'val must be "both"|"spread"'); n(["wait", "watch", "skip"].includes(x.st), p + "st"); });
  list("log", (x, p, n) => { n(num(x.t), p + "t"); n(LOG_KEYS.includes(x.k), p + "k must be one of " + LOG_KEYS.join("/")); n(x.v && typeof x.v === "object", p + "v must be an object"); });
  if (r && num(r.positions) && Array.isArray(s.open)) need(r.positions === s.open.length, "risk.positions (" + r.positions + ") must equal open.length (" + s.open.length + ")");
  return { ok: !e.length, errors: e.slice(0, 20) };
}
module.exports = { validate };
