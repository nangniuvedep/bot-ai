/* state-worker.mjs — Cloudflare Worker that holds bot-state.json.
   GET  /state.json   public, read-only, CORS *, never cached  (the page reads this)
   PUT  /state        needs  Authorization: Bearer <WRITE_TOKEN>  (only the bot writes)
   Needs: KV namespace bound as STATE, secret WRITE_TOKEN. Lives on *.workers.dev (already allowed by the app's connect-src).
   It touches nothing of the app. To remove it: delete the Worker and the KV namespace. */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" };
const json = (body, status = 200, extra = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...extra } });
const MAX_BYTES = 512 * 1024;

function same(a, b) { /* constant-time compare */
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/state.json" && req.method === "GET") {
      const v = await env.STATE.get("state");
      return v ? json(v) : json({ error: "no state yet" }, 404);
    }
    if (url.pathname === "/state" && req.method === "PUT") {
      const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
      if (!env.WRITE_TOKEN || !m || !same(m[1], env.WRITE_TOKEN)) return json({ error: "unauthorized" }, 401);
      const text = await req.text();
      if (text.length > MAX_BYTES) return json({ error: "too large" }, 413);
      let o; try { o = JSON.parse(text); } catch (e) { return json({ error: "not JSON" }, 400); }
      if (!o || o.v !== 1 || !Number.isFinite(o.updatedAt)) return json({ error: "not a v1 state" }, 400);
      const prev = await env.STATE.get("state");
      if (prev) { try { if (JSON.parse(prev).updatedAt > o.updatedAt) return json({ error: "older than stored state" }, 409); } catch (e) {} }
      await env.STATE.put("state", text);
      return json({ ok: true, updatedAt: o.updatedAt });
    }
    return json({ error: "not found" }, 404);
  }
};
