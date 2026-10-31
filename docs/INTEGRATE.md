# Bot AI inside the app: `bubblelayer.com/bot-ai/` (and how to remove it)

Decision (owner): the dashboard runs live on the app's own domain at its own path, uses what the app already has (prices, analysis pages),
is open for now (no link in the app, `noindex`; a password comes later), and removing it = deleting its folder + the few lines below.
The app and Bot AI keep separate version numbers and are fixed separately.

## What it reuses from the app (data and look only — never app code)
| Reuse | How | Risk |
|---|---|---|
| Prices | reads `https://data.bubblelayer.com/universe-slim-top.json` (what the app reads; already in `connect-src`) → live "current price" and open P/L of open positions (`open[].qty` needed). Any failure/old file → the price inside the state file | none |
| Bot's own signals | the bot reads `alerts-*.json` (bot side, `src/app-reader.js`) | none |
| Language layer | `/app-i18n.js` (20 languages), brand `translate="no"` | none |
| Look | logo, icons (`tools/sync-icons.js` rebuilds the sprite from the app's `ui-icon.js`), colours (copy in `bot-ai.css`) | low |
| Analysis pages | a link/button to `/analysis/` (not embedded) | none |
| App JavaScript functions/globals | **not used** (an app update could silently break the page, and the app's own tests could catch bot code) | avoided on purpose |

## Deploy rule that matters
The folder must live in the app's `pages/` (source: `ops/src/bot-ai/`), because Cloudflare Pages replaces the whole site on every deploy:
every app release must carry the current `bot-ai/` folder or it disappears at the next deploy. Update Bot AI alone by replacing that folder in the
repo and deploying; update the app as usual — as long as the folder is in the package, both keep working.

## Why it cannot mix up or break the app
1. **One-way dependency.** The page only reads one public JSON file (`bot-state.json`) and draws it. It never writes, never sends a
   command, never touches `localStorage` / cookies / IndexedDB, uses no app global except the translation layer (`__t`, `BLI18N`).
   The bot never writes into the app's infrastructure (R2 `bl-ta`, Workers, CSP) — see BOT-AI-DESIGN §1.
2. **Own folder `/bot-ai/`**, own HTML document. Its CSS and JS cannot collide with the app's (separate page, one namespace `window.BOTAI`).
3. **A versioned data contract** (`docs/STATE-CONTRACT.md`). The state file carries `"v"`. A newer/unknown `v` shows
   "This data version is not supported" — it never guesses. Unknown log keys are skipped.
4. **No inline script / handlers** → no new CSP hash to compute, `ops/compute-csp-hashes.py` is untouched.
5. **Checked by tools, not by memory**: `tools/check-seam.js` (rules above + CSP host) and `tools/test-ui.js` (every screen, 8 data modes,
   desktop + phone) must pass before every hand-over.

## The whole seam (app side) — 3 small edits, nothing else
| # | Where | What |
|---|---|---|
| 1 | `ops/src/bot-ai/` | copy the whole `ui/` folder here (like `ops/src/analysis/`); confirm `dong-goi.js` copies it to `pages/bot-ai/` |
| 2 | `ops/src/sw.js` | next to `isAnalysis()`: `/bot-ai/` must bypass the service worker (same reason as V1274: no mixed old/new files) |
| 3 | one button/link in the app | opens `/bot-ai/` (same domain → shares language and theme; the page itself never writes the app's storage) |

Serve `bot-state.json` from a small read-only Worker on `*.workers.dev` (already in `connect-src`) → no `_headers` edit. If the state lives on another host, add that one host to `connect-src`.
Then set `stateUrl` in `config.js` (the only file to configure) and run both tools.

## When the app releases a new version
- Nothing to do for the page unless the app's data files change shape. Then the bot side (`config/app-contract.json` + `src/app-reader.js`) is fixed,
  **not** the page. The page only sees `bot-state.json`.
- If the app changes its icons: `node tools/sync-icons.js <app>/ops/src/ui-icon.js` (rebuilds the sprite from the app's own file).
- If the app's design tokens change: the page keeps its copy in `bot-ai.css` (`:root`) — replace it with `/style.css` only if you want it to follow the app automatically.
- Re-run `check-seam.js <app>/pages/_headers` after pulling a new app version (catches a CSP change that would block `stateUrl`).

## Text and languages
English-first; fixed text is plain English, text with numbers uses `__t("... {x} ...", {x})`. The bot sends keys + values, never sentences
(`log[].k` → template in `bot-ai.js`). All source strings: `ui/i18n-strings.json` (regenerate: `node tools/test-ui.js --catalog`).
Add the 19 translations with the app's `ops/i18n/nap.js` and verify with `ops/i18n/kiem.js` before packaging (missing = not packaged).

## Password later
Nothing in the page needs to change: put Cloudflare Access (or any gate in front of `/bot-ai/*`) when wanted; the state Worker can be locked the same way.

## Removing it
Delete `ops/src/bot-ai/` (and `pages/bot-ai/`), the link (edit 3), the sw line (edit 2). The app is back to what it was. The bot (its own repo) is untouched.
