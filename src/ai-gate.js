/* ai-gate.js — the AI layer (B4), built so that it CAN ONLY REDUCE risk:
     verdict "take"   -> enter as the rules decided
     verdict "shrink" -> enter with a smaller size (multiplier clamped to [minShrink, 1], never above 1)
     verdict "skip"   -> do not enter
   It cannot add a trade, raise size, move stop/target, or touch exits. Bad output = skip that signal (no retry: asking again until it
   agrees would be fishing). Provider down/slow/over budget = wait and retry next round. Default mode is "off" (config ai.mode).
   The provider is injected: `aiFn(packet) -> Promise<string | object>` (see ai-provider.example.js). Nothing here knows a vendor. */
"use strict";
const ACTIONS = ["take", "skip", "shrink"];

/* compact numbers only, each with its time — no prose, no HTML */
function buildPacket(c, b, info, now) {
  const pick = {}; for (const k of ["tr", "ax", "rs", "mc", "sd", "rd", "nz", "a", "ar", "vr", "cb", "u", "d", "g"]) if (b && b[k] != null) pick[k] = b[k];
  return { coin: c.sym, tf: c.tf, rule: c.rule, edgePoints: +(c.edge * 100).toFixed(1), signalCandleClosedAt: new Date(c.S).toISOString(), asOf: new Date(now).toISOString(),
    brief: pick, book: { spreadPct: +info.spreadPct.toFixed(4), chaseAtr: +info.chaseAtr.toFixed(3), slipPct: +(info.slipPct || 0).toFixed(4) },
    plan: { entry: info.entry, stop: info.sl, target: info.tp } };
}

function parseVerdict(raw, cfg) {
  let o = raw;
  if (typeof raw === "string") { const m = raw.match(/\{[\s\S]*\}/); try { o = JSON.parse(m ? m[0] : raw); } catch (e) { return { ok: false, why: "not JSON" }; } }
  if (!o || typeof o !== "object" || !ACTIONS.includes(o.action)) return { ok: false, why: "action must be take|skip|shrink" };
  let size = 1;
  if (o.action === "shrink") { if (typeof o.size !== "number" || !Number.isFinite(o.size) || o.size <= 0) return { ok: false, why: "shrink needs a size in (0,1]" }; size = Math.min(1, Math.max(cfg.ai.minShrink, o.size)); }
  if (o.action === "skip") size = 0;
  const conf = typeof o.confidence === "number" && o.confidence >= 0 && o.confidence <= 1 ? o.confidence : null;
  return { ok: true, verdict: { action: o.action, size, confidence: conf, reason: typeof o.reason === "string" ? o.reason.slice(0, 200) : "" } };
}

/* -> {status:"ok", verdict} | {status:"invalid", why} | {status:"unavailable", why} */
async function consult(aiFn, packet, cfg) {
  if (typeof aiFn !== "function") return { status: "unavailable", why: "no AI provider configured" };
  let raw, timer;
  try { raw = await Promise.race([Promise.resolve().then(() => aiFn(packet)), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), cfg.ai.timeoutMs); })]); }
  catch (e) { return { status: "unavailable", why: String((e && e.message) || e).slice(0, 80) }; }
  finally { clearTimeout(timer); }
  const p = parseVerdict(raw, cfg);
  return p.ok ? { status: "ok", verdict: p.verdict } : { status: "invalid", why: p.why };
}
module.exports = { buildPacket, parseVerdict, consult };
