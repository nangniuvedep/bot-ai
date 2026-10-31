# CHANGELOG

## 2026-10-31 (đêm) — V7.1: sửa AI trả "empty answer"
- Phát hiện sau khi V7 lên (commit 162f90a, vòng 41214156444 `success`): cả `worker-ai/gpt-oss-120b` và `worker-ai/gemma-4` trả `empty answer` → AI chưa quyết định được gì. Nguyên nhân CHƯA xác nhận (chưa thấy phản hồi thật): nghi model suy luận trả định dạng khác hoặc hết 1500 token trong phần suy luận.
- `ai-provider.js`: `textOf()` đọc mọi dạng (`response`, `choices[].message.content` chuỗi/mảng, `output_text`, `output[]` kiểu Responses, `reasoning_content` chứa JSON khi bị cắt); `why()` ghi hình dạng phản hồi vào log (`keys`, `finish`, `msg`, `reasoning`, `out_tokens`). Config: `maxOutputTokens` 1500 → 3500, `timeoutMs` 60000 → 90000.
- Test thêm trong `short-manage.test.js` (mục 10). Chưa xác nhận với API thật: đọc dòng `AI unavailable: ... empty answer (keys=... finish=...)` ở vòng chạy kế tiếp.

## 2026-10-31 (đêm) — V7: short mô phỏng + quản lý SL/TP + trang Performance
- **Short (paper, 1x, KHÔNG phải spot thật):** tín hiệu V8 hướng xuống nay thành ứng viên `side: short` (config `allowShort`). Vào ở bid (khớp sổ bids), stop trên giá vào, target dưới; cỡ lệnh x`shortSizeMult` (0.5); phí funding giả định `shortFundingPctPerDay` (0.03%/ngày) tính lúc đóng. Đo "xanh" của short dùng base `dn` của app. **[KIỂM]** chưa rõ bảng Validation của app có trộn hướng không → số liệu short kém chắc hơn; AI được dặn khắt khe hơn.
- **Quản lý lệnh (`config.manage`):** +1R → dời stop về hòa vốn (+0.2% bù phí); +1.5R → stop bám đuôi (đỉnh − 1R); giá tiến gần target (<0.5R) → nới target thêm 1R và hạn giữ thêm 5 nến, tối đa 3 lần. Stop chỉ siết, không nới; cập nhật dùng nến SAU (không nhìn trước). Lý do đóng mới: `breakeven`, `trail`.
- **AI quản lý:** câu trả lời có thêm `manage:[{coin, stop?, target?, reason}]`. Governor (`adjustPosition`): stop chỉ được siết và phải còn cách giá; target chỉ đẩy xa hơn và chỉ khi đã ≥ +1R với stop ≥ hòa vốn (tối đa 8R). AI vẫn có thể `close`. Quyết định mới: `manage`, `manage-refused`.
- State (v vẫn 1, trường tùy chọn): lệnh có `side: BUY|SELL`, `market: spot|paper-short`, `sl0`, `managed`, `peakR`; lệnh đóng có `side`, `mfeR`, `sl0`; `rules.side: long|long-short`, `rules.manage`; khối `stats` (win, expR, PF, drawdown, chuỗi, theo hướng/lý do đóng/luật). `state-contract.js` nới tương ứng.
- UI: nhãn BUY / SELL (short), "stop moved from", trang **Performance** (dùng `stats`, tự tính lại từ `closed` nếu thiếu), nhãn lý do đóng mới, Settings nói đúng long+short.
- Test: `test/short-manage.test.js` (hình học short, kế toán tiền, target/stop short, hòa vốn, bám đuôi, không nhìn trước, nới target, Governor, closeEarly theo hướng, stats, state, vòng AI short + manage). 6 bộ test pass. `tools/test-ui.js`: 2 lỗi `sample-* overview` có sẵn từ trước V7 (sandbox không mạng), không lỗi JS mới.
- CHƯA làm: chốt lời từng phần, agent baseline, dữ liệu mới (funding/OI/nến thô/1D), biểu đồ nến có điểm vào/ra, cảnh báo Telegram, backtest. Chưa chạy với API thật.

## 2026-10-31 (tối) — V6.1 đã triển khai + handoff
- Worker `bot-ai-llm` và trang UI V6 đã deploy ở tài khoản PHỤ; secret `AI_PROXY_URL`/`AI_PROXY_TOKEN` đã đặt. Vòng 41212430677 `success` (providers: Gemini NO KEY → worker-ai gpt-oss-120b …; decisions 1; chưa có ENTERED).
- Thêm `docs/HANDOFF.md` (trạng thái, việc kế tiếp, lệnh, bẫy); cập nhật `docs/DEPLOYED.md`. Code không đổi; 5 bộ test pass.

