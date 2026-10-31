# bot-state.json — contract between the bot (writer) and the page (reader)

Written only by the bot, read-only for the page. Change the shape = bump `v`; the page refuses unknown `v`.

```
{ "v": 1, "updatedAt": <ms>, "mode": "paper", "status": "running" | "halted",
  "start": <number>, "todayPnl": <number>,
  "equity": [[<ms>, <number>], ...],                       // >= 2 points, oldest first
  "risk": { "dayLoss", "dayLimit", "positions", "maxPositions", "openRisk", "openRiskLimit",   // money / counts / fractions (0.03 = 3%)
            "drawdown", "drawdownLimit", "killSwitch": <bool> },
  "open":   [{ "coin", "tf", "entry", "price", "qty", "sl", "tp", "pnl", "pnlPct" }],   // coin = ticker (SOL); qty = size in coins, lets the page refresh price/P&L live
  "closed": [{ "t": <ms>, "coin", "tf", "r": <R multiple>, "pnl" }],
  "signals":[{ "coin", "tf", "rule", "val": "both" | "spread", "st": "wait" | "watch" | "skip" }],
  "log":    [{ "t": <ms>, "k": "run" | "cand" | "open" | "skip" | "close", "v": { ...values for that key } }] }
```
Rules: times are UTC epoch ms (the page shows them in the reader's time zone); no sentences, no HTML — only keys and values;
every value is escaped by the page; win rate, expectancy and profit factor are computed by the page from `closed`.
Fresh: the page shows STALE DATA when `updatedAt` is older than `config.staleAfterMin`.

## Optional fields added in V6 (still `v: 1`; a page that does not know them ignores them)
- `open[]`: `side` ("BUY" only), `market` ("spot"), `leverage` (always 1), `status` ("open"), `entryTime`, `expiry`, `notional`, `riskAmt`, `slPct`, `tpPct`, `pnlR`, `rule`, `by` ("ai"|"rules"), `aiWhy`, `aiConf`, `aiConv`, `aiModel`.
- `closed[]`: `side`, `leverage`, `entry`, `exit`, `qty`, `entryTime`, `why` ("target"|"stop"|"time"|"ai"), `rule`, `sl`, `tp`, `riskAmt`, `by`, `aiWhy`.
- `rules`: the real limits from config (market, side, leverage, stopAtr, targetAtr, maxHoldCandles, riskPct, ...). The validator rejects `leverage != 1` or `side != "long"`.
- `ai`: `{mode, providers[], last:{t, ok, provider, model, ms, view, noTrade, why, candidates, picked, calls}}`.
- `decisions[]`: last 40 `{t, coin?, tf?, rule?, action: open|skip|wait|close|ai-view, reason, why?, conf?, conv?, provider?, model?}`. `why` is a short AI sentence (<=200 chars); the page escapes it.
