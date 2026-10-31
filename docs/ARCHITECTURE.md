# ARCHITECTURE v2 — Bot AI: AI thật phân tích mỗi 15 phút và tự quyết định đặt lệnh ảo

Thay thế `BOT-AI-DESIGN.md` (B0). Bản này ngày 31/10/2026. Kế hoạch làm: `docs/PLAN.md`.
Các số về AI miễn phí / giá lấy từ tài liệu nhà cung cấp và bài so sánh bên thứ ba tháng 10/2026; **hạn mức đổi liên tục, kiểm lại trước khi làm** (mục 10).

## 0. Thay đổi so với bản cũ

| | Bản cũ (B0–B2) | Bản này |
|---|---|---|
| Ai quyết định vào lệnh | **Luật** quyết; AI chỉ được `take/shrink/skip` | **AI** quyết (vào / không vào / giữ / đóng / nâng stop); luật cứng chỉ **chặn** |
| Nhịp | GitHub Actions 15' một lần, trễ vài phút, chỉ khung 1H/4H | Cloudflare Worker, theo vòng 15' của máy quét app (khung 15m + 1H/4H/1D làm bối cảnh) |
| Dữ liệu cho AI | vài chỉ báo viết tắt | Gói dữ liệu đầy đủ: kỹ thuật app + thị trường + phái sinh + tin tức + lịch vĩ mô + chính sổ lệnh của AI |
| Giá vào lệnh | giá mở nến cũ (nhìn trước tương lai) | **giá ask lúc quyết định** + trượt giá theo sổ lệnh |
| AI | 1 AI, mặc định tắt | Nhiều agent (Bot AI 1, 2, …), mỗi agent một sổ riêng, so sánh được; có agent luật làm chuẩn |
| Đánh giá | chờ 200 lệnh | Sổ "bóng ma" cho lệnh bị AI bỏ + chuẩn luật + nhật ký replay được |

Giữ nguyên: bot **chỉ đọc** app (không ghi hạ tầng app), tiền ảo, `app-reader.js` là chỗ duy nhất biết định dạng file app, UI chỉ đọc.

## 1. Nguyên tắc bất biến

1. **Paper only.** Không có code đặt lệnh thật trong repo này. Lên tiền thật là dự án khác (`GO-LIVE.md`).
2. **AI quyết, luật chặn.** AI không có công cụ ghi gì cả. Nó chỉ trả JSON. Mọi thứ AI nói đều đi qua Validator → Risk Governor; Governor là người cuối cùng và AI không sửa được.
3. **Bất đối xứng rủi ro.** Hành động *tăng* rủi ro (mở lệnh) cần **hai chìa** (Analyst đề xuất + Decider duyệt) rồi mới qua Governor. Hành động *giảm* rủi ro (đóng, nâng stop, hủy lệnh chờ) chỉ cần một chìa. Stop chỉ được nâng, không bao giờ hạ.
4. **Không giao dịch là kết quả bình thường.** Mỗi vòng AI phân tích nhưng đa số vòng không đặt lệnh. Không có hạn ngạch "phải vào lệnh".
5. **Mọi dữ liệu có nguồn + thời điểm + trạng thái.** Thiếu/cũ/lạ → vòng đó **không mở lệnh mới** (quản lý lệnh đang giữ vẫn chạy).
6. **Replay được.** Mỗi vòng lưu snapshot dữ liệu, prompt, câu trả lời thô, kết quả validator. Muốn biết "vì sao vào lệnh này" thì đọc lại đúng thứ AI đã thấy.
7. **Tin tức/web là dữ liệu không đáng tin.** Chỉ đưa tiêu đề đã làm sạch, đặt trong khung dữ liệu; AI không có công cụ nên có bị tiêm lệnh cũng chỉ ra JSON, và JSON vẫn qua Governor.
8. **Không backtest AI trên quá khứ** (mô hình đã biết lịch sử). Chỉ chạy tiến, đánh giá bằng sổ ảo (mục 9).
9. **Mỗi thay đổi prompt/model = agent version mới** (id gồm hash prompt) để không trộn thống kê.

## 2. Sơ đồ

