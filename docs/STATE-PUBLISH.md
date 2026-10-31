# Publishing bot-state.json (step B2 wiring)

Flow: **bot** builds the state object -> `validate()` -> `PUT /state` (token) -> **Worker** stores it -> **page** reads `GET /state.json`.
The page never writes. The bot never touches the app. Nothing here is on the app's infrastructure.

## One-time setup (Cloudflare, ~5 min)
1. `cd worker && npx wrangler kv namespace create STATE` -> paste the printed id into `wrangler.toml`.
2. `npx wrangler secret put WRITE_TOKEN` -> any long random string (keep it; the bot needs the same value).
3. `npx wrangler deploy` -> note the URL, e.g. `https://bot-ai-state.<account>.workers.dev`.
4. Put `https://bot-ai-state.<account>.workers.dev/state.json` into `ui/config.js` as `stateUrl`.
   `*.workers.dev` is already in the app's `connect-src`, so `_headers` needs no edit (confirm with `node tools/check-seam.js <app>/pages/_headers`).

## Every time the bot has new numbers
```
export BOT_STATE_URL=https://bot-ai-state.<account>.workers.dev
export BOT_STATE_TOKEN=<the WRITE_TOKEN>
node tools/publish-state.js bot-state.json          # validates first; an invalid file is never sent
node tools/publish-state.js bot-state.json --check  # validate only
```
In code: `const { validate } = require("./src/state-contract.js")`, then `PUT` the JSON like `tools/publish-state.js` does.
The Worker refuses: no/wrong token (401), not a v1 state (400), larger than 512 KB (413), older `updatedAt` than the stored one (409).
Publish at least every `staleAfterMin` (45) minutes or the page shows STALE DATA — also when nothing changed: just refresh `updatedAt`.

## Try it without Cloudflare
`node tools/serve.js --dump-sample state.json`, edit it, `node tools/publish-state.js state.json --check`, `node tools/serve.js --state state.json`.

## What is NOT here
The rule bot and paper ledger that *produce* the state (B2 proper) are not written: their rules are still open in `BOT-AI-DESIGN.md`.
Until then the file can come from any script that follows `STATE-CONTRACT.md`.

## Remove
Delete the Worker and the KV namespace in Cloudflare, and clear `stateUrl`. The page falls back to sample data.
