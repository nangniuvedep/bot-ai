# PLAN v2 — làm Bot AI "AI quyết định mỗi 15 phút"

Kiến trúc: `docs/ARCHITECTURE.md`. Kế hoạch này thay mục 8 ("Các bước B1–B5") của `BOT-AI-DESIGN.md`.
Ngày lập: 31/10/2026.

## Cách làm việc (cho người/AI nhận từng việc)

1. **Một việc = một lượt làm xong**, không dừng giữa chừng. Việc nào dự đoán không xong một lượt thì tách nhỏ trước khi làm.
2. Mỗi lượt: đọc `README.md`, `docs/ARCHITECTURE.md`, mục việc của mình; không cần mở app.
3. Kết thúc mỗi lượt: `node --check` mọi file đã sửa, chạy toàn bộ `node test/*.test.js`, tăng số phiên bản, **đóng zip ngay** ("làm đến đâu zip đến đó"), ghi vào `docs/CHANGELOG.md` 3 dòng: làm gì, test nào qua, còn gì dở.
4. Việc nào cần **chủ dự án** (khóa API, deploy, chạy trên máy thật) ghi rõ `[CHỦ]`; việc cần **bên app** ghi `[APP]`.
5. Không sửa ngoài thư mục `Bot-AI/`, trừ phần `[APP]` đã tách ở Phụ lục A.

## P0 — Chốt quyết định (nói "đồng ý" là đủ; mặc định in đậm)

| # | Quyết định | Mặc định đề xuất | Ảnh hưởng |
|---|---|---|---|
| D1 | Hướng lệnh | **Spot long-only** (futures mô phỏng để sau) | schema, broker, UI |
| D2 | Nơi chạy | **Cloudflare Worker cron** (kế hoạch B: GitHub Actions) | P4 |
| D3 | Cấu hình AI ban đầu | **FREE**: Analyst `gemma-4-26b-a4b-it` (Workers AI) + Decider Gemini Flash khóa free; nâng BALANCED khi muốn | P3, chi phí |
| D4 | Số agent lúc đầu | **2**: `rule-baseline` (không AI) + `ai-1` | P6 |
| D5 | Vốn ảo / rủi ro | **10.000 USDT ảo, 1 %/lệnh, 5 vị thế, lỗ ngày 3 %, DD 10 %** (như hiện tại) | Governor |
| D6 | Repo bot công khai hay riêng tư | **Công khai** nếu không có bí mật trong prompt (prompt/packet là công khai thì ai cũng sao chép được; riêng tư nếu muốn giữ) | CI, journal |
| D7 | Ngân sách AI trả phí tối đa | **$0 mặc định, trần cứng $10/tháng** | `maxNeuronsPerDay` |

### P0-T0 `[CHỦ]` Đo thực tế (30 phút, không cần code mới ngoài 2 công cụ)
- Làm `tools/probe-ai.js`: gọi 1 prompt mẫu qua từng provider đã có khóa (Workers AI REST, Gemini, NIM), in ra: model, độ trễ, token vào/ra, neuron/giới hạn còn lại (header), JSON có hợp lệ không.
- Làm `tools/probe-sources.js`: gọi thử mọi nguồn ở ARCHITECTURE §4.1 (HTTP status, kích thước, độ trễ, có phải 451/403 không).
- **Chạy từ Worker thật** (một route tạm `/admin/probe`) *và* từ máy bạn, so kết quả. Nguồn nào chặn IP Cloudflare ghi lại.
- Xong khi: có bảng kết quả dán vào `docs/PROBE-RESULTS.md`; chốt D2/D3 dựa trên số thật.

## P1 — Sửa nền cho đúng (không cần AI)

