#!/usr/bin/env bash
# setup-repo.sh — tạo repo GitHub công khai "bot-ai", nhánh bot-data, và 2 secret.
# Chạy:  bash ~/Downloads/setup-repo.sh
set -euo pipefail

cd ~/Bot-AI

command -v gh >/dev/null 2>&1 || { echo "Chưa cài gh CLI"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Chưa đăng nhập gh. Chạy: gh auth login  (GitHub.com, HTTPS, trình duyệt) rồi chạy lại script này."; exit 1; }
[ -s ~/.bot-ai-token ] || { echo "Không thấy ~/.bot-ai-token"; exit 1; }

echo "== 1. Làm sạch git cũ, tạo .gitignore =="
rm -rf .git
printf 'state.json\nworker/.wrangler/\nnode_modules/\n.DS_Store\n' > .gitignore

GH_USER=$(gh api user -q .login)
GH_ID=$(gh api user -q .id)

echo "== 2. Khởi tạo repo local (danh tính: $GH_USER, email noreply) =="
git init -q -b main
git config user.name "$GH_USER"
git config user.email "${GH_ID}+${GH_USER}@users.noreply.github.com"
git add -A
git commit -qm "bot-ai"
mkdir -p .github/workflows
cp workflow/bot.yml .github/workflows/bot.yml
git add -A
git diff --cached --quiet || git commit -qm "workflow"

echo "== 3. Kiểm tra không có file nhạy cảm bị đưa vào =="
if git ls-files | grep -Eq '(^|/)\.wrangler/|^state\.json$'; then
  echo "LỖI: .wrangler hoặc state.json vẫn nằm trong commit. Dừng."; exit 1
fi
echo "OK"

echo "== 4. Tạo repo công khai bot-ai và đẩy main =="
gh repo create bot-ai --public --source=. --remote=origin --push

echo "== 5. Tạo nhánh bot-data =="
git switch --orphan bot-data
git commit -q --allow-empty -m init
git push origin bot-data
git switch main

echo "== 6. Đặt secret =="
gh secret set BOT_STATE_URL   --body "https://bot-ai-state.nangniuvedep.workers.dev"
gh secret set BOT_STATE_TOKEN --body "$(cat ~/.bot-ai-token)"
gh secret list

echo "== Xong =="
gh repo view --json url -q .url
git branch -a
