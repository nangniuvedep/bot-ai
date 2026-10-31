# Trạng thái triển khai — V4 (2026-10-31) — không chứa bí mật

**AI/người đọc sau: đọc file này TRƯỚC khi deploy hay sửa bất cứ thứ gì trên Cloudflare/GitHub.**

## 1. Hai tài khoản Cloudflare — luật cứng
| Tài khoản | Email | Dùng cho | Quy tắc |
|---|---|---|---|
| **CHÍNH "Looknow"** (gói $5) | looknow.vn@gmail.com | App BubbleLayer: R2 `bl-ta`, Worker `guard`, `crypto-worker`... | **KHÔNG deploy bot ở đây. KHÔNG `wrangler login` vào đây.** Chỉ đọc `ta.bubblelayer.com` (R2 Class B) |
| **PHỤ** (free, không thẻ) | nangniuvedep@gmail.com | **Toàn bộ phần của bot**: Worker, KV, Pages. Cũng có Worker `clock` của máy quét | Free bị chặn cứng, không tính tiền. Tài khoản chính của app chỉ làm bằng tay |

Trước MỌI lệnh `wrangler`: chạy `npx wrangler whoami`; email phải là **nangniuvedep@gmail.com**. Sai thì `npx wrangler logout && npx wrangler login` (chọn tài khoản phụ).
GitHub: tài khoản `nangniuvedep` (`gh auth status`).

## 2. Thành phần đang chạy
| Thành phần | Giá trị |
|---|---|
| Repo bot (công khai) | `github.com/nangniuvedep/bot-ai` — nhánh `main` (mã), `bot-data` (sổ lệnh: `ledger.json`, `bot-state.json`, `decisions.jsonl`) |
| Workflow | `.github/workflows/bot.yml` (tên `bot-ai`), cron `8,23,38,53 * * * *` (sau máy quét 01/16/31/46). Chạy tay: `gh workflow run bot.yml --repo nangniuvedep/bot-ai` |
| Worker giữ state | `bot-ai-state` → `https://bot-ai-state.nangniuvedep.workers.dev/state.json` (KV `STATE`, id `027ef8e5bd9a49ae8e7f6068958e6033`) — tài khoản PHỤ |
| Secret trên Worker | `WRITE_TOKEN` (bản lưu máy chủ dự án: `~/.bot-ai-token`; không ở trong repo) |
| Secret trên GitHub (repo bot) | `BOT_STATE_URL` = `https://bot-ai-state.nangniuvedep.workers.dev`, `BOT_STATE_TOKEN` = cùng giá trị `WRITE_TOKEN` |
| Trang xem thử (tách khỏi app) | Pages project `bot-ai-ui` ở tài khoản PHỤ → **`https://bot-ai-ui-6jx.pages.dev`** (hậu tố `-6jx` vì tên `bot-ai-ui.pages.dev` còn bị bản cũ bên Looknow giữ; xóa bản cũ rồi có thể deploy lại để lấy tên đẹp) |
| Trang trong app thật | CHƯA gắn (người dùng chốt: làm sau khi bot xong). Là bước duy nhất đụng app: `docs/INTEGRATE.md` |

## 3. Cách làm các việc thường gặp (đều ở tài khoản PHỤ)
- Deploy lại Worker: `cd worker && npx wrangler deploy`
- Đổi token: `openssl rand -hex 32 > ~/.bot-ai-token`, rồi `cd worker && npx wrangler secret put WRITE_TOKEN` và `gh secret set BOT_STATE_TOKEN --repo nangniuvedep/bot-ai` (cùng giá trị)
- Deploy lại trang: `npx wrangler pages deploy ui --project-name bot-ai-ui --branch main`
- Chạy test: `for t in test/*.test.js; do node $t; done` (4 bộ, không cần mạng)
- Chạy thử bot không ghi: `node src/run.js --dry --verbose`
- Tắt khẩn cấp: `"killSwitch": true` trong `config/bot-config.json` rồi commit; hoặc `gh workflow disable bot.yml --repo nangniuvedep/bot-ai`
- Xem state công khai: `curl -s https://bot-ai-state.nangniuvedep.workers.dev/state.json`
- Không có mạng/đăng nhập trong sandbox của AI: AI viết lệnh, người dùng dán vào zsh (người dùng thích MỘT dòng lệnh). Xuất đúng 1 ZIP mỗi lượt.

