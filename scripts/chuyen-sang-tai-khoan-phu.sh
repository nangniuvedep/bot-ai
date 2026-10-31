#!/usr/bin/env bash
# ĐÃ CHẠY XONG 31/10/2026 (V4). Chỉ giữ làm lịch sử, KHÔNG chạy lại: id KV/URL cũ trong file này là của tài khoản CHÍNH đã bỏ.
# Chuyển Worker bot-ai-state (+ KV) và Pages bot-ai-ui từ tài khoản Cloudflare CHÍNH sang tài khoản PHỤ.
# Chạy:  bash scripts/chuyen-sang-tai-khoan-phu.sh
# Không đụng app BubbleLayer, không đụng R2/guard. Bản cũ ở tài khoản chính: bạn tự xóa bằng tay sau khi xong.
# Cần: node >= 18, npx, gh (đã đăng nhập GitHub nangniuvedep), openssl, curl.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
REPO="nangniuvedep/bot-ai"
PAGES_NAME="${PAGES_NAME:-bot-ai-ui}"
OLD_HOST="bot-ai-state.looknow.workers.dev"
OLD_KV="da0251bef602435f8ba4c1cab6c2f754"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nDỪNG: %s\n' "$*" >&2; exit 1; }

for c in node npx gh openssl curl perl; do command -v "$c" >/dev/null || die "thiếu lệnh: $c"; done

say "1. Kiểm tra đang đăng nhập ĐÚNG tài khoản phụ"
WHO="$(npx --yes wrangler whoami 2>&1 || true)"
printf '%s\n' "$WHO" | grep -E 'email|Account Name|│' | head -8
if printf '%s' "$WHO" | grep -qiE 'looknow'; then
  die "đang đăng nhập tài khoản CHÍNH (Looknow). Chạy:  npx wrangler logout && npx wrangler login  (chọn tài khoản PHỤ nangniuvedep) rồi chạy lại script."
fi
printf '%s' "$WHO" | grep -qiE 'logged in' || die "wrangler chưa đăng nhập. Chạy: npx wrangler login (tài khoản phụ)"
read -r -p 'Tài khoản ở trên đúng là PHỤ nangniuvedep? gõ "yes": ' ok
[ "$ok" = "yes" ] || die "chưa xác nhận"
gh auth status >/dev/null 2>&1 || die "gh chưa đăng nhập. Chạy: gh auth login (GitHub nangniuvedep)"
gh repo view "$REPO" >/dev/null 2>&1 || die "gh không thấy repo $REPO (sai tài khoản GitHub?)"

say "2. Tạo KV mới trên tài khoản phụ"
KV_OUT="$(cd worker && npx --yes wrangler kv namespace create STATE 2>&1)" || { echo "$KV_OUT"; die "tạo KV lỗi"; }
echo "$KV_OUT"
NEW_KV="$(printf '%s' "$KV_OUT" | grep -Eo '[0-9a-f]{32}' | head -1)"
[ -n "$NEW_KV" ] || die "không đọc được id KV từ kết quả trên"
[ "$NEW_KV" != "$OLD_KV" ] || die "id KV trùng bản cũ: đang đăng nhập nhầm tài khoản chính"
perl -pi -e "s/\Q$OLD_KV\E/$NEW_KV/" worker/wrangler.toml
grep -q "$NEW_KV" worker/wrangler.toml || die "không ghi được id KV vào worker/wrangler.toml"
echo "KV mới: $NEW_KV"

say "3. Deploy Worker bot-ai-state"
DEP_OUT="$(cd worker && npx --yes wrangler deploy 2>&1)" || { echo "$DEP_OUT"; die "deploy lỗi"; }
echo "$DEP_OUT"
NEW_URL="$(printf '%s' "$DEP_OUT" | grep -Eo 'https://bot-ai-state[A-Za-z0-9.-]*\.workers\.dev' | head -1)"
[ -n "$NEW_URL" ] || die "không đọc được URL Worker từ kết quả trên"
case "$NEW_URL" in *looknow*) die "URL còn là looknow: đang đăng nhập nhầm tài khoản chính";; esac
echo "Worker mới: $NEW_URL"

say "4. Đặt WRITE_TOKEN mới (lưu ~/.bot-ai-token, bản cũ đổi tên .old)"
[ -f "$HOME/.bot-ai-token" ] && mv "$HOME/.bot-ai-token" "$HOME/.bot-ai-token.old"
umask 077
TOK="$(openssl rand -hex 32)"
printf '%s' "$TOK" > "$HOME/.bot-ai-token"
(cd worker && printf '%s' "$TOK" | npx --yes wrangler secret put WRITE_TOKEN)

say "5. Sửa địa chỉ trong ui/config.js và docs/DEPLOYED.md"
perl -pi -e "s#https://\Q$OLD_HOST\E#$NEW_URL#g; s/\Q$OLD_KV\E/$NEW_KV/g" ui/config.js docs/DEPLOYED.md
grep -q "$NEW_URL" ui/config.js || die "ui/config.js chưa được sửa"

say "6. Cập nhật 2 secret GitHub của repo bot"
gh secret set BOT_STATE_URL --repo "$REPO" --body "$NEW_URL"
gh secret set BOT_STATE_TOKEN --repo "$REPO" --body "$TOK"

say "7. Đẩy state hiện tại sang Worker mới (lấy từ nhánh bot-data công khai)"
TMP="$(mktemp)"
if curl -fsSL "https://raw.githubusercontent.com/$REPO/bot-data/bot-state.json" -o "$TMP"; then
  BOT_STATE_URL="$NEW_URL" BOT_STATE_TOKEN="$TOK" node tools/publish-state.js "$TMP" || echo "(không đẩy được state cũ; vòng bot kế tiếp sẽ tự đẩy)"
else
  echo "(không tải được bot-state.json; vòng bot kế tiếp sẽ tự đẩy)"
fi
rm -f "$TMP"

say "8. Kiểm tra đọc công khai"
code="$(curl -s -o /dev/null -w '%{http_code}' "$NEW_URL/state.json")"
echo "GET $NEW_URL/state.json -> $code (200 = có state; 404 = chưa có, chờ vòng bot kế)"

say "9. Deploy trang xem thử (Pages) lên tài khoản phụ"
npx --yes wrangler pages project create "$PAGES_NAME" --production-branch main >/dev/null 2>&1 || true
npx --yes wrangler pages deploy ui --project-name "$PAGES_NAME" --branch main || echo "(Pages lỗi: không ảnh hưởng bot; xem lại sau)"

say "XONG"
cat <<EOF
Worker mới : $NEW_URL/state.json
Token mới  : ~/.bot-ai-token
Còn lại, bạn làm tay:
  a) Đẩy code đã sửa lên repo bot:  cd "$ROOT" && git add -A && git commit -m "move state worker to secondary account" && git push
  b) Chạy thử 1 vòng:  gh workflow run bot.yml --repo $REPO
  c) Xóa Worker bot-ai-state, KV STATE ($OLD_KV) và Pages bot-ai-ui ở tài khoản chính Looknow.
EOF