```
 NGUỒN                          COLLECTORS (Worker, song song, timeout riêng)
 App R2 (ta.bubblelayer.com)    ─► app-reader     signals/brief/validation/rules/etf/live (15m,1H,4H,1D)
 Binance spot (data-api…vision) ─► market         nến 15m/1H/4H + sổ lệnh (chỉ coin shortlist) + nến 1m cho thoát lệnh
 Hyperliquid info / OKX         ─► derivs         funding, open interest, premium
 alternative.me, CoinGecko      ─► sentiment      Fear&Greed, BTC dominance, tổng vốn hóa
 RSS tin crypto + lịch vĩ mô    ─► news/macro     tiêu đề 6h gần nhất, sự kiện 24h tới
                                        │   mỗi nguồn trả {value, asOf, source, ok}
                                        ▼
                              SNAPSHOT (bất biến, có hash, lưu R2)  ──► dataHealth
                                        ▼
                              SHORTLIST (code, tối đa ~10 coin) + PACKET (≤ ~5k token)
                                        ▼
            ┌───────────────────────── AGENT RUNNER (N agent, cùng snapshot) ─────────────────────────┐
            │  Analyst (mỗi vòng, mô hình miễn phí)  ──đề xuất vào lệnh?──►  Decider (mô hình mạnh)      │
            │  JSON: marketView, entries[], positions[], cancel[], watch[]    approve | reject | giảm size │
            └──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                       ▼
                       VALIDATOR (schema) → RISK GOVERNOR (luật cứng) → PAPER BROKER (khớp ảo)
                                                       ▼
                         LEDGER mỗi agent (Durable Object, SQLite) + JOURNAL (R2 JSONL)
                                                       ▼
                       STATE PUBLISHER → GET /state.json (v2) → trang /bot-ai/ (chỉ đọc)
```

Chạy ở **một Cloudflare Worker** (`bot-ai`) trên gói Workers Paid sẵn có: Cron Trigger, Workers AI (binding, không cần khóa), Durable Object, R2, KV. Kế hoạch B: cùng lõi chạy bằng GitHub Actions (xem mục 8).

## 3. Nhịp chạy

- **Tick** = cron `*/5 * * * *`.
  1. Khóa (một tick tại một thời điểm).
  2. **Thoát lệnh cơ học** cho mọi agent: nến 1 phút từ lần kiểm trước, theo thứ tự thời gian, chạm cả stop và target trong 1 nến = stop. Không dùng AI. (Chạy mỗi tick, không chờ vòng AI.)
  3. Hỏi `alerts-signals.json`: có `tf["15m"].at` mới hơn `lastRoundAt` không, và `brief` cùng `at`? Chưa có → thoát, tick sau hỏi lại.
  4. Có → chạy **Round** (bên dưới). Chỉ **một Round cho mỗi `at`** (idempotent theo `roundId = at`).
  5. Publish state (luôn làm mới `updatedAt`, kể cả khi không có gì mới).
- **Round bị bỏ** nếu `now − at > 12 phút` (file quá cũ so với nến) hoặc dữ liệu thiết yếu hỏng; ghi lý do vào journal, UI hiện "bỏ vòng".
- **Vì sao không dùng cron theo giờ cố định của GitHub:** máy quét app chạy phút 01/16/31/46 qua GitHub Actions và file có thể về lúc :03–:12. Hỏi mỗi 5' rồi chạy khi file mới thì AI luôn phân tích đúng dữ liệu mới nhất, không phụ thuộc độ trễ.
- Vòng đóng nến 1H/4H/1D (`at` chia hết khung đó) gắn cờ `htfClosed:["1H","4H"]` trong packet: đây là lúc cấu trúc khung lớn thay đổi, AI được nhắc chú ý.
- **Phân tích 15' không có nghĩa là giữ lệnh 15'.** Chi phí vòng (phí 0,1 %/chiều + trượt ≈ 0,23 %) ăn **0,77 R nếu stop 0,3 %**, 0,23 R nếu stop 1 %, 0,12 R nếu stop 2 %. Nên Governor chặn lệnh có chi phí > `maxCostR` (0,25 R): thực tế lệnh sẽ có stop ≥ ~1 % và giữ vài giờ, với 15m dùng để chọn thời điểm vào, 1H/4H dùng để chọn hướng.

## 4. Dữ liệu cho AI (data plane)

### 4.1 Nguồn

