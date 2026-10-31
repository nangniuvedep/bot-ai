#!/usr/bin/env bash
# setup-ui.sh — chuẩn bị trang Bot AI để chạy ở https://bubblelayer.com/bot-ai/
# Bước 1: bash setup-ui.sh              -> liệt kê thư mục app tìm thấy
# Bước 2: bash setup-ui.sh <thư-mục-app> -> cấu hình, kiểm tra, rồi chép ui/ vào <app>/ops/src/bot-ai/
# Script KHÔNG sửa sw.js, KHÔNG deploy. Chỉ thêm 1 thư mục mới vào mã nguồn app.
set -euo pipefail

BOT=~/Bot-AI
STATE_URL="https://bot-ai-state.nangniuvedep.workers.dev/state.json"
APP="${1:-}"

if [ -z "$APP" ]; then
  echo "Thư mục app tìm thấy (có ops/src/sw.js):"
  find ~/Downloads ~/Desktop ~/Documents -maxdepth 5 -path '*/ops/src/sw.js' -not -path '*/node_modules/*' 2>/dev/null \
    | sed 's#/ops/src/sw.js$##' | sort -u
  echo
  echo "Chọn thư mục là bản app MỚI NHẤT bạn đang phát hành, rồi chạy:"
  echo "  bash $0 \"<đường-dẫn-app>\""
  exit 0
fi

APP="${APP%/}"
[ -f "$APP/ops/src/sw.js" ] || { echo "Không thấy $APP/ops/src/sw.js — sai thư mục app"; exit 1; }
[ -d "$BOT/ui" ] || { echo "Không thấy $BOT/ui"; exit 1; }

echo "== 1. Đặt stateUrl trong ~/Bot-AI/ui/config.js =="
STATE_URL="$STATE_URL" BOT="$BOT" node -e '
const fs=require("fs"), p=process.env.BOT+"/ui/config.js";
let s=fs.readFileSync(p,"utf8");
s=s.replace(/stateUrl:\s*"[^"]*"/,"stateUrl: \""+process.env.STATE_URL+"\"");
fs.writeFileSync(p,s);'
grep -n "stateUrl" "$BOT/ui/config.js"

echo "== 2. Kiểm tra theo luật của app (check-seam + test-ui) =="
HDR="$APP/pages/_headers"
[ -f "$HDR" ] || HDR=$(find "$APP" -maxdepth 4 -name _headers -not -path '*/node_modules/*' | head -1)
[ -n "$HDR" ] && [ -f "$HDR" ] || { echo "Không thấy file _headers của app"; exit 1; }
echo "dùng _headers: $HDR"
( cd "$BOT" && node tools/check-seam.js "$HDR" && node tools/test-ui.js )

echo "== 3. Lưu cấu hình vào repo bot =="
if git -C "$BOT" diff --quiet -- ui/config.js; then
  echo "config.js không đổi"
else
  git -C "$BOT" add ui/config.js
  git -C "$BOT" commit -qm "ui: stateUrl"
  git -C "$BOT" push -q origin main
  echo "đã commit + push"
fi

echo "== 4. Chép ui/ vào mã nguồn app (chỉ thêm thư mục mới ops/src/bot-ai) =="
rm -rf "$APP/ops/src/bot-ai"
cp -R "$BOT/ui" "$APP/ops/src/bot-ai"
ls "$APP/ops/src/bot-ai"

echo
echo "== 5. Thông tin để sửa sw.js và kiểm tra đóng gói (dán phần này lên chat) =="
echo "--- sw.js: isAnalysis ---"
grep -n -B2 -A6 "isAnalysis" "$APP/ops/src/sw.js" | head -40 || true
echo "--- dong-goi.js: analysis ---"
DG=$(find "$APP" -name 'dong-goi.js' -not -path '*/node_modules/*' | head -1)
echo "file: ${DG:-không thấy}"
[ -n "$DG" ] && grep -n -i "analysis" "$DG" | head -20 || true
echo "--- cách bạn deploy: wrangler / script ---"
ls "$APP" | head -30
