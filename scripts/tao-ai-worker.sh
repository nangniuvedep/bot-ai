#!/usr/bin/env bash
# Tao Worker bot-ai-llm (Workers AI, khong can API token) o tai khoan PHU, sinh mat khau ngau nhien, dat secret cho Worker va GitHub.
set -euo pipefail
cd "$(dirname "$0")/../worker"
npx wrangler whoami 2>&1 | grep -q "nangniuvedep@gmail.com" || { echo "Sai tai khoan Cloudflare: chay npx wrangler logout && npx wrangler login (chon tai khoan PHU nangniuvedep)"; exit 1; }
T=$(openssl rand -hex 32)
npx wrangler deploy -c wrangler-ai.toml
printf '%s' "$T" | npx wrangler secret put AI_TOKEN -c wrangler-ai.toml
gh secret set AI_PROXY_TOKEN --repo nangniuvedep/bot-ai --body "$T"
gh secret set AI_PROXY_URL --repo nangniuvedep/bot-ai --body "https://bot-ai-llm.nangniuvedep.workers.dev"
echo "Xong: Worker bot-ai-llm + 2 secret AI_PROXY_URL / AI_PROXY_TOKEN."