| # | Nguồn | Dùng để | TTL | Ai lấy | Trạng thái |
|---|---|---|---|---|---|
| 1 | App: `signals` (15m,1H,4H,1D) | mã V8 nào đang bật, hướng, coin | mỗi vòng | bot đọc | có (hợp đồng V1479) |
| 2 | App: `brief` | xu hướng, ADX, RSI, MACD, ATR%, S/R, volume ratio, gauge | mỗi vòng | bot đọc | có; bot chưa dùng 15m, chưa dùng `s/r` |
| 3 | App: `validation` | mã nào hơn ngẫu nhiên (2 giai đoạn) | 1 ngày | bot đọc | có; **chưa rõ có khung 15m** (App A1) |
| 4 | App: `rules` | tên/nhóm 340 mã | 1 ngày | bot đọc | có nhưng **thiếu mô tả ý nghĩa** (App A2) |
| 5 | App: `etf` | dòng tiền ETF (bối cảnh) | 4320' | bot đọc | có; cần chốt ý nghĩa trường |
| 6 | App: `live` | sự kiện 48h (biến động, volume) | mỗi vòng | bot đọc | có, chưa dùng |
| 7 | Binance spot | nến 15m/1H/4H cho shortlist, sổ lệnh, nến 1m | mỗi vòng | bot | có phần; **[KIỂM] IP của Cloudflare có bị chặn không** |
| 8 | Hyperliquid `info` (`metaAndAssetCtxs`) | funding, OI, premium của ~150 perp, một lời gọi, không cần khóa | mỗi vòng | bot | mới; cần bảng ánh xạ ký hiệu (`kPEPE`…). Dự phòng: OKX public |
| 9 | alternative.me Fear&Greed, CoinGecko `/global` | tâm lý, BTC dominance, tổng vốn hóa | 1 giờ | bot | mới; **[KIỂM]** endpoint + hạn mức |
| 10 | RSS tin (CoinDesk, Cointelegraph, The Block, thông báo sàn) | tiêu đề 6h gần nhất, tối đa ~15, đã dedupe | 15' | bot | mới; **[KIỂM]** danh sách feed |
| 11 | Lịch vĩ mô (FOMC/CPI/NFP…) | cửa sổ cấm vào lệnh trước sự kiện | 1 ngày | bot | mới; dự phòng `config/macro-events.json` tự cập nhật tay |
| 12 | Sổ lệnh của chính AI | lệnh đang giữ, lệnh chờ, 10 lệnh đóng gần nhất, lý do bị Governor từ chối | mỗi vòng | bot | mới |

Binance futures **không** dùng làm nguồn: chặn IP Mỹ (HTTP 451). Ghi nhận trong DATA-CONTRACT từ trước.

### 4.2 Dữ liệu app còn thiếu để AI chạy đầy đủ

Tóm tắt (chi tiết kèm đặc tả để gửi app: `PLAN.md` Phụ lục A):

| Mã | Mức | Thiếu gì | Hậu quả nếu không có |
|---|---|---|---|
| A1 | **bắt buộc** | Xác nhận khung **15m** có trong `signals` + `brief` mỗi 15' (cùng `at`) và **validation có khung 15m** | Không có bộ lọc "xanh" cho 15m; AI phải dựa vào 1H/4H |
| A2 | **bắt buộc** | `alerts-codebook.json`: mỗi mã V8 một câu ý nghĩa, hướng, nhóm, khung hợp, điều kiện nhiễu | AI thấy "V8-xxx" mà không hiểu nghĩa; quyết định mù |
| A3 | nên (giá trị cao) | `alerts-scorecard.json`: kết quả **theo dõi tiến** từng mã V8 (7/30 ngày gần nhất, cùng cấu hình 1×/2×ATR, 10 nến) | Chỉ có thống kê quá khứ (validation); không biết mã nào *đang* hỏng. Cũng giải quyết nút cổ chai "200 lệnh" vì máy quét thấy gần hết tín hiệu, không chỉ lệnh bot vào |
| A4 | nên | Trường `writtenAt` (lúc ghi file) trong mọi file | Bot đoán độ trễ quét bằng `at`; khó phát hiện quét đứng |
| A5 | tùy chọn | `alerts-market.json`: breadth (số mã lên/xuống mỗi khung, % coin trend lên, trạng thái BTC/ETH) theo định nghĩa của app | Bot tự tính từ `brief` được; làm ở app chỉ để thống nhất định nghĩa |

Không cần app làm: nến, sổ lệnh, phái sinh, tin tức, lịch vĩ mô, tâm lý (bot tự lấy, mục 4.1).