| ID | Việc | Xong khi |
|---|---|---|
| P1-T1 | `src/broker.js`: khớp ảo theo **ask lúc quyết định** + trượt sổ lệnh; thoát lệnh chỉ xét từ lúc quyết định; bỏ `entryCandle`/`maxEntryDelayMin` khỏi đường vào lệnh. Cập nhật `bot.js` dùng broker | Test mới: quyết định lúc 10:25, giá đã chạm target lúc 10:10 ⇒ **không** có lệnh thắng hồi tố; test cũ còn lại vẫn qua |
| P1-T2 | Mã lý do cho mọi từ chối (`COST_R`, `STOP_RANGE`, …) trong `governor.js` tách khỏi `tryEnter`; thêm `maxCostR`, `minNetRR`, cửa sổ vĩ mô, `dataHealth` | Mỗi luật có 1 test vượt + 1 test chặn |
| P1-T3 | `[CHỦ+APP]` Đối chiếu công thức "xanh" với trang Validation của app (đang là **giả định**, `DATA-CONTRACT` §3) | Ghi kết quả vào `DATA-CONTRACT.md`; nếu lệch, sửa `greenEdge()` và test |
| P1-T4 | `[CHỦ]` Chạy `node src/run.js --dry --verbose` trên máy thật, dán đầu ra vào `docs/PROBE-RESULTS.md` | Có ít nhất 1 lần đọc app + Binance thật không lỗi |

## P2 — Mặt phẳng dữ liệu (collectors → snapshot → packet)

Mỗi collector là một file trong `core/collectors/`, trả `{value, asOf, source, ok, reason}`, nhận `fetchFn` để test bằng dữ liệu giả, **không** gọi mạng trong test.

| ID | Việc | Xong khi |
|---|---|---|
| P2-T1 | `app-reader.js` mở rộng: khung 15m, `rules`, `etf`, `live`; đọc `codebook`, `scorecard`, `writtenAt` **nếu có** (thiếu = ok:false, không lỗi) | `test/app-reader.test.js` thêm ca 15m + file thiếu |
| P2-T2 | `market.js`: nến 15m/1H/4H + sổ lệnh cho một danh sách coin (song song, giới hạn đồng thời) | test bằng fixture; mọi lỗi → `ok:false` |
| P2-T3 | `derivs.js`: Hyperliquid `metaAndAssetCtxs` + bảng ánh xạ ký hiệu (`config/symbol-map.json`); dự phòng OKX | test ánh xạ `kPEPE`↔`PEPE`; coin không có perp → `null`, không lỗi |
| P2-T4 | `sentiment.js` (Fear&Greed, CoinGecko global) | `[KIỂM]` endpoint thật ở P0-T0; test fixture |
| P2-T5 | `news.js` + `sanitize.js`: RSS → tiêu đề, dedupe theo hash, ≤15, cắt 160 ký tự, bỏ URL/HTML/ký tự điều khiển, **không** đưa nội dung bài | test chuỗi tiêm lệnh ("ignore previous instructions…") ra ở dạng dữ liệu vô hại, độ dài chặn |
| P2-T6 | `macro.js` + `config/macro-events.json` (nhập tay làm dự phòng) | test cửa sổ ±30' |
| P2-T7 | `snapshot.js` (gộp, `dataHealth`, hash, TTL cache theo nguồn) | cùng đầu vào ⇒ cùng hash; nguồn chậm không chặn vòng quá timeout |
| P2-T8 | `shortlist.js` + `packet.js` (tên trường đọc được, ngân sách token, thứ tự cắt) | packet ≤ 5k token ước lượng trên fixture 100 coin; test cắt đúng thứ tự |

## P3 — Lớp Agent

