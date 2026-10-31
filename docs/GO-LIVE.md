# Before any real money (checklist — paper first, always)

The bot trades virtual money. These are the steps the established platforms (3Commas, Cryptohopper, Bitsgap, Coinrule) apply before real orders; this is not financial advice.

1. **Evidence first**: >= 200 closed paper trades, positive average R **after** fees and slippage, in both 1H and 4H, over more than one market phase. Read `data/decisions.jsonl` and the closed list, not just the equity line.
2. **Exchange key**: create a new API key with **trading permission only, withdrawals disabled**, restricted to the IP the bot runs from. Never reuse a key. Keep it in a secret, never in the repo.
3. **Start tiny**: a small fraction of the intended size, same rules, kill switch tested (`killSwitch: true` in `config/bot-config.json`, or `kill: true` in the ledger) — a halt must still manage exits.
4. **Order handling**: real orders can partly fill, be rejected or slip more than the paper model. Live execution is a separate piece of code (not written); compare its fills to the paper fills for the same signals before scaling.
5. **Daily check**: drawdown, trades per day, any paused rule (`rule-paused` in the journal), AI skips (if the AI veto is on).
6. **Never**: grid/martingale add-ons, leverage, AI placing orders directly.
