/* ai-provider.js — calls an LLM through a PRIORITY LIST of providers (config ai.providers, smartest first).
   A provider without its key is skipped; one that fails (429 / timeout / error) is put on a short pause (ledger L.aiOff) and the next one answers.
   Keys come from environment variables only (GitHub Secrets) — never from the repo. Nothing here knows the trading rules.
   call(cfg, {system, user}, {env, fetchFn, L, now}) -> {ok:true, text, provider, model, ms} | {ok:false, why} */
"use strict";

const clip = (s, n = 120) => String(s || "").replace(/\s+/g, " ").slice(0, n);


/* Workers AI models answer in different shapes (plain {response}, OpenAI chat {choices}, Responses API {output}, reasoning models with content in
   reasoning_content when the token budget ran out). Returns the answer text, or "" — and `why(res)` describes the shape for the log. */
const partsText = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : (x && (x.text || x.content)) || "")).join("") : "");
function textOf(res) {
  if (!res || typeof res !== "object") return typeof res === "string" ? res : "";
  if (typeof res.response === "string" && res.response.trim()) return res.response;
  if (res.result && res.result !== res) { const t = textOf(res.result); if (t) return t; }
  if (typeof res.output_text === "string" && res.output_text.trim()) return res.output_text;
  const ch = res.choices && res.choices[0], m = ch && (ch.message || ch.delta);
  if (m) { const t = partsText(m.content); if (t.trim()) return t; }
  if (ch && typeof ch.text === "string" && ch.text.trim()) return ch.text;
  if (Array.isArray(res.output)) { const t = res.output.filter((o) => o && o.type !== "reasoning").map((o) => partsText(o.content) || (typeof o.text === "string" ? o.text : "")).join(""); if (t.trim()) return t; }
  const rc = m && (m.reasoning_content || m.reasoning);   // answer cut off inside the reasoning: use it only if it holds the JSON we asked for
  if (typeof rc === "string" && /"entries"\s*:/.test(rc)) return rc;
  return "";
}
function why(res) {
  if (!res || typeof res !== "object") return "result=" + typeof res;
  const ch = res.choices && res.choices[0], m = ch && ch.message;
  return "keys=" + Object.keys(res).slice(0, 6).join(",") + (ch ? " finish=" + ch.finish_reason + " msg=" + (m ? Object.keys(m).join(",") : "none") + (m && (m.reasoning_content || m.reasoning) ? " reasoning=" + String(m.reasoning_content || m.reasoning).length + "ch" : "") : "") + (res.usage ? " out_tokens=" + (res.usage.completion_tokens || res.usage.output_tokens) : "");
}

/* one provider -> text. Throws Error on any failure (message kept short, never contains a key). */
async function once(p, { system, user }, { env, fetchFn, timeoutMs, maxTokens }) {
  const sig = AbortSignal.timeout(timeoutMs), json = { "content-type": "application/json" };
  let r, body;
  if (p.type === "gemini") {
    r = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`, { method: "POST", signal: sig, headers: { ...json, "x-goog-api-key": env[p.keyEnv || "GEMINI_API_KEY"] },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens, responseMimeType: "application/json" } }) });
    body = await readBody(r);
    return ((body.candidates || [])[0]?.content?.parts || []).map((x) => x.text || "").join("");
  }
  if (p.type === "workers-ai") {
    r = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env[p.accountEnv || "CF_ACCOUNT_ID"])}/ai/run/${p.model}`, { method: "POST", signal: sig, headers: { ...json, authorization: "Bearer " + env[p.keyEnv || "CF_API_TOKEN"] },
      body: JSON.stringify({ messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, temperature: 0.2 }) });
    body = await readBody(r); const t1 = textOf(body.result); if (!t1) throw new Error("empty answer (" + why(body.result) + ")"); return t1;
  }
  if (p.type === "worker-ai") {   // our own tiny Worker (worker/ai-worker.mjs) that holds the Workers AI binding: no Cloudflare API token needed
    r = await fetchFn(env[p.urlEnv || "AI_PROXY_URL"], { method: "POST", signal: sig, headers: { ...json, authorization: "Bearer " + env[p.keyEnv || "AI_PROXY_TOKEN"] },
      body: JSON.stringify({ model: p.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, temperature: 0.2 }) });
    body = await readBody(r); const t2 = textOf(body.result); if (!t2) throw new Error("empty answer (" + why(body.result) + ")"); return t2;
  }
  if (p.type === "openai") {   // NVIDIA NIM, Groq, OpenRouter, OpenAI ...
    r = await fetchFn(p.baseUrl.replace(/\/$/, "") + "/chat/completions", { method: "POST", signal: sig, headers: { ...json, authorization: "Bearer " + env[p.keyEnv] },
      body: JSON.stringify({ model: p.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, temperature: 0.2 }) });
    body = await readBody(r); return (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || "";
  }
  throw new Error("unknown provider type " + p.type);
}
async function readBody(r) {
  if (!r.ok) { let t = ""; try { t = clip(await r.text(), 100); } catch (e) {} throw new Error("HTTP " + r.status + (t ? " " + t : "")); }
  try { return await r.json(); } catch (e) { throw new Error("not JSON"); }
}
const hasKey = (p, env) => p.type === "worker-ai" ? !!(env[p.urlEnv || "AI_PROXY_URL"] && env[p.keyEnv || "AI_PROXY_TOKEN"]) : p.type === "workers-ai" ? !!(env[p.accountEnv || "CF_ACCOUNT_ID"] && env[p.keyEnv || "CF_API_TOKEN"]) : !!env[p.keyEnv || (p.type === "gemini" ? "GEMINI_API_KEY" : "")];

async function call(cfg, prompt, { env = process.env, fetchFn = fetch, L = null, now = Date.now() } = {}) {
  const a = cfg.ai, off = L ? (L.aiOff = L.aiOff || {}) : {}, tried = [];
  for (const p of a.providers || []) {
    const id = p.type + ":" + p.model;
    if (!hasKey(p, env)) { tried.push(p.type + " no-key"); continue; }
    if ((off[id] || 0) > now) { tried.push(p.type + " paused"); continue; }
    const t0 = Date.now();
    try {
      const text = await once(p, prompt, { env, fetchFn, timeoutMs: a.timeoutMs, maxTokens: a.maxOutputTokens });
      if (!text || !String(text).trim()) throw new Error("empty answer");
      return { ok: true, text: String(text), provider: p.type, model: p.model, ms: Date.now() - t0 };
    } catch (e) {
      const msg = clip((e && e.message) || e, 170); tried.push(p.type + " " + msg);
      off[id] = now + (a.pauseMin || 30) * 6e4;   // rotate: do not hammer a provider that just failed / hit its free limit
    }
  }
  return { ok: false, why: tried.length ? tried.join(" | ") : "no providers configured" };
}
module.exports = { call, hasKey, textOf, why };