### 4.3 Packet gửi AI

- JSON, **tên trường đọc được** (không viết tắt `tr, ax, rs…`), mỗi giá trị quan trọng có `asOf`. Kèm chú giải đơn vị trong system prompt.
- Ngân sách ≤ ~5.000 token vào. Thứ tự cắt khi quá: tin tức → coin cuối shortlist → số nến lịch sử → phái sinh chi tiết.
- Cấu trúc:

```
meta        roundId, asOf, htfClosed, dataHealth{nguồn: ok|stale|down}, agentId, promptVersion
market      BTC/ETH nhiều khung (trend, RSI, ATR%), breadth, fearGreed, btcDominance, totalMcap, etf, derivsTổng
macro       sự kiện 24h tới (giờ, mức), cờ noTradeWindow
news        ≤15 tiêu đề {t, source, title} (đã làm sạch)
candidates  ≤10 coin: giá, spread, độ sâu, ATR% từng khung, mã V8 đang bật (+ý nghĩa, +validation 2 giai đoạn, +scorecard nếu có),
            vùng hỗ trợ/kháng cự thật (giá + khoảng cách theo ATR), 24 nến 15m gọn, funding, OI, sức mạnh so với BTC
portfolio   equity, tiền mặt, rủi ro còn lại (ngày, mở, drawdown), vị thế mở {entry, stop, target, pnlR, tuổi}, lệnh chờ,
            10 lệnh đóng gần nhất kèm lý do AI lúc vào, 5 đề xuất bị từ chối gần nhất kèm lý do
limits      hành động được phép, ràng buộc cứng (để AI không đề xuất thứ chắc chắn bị chặn)
```

- **Shortlist** (code, xác định): chấm điểm theo mã V8 hướng lên "xanh", số khung đồng thuận, trend/ADX/volume, thanh khoản/spread; luôn thêm coin đang giữ + coin AI đã đưa vào `watch`. AI không thấy 100 coin: vừa tốn token vừa dễ lạc.

## 5. Lớp Agent

### 5.1 Hai tầng

| Tầng | Chạy khi | Việc | Mô hình mặc định (xem mục 6) |
|---|---|---|---|
| **Analyst** | mọi vòng (96/ngày) | đọc market + shortlist + portfolio; ra `marketView`, đề xuất `entries`, quản lý `positions`, `watch` | Workers AI, miễn phí trong 10.000 neuron/ngày |
| **Decider** | chỉ khi Analyst đề xuất **mở lệnh** (ước vài lần/ngày; trần `maxDeciderPerDay`) | đọc lại cùng packet + đề xuất, tự lập luận độc lập; trả `approve / reject / reduce` | mô hình mạnh nhất cho phép trong ngân sách |

Đóng lệnh / nâng stop / hủy lệnh chờ chỉ cần Analyst (giảm rủi ro). Decider lỗi → mặc định **bỏ đề xuất mở lệnh** (`onDeciderDown:"skip"`).

### 5.2 Hợp đồng trả lời (JSON, `bot-ai.decision.v1`)

```json
{
  "schema": "bot-ai.decision.v1",
  "roundId": 1793446500000,
  "marketView": { "regime": "trend_up|range|trend_down|risk_off|unclear", "confidence": 0.6, "summary": "≤300 ký tự" },
  "entries": [
    { "coin": "SOL", "orderType": "market|limit", "limitPrice": null, "stop": 0, "target": 0,
      "conviction": 1, "maxHoldCandles15m": 40, "thesis": "≤300", "invalidation": "≤200", "confidence": 0.62 }
  ],
  "positions": [ { "coin": "ETH", "action": "hold|close|raise_stop", "newStop": null, "reason": "≤200" } ],
  "cancel":    [ { "coin": "AVAX", "reason": "≤150" } ],
  "watch":     [ { "coin": "LINK", "trigger": "≤150", "expireCandles15m": 4 } ],
  "noTradeReason": "≤200 hoặc null"
}
```

