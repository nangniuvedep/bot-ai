/* ai-provider.js — calls an LLM through a PRIORITY LIST of providers (config ai.providers, smartest first).
   A provider without its key is skipped; one that fails (429 / timeout / error) is put on a short pause (ledger L.aiOff) and the next one answers.
   Keys come from environment variables only (GitHub Secrets) — never from the repo. Nothing here knows the trading rules.
   call(cfg, {system, user}, {env, fetchFn, L, now}) -> {ok:true, text, provider, model, ms} | {ok:false, why} */
"use strict";

const clip = (s, n = 120) => String(s || "").replace(/\s+/g, " ").slice(0, n);

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
    body = await readBody(r); const res = body.result || {};
    return typeof res.response === "string" ? res.response : (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || "";
  }
  if (p.type === "worker-ai") {   // our own tiny Worker (worker/ai-worker.mjs) that holds the Workers AI binding: no Cloudflare API token needed
    r = await fetchFn(env[p.urlEnv || "AI_PROXY_URL"], { method: "POST", signal: sig, headers: { ...json, authorization: "Bearer " + env[p.keyEnv || "AI_PROXY_TOKEN"] },
      body: JSON.stringify({ model: p.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, temperature: 0.2 }) });
    body = await readBody(r); const res = body.result || {};
    return typeof res.response === "string" ? res.response : (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || "";
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
      const msg = clip((e && e.message) || e, 90); tried.push(p.type + " " + msg);
      off[id] = now + (a.pauseMin || 30) * 6e4;   // rotate: do not hammer a provider that just failed / hit its free limit
    }
  }
  return { ok: false, why: tried.length ? tried.join(" | ") : "no providers configured" };
}
module.exports = { call, hasKey };
