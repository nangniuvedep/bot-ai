/* app-reader.js — the ONLY module of Bot-AI that knows the app's file formats.
   GET only. Every read returns {ok, data, at, ageMin, reason}; on any doubt ok=false and the bot skips the round
   (never trades on a file it cannot trust). Node >= 18 (global fetch). */
"use strict";
const fs = require("fs"), path = require("path");
const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/app-contract.json"), "utf8"));

const bad = (reason) => ({ ok: false, reason });

/* read one app file by key ("signals", "brief", …). `fetchFn` is injectable for tests. */
async function readFile(key, { fetchFn = fetch, now = Date.now(), contract = CONTRACT } = {}) {
  const f = contract.files[key];
  if (!f) return bad("unknown file key " + key);
  let r;
  try {
    r = await fetchFn(contract.base + f.name, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(contract.timeoutMs) });
  } catch (e) {
    return bad("network: " + String((e && e.message) || e).slice(0, 80));
  }
  if (!r.ok) return bad("HTTP " + r.status);
  let data;
  try { data = await r.json(); } catch (e) { return bad("not JSON"); }
  if (!data || typeof data !== "object") return bad("empty");
  if (f.v && !f.v.includes(data.v)) return bad(`format v=${data.v}, expected ${f.v.join("/")} (app changed? update config + this file)`);
  const at = Number(data.at);
  if (f.maxAgeMin != null) {
    if (!Number.isFinite(at)) return bad("no at");
    const ageMin = (now - at) / 6e4;
    if (ageMin > f.maxAgeMin) return bad(`too old: ${Math.round(ageMin)} min (max ${f.maxAgeMin})`);
    if (ageMin < -5) return bad("at is in the future");
    return { ok: true, data, at, ageMin };
  }
  return { ok: true, data, at: Number.isFinite(at) ? at : null, ageMin: null };
}

/* signals.json → { [tf]: { at, scanned, coins: [{ sym, pair, price, qv, c24, ch, hits: [{ code, dir }] }] } }
   Only hits with a direction (dir ≠ 0). A hit in the file is [code, html, dir, say?]. */
function signals(data, contract = CONTRACT) {
  const out = {};
  for (const tf of contract.timeframes) {
    const t = data.tf && data.tf[tf];
    if (!t || !Array.isArray(t.coins)) continue;
    out[tf] = {
      at: t.at, scanned: t.scanned,
      coins: t.coins.map((c) => ({
        sym: c.sym, pair: c.pair, price: c.price, qv: c.qv, c24: c.c24, ch: c.ch,
        hits: (c.s || []).map((h) => ({ code: h[0], dir: Number(h[2]) })).filter((h) => h.dir === 1 || h.dir === -1),
      })),
    };
  }
  return out;
}

/* brief.json → { [tf]: { at, c: { SYM: {tr, ax, rs, mc, s, sd, r, rd, nz, a, ar, vr, cb, u, d, h, k, p, g} } } }
   a = ATR(14) in % of close, p = close, g = gauge −100…+100 (it describes, it does not forecast). */
function brief(data, contract = CONTRACT) {
  const out = {};
  for (const tf of contract.timeframes) {
    const t = data.tf && data.tf[tf];
    if (t && t.c) out[tf] = { at: t.at, c: t.c };
  }
  return out;
}

/* validation.json → how many of a code's hits were judged, and its win rate, in both periods (a = first 70 %, b = last 30 %),
   for one setting cfg ("1-2" = stop 1×ATR, target 2×ATR). cfg cell = [right, wrong, unclear].
   ASSUMPTION to verify against the app's Validation page: win rate = right / (right + wrong); "judged" n = right + wrong. */
function validated(data, tf, code, cfg, contract = CONTRACT) {
  const t = data.tf && data.tf[tf];
  const row = t && t.rows && t.rows.find((x) => x.code === code);
  if (!row) return null;
  const rate = (cell) => { const n = cell ? cell[0] + cell[1] : 0; return { n, win: n ? cell[0] / n : null }; };
  const side = (p) => ({ n: p.n, ...rate(p.cfg && p.cfg[cfg]) });
  return { a: side(row.a), b: side(row.b) };
}

/* base (random candle) win rate for the same setting and period; dir = "up" | "dn" */
function baseRate(data, tf, period, cfg, dir) {
  const cell = data.tf[tf].base[period][cfg][dir];
  const n = cell[0] + cell[1];
  return { n, win: n ? cell[0] / n : null };
}

module.exports = { CONTRACT, readFile, signals, brief, validated, baseRate };
