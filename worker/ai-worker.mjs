/* ai-worker.mjs — tiny Cloudflare Worker that lets the bot use Workers AI WITHOUT any API token.
   The AI binding lives inside this Worker; the bot (GitHub Actions) calls it with a shared password.
   POST /  Authorization: Bearer <AI_TOKEN>   body {model, messages, max_tokens?, temperature?}  ->  {result: <Workers AI output>}
   Only "@cf/..." models; message count/size capped. Needs: binding AI, secret AI_TOKEN. Delete the Worker to remove it. */
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
function same(a, b) { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
    if (!env.AI_TOKEN || !m || !same(m[1], env.AI_TOKEN)) return json({ error: "unauthorized" }, 401);
    let b; try { b = await req.json(); } catch (e) { return json({ error: "not JSON" }, 400); }
    if (!b || typeof b.model !== "string" || !/^@cf\/[\w.\-\/]+$/.test(b.model)) return json({ error: "model must be @cf/..." }, 400);
    if (!Array.isArray(b.messages) || !b.messages.length || b.messages.length > 6 || JSON.stringify(b.messages).length > 120000) return json({ error: "bad messages" }, 400);
    const max = Math.min(Math.max(+b.max_tokens || 1000, 16), 4000), temp = Math.min(Math.max(+b.temperature || 0.2, 0), 1);
    try { return json({ result: await env.AI.run(b.model, { messages: b.messages, max_tokens: max, temperature: temp }) }); }
    catch (e) { return json({ error: String((e && e.message) || e).slice(0, 200) }, 502); }
  }
};
