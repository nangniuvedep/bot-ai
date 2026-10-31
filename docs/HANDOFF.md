# HANDOFF — V7 (2026-10-31, đêm) — không chứa bí mật

**Chat mới / AI mới: đọc file này, rồi `docs/DEPLOYED.md` (luật 2 tài khoản Cloudflare), rồi mới làm.**

## 0a. TÌNH TRẠNG MỚI NHẤT (31/10 đêm)
- V7.1 đã lên (c1b0e8b) nhưng vòng sau đó báo `worker-ai paused` (lệnh nghỉ 30 phút từ lỗi cũ). V7.2 (trong ZIP) xóa lệnh nghỉ cũ + nghỉ ngắn 3 phút cho phản hồi rỗng. Đẩy: `bash ~/Downloads/Bot-AI-V4/scripts/day-v7-len.sh "V7.2"` rồi đọc log.
- V7 ĐÃ lên GitHub `main` (162f90a) và trang Pages; vòng 41214156444 `success`.
- **LỖI ĐANG MỞ:** log `AI unavailable: gemini no-key | worker-ai empty answer | worker-ai empty answer | workers-ai no-key`. AI chưa trả lời được. V7.1 (trong ZIP này) sửa cách đọc phản hồi + tăng token + log chẩn đoán; **chưa đẩy lên**. Đẩy: `bash ~/Downloads/Bot-AI-V4/scripts/day-v7-len.sh "V7.1: fix AI empty answer"`, rồi đọc dòng `AI unavailable` hoặc `ENTERED` trong log.
- Nếu vẫn `empty answer`: dòng log giờ ghi `keys/finish/reasoning/out_tokens`. `finish=length` → tăng `maxOutputTokens` hoặc đổi model; `keys=` lạ → thêm dạng vào `textOf()`. Phương án dự phòng: đặt khóa `GEMINI_API_KEY` (nhà số 1) bằng `gh secret set GEMINI_API_KEY --repo nangniuvedep/bot-ai`.

## 0. V7: short mô phỏng + quản lý SL/TP (đã deploy)
- Code V7 có trong ZIP này, 6 bộ test pass, nhưng **chưa commit/push, chưa chạy với dữ liệu thật**. Chi tiết: `docs/CHANGELOG.md` mục V7.
- **Đưa lên bằng một lệnh:** `bash ~/Downloads/Bot-AI-V4/scripts/day-v7-len.sh` (test → kiểm tài khoản → clone repo mới → chép V7 đè → commit/push main → deploy Pages → chạy bot → xem log). Dưới đây là cách làm tay tương đương.
- Cách đưa lên: chép code vào repo git thật → `git add -A && git commit -m "V7 short + trade management" && git push`; rồi deploy lại trang: `cd ~/Downloads/Bot-AI-V4 && npx wrangler pages deploy ui --project-name bot-ai-ui --branch main` (whoami phải là nangniuvedep@gmail.com). Worker AI/state KHÔNG cần deploy lại. Chạy tay: `gh workflow run bot.yml --repo nangniuvedep/bot-ai`.
- Tắt riêng short: `"allowShort": false` trong `config/bot-config.json`. Tắt quản lý stop: `"manage": {"enabled": false}`.
- **Phải xác nhận sau vòng chạy đầu:** (a) log có dòng `ENTERED SHORT`/`ENTERED LONG`; (b) trang Performance và nhãn SELL hiển thị đúng; (c) tên trường mới không làm UI cũ vỡ (đã nới `state-contract.js`).
- Rủi ro đã biết: số liệu "xanh" của short dùng base `dn` nhưng chưa rõ bảng Validation có trộn hướng (xem `docs/DATA-CONTRACT.md` mục 3); short mô phỏng không tính phí vay/funding thật (chỉ 0.03%/ngày giả định); chưa có agent baseline nên chưa chứng minh AI hơn luật.
- Việc kế tiếp đề xuất: (1) agent baseline luật thuần chạy song song; (2) chốt lời từng phần; (3) dữ liệu mới: nến thô + khung 1D + funding/OI; (4) biểu đồ nến có điểm vào/SL/TP; (5) cảnh báo Telegram.

## 1. Đang ở đâu (trước V7)
- Code V6.1 đã ở nhánh `main` của `nangniuvedep/bot-ai` (ada1517 → deb2a0e). ZIP này = bản V6.1 đầy đủ (65 file + HANDOFF), 5 bộ test pass trong sandbox.
- Cloudflare (tài khoản PHỤ `nangniuvedep@gmail.com`) ĐÃ XONG:
  - Worker AI `bot-ai-llm` → `https://bot-ai-llm.nangniuvedep.workers.dev` (binding Workers AI, secret `AI_TOKEN`).
  - GitHub secret `AI_PROXY_URL`, `AI_PROXY_TOKEN` đã đặt.
  - Trang giao diện V6: `https://bot-ai-ui-6jx.pages.dev` (đã deploy; lỗi hiển thị cũ → Cmd+Shift+R).
  - Worker state `bot-ai-state` giữ nguyên như V4.
