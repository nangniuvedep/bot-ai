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
    open: ["portfolio", "Opened <b>{coin}</b> {tf} at {price} · risk {risk} equity"],
    skip: ["warning", "Skipped <b>{coin}</b>: spread above configured limit"],
    close: ["check", "Closed <b>{coin}</b> {tf} at target · {r}"]
  };
  var CLOSET = { stop: "Closed <b>{coin}</b> {tf} at stop · {r}", time: "Closed <b>{coin}</b> {tf} after max hold time · {r}" };
  var VAL = { both: "Both stages green", spread: "Spread too wide" }, ST = { wait: "Waiting for candle", watch: "Watching", skip: "Skipped" };
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
  function openT() {
    if (!S.open.length) return '<div class="empty">' + __t("No open positions") + "</div>";
    return "<table><thead><tr><th>" + ["Coin", "Frame", "SL · price · TP", "Entry", "Current", "Open P/L"].map(function (x) { return __t(x); }).join("</th><th>") + "</th></tr></thead><tbody>" + S.open.map(function (x) {
      var q = pos(x), rngW = x.tp - x.sl || 1, pp = Math.max(0, Math.min(1, (q.price - x.sl) / rngW)), et = Math.max(0, Math.min(1, (x.entry - x.sl) / rngW)), c = q.pnl >= 0 ? "up" : "dn";
      return "<tr><td>" + coin(x.coin) + '</td><td><span class="tf">' + esc(x.tf) + '</span></td><td><span class="rng"><u style="left:' + et * 100 + '%"></u><i style="left:' + pp * 100 + '%"></i></span></td><td>' + f(x.entry, 3) + "</td><td>" + f(q.price, 3) + '</td><td class="' + c + '">' + sg(q.pnl) + " <small>(" + (q.pct >= 0 ? "+" : "") + f(q.pct) + "%)</small></td></tr>";
    }).join("") + "</tbody></table>";
  }
  function histT() {
    if (!S.closed.length) return '<div class="empty">' + __t("No closed trades yet") + "</div>";
    return "<table><thead><tr><th>" + ["Date", "Coin", "Frame", "Result (R)", "P/L"].map(function (x) { return __t(x); }).join("</th><th>") + "</th></tr></thead><tbody>" + S.closed.slice().sort(function (a, b) { return b.t - a.t; }).map(function (x) {
      var c = x.r > 0 ? "up" : "dn"; return '<tr><td style="font-family:var(--m);font-weight:400;font-size:11px">' + dt(x.t) + "</td><td>" + esc(x.coin) + '</td><td><span class="tf">' + esc(x.tf) + '</span></td><td class="' + c + '">' + (x.r > 0 ? "+" : "") + f(x.r, 1) + 'R</td><td class="' + c + '">' + sg(x.pnl) + "</td></tr>";
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
      var v = {}, k; for (k in l.v || {}) v[k] = esc(l.v[k]); /* unknown keys from a newer bot are skipped, not guessed */
      var T = l.k === "close" && l.v && CLOSET[l.v.why] ? CLOSET[l.v.why] : LOGT[l.k][1];
      return '<div class="ai"><time>' + tm(l.t) + "</time>" + ic(LOGT[l.k][0], "b14") + "<div>" + __t(T, v) + "</div></div>";
    });
    return rows.length ? '<div class="act">' + rows.join("") + "</div>" : '<div class="empty">' + __t("No activity yet") + "</div>";
  }
  function sets() {
    var rows = [["Mode", "Paper (virtual money)"], ["Direction", "Spot, long only"], ["Risk per trade", "1% equity"], ["Max positions", String(S.risk.maxPositions)], ["Daily loss limit", pc(S.risk.dayLimit / S.start, 0)], ["Timeframes", "1H, 4H"]];
    return '<div class="set">' + rows.map(function (x) { return '<div class="sr">' + __t(x[0]) + "<b>" + __t(x[1]) + "</b></div>"; }).join("") + "</div>";
  }
  var PAGES = {
    overview: function (c) {
      return '<div class="grid g4">' + kpi("Equity", "gauge", "$" + f(c.eq), __t("Start {v}", { v: "$" + f(S.start, 0) })) +
        kpi("Total P/L", "chart-area", sg(c.total), __t("{pct} · open {v}", { pct: (c.total >= 0 ? "+" : "") + f(c.total / S.start * 100) + "%", v: sg(c.openPnl) }), c.total >= 0 ? "up" : "dn") +
        kpi("Win rate", "check", f(c.win * 100, 1) + "%", __t("Closed trades: {n}", { n: c.n })) +
        kpi("Expectancy / trade", "signal", (c.exp >= 0 ? "+" : "") + f(c.exp) + "R", __t("Profit factor {v}", { v: c.pf == null ? "—" : f(c.pf) }), c.exp >= 0 ? "up" : "dn") + "</div>" +
        '<div class="grid g2">' + card("Equity", "chart-area", null, chart(), "", seg()) + card("Risk today", "warning", null, risk()) + "</div>" +
        '<div class="grid g2">' + card("Open positions", "portfolio", S.open.length + " / " + S.risk.maxPositions, openT(), " tb") + card("Recent activity", "clock", null, logL()) + "</div>";
    },
    positions: function () { return card("Open positions", "portfolio", S.open.length + " / " + S.risk.maxPositions, openT(), " tb"); },
    history: function () { return card("History", "list", __t("Trades: {n}", { n: S.closed.length }), histT(), " tb"); },
    signals: function () { return card("Signals", "bar-top", S.signals.length, sigT(), " tb"); },
    risk: function () { return card("Risk today", "warning", null, risk()); },
    log: function () { return card("Log", "clock", null, logL()); },
    settings: function () { return card("Settings", "settings", __t("read only"), sets()); }
  };
  function nav() {
    var n1 = [["overview", "gauge", "Overview"], ["positions", "portfolio", "Open positions", S ? S.open.length : ""], ["history", "list", "History", S ? S.closed.length : ""], ["signals", "bar-top", "Signals", S ? S.signals.length : ""]],
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