- `entries: []` là câu trả lời hợp lệ và phổ biến.
- `conviction` 1 → rủi ro 0,5 % vốn, 2 → 1,0 % (trần cấu hình `riskPct`). Mức 3 để dành.
- Số lượng (qty) **do Governor tính** từ rủi ro và khoảng cách stop; AI không đưa qty.
- Loại lệnh v1: `market` (khớp ask hiện tại) và `limit` (mua thấp hơn, hết hạn sau N nến; chỉ khớp khi nến 1 phút **xuyên qua** giá limit).
- Hướng: **spot long-only** (mặc định). Chọn "mô phỏng futures" là quyết định mở (PLAN §P0-D1); khi chọn thì thêm `side` vào schema, không đổi chỗ khác.

### 5.3 Phân tích câu trả lời

1. Yêu cầu JSON mode / structured output của nhà cung cấp khi có.
2. Nếu vẫn lỗi: lấy **đối tượng JSON hợp lệ cuối cùng** trong văn bản (không dùng regex tham lam từ `{` đầu đến `}` cuối), bỏ khối `<think>`, chuẩn hóa chữ thường/hoa, `confidence` 0–100 → 0–1.
3. Sai **định dạng** → được yêu cầu sửa **một lần** với cùng packet (không phải "câu cá"). Sai **nội dung** (AI không đồng ý) thì không bao giờ hỏi lại.
4. Vẫn lỗi → vòng đó coi như `entries: []`, vị thế giữ nguyên theo stop/target đã đặt.
5. Timeout: Analyst 90 giây, Decider 120 giây, truyền `AbortSignal` thật; mỗi provider có circuit breaker (3 lỗi liên tiếp → nghỉ 3 vòng, thử provider dự phòng).

### 5.4 Trí nhớ giữa các vòng

Mô hình không nhớ gì. Liên tục qua: (a) `watch` của chính AI, (b) 10 lệnh đóng + lý do lúc vào, (c) đề xuất bị Governor từ chối kèm mã lý do, (d) `marketView` của vòng trước (một dòng). Tất cả nằm trong packet, không có kho nhớ ẩn.

## 6. Chọn AI (miễn phí trước)

Ghi chú quan trọng: "siêu thông minh" và "miễn phí" kéo ngược nhau. Các mô hình mở mạnh nhất hiện có (gpt-oss-120b, DeepSeek V4, Kimi K2.6, GLM-5.x, Nemotron 3) không phải loại tốt nhất thế giới, và **chưa có bằng chứng LLM có lợi thế ổn định ở nhịp 15 phút trên crypto**. Vì vậy thiết kế **không** dựa vào "AI giỏi hơn" mà dựa vào: dữ liệu tốt, Governor cứng, chuẩn so sánh, và dừng AI nếu không hơn bot luật.

### 6.1 Ngân sách Workers AI (nguồn: bảng giá chính thức cập nhật 20/10/2026)

- 10.000 neuron/ngày miễn phí, dùng chung mọi mô hình, reset 00:00 UTC. Gói Workers Paid ($5, bạn đang có) giữ nguyên 10.000 miễn phí rồi tính **$0,011 / 1.000 neuron**.
- Tám mô hình mạnh (Kimi K2.6/K2.7-code, GLM-5.2/5.3/5.3-flash, DeepSeek V4 Flash/V4.1 Flash/V4 Pro) **chỉ gọi được khi có gói trả phí**; giới hạn 20 yêu cầu/phút/mô hình (50 nếu dùng credit AI Gateway trả trước). Mô hình thường: 300 yêu cầu/phút.
- Ước tính Analyst: **96 vòng/ngày, 5.000 token vào + 1.200 ra**:

| Mô hình (Workers AI) | neuron/vòng | neuron/ngày | so với 10k miễn phí | ≈ $/tháng |
|---|---:|---:|---:|---:|
| `gemma-4-26b-a4b-it` | 78 | 7.506 | 75 % | **0** |
| `glm-4.7-flash` | 71 | 6.833 | 68 % | **0** |
| `qwen3-30b-a3b-fp8` | 60 | 5.731 | 57 % | **0** (nếu bật "thinking" thì token ra tăng, tính lại) |
| `gpt-oss-20b` | 124 | 11.869 | 119 % | 0,6 |
| `glm-5.3-flash` (trả phí) | 123 | 11.782 | 118 % | 0,6 |
| `gpt-oss-120b` | 241 | 23.127 | 231 % | 4,3 (token suy luận có thể đẩy lên ~6–7) |
| `deepseek-v4.1-flash` (trả phí, chưa tính cache) | 267 | 25.658 | 257 % | 5,2 |
| `llama-3.3-70b-instruct-fp8-fast` | 379 | 36.394 | 364 % | 8,7 |
| `nemotron-3-120b-a12b` | 391 | 37.528 | 375 % | 9,1 |
| `kimi-k2.6` (trả phí) | 868 | 83.346 | 833 % | 24,2 |
| `deepseek-v4-pro` (trả phí) | 1.032 | 99.072 | 991 % | 29,4 |