| ID | Việc | Xong khi |
|---|---|---|
| P3-T1 | `agents/prompts/system.md` + `schema.js` (`bot-ai.decision.v1` + `bot-ai.verdict.v1`) + validator | Test: 20 mẫu trả lời (sạch, bọc ```json, có lời dẫn chứa `{}`, hai JSON, chữ hoa, `confidence` 80, stop hạ, qty tự thêm…) cho kết quả xác định |
| P3-T2 | `agents/parse.js`: JSON mode → lấy đối tượng hợp lệ **cuối cùng** → sửa định dạng một lần | thay `ai-gate.parseVerdict`; test ca hỏng của audit 31/10 (lời dẫn có `{}`, hai JSON) giờ qua |
| P3-T3 | `agents/providers/`: `workers-ai.js` (binding + REST), `gemini.js`, `openai-compat.js` (NIM/Groq/OpenRouter); chung `AbortSignal`, `usage`, `circuit breaker`, `max_retries=0` | test bằng fetch giả: timeout thật hủy yêu cầu; 429 sang provider kế |
| P3-T4 | `agents/budget.js`: đếm neuron theo `usage`, trần `maxNeuronsPerDay`, tự hạ model | test: gần trần → chọn model rẻ; vượt → bỏ vòng, ghi journal |
| P3-T5 | `agents/runner.js`: Analyst → (Decider nếu có đề xuất mở lệnh) → Validator → Governor → Broker; `onDeciderDown:"skip"` | test end-to-end bằng provider giả: mở, bỏ, đóng, nâng stop, từ chối kèm lý do |
| P3-T6 | `journal.js`: mỗi vòng lưu {snapshot hash, packet, raw, parsed, kết quả governor, token, độ trễ} dạng JSONL | test: đọc lại journal tái tạo đúng quyết định (`tools/replay.js`) |
| P3-T7 | Loại lệnh `limit` + hủy lệnh chờ trong broker | test xuyên giá (low < limit) khớp, chạm đúng giá không khớp |

## P4 — Chạy thật trên server

| ID | Việc | Xong khi |
|---|---|---|
| P4-T1 | `worker/bot-ai.mjs`: `scheduled()` tick/round, khóa, idempotent theo `roundId`; routes `GET /state.json`, `/admin/*` có token | test bằng miniflare/giả lập: hai tick cùng `at` chỉ chạy một Round |
| P4-T2 | `worker/ledger-do.mjs`: Durable Object (SQLite) ledger + `ghost` + metrics theo agent | test CRUD + khôi phục sau crash giữa vòng (không mở lệnh nửa chừng) |
| P4-T3 | `wrangler.toml`, binding `AI`, R2, KV, DO; `docs/DEPLOY.md` từng bước | `[CHỦ]` deploy thử, `/state.json` trả dữ liệu |
| P4-T4 | `workflow/bot.yml` chuyển thành **kế hoạch B** (cùng lõi) + job CI chạy test | CI xanh |
| P4-T5 | Công cụ `tools/admin.js` (kill, bật/tắt agent, xem journal gần nhất) | chạy được với token |

## P5 — State v2 và giao diện

| ID | Việc | Xong khi |
|---|---|---|
| P5-T1 | `docs/STATE-CONTRACT.md` v2 + `state-contract.js`: `agents[]` (id, model, trạng thái, equity, open, closed, lastDecision{t, action, reason, confidence}), `ai{latency, neuronsToday, budgetLeft, provider}`, `rounds[]` (bỏ/chạy, lý do) ; trang vẫn từ chối `v` lạ | test validator + Worker |
| P5-T2 | `ui/`: tab theo agent, luồng quyết định (vào/bỏ/giữ + lý do ngắn), thẻ sức khỏe AI/ngân sách, so sánh agent với baseline | `tools/test-ui.js` mọi màn hình qua; `i18n-strings.json` cập nhật |
| P5-T3 | Dịch 19 ngôn ngữ cho chuỗi mới bằng `ops/i18n/nap.js` (nếu đóng gói vào app) | `kiem.js` qua |

## P6 — Đánh giá và nhiều AI

| ID | Việc | Xong khi |
|---|---|---|
| P6-T1 | Agent `rule-baseline` (bot luật cũ qua cùng snapshot/Governor) | cùng ledger schema; test so sánh tự nhất quán |
| P6-T2 | Sổ bóng ma: mô phỏng mọi `entries` bị bỏ/bị chặn | test: lệnh bị Decider reject vẫn có kết quả hậu nghiệm |
| P6-T3 | `config/agents.json` + registry (Bot AI 1, 2, …), mỗi agent một DO | thêm agent bằng config, không sửa code |
| P6-T4 | `tools/report.js`: kỳ vọng R sau phí, thắng, PF, DD, lệnh/ngày, chi phí AI/lệnh, so baseline theo khoảng thời gian | xuất Markdown; test trên sổ giả |

## P7 — Chạy tiến và quyết định

1. Chạy `rule-baseline` + `ai-1` song song **ít nhất 4 tuần** (không sửa prompt giữa chừng; sửa = agent mới).
2. Mỗi tuần đọc `tools/report.js` và journal: lệnh nào AI vào, lý do, kết quả; loại lỗi thường gặp (`COST_R`, dữ liệu thiếu).
3. Quyết định tại mốc: ≥ 200 lệnh đóng/agent **hoặc** 8 tuần, tùy cái nào đến sau; tiêu chí ở ARCHITECTURE §9.4. AI không hơn baseline ⇒ tắt AI, giữ baseline.
4. Thêm agent thứ hai (BALANCED) chỉ sau khi agent đầu chạy ổn ≥ 2 tuần.

## Thứ tự và phụ thuộc

```
P0-T0 ─┬─► P2 (collectors) ─► P3 (agents) ─► P4 (server) ─► P5 (UI) ─► P6 ─► P7
P1 ────┘        ▲
Phụ lục A (app) ┘  A1,A2 chặn P2-T1/P3-T1 phần 15m & mã V8; A3,A4,A5 không chặn
```

Có thể chạy `P1` và `P0-T0` song song. Mốc nhỏ nhất đáng thử: **P0 + P1 + P2-T1…T8 + P3 bằng provider giả** ⇒ chạy `--dry` in ra packet và quyết định giả để đọc bằng mắt, trước khi nối AI thật.

---

# Phụ lục A — Yêu cầu gửi bên app chính `[APP]`

Nguyên tắc: **chỉ thêm, không đổi** file/trường hiện có (bot đang đọc theo hợp đồng V1479). Mọi file mới tuân thủ: JSON, có `v`, có `at` (nến đóng, ms), **và `writtenAt` (ms, lúc ghi)**; nằm cùng `https://ta.bubblelayer.com/`; thêm tên vào danh sách cho phép của worker `guard`. Không đổi nhịp quét. Mỗi thay đổi có `v` mới nếu đổi hình dạng.

## A1 (bắt buộc) — Khung 15m đủ cho bot
1. Xác nhận `alerts-signals.json` và `alerts-brief.json` có `tf["15m"]` **mỗi lượt quét 15 phút**, `at` của hai file **bằng nhau** (bot bỏ khung khi lệch).
2. Xác nhận `alerts-validation.json` có `tf["15m"]` cùng cấu trúc như 1H/4H (`base`, `rows[].a/b`, 9 cấu hình `cfg`). Nếu **chưa**: thêm; nếu không thể, ghi rõ để bot **không** áp bộ lọc "xanh" cho 15m.
3. Trả lời giúp 3 câu: (a) công thức "xanh" chính xác của trang Validation; (b) 15m quét bao nhiêu coin so với 1H; (c) file 15m có thể về trễ nhất bao lâu sau phút :01/:16/:31/:46.

## A2 (bắt buộc) — `alerts-codebook.json`
Để AI hiểu 340 mã V8. Mỗi mã một bản ghi (ngắn, tiếng Anh, ≤ 160 ký tự mỗi chuỗi):
```
{ "v": 1, "at": <ms>, "writtenAt": <ms>,
  "codes": { "<code>": { "name": "...", "group": "...", "meaning": "một câu: điều kiện giá/chỉ báo nào được phát hiện",
                          "dir": 1|-1|0, "bestTf": ["1H","4H"], "noisyWhen": "một câu: khi nào hay nhiễu" } } }
```
Nguồn: sinh từ chính định nghĩa mã trong code app (không viết tay lại để khỏi lệch). Cập nhật khi mã đổi. Nếu một số trường chưa có thể sinh, bỏ trường đó (bot chịu thiếu).

## A3 (nên, giá trị cao) — `alerts-scorecard.json`
Kết quả **theo dõi tiến** của từng tín hiệu mà máy quét đã phát, chấm bằng đúng cấu hình `1-2` (stop 1×ATR, target 2×ATR, 10 nến, chạm cả hai = sai) — cùng thước với Validation nhưng **trên dữ liệu mới**:
```
{ "v": 1, "at": <ms>, "writtenAt": <ms>,
  "tf": { "15m|1H|4H": { "codes": { "<code>": { "d7": {"r":n,"w":n,"u":n}, "d30": {"r":n,"w":n,"u":n} } },
                           "base": { "d7": {...}, "d30": {...} } } } }
```
Cập nhật mỗi lượt quét (hoặc mỗi giờ). Giá trị: AI/bot biết mã nào **đang** hỏng, và mẫu thống kê lớn hơn nhiều so với riêng lệnh của bot.

## A4 (nên) — `writtenAt`
Thêm `writtenAt` vào `signals`, `brief`, `validation`, `live`, `etf`, `rules`. Bot phân biệt "nến cũ" với "quét đứng".

## A5 (tùy chọn) — `alerts-market.json`
Breadth theo định nghĩa của app: mỗi khung `{up, down, neutral}` (số mã V8), `% coin trend lên`, trạng thái BTC/ETH (`tr`, `rs`, `ax`). Bot tự tính được từ `brief` nên không chặn việc nào.

## Không yêu cầu app làm
Nến, sổ lệnh, funding/OI, tin tức, lịch vĩ mô, tâm lý thị trường: bot tự lấy (ARCHITECTURE §4.1). App **không** cần biết bot tồn tại; chỉ cần giữ file ổn định và có `v`.

## Tải lên R2
Bot đọc `signals` mỗi tick (≈288 lần/ngày) để biết file mới, rồi đọc phần còn lại một lần mỗi vòng (≈96 vòng/ngày × ≤ 6 file). Tổng khoảng 900 lượt đọc R2/ngày, rất nhỏ so với hạn mức 10 triệu/tháng của app. Nếu bên app muốn giảm, dùng `HEAD`/`If-None-Match` (R2 trả `ETag`).

---

# Phụ lục B — Việc chủ dự án cần cung cấp `[CHỦ]`

| Cần | Dùng cho | Khi nào |
|---|---|---|
| Khóa Gemini AI Studio (free) | Decider cấu hình FREE | P0-T0 |
| (tùy chọn) Khóa NVIDIA NIM / OpenRouter | agent so sánh, dự phòng | P6 |
| Token Cloudflare để `wrangler deploy` hoặc tự deploy theo `DEPLOY.md` | P4-T3 | P4 |
| Quyết định D1–D7 (P0) | mọi thứ sau P0 | đầu tiên |
| Danh sách RSS tin tức muốn dùng + lịch vĩ mô tay | P2-T5/T6 | P2 |

# Phụ lục C — Cái gì **không** làm ở v2

- Không đặt lệnh thật, không khóa sàn trong repo.
- Không grid/martingale/DCA, không đòn bẩy (futures mô phỏng chỉ khi chốt D1 khác mặc định).
- Không cho AI gọi công cụ/duyệt web trực tiếp: mọi dữ liệu web đi qua collector có kiểm soát.
- Không backtest AI trên quá khứ.
- Không nâng từ paper lên tiền thật trước khi qua `GO-LIVE.md` và P7.
