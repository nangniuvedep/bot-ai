# Bot-AI — bot paper trading (tiền ảo), tách hẳn khỏi app

> **Đang làm dở? Đọc `docs/HANDOFF.md` trước.** (V7: long + short mô phỏng, tự dời stop/target, trang Performance.)

**Xóa cả thư mục này thì app không đổi gì.** App không biết bot tồn tại.

## Nguyên tắc ghép nối
- Bot chỉ **đọc** app bằng HTTP GET các file `alerts-*.json`. Không import code app, không ghi R2 của app, không thêm Worker, không sửa `sw.js` / CSP / `index.html`.
- **Chỗ duy nhất biết về app** là 2 file: `config/app-contract.json` (địa chỉ, phiên bản file, tuổi tối đa) và `src/app-reader.js` (đọc + kiểm). Phần còn lại của bot (luật, sổ lệnh, AI) chỉ dùng dữ liệu đã chuẩn hóa từ `app-reader.js`.
- App đang được cập nhật ở lộ trình khác. Khi app đổi định dạng file: sửa 2 file trên, chạy `node test/app-reader.test.js`. Bot thấy `v` lạ hoặc file quá cũ thì **bỏ lượt, không vào lệnh**.
- Khi nối với app thật: chỉ cần chỉnh `config/app-contract.json` (xem `docs/DATA-CONTRACT.md`, mục "Việc cần kiểm khi nối").

## Cấu trúc
```
Bot-AI/
  README.md
  config/app-contract.json   địa chỉ + phiên bản + tuổi tối đa của từng file app
  docs/DATA-CONTRACT.md      hợp đồng dữ liệu (đọc file này thay vì đọc app)
  docs/ARCHITECTURE.md       KIẾN TRÚC v2 hiện hành: AI quyết định mỗi 15 phút, Governor cứng, nhiều agent
  docs/PLAN.md               kế hoạch v2 (việc nhỏ làm xong trong một lượt) + yêu cầu gửi bên app (Phụ lục A)
  docs/BOT-AI-DESIGN.md      thiết kế cũ B0 (đã thay thế, giữ làm lịch sử)
  src/app-reader.js          lớp đọc app (duy nhất chạm vào app)
  test/app-reader.test.js    kiểm lớp đọc bằng dữ liệu giả, không cần mạng
  src/state-contract.js      kiểm bot-state.json đúng hợp đồng (bot gọi trước khi gửi)
  worker/                    Worker *.workers.dev giữ bot-state.json (bot ghi bằng token, trang chỉ đọc)
  tools/live.js             1 lệnh: chạy bot + mở trang xem trực tiếp (node tools/live.js)
  tools/publish-state.js     kiểm + gửi bot-state.json lên Worker
  src/bot.js · binance.js · state-builder.js · run.js   bot luật + sổ lệnh ảo (docs/BOT-RULES.md)
  config/bot-config.json    mọi con số của bot (rủi ro, phí, giới hạn)
  workflow/bot.yml          workflow GitHub Actions mẫu cho repo bot
  src/ai-gate.js · ai-provider.example.js   cổng AI chỉ được bỏ/giảm lệnh (mặc định tắt)
  docs/GO-LIVE.md           danh sách việc trước khi dùng tiền thật
  test/improve.test.js      kiểm xếp hạng, giới hạn lệnh, rule guard, cổng AI
  test/bot.test.js          kiểm bot bằng dữ liệu giả
  test/state.test.js         kiểm validator + Worker (KV giả, không cần mạng)
  ui/                        trang giao diện (chỉ đọc)
```
Mọi bước sau (B2 sổ lệnh, B3 dữ liệu bổ sung, B4 AI) thêm file mới trong `src/`, không sửa ngoài thư mục này.

**V4 (2026-10-31):** đường ống chạy thật và đã chuyển sang tài khoản Cloudflare PHỤ — **đọc `docs/DEPLOYED.md` TRƯỚC khi deploy** (2 tài khoản, luật cấm deploy vào tài khoản chính, địa chỉ, secret ở đâu, billing, việc còn mở). Script triển khai: `scripts/` (`chuyen-sang-tai-khoan-phu.sh` đã chạy xong, đừng chạy lại).

## Lập trình riêng (tiết kiệm token)
Người viết bot chỉ cần đọc: `README.md`, `docs/ARCHITECTURE.md` (kiến trúc v2), `docs/PLAN.md` (việc cần làm), `docs/DATA-CONTRACT.md`. Không cần mở app.
`docs/BOT-AI-DESIGN.md` là thiết kế cũ B0 (đã được thay thế).
Nguồn của hợp đồng: gói bubblelayer-V1479 (ngày chụp ghi trong DATA-CONTRACT).