## 2026-10-31 — V5: AI quyết định vào/đóng lệnh (ai.mode = "decide")
- Mỗi vòng: 1 lần gọi AI với shortlist (≤12 coin có tín hiệu V8 lên, kèm thống kê xanh/validation, brief đầy đủ, BTC/ETH, sổ lệnh, 10 lệnh đóng gần nhất). AI trả JSON: `entries` (id, conviction 1|2, lý do) và `close`. Governor cũ (spread, độ sâu, stop, rủi ro, giới hạn ngày, drawdown) vẫn chặn cuối cùng; AI không chọn qty/stop.
- Nhà cung cấp theo thứ tự ưu tiên (`config ai.providers`): Gemini → Workers AI gpt-oss-120b → Workers AI gemma. Thiếu khóa thì bỏ qua; lỗi/429 thì nghỉ 30 phút và chuyển nhà kế.
- Giá vào = ask lúc quyết định (hết vào lệnh hồi tố trong chế độ này). Cắt lệnh sớm = bid − trượt.
- File mới: `src/ai-decider.js`, `src/ai-provider.js`, `test/ai-decide.test.js`. Sửa: `bot.js` (closeEarly), `run.js`, config, workflow (secret GEMINI_API_KEY, CF_ACCOUNT_ID, CF_API_TOKEN). Test cũ đặt `ai.mode="off"`. Chế độ `veto` cũ không còn nối provider.
- V6 (cùng ngày): trạng thái lệnh đầy đủ. State thêm trường tùy chọn (v vẫn 1): lệnh mở có `side:BUY`, `market:spot`, `leverage:1`, giờ vào, hạn thoát, stop/target (giá + %), size, rủi ro $, ai quyết + lý do; lệnh đóng có giá vào/ra, SL/TP, thời gian giữ, lý do đóng (target/stop/time/AI); `rules` (thật từ config), `ai` (nhà nào trả lời, lúc nào, nhận định thị trường), `decisions` (40 quyết định gần nhất kèm lý do). UI: bảng lệnh đang mở, lịch sử, trang "AI decisions", thẻ AI engine, thanh Order flow, Settings đọc từ state. Nút Live vẫn khóa: bot chưa có code đặt lệnh thật.
- V6.1: Worker `bot-ai-llm` (`worker/ai-worker.mjs`, binding Workers AI, mật khẩu `AI_TOKEN`) để bot dùng Workers AI KHÔNG cần API token; provider `worker-ai`; `scripts/tao-ai-worker.sh` tự deploy + sinh mật khẩu + đặt secret `AI_PROXY_URL`/`AI_PROXY_TOKEN`.
- CHƯA kiểm với API thật (sandbox không có mạng/khóa): tên model trong config cần xác nhận bằng một lần chạy tay. Chưa có agent baseline để so sánh.

## 2026-10-31 — V4: chuyển Worker/KV/Pages sang tài khoản Cloudflare PHỤ
- Lý do: luật của app — tài khoản chính (Looknow) chỉ làm bằng tay, không deploy tự động; bot không được ăn hạn mức tài khoản chính ngoài việc đọc `ta.bubblelayer.com`.
- Worker `bot-ai-state`: `https://bot-ai-state.nangniuvedep.workers.dev` (KV mới `027ef8e5...`). Token mới. Secret GitHub `BOT_STATE_URL`/`BOT_STATE_TOKEN` đã cập nhật. Trang xem thử: `https://bot-ai-ui-6jx.pages.dev`.
- Đã kiểm: vòng chạy tay `success`, state mới ghi được, `GET /state.json` 200.
- Sửa: `ui/config.js`, `worker/wrangler.toml`, `scripts/setup-ui.sh`, `scripts/setup-repo.sh` (URL mới). Thêm `scripts/chuyen-sang-tai-khoan-phu.sh` (một lần, ĐÃ CHẠY, không chạy lại). Viết lại `docs/DEPLOYED.md`: 2 tài khoản, cách làm việc thường gặp, billing, VIỆC CÒN MỞ.
- Code bot (`src/`, `test/`, `config/`) KHÔNG đổi; 4 bộ test vẫn qua.
- CHƯA làm: xóa bản cũ ở Looknow (người dùng tự làm sau); hợp đồng chống lệch (cần fixture thật); gắn vào app.

## 2026-10-31 — V3: đã triển khai đường ống (bot luật cũ, chưa có AI)
- Đưa lên chạy thật: Worker `bot-ai-state` (KV), repo GitHub + workflow cron 15 phút, nhánh `bot-data`, trang thử trên Cloudflare Pages `bot-ai-ui`. Chi tiết: `docs/DEPLOYED.md`.
- `ui/config.js`: đặt `stateUrl`. `worker/wrangler.toml`: điền id KV. Thêm `.gitignore` (loại `state.json`, `worker/.wrangler/`), `.github/workflows/bot.yml`, `scripts/setup-repo.sh`, `scripts/setup-ui.sh`.
- Code bot (`src/`, `test/`, `config/`) KHÔNG đổi so với v2. P1–P4 vẫn chưa làm.

## 2026-10-31 — kiến trúc v2 (chỉ tài liệu, chưa đổi code)
- Viết lại `docs/ARCHITECTURE.md` và `docs/PLAN.md`: AI thật phân tích mỗi 15 phút và tự quyết định đặt lệnh ảo; Governor cứng; nhiều agent; chạy trên Cloudflare Worker; ưu tiên AI miễn phí (Workers AI 10.000 neuron/ngày + Gemini free cho Decider).
- Đánh dấu `BOT-AI-DESIGN.md` đã được thay thế. Cập nhật `README.md`.
- Code, config và test giữ nguyên (4 bộ test cũ vẫn qua). Phát hiện cần sửa ở P1: vào lệnh hồi tố (nhìn trước tương lai), parser JSON giòn, timeout 20s quá ngắn.
- Còn dở: toàn bộ P0–P7; yêu cầu app A1–A5 chưa gửi.
