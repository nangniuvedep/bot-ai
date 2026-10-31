# Bot rules as implemented (B2) — all numbers live in `config/bot-config.json`

Long-only spot, virtual money, no leverage. `node src/run.js` = one round (every 15 min via `workflow/bot.yml`).

## A round
1. **Exits first**, from 1-minute candles since the last check, in time order. A candle touching stop and target counts as the **stop**.
   After `maxHoldCandles` (10) the position leaves at the **open of the next candle** (minus `timeoutSlipPct`). Stop fills at stop − `stopSlipPct`; target fills at target.
2. **Read the app** (`signals`, `brief`, `validation`). Any file missing/old/wrong version → **no new entries** this round (exits and state still run).
   `signals` and `brief` must be from the same round (`at` equal) or that timeframe is skipped.
3. **Candidates**: a coin with an **up** hit (dir = +1) on 1H/4H whose code is **green** (below), whose entry candle (= the app's `at`, the moment the signal candle closed) is already open and not older than `maxEntryDelayMin` (30).
4. **Entry** (virtual): fill = open of the entry candle × (1 + spread/2 + book slippage for the order size). Refused when:
   spread > 0.15 % (`spread`, logged as a skip) · ask is more than 0.5 ATR above the open (`chase`) · visible depth (20 levels) cannot fill the size (`depth`) ·
   stop distance outside 0.3–12 % of price (`stop-size`) · already holding the coin · cooldown (3 candles after a close) · max 5 positions · day loss ≥ 3 % · open risk > 5 % · kill switch / drawdown halt.
5. **Size**: risk 1 % of equity per trade = qty × (stop distance + both fees); notional capped at 25 % of equity and at available cash.
   Stop = entry − 1 ATR, target = entry + 2 ATR (cfg `"1-2"`, the same ruler as the Validation page), ATR = the signal candle's ATR(14) from `brief`.
6. **Fees** 0.1 % per side. **Equity** = cash + open positions at the last 1-minute close. Drawdown ≥ 10 % from peak → **halted** (sticky: set `halted:false` in the ledger by hand to resume).
7. **Never twice**: each signal `coin|tf|at` is recorded; re-runs and reloads cannot enter it again. A temporary refusal (limits, cooldown, no market data) retries next round until the 30-minute window ends.

## Added after comparing with other bots (3Commas, Bitsgap, Cryptohopper, Coinrule, Hummingbot, FreqAI, Alpha Arena)
- **Ranking + round limit**: candidates are sorted by edge over the random base (then liquidity); at most `maxNewPerRound` (2) new entries per round, the rest wait and
  retry next round inside the entry window. Reason: dozens of coins can be green at once (market-wide move) and would all be the same bet.
- **Trades per day** `maxTradesPerDay` (6): overtrading was the clearest failure of the AI traders in Alpha Arena (fees > 13 % of capital).
- **Rule guard** `codeGuard`: a V8 code with >= 12 live closed trades whose average of the last 20 is below -0.3R is paused for 72 h and then restarts from a clean count.
  (Validation is the past; this watches the future.)
- **Decision journal** `data/decisions.jsonl`: one JSON line per decision (open / skip / wait once per reason / rule paused), with the numbers behind it (edge, spread, chase, slippage, entry, stop, target, AI verdict).
- **AI veto gate** (`src/ai-gate.js`, config `ai`, default `"off"`): the AI may only say take / shrink (size clamped to [0.25, 1]) / skip. It cannot add trades, raise size or touch stops/exits.
  Invalid answer = that signal is skipped and never re-asked; provider down/slow/over `maxCallsPerDay` = wait and retry; `veto` mode without a provider never trades blind.
  Write `src/ai-provider.js` from `ai-provider.example.js` (one function, key from an environment variable), then set `ai.mode` to `"veto"`.
  Judge it only forward, against the rule bot, on >= 200 closed trades.
- Deliberately NOT copied: grid / DCA / martingale (they add to losers), copy trading, AI-as-executor, leverage.

## "Green" — an ASSUMPTION to confirm against the app's Validation page
Win rate (right / (right + wrong), cfg "1-2") beats the random-candle base rate by ≥ 2 points in **both** periods (70 % and 30 %), each judged on ≥ 50 hits.
The app's exact formula is in its page code and was not available (DATA-CONTRACT §3 [KIỂM]). If it differs, change `greenEdge()` in `src/bot.js` only.

## Files
- `data/ledger.json` — the full book (positions, closed trades, seen signals, cooldowns, log). Never edit while a round runs.
- `data/bot-state.json` — what the page shows; publish with `tools/publish-state.js`.

## Not done yet
- Data from the app and Binance has never been read live from here (no network to those hosts in the build environment): run `node src/run.js --dry` once on a real machine and read the "·" lines.
- B3 extra sources (Fear & Greed, stablecoins, funding) are not started; the bot works without them. A market-wide regime filter was left out on purpose: no source showed it helps, so it needs its own forward test first.
- No AI provider is wired (none chosen yet): `ai.mode` stays `"off"`.