- Vòng chạy 41212430677 (sau khi có secret): `success`. Log:
  - `AI mode = decide: providers gemini/gemini-2.5-flash (NO KEY) → worker-ai/@cf/openai/gpt-oss-120b → worker-ai/@cf/google/gemma-4-26b-a4b-it → workers-ai/@cf/openai/gpt-oss-120b (NO KEY)`
  - `round done · equity 9968.16 · open 2 · closed 2 · status running · decisions 1`
  - Không có dòng `AI unavailable`, không có `ENTERED`. Nghĩa là: đường ống chạy, chưa thấy AI vào lệnh nào (có thể do không có tín hiệu hoặc AI chọn không vào).

## 2. Việc kế tiếp (theo thứ tự)
1. **Xác nhận AI thật sự trả lời.** Mở `https://bot-ai-ui-6jx.pages.dev` → mục "AI decisions": phải thấy nhà AI (worker-ai/gpt-oss-120b), nhận định thị trường, lý do quyết định. Hoặc: `curl -s https://bot-ai-state.nangniuvedep.workers.dev/state.json | jq '.ai, .decisions[0:3]'`. Nếu rỗng/lỗi: xem log vòng chạy với `grep -iE "AI unavailable|AI:|HTTP"`; tên model sai (HTTP 400/404) thì sửa `config/bot-config.json` → `ai.providers`.
2. Chờ vài vòng cron (15 phút/vòng) để thấy ít nhất một `ENTERED by AI` hoặc `nothing to decide` có lý do; kiểm lệnh mở/đóng trên UI khớp state.
3. (Tuỳ chọn) Thêm khóa `GEMINI_API_KEY` vào GitHub secret để Gemini làm nhà số 1: `gh secret set GEMINI_API_KEY --repo nangniuvedep/bot-ai`. Hiện đang chạy bằng Worker AI miễn phí.
4. Việc cũ còn mở (xem `docs/DEPLOYED.md` mục 6): xóa bản cũ ở Looknow (người dùng tự làm), hợp đồng chống lệch + fixture thật, gắn vào app, P1 sửa vào lệnh hồi tố, agent baseline để so sánh AI.

## 3. Lệnh hay dùng (một dòng, dán vào zsh; thư mục dự án `~/Downloads/Bot-AI-V4`)
- Kiểm tài khoản trước mọi lệnh wrangler: `npx wrangler whoami` (email phải là nangniuvedep@gmail.com).
- Chạy bot tay: `gh workflow run bot.yml --repo nangniuvedep/bot-ai`
- Lấy mã vòng mới nhất: `gh run list --repo nangniuvedep/bot-ai --limit 1`
- Xem log vòng (cần mã số, không có thì gh đòi chế độ tương tác): `gh run view <MÃ> --repo nangniuvedep/bot-ai --log | grep -iE "AI mode|ENTERED|AI unavailable|AI:|nothing to decide|round done|failed|rule " | head -30`
- Deploy lại trang: `cd ~/Downloads/Bot-AI-V4 && npx wrangler pages deploy ui --project-name bot-ai-ui --branch main`
- Deploy lại Worker AI (đổi mật khẩu luôn): `bash scripts/tao-ai-worker.sh`
- Test: `for t in test/*.test.js; do node $t; done` (6 bộ)
- Tắt khẩn cấp: `"killSwitch": true` trong `config/bot-config.json` rồi commit, hoặc `gh workflow disable bot.yml --repo nangniuvedep/bot-ai`.

## 4. Lưu ý / bẫy
- Sandbox của AI không có mạng/đăng nhập: AI viết lệnh, người dùng dán. Người dùng thích MỘT dòng lệnh; xuất đúng 1 ZIP mỗi lượt.
- Thư mục giải nén ZIP KHÔNG phải repo git: chép code vào repo thật rồi commit/push. (Bản V6 trên `main` đã được đẩy; ZIP này thêm `docs/HANDOFF.md` và cập nhật docs, cần chép + commit nếu muốn giữ trong repo.)
- Thư mục gốc trong ZIP vẫn tên `Bot-AI-V4/` (khớp đường dẫn người dùng).
- `workflow/bot.yml` là bản sao của `.github/workflows/bot.yml` (giống hệt); sửa cả hai.
- Nút Live trên UI vẫn khóa: bot CHƯA có code đặt lệnh thật. Chỉ là sổ lệnh giấy (kể cả short — là mô phỏng, không phải spot).
- Tên model trong config chưa được kiểm hết với API thật ngoài lần chạy 41212430677; nếu một model lỗi, bot tự nghỉ 30 phút và chuyển nhà kế.
- Billing: thêm Worker AI không đụng tài khoản chính. Neuron Workers AI có hạn mức 10.000/ngày (free) — `ai.maxCallsPerDay = 96`; tính lại nếu đổi tần suất cron.
- Số liệu "xanh" nhiều coin giống nhau (thống kê theo chỉ báo, không theo coin) → tín hiệu tương quan; chưa xác nhận với app.
