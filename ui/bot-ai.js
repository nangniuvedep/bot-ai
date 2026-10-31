/* bot-ai.js — Bot AI page. Read-only: it only fetches the bot's state file and draws it. It never writes anything,
   never touches the app's storage keys, and exposes one global (window.BOTAI). */
(function () {
  "use strict";
  var B = (window.BOTAI = window.BOTAI || {}), CFG = B.config || {};
  if (!window.__t) window.__t = function (s, v) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return v && v[k] != null ? v[k] : ""; }); };
  var $ = function (i) { return document.getElementById(i); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var LOC = (window.BLI18N && window.BLI18N.locale) || undefined; /* reader's language; time zone = reader's own */
  var f = function (n, d) { d = d == null ? 2 : d; return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var sg = function (n, d) { return (n >= 0 ? "+" : "-") + "$" + f(Math.abs(n), d); };
  var pc = function (n, d) { return f(n * 100, d == null ? 1 : d) + "%"; };
  var tm = function (t) { return new Date(t).toLocaleTimeString(LOC, { hour: "2-digit", minute: "2-digit" }); };
  var dt = function (t) { return new Date(t).toLocaleDateString(LOC, { month: "short", day: "numeric" }); };
  function ic(k, c) { return '<svg class="bi ' + (c || "") + '" aria-hidden="true"><use href="#i-' + k + '"/></svg>'; }

  /* ---- state ---- */
  var S = null, mode = "loading", rg = "30D", timer = null;
  function valid(s) {
    return s && typeof s === "object" && (CFG.supportedStateVersions || [1]).indexOf(s.v) >= 0 && Array.isArray(s.equity) && s.equity.length > 1 &&
      Array.isArray(s.open) && Array.isArray(s.closed) && Array.isArray(s.signals) && Array.isArray(s.log) && s.risk && typeof s.start === "number";
  }
  function load() {
    if (!CFG.stateUrl) { S = B.sample; mode = valid(S) ? "sample" : "error"; return Promise.resolve(); }
    var ac = window.AbortController ? new AbortController() : null, to = ac && setTimeout(function () { ac.abort(); }, CFG.timeoutMs || 15000);
    return fetch(CFG.stateUrl + (CFG.stateUrl.indexOf("?") < 0 ? "?" : "&") + "_=" + Date.now(), { cache: "no-store", signal: ac ? ac.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .then(function (s) {
        if (!valid(s)) { mode = "version"; return; }
        S = s; mode = Date.now() - s.updatedAt > (CFG.staleAfterMin || 45) * 6e4 ? "stale" : "live";
      })
      .catch(function () { if (!S) mode = "error"; else mode = "stale"; })
      .then(function () { if (to) clearTimeout(to); });
  }

  /* ---- live prices (optional): refresh price / P&L of open positions from the app's own public price file ---- */
  var PX = null; /* { SOL: price, ... } or null */
  function loadPrices() {
    PX = null;
    if (!CFG.priceUrl || (mode !== "live" && mode !== "stale")) return Promise.resolve();
    var ac = window.AbortController ? new AbortController() : null, to = ac && setTimeout(function () { ac.abort(); }, CFG.timeoutMs || 15000);
    return fetch(CFG.priceUrl, { signal: ac ? ac.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .then(function (j) {
        if (!j || !Array.isArray(j.data) || (j.timestamp && Date.now() - j.timestamp > (CFG.priceMaxAgeMin || 15) * 6e4)) return;
        var best = {}, m = {};
        j.data.forEach(function (c) { /* several coins may share a ticker: keep the best-ranked one */
          if (!c || typeof c.symbol !== "string" || !(c.current_price > 0)) return;
          var k = c.symbol.toUpperCase(), rk = c.market_cap_rank > 0 ? c.market_cap_rank : 1e9;
          if (best[k] == null || rk < best[k]) { best[k] = rk; m[k] = c.current_price; }
        });
        PX = m;
      })
      .catch(function () { PX = null; }) /* any problem -> the state file's own price is used */
      .then(function () { if (to) clearTimeout(to); });
  }
  function pos(x) { /* current price + open P/L of one position (live when possible) */
    var lp = PX && PX[String(x.coin).toUpperCase()];
    if (lp && x.qty > 0) return { price: lp, pnl: (lp - x.entry) * x.qty, pct: (lp / x.entry - 1) * 100 };
    return { price: x.price, pnl: x.pnl, pct: x.pnlPct };
  }

  /* ---- derived numbers (computed from the state, never typed in) ---- */
  function calc() {
    var e = S.equity, eq = e[e.length - 1][1], cl = S.closed, w = cl.filter(function (x) { return x.r > 0; }), gp = 0, gl = 0, sr = 0;
    cl.forEach(function (x) { sr += x.r; if (x.pnl > 0) gp += x.pnl; else gl -= x.pnl; });
    return { eq: eq, total: eq - S.start, openPnl: S.open.reduce(function (a, x) { return a + pos(x).pnl; }, 0), n: cl.length,
      win: cl.length ? w.length / cl.length : 0, exp: cl.length ? sr / cl.length : 0, pf: gl ? gp / gl : null };
  }

  /* ---- pieces ---- */
  var LOGT = { /* English templates; the bot sends only a key + values (never sentences) */
    run: ["check", "Run complete · candidates {a} · waiting {b} · watching {c}"],
    cand: ["signal", "Candidate <b>{coin}</b> {tf} · {rule} passed both stages"],
    open: ["portfolio", "Opened {side} <b>{coin}</b> {tf} at {price} · no leverage · risk {risk} equity"],
    skip: ["warning", "Skipped <b>{coin}</b>: spread above configured limit"],
    close: ["check", "Closed <b>{coin}</b> {tf} at target · {r}"]
  };
  var CLOSET = { stop: "Closed <b>{coin}</b> {tf} at stop · {r}", time: "Closed <b>{coin}</b> {tf} after max hold time · {r}", ai: "Closed <b>{coin}</b> {tf} early by AI · {r}", breakeven: "Closed <b>{coin}</b> {tf} at break-even stop · {r}", trail: "Closed <b>{coin}</b> {tf} by trailing stop · {r}" };
  var VAL = { both: "Both stages green", spread: "Spread too wide" }, ST = { wait: "Waiting", watch: "Order open", skip: "Not entered" };
  function hue(s) { var h = 0, i; for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function coin(c) { return '<span class="co"><i class="cc" style="background:hsl(' + hue(c) + ',55%,48%)">' + esc(c.slice(0, 3)) + "</i>" + esc(c) + "</span>"; }
  function kpi(l, i, v, s, c) { return '<div class="card kp"><div class="kl">' + ic(i, "b14") + __t(l) + '</div><div class="kv ' + (c || "") + '">' + v + '</div><div class="ks">' + s + "</div></div>"; }
  function card(t, i, n, b, x, head) { return '<div class="card' + (x || "") + '"><div class="ch">' + ic(i, "b14") + __t(t) + (head || "") + (n != null ? '<span class="n">' + n + "</span>" : "") + "</div>" + b + "</div>"; }
  function seg() { return '<div class="seg">' + ["7D", "30D", "All"].map(function (x) { return '<button data-r="' + x + '"' + (x === rg ? ' class="on"' : "") + ">" + __t(x) + "</button>"; }).join("") + "</div>"; }
  function chart() {
    var span = { "7D": 7, "30D": 30 }[rg], now = S.equity[S.equity.length - 1][0], d = S.equity.filter(function (p) { return !span || p[0] >= now - span * 864e5; });
    if (d.length < 2) d = S.equity.slice(-2);
    var vs = d.map(function (p) { return p[1]; }), mn = Math.min.apply(0, vs), mx = Math.max.apply(0, vs), W = 700, H = 230, pl = 10, pr = 56, pt = 10, pb = 22, g = "", k;
    var X = function (i) { return pl + i / (d.length - 1) * (W - pl - pr); }, Y = function (v) { return pt + (1 - (v - mn) / (mx - mn || 1)) * (H - pt - pb); };
    var p = vs.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
    for (k = 0; k < 4; k++) { var v = mn + (mx - mn) * k / 3, y = Y(v); g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="var(--bd)"/><text x="' + (W - pr + 8) + '" y="' + (y + 3) + '" fill="var(--tx3)" font-size="9" font-family="JetBrains Mono">' + f(v, 0) + "</text>"; }
    if (S.start > mn && S.start < mx) g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(S.start) + '" y2="' + Y(S.start) + '" stroke="var(--tx3)" stroke-dasharray="3 3"/>';
    return '<div id="chart"><svg class="ch-svg" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img"><defs><linearGradient id="gr" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#00d17a" stop-opacity=".35"/><stop offset="1" stop-color="#00d17a" stop-opacity="0"/></linearGradient></defs>' + g +
      '<path d="' + p + " L" + X(d.length - 1) + " " + (H - pb) + " L" + pl + " " + (H - pb) + 'Z" fill="url(#gr)"/><path d="' + p + '" fill="none" stroke="#00d17a" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg></div>';
  }
  function risk() {
    var R = S.risk, col = function (r) { return r >= 0.9 ? "var(--rd)" : r >= 0.5 ? "var(--yw)" : "var(--ac)"; };
    function row(i, l, v, r) { r = Math.max(0, Math.min(1, r || 0)); return '<div class="rk"><div class="rr"><span>' + ic(i, "b14") + __t(l) + "</span><b>" + v + '</b></div><div class="bar"><i style="width:' + r * 100 + "%;background:" + col(r) + '"></i></div></div>'; }
    return row("warning", "Daily loss", "$" + f(R.dayLoss) + " / $" + f(R.dayLimit), R.dayLoss / R.dayLimit) +
      row("portfolio", "Positions", R.positions + " / " + R.maxPositions, R.positions / R.maxPositions) +
      row("gauge", "Open risk", __t("{pct} equity", { pct: pc(R.openRisk) }), R.openRisk / R.openRiskLimit) +
      row("chart-area", "Drawdown from peak", pc(R.drawdown), R.drawdown / R.drawdownLimit) +
      '<div class="rk"><div class="rr"><span>' + ic("lock", "b14") + __t("Kill switch") + "</span><b>" + __t(R.killSwitch ? "On" : "Off") + "</b></div></div>";
  }
  /* ---- order detail helpers (all optional fields: an older bot file without them still draws, with "—") ---- */
  var dtm = function (t) { return dt(t) + " " + tm(t); };
  function dur(ms) { var m = Math.max(0, Math.round(ms / 6e4)), h = Math.floor(m / 60), d = Math.floor(h / 24); return d ? d + "d " + (h % 24) + "h" : h ? h + "h " + (m % 60) + "m" : m + "m"; }
  function pill(c, t) { return '<span class="pill ' + c + '">' + __t(t) + "</span>"; }
  var WHY = { target: ["up", "Take-profit hit"], stop: ["dn", "Stop-loss hit"], breakeven: ["nt", "Break-even stop"], trail: ["up", "Trailing stop"], time: ["nt", "Max hold time"], ai: ["ac", "Closed by AI"] };
  var ACT = { open: ["up", "Order opened"], skip: ["dn", "Not entered"], wait: ["nt", "Waiting"], close: ["ac", "Closed by AI"], "ai-view": ["ac", "AI market view"], manage: ["ac", "Stop/target moved"], "manage-refused": ["nt", "Change refused"] };
  var RSN = { "day-trades": "Daily trade limit reached", "day-loss": "Daily loss limit reached", "max-positions": "Max positions reached", spread: "Spread too wide", chase: "Price already ran too far", "stop-size": "Stop distance out of range",
    depth: "Order book too thin", "open-risk": "Total open risk too high", cooldown: "Cooling down after a recent trade", "no-cash": "Not enough cash", halted: "Bot halted (drawdown)", kill: "Kill switch on", "round-limit": "Max new orders this round",
    "ai-skip": "AI chose not to enter", "ai-unavailable": "AI unavailable, will retry", "ai-invalid": "AI answer unusable, will retry", "ai-budget": "AI daily call budget used", "no-book": "No order book data", ai: "AI opened a position", "short-disabled": "Short selling is off", "stop-not-tighter": "Stop can only be tightened", "stop-too-close": "Stop too close to price", "target-not-further": "Target can only be pushed further", "target-needs-profit-and-breakeven": "Target needs +1R and a break-even stop", "target-too-far": "Target too far", "nothing-to-change": "Nothing to change", "already-open": "Already holding this coin" };
  function by(x) { return x.by === "ai" ? pill("ac", "AI") : pill("nt", "Rules"); }
  function who(x) { return x.aiWhy ? '<div class="why">' + esc(x.aiWhy) + (x.aiModel ? " <small>· " + esc(x.aiModel) + (x.aiConf != null ? " · " + Math.round(x.aiConf * 100) + "%" : "") + "</small>" : "") + "</div>" : ""; }
  function ordr(x) { var sh = x.side === "SELL"; return '<span class="pill ' + (sh ? "dn" : "up") + '">' + __t(sh ? "SELL (short)" : "BUY") + '</span> <small class="mu">' + __t(sh ? "Paper short" : "Spot") + " · " + __t("No leverage") + " (1x)</small>"; }
  function pctS(v) { return v == null || !isFinite(v) ? "" : ' <small class="mu">(' + (v >= 0 ? "+" : "") + f(v) + "%)</small>"; }
  function openT() {
    if (!S.open.length) return '<div class="empty">' + __t("No open positions") + "</div>";
    var H = ["Coin", "Order", "Opened", "Entry", "Stop-loss", "Take-profit", "Current", "Open P/L", "Size · risk", "Decided by"];
    return "<table><thead><tr><th>" + H.map(function (x) { return __t(x); }).join("</th><th>") + "</th></tr></thead><tbody>" + S.open.map(function (x) {
      var q = pos(x), rngW = x.tp - x.sl || 1, pp = Math.max(0, Math.min(1, (q.price - x.sl) / rngW)), et = Math.max(0, Math.min(1, (x.entry - x.sl) / rngW)), c = q.pnl >= 0 ? "up" : "dn",
        slp = x.slPct != null ? x.slPct : (x.sl / x.entry - 1) * 100, tpp = x.tpPct != null ? x.tpPct : (x.tp / x.entry - 1) * 100,
        opened = x.entryTime ? dtm(x.entryTime) + '<br><small class="mu">' + __t("{d} ago", { d: dur(Date.now() - x.entryTime) }) + (x.expiry ? " · " + __t("exit by {t}", { t: tm(x.expiry) }) : "") + "</small>" : "—",
        sz = x.notional != null ? "$" + f(x.notional, 0) + '<br><small class="mu">' + __t("risk {v}", { v: "$" + f(x.riskAmt || 0, 0) }) + "</small>" : "—";
      return "<tr><td>" + coin(x.coin) + ' <span class="tf">' + esc(x.tf) + "</span></td><td>" + ordr(x) + "</td><td>" + opened + "</td><td>" + f(x.entry, 3) + '</td><td class="dn">' + f(x.sl, 3) + pctS(slp) + (x.managed && x.sl0 != null ? '<br><small class="mu">' + __t("moved from {v}", { v: f(x.sl0, 3) }) + "</small>" : "") + '</td><td class="up">' + f(x.tp, 3) + pctS(tpp) +
        '</td><td>' + f(q.price, 3) + '</td><td class="' + c + '">' + sg(q.pnl) + pctS(q.pct) + "</td><td>" + sz + "</td><td>" + by(x) + "</td></tr>" +
        (x.aiWhy || x.rule ? '<tr class="dr"><td colspan="10">' + (x.rule ? '<small class="mu">' + __t("Signal") + ": " + esc(x.rule) + "</small> " : "") + who(x) + "</td></tr>" : "");
    }).join("") + "</tbody></table>";
  }
  function histT() {
    if (!S.closed.length) return '<div class="empty">' + __t("No closed trades yet") + "</div>";
    var H = ["Closed", "Coin", "Order", "Entry → Exit", "Stop-loss · Take-profit", "Held", "Outcome", "Result (R)", "P/L", "Decided by"];
    return "<table><thead><tr><th>" + H.map(function (x) { return __t(x); }).join("</th><th>") + "</th></tr></thead><tbody>" + S.closed.slice().sort(function (a, b) { return b.t - a.t; }).map(function (x) {
      var c = x.r > 0 ? "up" : "dn", w = WHY[x.why];
      return '<tr><td style="font-family:var(--m);font-weight:400;font-size:11px">' + dtm(x.t) + "</td><td>" + esc(x.coin) + ' <span class="tf">' + esc(x.tf) + "</span></td><td>" + ordr(x) + "</td><td>" + (x.entry != null ? f(x.entry, 3) + " → " + f(x.exit, 3) : "—") + "</td><td>" +
        (x.sl != null ? '<span class="dn">' + f(x.sl, 3) + '</span> · <span class="up">' + f(x.tp, 3) + "</span>" : "—") + "</td><td>" + (x.entryTime ? dur(x.t - x.entryTime) : "—") + "</td><td>" + (w ? pill(w[0], w[1]) : "—") + '</td><td class="' + c + '">' + (x.r > 0 ? "+" : "") + f(x.r, 1) + 'R</td><td class="' + c + '">' + sg(x.pnl) + "</td><td>" + (x.by ? by(x) : "—") + "</td></tr>" +
        (x.aiWhy ? '<tr class="dr"><td colspan="10">' + who(x) + "</td></tr>" : "");
    }).join("") + "</tbody></table>";
  }
  /* lifecycle: signal -> AI decides -> order open -> closed (and how). Counts come from the state, nothing is typed in. */
  function flow() {
    var o = { target: 0, stop: 0, time: 0, ai: 0 }; S.closed.forEach(function (x) { if (o[x.why] != null) o[x.why]++; });
    var st = function (l, n, c) { return '<div class="fl ' + (c || "") + '"><b>' + n + "</b><span>" + __t(l) + "</span></div>"; }, ar = '<i class="fa">›</i>';
    return '<div class="flow">' + st("Candidates", S.signals.length) + ar + st("AI decides", (S.decisions || []).filter(function (d) { return d.action === "open" || d.action === "skip"; }).length) + ar + st("Open orders", S.open.length, "ac") + ar +
      st("Take-profit", o.target, "up") + st("Stop-loss", o.stop, "dn") + st("Max hold time", o.time) + st("Closed by AI", o.ai, "ac") + "</div>";
  }
  function aiCard() {
    var A = S.ai; if (!A) return "";
    if (A.mode !== "decide") return card("AI engine", "signal", null, '<div class="set"><div class="sr">' + __t("Decides orders") + "<b>" + __t("Rules (AI off)") + "</b></div></div>");
    var l = A.last, rows = [["Decides orders", __t("AI")], ["Providers (priority)", (A.providers || []).map(esc).join(" → ") || "—"]];
    if (l) {
      rows.push(["Last AI run", dtm(l.t) + " · " + (l.ok ? '<span class="up">' + __t("OK") + "</span>" : '<span class="dn">' + __t("Unavailable") + "</span>")]);
      if (l.ok) { rows.push(["Answered by", esc(l.provider + "/" + l.model) + (l.ms ? " · " + Math.round(l.ms / 100) / 10 + "s" : "")]); rows.push(["Candidates → picked", l.candidates + " → " + l.picked]); }
      else if (l.why) rows.push(["Reason", esc(l.why)]);
      if (l.view) rows.push(["AI market view", esc(l.view)]);
      if (l.noTrade) rows.push(["Why no trade", esc(l.noTrade)]);
    } else rows.push(["Last AI run", "—"]);
    return card("AI engine", "signal", null, '<div class="set">' + rows.map(function (x) { return '<div class="sr"><span>' + __t(x[0]) + '</span><b class="wr">' + x[1] + "</b></div>"; }).join("") + "</div>");
  }
  function decT() {
    var d = (S.decisions || []).slice().sort(function (a, b) { return b.t - a.t; });
    if (!d.length) return '<div class="empty">' + __t("No decisions yet") + "</div>";
    return "<table><thead><tr><th>" + ["Time", "Coin", "Outcome", "Why", "AI note"].map(function (x) { return __t(x); }).join("</th><th>") + "</th></tr></thead><tbody>" + d.map(function (x) {
      var a = ACT[x.action] || ["nt", x.action], rs = RSN[x.reason], why = x.action === "ai-view" ? "" : rs ? __t(rs) : (x.reason ? esc(x.reason) : "");
      return '<tr><td style="font-family:var(--m);font-weight:400;font-size:11px">' + dtm(x.t) + "</td><td>" + (x.coin ? esc(x.coin) + (x.tf ? ' <span class="tf">' + esc(x.tf) + "</span>" : "") : "—") + "</td><td>" + pill(a[0], a[1]) + '</td><td class="pl">' + why +
        '</td><td class="pl wr">' + (x.why ? esc(x.why) : "") + (x.provider ? ' <small class="mu">· ' + esc(x.provider) + (x.conf != null ? " · " + Math.round(x.conf * 100) + "%" : "") + "</small>" : "") + "</td></tr>";
    }).join("") + "</tbody></table>";
  }
  function sigT() {
    if (!S.signals.length) return '<div class="empty">' + __t("No candidates right now") + "</div>";
    return "<table><thead><tr><th>" + ["Coin", "Frame", "Rule", "Validation", "Status"].map(function (x) { return __t(x); }).join("</th><th>") + "</th></tr></thead><tbody>" + S.signals.map(function (x) {
      return "<tr><td>" + esc(x.coin) + '</td><td><span class="tf">' + esc(x.tf) + "</span></td><td>" + esc(x.rule) + '</td><td class="pl">' + (VAL[x.val] ? __t(VAL[x.val]) : "—") + '</td><td class="pl">' + (ST[x.st] ? __t(ST[x.st]) : "—") + "</td></tr>";
    }).join("") + "</tbody></table>";
  }
  function logL() {
    var rows = S.log.slice().sort(function (a, b) { return b.t - a.t; }).filter(function (l) { return LOGT[l.k]; }).map(function (l) {
      var v = {}, k; for (k in l.v || {}) v[k] = esc(l.v[k]); if (l.k === "open" && !v.side) v.side = "BUY"; if (l.k === "open" && v.risk === "managed") return ""; /* unknown keys from a newer bot are skipped, not guessed */
      var T = l.k === "close" && l.v && CLOSET[l.v.why] ? CLOSET[l.v.why] : LOGT[l.k][1];
      return '<div class="ai"><time>' + tm(l.t) + "</time>" + ic(LOGT[l.k][0], "b14") + "<div>" + __t(T, v) + "</div></div>";
    });
    return rows.length ? '<div class="act">' + rows.join("") + "</div>" : '<div class="empty">' + __t("No activity yet") + "</div>";
  }
  function sets() {
    var R = S.rules, rk = S.risk, rows;
    if (R) rows = [["Mode", "Paper (virtual money)"], ["Market", R.market === "spot" ? "Spot" : String(R.market)], ["Direction", R.side === "long-short" ? "Long and short (paper short, 1x)" : "BUY only (long) · no short selling"], ["Leverage", "None (1x)"],
      ["Decides orders", R.decider === "ai" ? "AI" : "Rules"], ["Stop-loss", __t("{n} ATR from entry", { n: R.stopAtr })], ["Take-profit", __t("{n} ATR from entry", { n: R.targetAtr })], ["Stop management", R.manage ? __t("Break-even at +{a}R, trail from +{b}R", { a: R.manage.breakevenAtR, b: R.manage.trailAtR }) : "Off"], ["Max hold", __t("{n} candles", { n: R.maxHoldCandles })],
      ["Risk per trade", pc(R.riskPct, 1) + " " + __t("equity")], ["Max size per trade", pc(R.maxNotionalPct, 0) + " " + __t("equity")], ["Fee per side", pc(R.feePct, 2)], ["Max positions", String(R.maxPositions)],
      ["Max new orders per day", String(R.maxTradesPerDay)], ["Daily loss limit", pc(R.dayLossPct, 0)], ["Drawdown halt", pc(R.drawdownLimit, 0)], ["Timeframes", (R.tfs || []).join(", ")]];
    else rows = [["Mode", "Paper (virtual money)"], ["Direction", "Spot, long only"], ["Risk per trade", "1% equity"], ["Max positions", String(rk.maxPositions)], ["Daily loss limit", pc(rk.dayLimit / S.start, 0)], ["Timeframes", "1H, 4H"]];
    return '<div class="set">' + rows.map(function (x) { return '<div class="sr">' + __t(x[0]) + "<b>" + __t(x[1]) + "</b></div>"; }).join("") + "</div>";
  }
  /* fallback when the bot file has no `stats` (older bot / sample data): same numbers from the closed trades */
  function localStats() {
    var c = S.closed || [], n = c.length; if (!n) return null;
    var sum = function (a, g) { return a.reduce(function (t, x) { return t + g(x); }, 0); }, w = c.filter(function (x) { return x.r > 0; }), l = c.filter(function (x) { return x.r <= 0; }), gl = -sum(l, function (x) { return x.pnl; });
    var pk = -Infinity, dd = 0; (S.equity || []).forEach(function (q) { if (q[1] > pk) pk = q[1]; if (pk > 0) dd = Math.max(dd, (pk - q[1]) / pk); });
    function sm(a) { return { n: a.length, win: a.filter(function (x) { return x.r > 0; }).length / a.length, expR: sum(a, function (x) { return x.r; }) / a.length, pnl: sum(a, function (x) { return x.pnl; }) }; }
    function grp(k) { var m = {}, o = {}; c.forEach(function (x) { var g = k(x); if (g) (m[g] = m[g] || []).push(x); }); Object.keys(m).forEach(function (g) { o[g] = sm(m[g]); }); return o; }
    var h = c.filter(function (x) { return x.entryTime; }), st = 0, bs = 0, ws = 0;
    c.forEach(function (x) { if (x.r > 0) { st = st > 0 ? st + 1 : 1; bs = Math.max(bs, st); } else { st = st < 0 ? st - 1 : -1; ws = Math.max(ws, -st); } });
    return { n: n, win: w.length / n, expR: sum(c, function (x) { return x.r; }) / n, avgWinR: w.length ? sum(w, function (x) { return x.r; }) / w.length : 0, avgLossR: l.length ? sum(l, function (x) { return x.r; }) / l.length : 0,
      profitFactor: gl > 0 ? sum(w, function (x) { return x.pnl; }) / gl : null, maxDrawdown: dd, avgHoldMin: h.length ? sum(h, function (x) { return (x.t - x.entryTime) / 6e4; }) / h.length : 0, bestStreak: bs, worstStreak: ws,
      avgMfeR: null, bySide: grp(function (x) { return x.side === "SELL" ? "short" : "long"; }), byWhy: grp(function (x) { return x.why; }), byRule: grp(function (x) { return x.rule; }) };
  }
  function perfP() {
    var T = S.stats || localStats(); if (!T || !T.n) return card("Performance", "chart-area", null, '<div class="empty">' + __t("No closed trades yet") + "</div>");
    var P = function (v) { return f(v * 100, 1) + "%"; }, Rr = function (v) { return (v >= 0 ? "+" : "") + f(v) + "R"; };
    var k = '<div class="grid g4">' + kpi("Win rate", "check", P(T.win), __t("Closed trades: {n}", { n: T.n })) + kpi("Expectancy / trade", "signal", Rr(T.expR), __t("Profit factor {v}", { v: T.profitFactor == null ? "—" : f(T.profitFactor) }), T.expR >= 0 ? "up" : "dn") +
      kpi("Avg win / avg loss", "list", Rr(T.avgWinR) + " / " + Rr(T.avgLossR), __t("Streak best {a} · worst {b}", { a: T.bestStreak, b: T.worstStreak })) + kpi("Max drawdown", "warning", P(T.maxDrawdown), __t("Avg hold {v}", { v: dur(T.avgHoldMin * 6e4) })) + "</div>";
    function tbl(title, o, lab) { var rows = Object.keys(o || {}); if (!rows.length) return ""; return card(title, "list", null, "<table><thead><tr><th>" + __t("Group") + "</th><th>" + __t("Trades") + "</th><th>" + __t("Win rate") + "</th><th>" + __t("Expectancy / trade") + "</th><th>P/L</th></tr></thead><tbody>" + rows.map(function (g) { var x = o[g]; return "<tr><td>" + esc(lab ? __t(lab[g] || g) : g) + "</td><td>" + x.n + "</td><td>" + P(x.win) + '</td><td class="' + (x.expR >= 0 ? "up" : "dn") + '">' + Rr(x.expR) + '</td><td class="' + (x.pnl >= 0 ? "up" : "dn") + '">' + sg(x.pnl) + "</td></tr>"; }).join("") + "</tbody></table>", " tb"); }
    var W = {}; Object.keys(WHY).forEach(function (q) { W[q] = WHY[q][1]; });
    return k + '<div class="grid g2">' + tbl("By direction", T.bySide, { long: "Long", short: "Short" }) + tbl("By exit reason", T.byWhy, W) + "</div>" + tbl("By signal rule", T.byRule) +
      (T.avgMfeR != null ? card("Exit quality", "signal", null, '<div class="sr">' + __t("Average best open profit before exit") + "<b>" + Rr(T.avgMfeR) + "</b></div>") : "");
  }
  var PAGES = {
    overview: function (c) {
      return '<div class="grid g4">' + kpi("Equity", "gauge", "$" + f(c.eq), __t("Start {v}", { v: "$" + f(S.start, 0) })) +
        kpi("Total P/L", "chart-area", sg(c.total), __t("{pct} · open {v}", { pct: (c.total >= 0 ? "+" : "") + f(c.total / S.start * 100) + "%", v: sg(c.openPnl) }), c.total >= 0 ? "up" : "dn") +
        kpi("Win rate", "check", f(c.win * 100, 1) + "%", __t("Closed trades: {n}", { n: c.n })) +
        kpi("Expectancy / trade", "signal", (c.exp >= 0 ? "+" : "") + f(c.exp) + "R", __t("Profit factor {v}", { v: c.pf == null ? "—" : f(c.pf) }), c.exp >= 0 ? "up" : "dn") + "</div>" +
        card("Order flow", "list", null, flow()) +
        '<div class="grid g2">' + card("Equity", "chart-area", null, chart(), "", seg()) + card("Risk today", "warning", null, risk()) + "</div>" +
        card("Open positions", "portfolio", S.open.length + " / " + S.risk.maxPositions, openT(), " tb") +
        '<div class="grid g2b">' + aiCard() + card("Recent activity", "clock", null, logL()) + "</div>";
    },
    performance: function () { return perfP(); },
    positions: function () { return card("Order flow", "list", null, flow()) + card("Open positions", "portfolio", S.open.length + " / " + S.risk.maxPositions, openT(), " tb"); },
    decisions: function () { return aiCard() + card("AI decisions", "signal", (S.decisions || []).length, decT(), " tb"); },
    history: function () { return card("Order flow", "list", null, flow()) + card("History", "list", __t("Trades: {n}", { n: S.closed.length }), histT(), " tb"); },
    signals: function () { return card("Signals", "bar-top", S.signals.length, sigT(), " tb"); },
    risk: function () { return card("Risk today", "warning", null, risk()); },
    log: function () { return card("Log", "clock", null, logL()); },
    settings: function () { return card("Settings", "settings", __t("read only"), sets()); }
  };
  function nav() {
    var n1 = [["overview", "gauge", "Overview"], ["positions", "portfolio", "Open positions", S ? S.open.length : ""], ["history", "list", "History", S ? S.closed.length : ""], ["performance", "chart-area", "Performance"], ["decisions", "signal", "AI decisions", S ? (S.decisions || []).length : ""], ["signals", "bar-top", "Signals", S ? S.signals.length : ""]],
      n2 = [["risk", "warning", "Risk"], ["log", "clock", "Log"], ["settings", "settings", "Settings"]];
    function h(a) { return a.map(function (x) { return '<a class="sbi" data-p="' + x[0] + '" href="#' + x[0] + '">' + ic(x[1]) + __t(x[2]) + (x[3] !== "" && x[3] != null ? "<em>" + x[3] + "</em>" : "") + "</a>"; }).join(""); }
    $("nav1").innerHTML = h(n1); $("nav2").innerHTML = h(n2);
  }
  function msg(t, retry) { return '<div class="card"><div class="empty">' + ic("warning", "bi-20") + "<div>" + __t(t) + "</div>" + (retry ? '<button class="hb" data-retry="1">' + ic("refresh", "b14") + "<span>" + __t("Retry") + "</span></button>" : "") + "</div></div>"; }
  function updText() { if (!S) { $("upd").textContent = ""; return; } var m = Math.max(0, Math.round((Date.now() - S.updatedAt) / 6e4)); $("upd").textContent = m < 1 ? __t("Updated just now") : __t("Updated {n} min ago", { n: m }); }
  function draw() {
    var b = $("badge"), page = (location.hash || "#overview").slice(1);
    if (!PAGES[page]) page = "overview";
    b.className = "badge" + (mode === "sample" || mode === "stale" ? " show" : "") + (mode === "stale" ? " bad" : "");
    b.lastChild.textContent = mode === "stale" ? __t("STALE DATA") : __t("SAMPLE DATA");
    nav();
    document.querySelectorAll(".sbi").forEach(function (a) { a.classList.toggle("on", a.dataset.p === page); });
    $("sb").classList.remove("open"); $("scrim").classList.remove("open");
    if (mode === "loading") { $("scroll").innerHTML = msg("Loading…"); return; }
    if (mode === "version") { $("scroll").innerHTML = msg("This data version is not supported by this page."); $("hsts").innerHTML = ""; return; }
    if (mode === "error" || !S) { $("scroll").innerHTML = msg("Bot data is unavailable.", true); $("hsts").innerHTML = ""; return; }
    var c = calc(), R = S.risk;
    $("hsts").innerHTML = [["Equity", "$" + f(c.eq)], ["Today", '<span class="' + (S.todayPnl >= 0 ? "up" : "dn") + '">' + sg(S.todayPnl) + "</span>"], ["Total P/L", '<span class="' + (c.total >= 0 ? "up" : "dn") + '">' + sg(c.total) + "</span>"],
      ["Positions", R.positions + " / " + R.maxPositions], ["Win rate", Math.round(c.win * 100) + "%"], ["Daily loss", pc(R.dayLoss / S.start) + " / " + pc(R.dayLimit / S.start, 0)]].map(function (x) { return '<div class="hst"><div class="hstl">' + __t(x[0]) + '</div><div class="hstv">' + x[1] + "</div></div>"; }).join("");
    var halted = S.status !== "running" || R.killSwitch;
    $("st").textContent = __t(halted ? "Halted" : "Running"); $("dot").className = "dot" + (halted ? " halt" : "");
    $("scroll").innerHTML = PAGES[page](c); updText();
    document.querySelectorAll("[data-r]").forEach(function (x) { x.onclick = function () { rg = x.dataset.r; draw(); }; });
    document.querySelectorAll("[data-retry]").forEach(function (x) { x.onclick = refresh; });
  }
  function refresh() { return load().then(loadPrices).then(draw); }
  window.addEventListener("hashchange", draw);
  document.addEventListener("DOMContentLoaded", function () {
    $("menu-btn").onclick = function () { $("sb").classList.add("open"); $("scrim").classList.add("open"); };
    $("scrim").onclick = function () { $("sb").classList.remove("open"); $("scrim").classList.remove("open"); };
    $("theme").onclick = function () { var l = document.documentElement.classList.toggle("light-mode"); this.innerHTML = ic(l ? "theme-light" : "theme-dark"); };
    $("rf").onclick = refresh;
    draw(); refresh();
    if (CFG.stateUrl) timer = setInterval(function () { if (!document.hidden) refresh(); }, (CFG.refreshSec || 60) * 1000);
    setInterval(updText, 30000);
  });
  B.refresh = refresh; B._timer = function () { return timer; };
})();
