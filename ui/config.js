/* config.js — the ONLY place the page is configured. Everything else reads window.BOTAI.config. */
(function () {
  "use strict";
  window.BOTAI = window.BOTAI || {};
  window.BOTAI.config = {
    /* Public, read-only URL of the bot's state file (written by the bot, never by this page).
       Empty = show the built-in sample data. The host must be allowed by connect-src in pages/_headers
       (https://*.workers.dev already is) — run tools/check-seam.js to verify. */
    stateUrl: "https://bot-ai-state.looknow.workers.dev/state.json",
    /* Live prices: the same public file the app reads (host already allowed by connect-src). Empty = use prices inside the state file. */
    priceUrl: "https://data.bubblelayer.com/universe-slim-top.json",
    priceMaxAgeMin: 15,          /* older price file -> ignored, state-file prices are used */
    supportedStateVersions: [1], /* a file with another "v" is refused, never guessed */
    staleAfterMin: 45,           /* older than this -> STALE badge */
    refreshSec: 60,
    timeoutMs: 15000
  };
})();