- Decider **chỉ gọi khi có đề xuất mở lệnh**, ví dụ 12 lần/ngày × (7.000 vào, 800 ra): `gpt-oss-120b` ≈ 3,3k neuron/ngày, `deepseek-v4.1-flash` ≈ 3,3k, `deepseek-v4-pro` ≈ 13,5k, `kimi-k2.6` ≈ 10,7k.
- Giá neuron của một số mô hình mới có **giá cached input rất rẻ** (ví dụ DeepSeek V4.1 Flash 545 neuron/M token cache so với 27.273 không cache): đặt system prompt cố định ở đầu để tận dụng prompt caching, kiểm trang *Prompt caching* của Cloudflare.
- Hết 10.000 neuron trên gói Free thì lỗi; trên **gói Paid thì bị tính tiền**. Vì vậy bot có `maxNeuronsPerDay` (mặc định 40.000 ≈ $0,33/ngày) tự đếm theo `usage` trả về và **hạ xuống mô hình rẻ hơn** khi gần trần.

### 6.2 AI ngoài Workers AI (miễn phí có điều kiện)

| Nhà cung cấp | Hạn mức free (nguồn bên thứ ba, 10/2026) | Hợp cho | Điều kiện / bẫy |
|---|---|---|---|
| Google Gemini (khóa AI Studio) | Google **không công bố** số free; báo cáo: Flash ≈ 5 RPM / 20 RPD, Flash-Lite ≈ 500 RPD, Pro = 0 | **Decider** (≤ 20 lần/ngày, mạnh hơn mô hình mở nhỏ) | Có tài khoản bị `limit: 0`: kiểm trong AI Studio trước. Prompt free có thể dùng cải tiến sản phẩm |
| NVIDIA NIM | 40 RPM, **10.000 req/ngày/mô hình** (gpt-oss-20b, nemotron-3-super-120b) | Analyst phụ / agent so sánh | Cần NVIDIA Developer Program; là API dùng thử, không cam kết sản xuất |
| Groq | 30 RPM, 1k req/ngày nhưng **8k token/phút, 200k token/ngày/mô hình** | Chỉ gọi nhỏ (packet gọn) | 96 vòng × 6k token ≈ 576k token/ngày > trần; không đủ cho Analyst |
| OpenRouter `:free` | 20 RPM, **50 req/ngày** (1.000 sau khi nạp $10) | Dự phòng khẩn cấp | Nhà cung cấp free có thể ghi log prompt |
| GitHub Models | một nguồn báo **đã ngừng 30/7/2026** | Không dùng | — |

Dữ liệu gửi AI chỉ là dữ liệu thị trường công khai, không có khóa/dữ liệu người dùng, nên việc "prompt free có thể bị dùng để huấn luyện" chấp nhận được; vẫn nên ghi rõ.

### 6.3 Ba cấu hình mẫu (đổi bằng `config/agents.json`, không sửa code)

| Cấu hình | Analyst (96/ngày) | Decider (≤12–20/ngày) | Chi phí ước tính |
|---|---|---|---|
| **FREE** (mặc định đề xuất) | `gemma-4-26b-a4b-it` hoặc `qwen3-30b-a3b-fp8` | Gemini Flash (khóa free) → dự phòng `gpt-oss-120b` | ≈ $0 (+ vài cent nếu rơi sang dự phòng) |
| **BALANCED** | `gpt-oss-120b` | `deepseek-v4.1-flash` | ≈ $5–9/tháng |
| **MAX** | `deepseek-v4.1-flash` | `deepseek-v4-pro` hoặc `kimi-k2.6` | ≈ $20–35/tháng |

Muốn so sánh nhiều AI (Bot AI 1, Bot AI 2…): đăng ký thêm agent trong `config/agents.json`, mỗi agent một sổ riêng, cùng snapshot mỗi vòng (mục 9). Cẩn thận: 10.000 neuron/ngày là **một hồ chung** cho mọi agent; agent thứ hai nên dùng nguồn khác (Gemini/NIM) hoặc chấp nhận trả cent.

