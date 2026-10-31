"use strict";
const assert = require("assert"), R = require("../src/app-reader.js");
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const res = (obj, ok = true, status = 200) => async () => ({ ok, status, json: async () => obj });
(async () => {
  // good signals file
  const sig = { v: 2, at: NOW - 5 * 6e4, tf: { "1H": { at: NOW - 6e5, scanned: 2, coins: [
    { sym: "BTC", pair: "BTCUSDT", price: 100, qv: 1e9, c24: 1, ch: 0.2, s: [["RSI-02", "<b>x</b>", 1], ["VL-01", "y", 0], ["TR-05", "z", -1, "id"]] } ] } } };
  let r = await R.readFile("signals", { fetchFn: res(sig), now: NOW });
  assert(r.ok);
  const s = R.signals(r.data);
  assert.deepStrictEqual(s["1H"].coins[0].hits, [{ code: "RSI-02", dir: 1 }, { code: "TR-05", dir: -1 }]); // neutral dropped
  // wrong version → skip
  r = await R.readFile("signals", { fetchFn: res({ ...sig, v: 3 }), now: NOW });
  assert(!r.ok && /format v=3/.test(r.reason));
  // too old → skip
  r = await R.readFile("signals", { fetchFn: res({ ...sig, at: NOW - 200 * 6e4 }), now: NOW });
  assert(!r.ok && /too old/.test(r.reason));
  // HTTP error / network error / bad json
  r = await R.readFile("signals", { fetchFn: res({}, false, 503), now: NOW }); assert(!r.ok && /HTTP 503/.test(r.reason));
  r = await R.readFile("signals", { fetchFn: async () => { throw new Error("boom"); }, now: NOW }); assert(!r.ok && /network/.test(r.reason));
  r = await R.readFile("signals", { fetchFn: async () => ({ ok: true, json: async () => { throw new Error("x"); } }), now: NOW }); assert(!r.ok && /not JSON/.test(r.reason));
  // validation
  const val = { v: 2, at: NOW, tf: { "1H": { base: { a: { "1-2": { up: [40, 60, 0], dn: [0, 0, 0] } }, b: { "1-2": { up: [45, 55, 0], dn: [0, 0, 0] } } },
    rows: [{ code: "RSI-02", perDay: 3, a: { n: 120, cfg: { "1-2": [50, 50, 20] } }, b: { n: 60, cfg: { "1-2": [30, 20, 10] } } }] } } };
  const v = R.validated(val, "1H", "RSI-02", "1-2");
  assert.strictEqual(v.a.n, 100); assert.strictEqual(v.a.win, 0.5); assert.strictEqual(v.b.win, 0.6);
  assert.strictEqual(R.validated(val, "1H", "NOPE", "1-2"), null);
  assert.strictEqual(R.baseRate(val, "1H", "a", "1-2", "up").win, 0.4);
  console.log("app-reader: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