## 4. Billing (tính 31/10/2026, quy trình 3 câu hỏi của app)
| Mục | Từ đâu | Con số/ngày | Ngân sách ngày (app) | % |
|---|---|---|---|---|
| R2 Class B (tài khoản CHÍNH) | 96 vòng × 3 file (`signals`, `brief`, `validation`) từ `ta.bubblelayer.com`, không cache | 288 | 233.333 | ~0,12% |
| R2 Class A | bot không ghi R2 | 0 | 23.333 | 0% |
| KV write (PHỤ, free: 1.000/ngày) | 1 lần/vòng | 96 | — | ~10% free |
| KV read + Worker requests (PHỤ, free: 100.000/ngày) | 96 + mỗi tab trang bot mở 1 lần/phút (tab ẩn không đọc) | 96 + 1.440/tab | — | 1 tab ≈ 1,5% |
Bot làm R2 Class B tăng tối đa ~0,12% ngân sách; chuyển Worker sang phụ không đổi con số này (dữ liệu `bl-ta` ở tài khoản chính). **Phải tính lại** nếu đổi tần suất cron, thêm file đọc, hoặc thêm nguồn AI. App (`BILLING-RULES.md` mục 0n) CHƯA có dòng nào về bot — chưa thêm vì người dùng chốt không đụng app.

## 5. Đã kiểm
- 4 bộ test pass trên máy và trên GitHub Actions; `--dry` đọc được `alerts-signals.json`.
- Sau chuyển (31/10 ~20:30 giờ máy người dùng): vòng chạy tay `success`, `updatedAt` mới hơn lần đẩy trước, state có 2 vị thế giấy; `GET /state.json` 200, CORS `*`.
- Vòng chạy tay bị bỏ qua vào lệnh nếu nến quá cũ (>30 phút): bình thường. Vòng cron đầu có nến trong cửa sổ: xem log để xác nhận Binance từ máy chủ GitHub.

## 6. VIỆC CÒN MỞ (làm theo thứ tự)
1. **[CHỦ] Xóa bản cũ ở tài khoản CHÍNH Looknow** (người dùng tự làm, hoãn): Worker `bot-ai-state` (`bot-ai-state.looknow.workers.dev`), KV `STATE` id `da0251bef602435f8ba4c1cab6c2f754`, Pages `bot-ai-ui`. Lệnh: `npx wrangler login` (Looknow) → `whoami` → `npx wrangler delete --name bot-ai-state` → `npx wrangler kv namespace delete --namespace-id da0251bef602435f8ba4c1cab6c2f754` → `npx wrangler pages project delete bot-ai-ui`. Xong thì đăng nhập lại tài khoản PHỤ. KHÔNG đụng R2 `bl-ta`, `guard`, `crypto-worker`.
2. **[CHỦ] Chép code V4 vào repo git thật** (thư mục giải nén ZIP không phải repo) rồi commit + push: bốn file đã đổi so với V3 = `ui/config.js`, `worker/wrangler.toml`, `docs/*`, `scripts/*`. Workflow đã dùng secret mới nên bot KHÔNG phụ thuộc bước này.
3. **HỢP ĐỒNG CHỐNG LỆCH (chưa làm, việc code kế tiếp):** lưu mẫu `alerts-signals/brief/validation.json` thật làm fixture trong `test/fixtures/` (người dùng đã tải về `~/Downloads/alerts-*.json`, ~880 KB, nhưng CHƯA gửi AI), danh sách trường bot dùng, test báo đúng tên trường lệch; lúc chạy nếu hình dạng sai thì bot không vào lệnh mới, `bot-state.json` mang trạng thái "tạm dừng: dữ liệu app đổi" + lý do, workflow đỏ để GitHub gửi mail. Trường mới thêm thì bỏ qua; chỉ đổi `v` / bỏ / đổi tên trường mới dừng. Đề xuất (chưa duyệt): thêm 1 dòng vào `CRITICAL-NOTES.md` của app ("`alerts-*.json` có người đọc ngoài app: đổi `v` hay tên trường thì báo bot").
4. `config/app-contract.json` ghi `snapshot: bubblelayer-V1479`; app hiện V1502, `v: 2` vẫn khớp. Cập nhật khi có bản chụp mới.
5. Từ `docs/PLAN.md`: P1 (sửa vào lệnh hồi tố) và P0–P7 vẫn chưa làm; số liệu paper hiện chỉ để thử đường ống.

## 7. Lưu ý còn mở (cũ)
- Số liệu "xanh" của nhiều coin giống hệt nhau (thống kê theo chỉ báo, không theo coin) → tín hiệu tương quan; cần xác nhận cách app tính.
- `equity` trong state có điểm trùng timestamp ở vòng đầu; theo dõi.
- Mỗi bản phát hành app phải mang theo thư mục `bot-ai/` nếu đã gắn vào app (Pages thay cả site mỗi lần deploy).
