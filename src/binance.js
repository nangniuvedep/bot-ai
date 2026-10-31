/* binance.js — public Binance SPOT market data only (no key, GET only) via data-api.binance.vision.
   Every call returns {ok, data, reason}; on any doubt ok=false and the caller skips (never guesses). `fetchFn` injectable. */
"use strict";
const BASE = "https://data-api.binance.vision";
const bad = (reason) => ({ ok: false, reason });

async function get(path, fetchFn = fetch) {
  let r;
  try { r = await fetchFn(BASE + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) }); }
  catch (e) { return bad("network: " + String((e && e.message) || e).slice(0, 80)); }
  if (!r.ok) return bad("HTTP " + r.status);
  try { return { ok: true, data: await r.json() }; } catch (e) { return bad("not JSON"); }
}

/* 1-minute candles from `from` (ms) up to `to` (ms), closed candles only, paged by 1000. -> [{t,o,h,l,c}] */
async function klines1m(pair, from, to, now, fetchFn) {
  const out = []; let start = from;
  for (let guard = 0; guard < 8 && start < to; guard++) {
    const r = await get(`/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=1m&startTime=${start}&endTime=${to}&limit=1000`, fetchFn);
    if (!r.ok) return r;
    if (!Array.isArray(r.data)) return bad("klines not an array");
    const rows = r.data.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], ct: +k[6] }));
    if (rows.some((k) => ![k.t, k.o, k.h, k.l, k.c].every(Number.isFinite))) return bad("klines has bad numbers");
    out.push(...rows.filter((k) => k.ct < now));
    if (r.data.length < 1000) break;
    start = rows[rows.length - 1].t + 60000;
  }
  return { ok: true, data: out };
}

/* order book (top levels). -> {bid, ask, asks:[[price,qty]], bids:[[price,qty]]} */
async function book(pair, levels, fetchFn) {
  const r = await get(`/api/v3/depth?symbol=${encodeURIComponent(pair)}&limit=${levels}`, fetchFn);
  if (!r.ok) return r;
  const d = r.data, num = (a) => a.map((x) => [+x[0], +x[1]]);
  if (!d || !Array.isArray(d.asks) || !Array.isArray(d.bids) || !d.asks.length || !d.bids.length) return bad("empty book");
  const asks = num(d.asks), bids = num(d.bids);
  if (!asks.concat(bids).every((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]))) return bad("book has bad numbers");
  return { ok: true, data: { bid: bids[0][0], ask: asks[0][0], asks, bids } };
}

/* average price to BUY `notional` USDT walking the asks; null if the visible depth cannot fill it */
function walkAsks(asks, notional) {
  let left = notional, qty = 0;
  for (const [p, q] of asks) { const take = Math.min(left, p * q); qty += take / p; left -= take; if (left <= 1e-9) break; }
  return left > 1e-6 ? null : notional / qty;
}

/* average price to SELL `notional` USDT walking the bids (used by paper shorts); null if the visible depth cannot fill it */
function walkBids(bids, notional) {
  let left = notional, qty = 0;
  for (const [p, q] of bids) { const take = Math.min(left, p * q); qty += take / p; left -= take; if (left <= 1e-9) break; }
  return left > 1e-6 ? null : notional / qty;
}

module.exports = { BASE, klines1m, book, walkAsks, walkBids };