## 7. Risk Governor và Paper Broker

### 7.1 Governor (luật cứng, đọc từ `config/bot-config.json`, AI không sửa được)

Giữ các giới hạn đang có (rủi ro 1 %/lệnh, tối đa 5 vị thế, rủi ro mở ≤ 5 %, lỗ ngày 3 %, drawdown 10 % → dừng, cooldown, spread ≤ 0,15 %, độ sâu 20 mức, kill switch) và **thêm** cho agent AI:

| Luật mới | Mặc định đề xuất | Lý do |
|---|---|---|
| `maxCostR` | 0,25 R (phí+trượt ÷ khoảng stop) | chặn scalp bị phí ăn hết (mục 3) |
| Stop AI chọn | trong [0,5 ; 3] × ATR của khung quyết định, và ≥ `minStopPct` | tránh stop quá sát/quá xa |
| `minNetRR` | 1,5 sau phí+trượt | tránh kèo tỉ lệ xấu |
| Cửa sổ vĩ mô | không mở lệnh mới ±30' quanh sự kiện mức cao | biến động tin |
| `dataHealth` | app 15m + sổ lệnh coin phải `ok` | dữ liệu mù = không vào |
| Stop chỉ nâng | luôn | tránh "gỡ gạc" |
| Số lệnh/ngày | giữ 6 (có thể tăng sau bằng bằng chứng) | overtrading là lỗi lớn nhất của AI trader (Alpha Arena) |
| Tương quan | tối đa 2 vị thế cùng cụm (v2, sau) | cùng một kèo |
| Trần chi phí AI | `maxNeuronsPerDay` | mục 6.1 |

Mọi lần từ chối ghi `reasonCode` (ví dụ `COST_R`, `STOP_RANGE`, `DAY_LOSS`) và được đưa lại vào packet vòng sau.

### 7.2 Paper Broker (sửa lỗi "hồi tố" của bản cũ)

- **Giá vào = ask lúc quyết định** + trượt giá khi quét sổ lệnh cho đúng cỡ lệnh. Thoát lệnh chỉ xét từ **lúc quyết định trở đi**. Không còn "vào lúc 10:00 nhưng quyết định lúc 10:25".
- Lệnh `limit`: nằm chờ, hết hạn sau N nến 15m; khớp khi nến 1 phút có `low` < giá limit (xuyên qua, không chỉ chạm), khớp ở giá limit.
- Stop khớp ở stop − trượt; target khớp ở target (không trượt, bảo thủ có thể đổi); hết hạn giữ → thoát ở giá mở nến kế − trượt; AI chủ động đóng → giá bid lúc đó − trượt.
- Phí 0,1 %/chiều (cấu hình). Equity = tiền mặt + vị thế theo giá đóng nến 1 phút gần nhất.
- Mỗi lệnh lưu: `agentId`, `roundId`, `snapshotHash`, `entryDecisionAt`, `thesis`, `invalidation` để replay và thống kê sau.

## 8. Hạ tầng và vận hành

| Thành phần | Công nghệ | Ghi chú |
|---|---|---|
| Scheduler + lõi | Cloudflare Worker `bot-ai`, cron `*/5` | cron của Cloudflare đúng phút; không dính trễ hàng đợi GitHub |
| Ledger + journal gần | **Durable Object (SQLite)**, một đối tượng cho mỗi agent | ghi đơn luồng, nhất quán; truy vấn SQL cho thống kê |
| Snapshot/prompt/response thô | R2 `bot-ai-journal`, JSONL theo ngày | replay, kiểm toán |
| State cho trang | KV `STATE` (hoặc cache của DO), `GET /state.json` công khai | giống Worker hiện tại, nâng lên v2 |
| Admin | `POST /admin/kill`, `/admin/agent/:id/(on\|off)`, bảo vệ bằng token | công tắc bật/tắt AI từng agent mà UI vẫn chỉ đọc |
| Mã nguồn / CI | GitHub (miễn phí) | test, bundle bằng `wrangler`; không chạy vòng giao dịch |
| Kế hoạch B | Workflow GitHub Actions gọi cùng lõi, AI qua REST | dùng nếu IP Cloudflare bị Binance/nguồn nào đó chặn |

