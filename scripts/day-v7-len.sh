#!/usr/bin/env bash
# Day V7 len GitHub (thay V6 tren nhanh main) + deploy trang giao dien + chay bot 1 vong + xem log.
# Chay: bash ~/Downloads/Bot-AI-V4/scripts/day-v7-len.sh     (thu muc nay = ban V7 vua giai nen)
# Chi dung tai khoan PHU: GitHub nangniuvedep, Cloudflare nangniuvedep@gmail.com. Khong dung vao Looknow.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"; REPO="nangniuvedep/bot-ai"; cd "$SRC"
say() { printf '\n== %s\n' "$*"; }

say "1/6 Chay test (6 bo)"
for t in test/*.test.js; do node "$t" | tail -1; done

say "2/6 Kiem tra tai khoan"
LOGIN="$(gh api user -q .login 2>/dev/null || true)"
[ "$LOGIN" = "nangniuvedep" ] || { echo "GitHub dang la '${LOGIN:-chua dang nhap}', can nangniuvedep. Chay: gh auth login"; exit 1; }
npx wrangler whoami 2>&1 | grep -q "nangniuvedep@gmail.com" || { echo "Sai tai khoan Cloudflare. Chay: npx wrangler logout; npx wrangler login (tai khoan nangniuvedep@gmail.com), roi chay lai script nay."; exit 1; }
echo "OK: GitHub nangniuvedep, Cloudflare nangniuvedep@gmail.com"

say "3/6 Chep V7 vao ban sao repo moi (khong dung vao thu muc nay)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
gh repo clone "$REPO" "$TMP/repo" -- -q
cd "$TMP/repo"; git checkout -q main
rsync -a --delete --exclude .git --exclude node_modules --exclude state.json --exclude worker/.wrangler --exclude .DS_Store "$SRC/" "$TMP/repo/"
git add -A
if git diff --cached --quiet; then echo "Khong co thay doi so voi main (V7 da len roi)."; else
  git diff --cached --stat | tail -15
  git config user.name >/dev/null 2>&1 || git config user.name "nangniuvedep"
  git config user.email >/dev/null 2>&1 || git config user.email "nangniuvedep@users.noreply.github.com"
  git commit -q -m "V7: short mo phong, tu doi SL/TP (hoa von, bam duoi, noi target), AI manage, trang Performance"
  say "4/6 Day len main"
  git push -q origin main && echo "Da day: $(git rev-parse --short HEAD)"
fi
cd "$SRC"

say "5/6 Deploy trang giao dien (Pages bot-ai-ui)"
npx wrangler pages deploy ui --project-name bot-ai-ui --branch main

say "6/6 Chay bot 1 vong va xem log"
gh workflow run bot.yml --repo "$REPO"; sleep 20
ID="$(gh run list --repo "$REPO" --workflow bot.yml --limit 1 --json databaseId -q '.[0].databaseId')"
echo "Ma vong chay: $ID"
gh run watch "$ID" --repo "$REPO" --exit-status || true
gh run view "$ID" --repo "$REPO" --log | grep -iE "AI mode|ENTERED|manage|AI unavailable|AI:|nothing to decide|round done|failed|rule " | head -30 || true
echo; echo "Xong. Mo https://bot-ai-ui-6jx.pages.dev (Cmd+Shift+R), vao muc Performance va AI decisions."