Cần kiểm trước khi cam kết (task P2-T1): từ Worker thật, gọi thử Binance spot (`data-api.binance.vision`), Hyperliquid, alternative.me, CoinGecko, các RSS, `ta.bubblelayer.com`. Nguồn nào bị chặn thì đổi nguồn hoặc chuyển sang kế hoạch B.

Vận hành: STALE nếu không có vòng nào trong 45'; báo lỗi nếu provider hỏng liên tục; ngân sách neuron hiển thị trên trang; kill switch qua admin hoặc `killSwitch:true`.

## 9. Đánh giá (làm thế nào biết AI có thật sự hơn)

1. **Agent chuẩn `rule-baseline`** (bot luật cũ, không AI) chạy trên **cùng snapshot, cùng rủi ro, cùng phí** với mọi agent AI.
2. **Sổ "bóng ma"** (ghost ledger): mỗi `entries[]` bị Decider/Governor bỏ vẫn được mô phỏng kết quả như thể đã vào. Cho biết lệnh bị bỏ là cứu hay hại.
3. Chỉ số theo agent: kỳ vọng R **sau phí**, tỷ lệ thắng, profit factor, max drawdown, số lệnh/ngày, chi phí AI/lệnh, độ lệch so với baseline, độ nhất quán Analyst–Decider.
4. Tiêu chí giữ AI: ≥ 200 lệnh đóng/agent (nhờ A3 scorecard có thể đánh giá tín hiệu nhanh hơn nhưng *lệnh của agent* vẫn cần đủ mẫu), kỳ vọng R dương sau phí ở ≥ 2 pha thị trường, và **hơn baseline** ở cùng kỳ. Hòa hoặc thua → tắt AI, giữ baseline.
5. Đổi prompt/model = agent mới; không so sánh số liệu khác version.

## 10. Rủi ro còn lại và giới hạn trung thực

- Hạn mức AI miễn phí **đổi liên tục** và Google không công bố con số; mọi bảng ở mục 6 có hạn dùng ngắn. Task P0-T0 chạy `tools/probe-ai.js` để đo thực tế bằng khóa của bạn.
- LLM không xác định (cùng packet có thể ra khác). Vì thế lưu mọi câu trả lời thô.
- Paper ≠ thật: khớp ảo lạc quan hơn sổ lệnh thật khi thị trường chạy nhanh.
- Packet chỉ chứa dữ liệu công khai; nhưng nội dung tin tức vẫn là kênh tiêm lệnh tiềm năng. Giảm thiểu: chỉ tiêu đề, cắt độ dài, loại URL, đặt trong khung dữ liệu, AI không có công cụ, Governor chặn.
- Mô hình mở nhỏ có thể suy luận kém về cấu trúc giá. Đó là lý do đo bằng sổ ảo và so với baseline trước khi tin.
- Chi phí vòng ở khung 15m rất cao (mục 3): nếu agent liên tục bị `COST_R` chặn thì kết luận là kèo 15m không đáng giao dịch, không phải lỗi hệ thống.

## 11. Ánh xạ từ code hiện có

| Hiện có | Số phận |
|---|---|
| `src/app-reader.js`, `config/app-contract.json` | giữ; thêm khung 15m, `rules`/`etf`/`live`, `writtenAt`, codebook, scorecard |
| `src/binance.js` | giữ; thêm nến 15m/1H/4H và dùng cho thoát lệnh trong Worker |
| `src/bot.js` (`findCandidates`, `tryEnter`, `applyExits`) | `findCandidates/greenEdge` → shortlist + agent `rule-baseline`; `tryEnter/applyExits` → `broker.js` (giá ask lúc quyết định) |
| `src/ai-gate.js`, `ai-provider.example.js` | thay bằng `agents/` (prompt, schema, parser, providers) |
| `src/run.js` | thành `round()` trong Worker; bản CLI giữ cho chạy thử `--dry` |
| `src/state-builder.js`, `state-contract.js`, `worker/state-worker.mjs` | nâng lên state v2 (`docs/STATE-CONTRACT.md`) và gộp vào Worker `bot-ai` |
| `ui/` | thêm tab theo agent, luồng quyết định kèm lý do, sức khỏe AI/ngân sách (task P5) |
| `docs/BOT-RULES.md`, `GO-LIVE.md`, `DATA-CONTRACT.md`, `INTEGRATE.md` | giữ; BOT-RULES mô tả agent baseline |
