# Hợp đồng dữ liệu app → bot

Nguồn: gói **bubblelayer-V1479** (app vẫn đang đổi ở lộ trình khác — đây là bản chụp, không phải bảo đảm).
Đọc file này thay vì đọc app. Chỗ nào nghi ngờ thì ghi **[KIỂM]**.

## 1. Ai ghi, ghi ở đâu, cập nhật khi nào
- Máy quét: GitHub Actions, repo công khai `nangniuvedep/coin-data`, workflow `data.yml`. Đồng hồ Cloudflare (tài khoản phụ) bấm chạy **01/16/31/46 phút mỗi giờ** (15 phút một lần). Nguồn nến: Binance spot qua `data-api.binance.vision`.
- Ghi lên R2 bucket `bl-ta`, phục vụ qua `https://ta.bubblelayer.com/<tên file>`.
- **[KIỂM]** Tên file trên CDN: tài liệu app ghi `alerts-live.json`, `alerts-signals.json`, `alerts-brief.json`, `alerts-validation.json`, `alerts-rules.json`, `alerts-etf.json` (danh sách cho phép của worker `guard`). Workflow ghi bằng tiền tố `S_PREFIX` (gợi ý `ta/alerts-`) — nếu tiền tố thật là `ta/alerts-` thì địa chỉ là `.../ta/alerts-signals.json`. Hãy gọi thử 1 lần với `curl -I` rồi chỉnh `config/app-contract.json`.
- Worker `guard` xóa mọi file lạ trong bucket. Bot **không được** ghi vào bucket này.

## 2. Các file bot dùng
Chung: JSON, có `v` (phiên bản định dạng) và `at` (mili giây epoch, mốc nến đã đóng hoặc lúc ghi). Bot kiểm `v` và tuổi `at`; sai thì bỏ lượt.

| File | v | Cập nhật | Bot dùng để |
|---|---|---|---|
| `alerts-signals.json` | 2 | mỗi lượt quét | tín hiệu V8 của từng coin, từng khung |
| `alerts-brief.json` | 2 | mỗi lượt quét | số liệu "coin đang thế nào" (xu hướng, RSI, ATR, hỗ trợ/kháng cự, gauge) |
| `alerts-validation.json` | 2 | mỗi ngày (≈00:01 UTC) | mã V8 nào hơn ngẫu nhiên, ở cả 2 giai đoạn |
| `alerts-etf.json` | — | 1–2 lần/ngày, khi số đổi | bối cảnh dòng tiền ETF (chỉ làm bối cảnh) |
| `alerts-rules.json` | 1 | mỗi lượt | tên/nhóm của 340 mã V8 (chỉ để hiển thị) |
| `alerts-live.json` | 2 | mỗi lượt | sự kiện 48 giờ (biến động lớn, volume…). Chưa cần cho bot |

Khung giờ: `15m`, `1H`, `4H`, `1D` (1W chỉ là khung tham chiếu phía trên). Mỗi khung chỉ ghi lại khi nến của nó đóng.

## 3. Hình dạng
### signals.json
```
{ v:2, at, lastAt:{tf:ms}, err:{tf:{at,msg}}, tf:{ "1H": { at, scanned, btc:{ch,c24},
  coins:[ { sym, pair, price, ch, c24, qv, s:[ [code, html, dir, say?], … ], sum:{u,d,n,top} } ] } }, say:{…} }
```
- `at` của khung = `floor(now/ms)*ms` = lúc nến tín hiệu **vừa đóng** = lúc **mở nến kế tiếp** (xác nhận trên file thật 31/10/2026: lúc 10:42 UTC, 1H có at=10:00, 4H có at=08:00). Vào lệnh ảo ở mở nến kế tiếp = **`at`** (cờ `atIsCandleClose` trong `config/app-contract.json`).
- Chỉ có coin **đủ thanh khoản** (qv ≥ 5 triệu USD/24h), đã niêm yết ≥ 14 ngày, và có ít nhất 1 mã V8. Sắp theo qv giảm dần.
- `dir` của một hit: `1` lên, `-1` xuống, `0` trung tính. Bot chỉ dùng `±1`.
- `err[tf]` có giá trị = khung đó quét lỗi lượt gần nhất → coi dữ liệu khung đó là cũ.

### brief.json
```
{ v:2, at, min:{brief,v8}, tf:{ "1H": { at, c:{ SYM:{tr,ax,rs,mc,s,sd,r,rd,nz,a,ar,vr,cb,u,d,h,k,p,g} }, x:{ SYM:[lý do,nến] } } } }
```
`tr` xu hướng (+1/0/−1) · `ax` ADX · `rs` RSI · `mc` MACD (−2…+2) · `s`/`r` giữa vùng hỗ trợ/kháng cự gần nhất (null nếu không có) · `sd`/`rd` khoảng cách % · `nz` gần hỗ trợ(1)/kháng cự(2) trong 0,75 ATR · **`a` = ATR(14) theo % giá** · `ar` ATR hiện tại ÷ trung bình · `vr` volume ÷ trung bình 20 nến · `cb` thân nến theo ATR · `u`/`d` số mã V8 lên/xuống · `h` 1 = đã chạy V8 · `p` giá đóng · `g` gauge −100…+100 (mô tả, không dự báo).
Brief có cho cả coin ít thanh khoản; `x[SYM]` cho biết vì sao một coin không có brief (`new`, `gap`, `error`).

### validation.json
```
{ v:2, at, tf:{ "1H": { coins, days, cut,
  base:{ a:{cfg:{up:[r,w,u], dn:[r,w,u]}}, b:{…} },
  rows:[ { code, perDay, a:{n,du,dd,cfg:{cfg:[r,w,u]}}, b:{…} } ] } } }
```
- `a` = 70% đầu, `b` = 30% cuối. `cfg` = `"<dừng>-<tỉ lệ>"` với dừng ∈ {0.5, 1, 2}×ATR(14), mục tiêu = tỉ lệ × dừng, tỉ lệ ∈ {1,2,3} → 9 cấu hình (`"1-2"` = dừng 1 ATR, mục tiêu 2 ATR).
- `[r,w,u]` = đúng / sai / chưa rõ trong 10 nến. Chạm cả hai mốc trong cùng một nến = sai. `base` = một nến ngẫu nhiên cùng hướng, cùng mốc.
- Chỉ 100 coin giao dịch nhiều nhất, mỗi khung. Bot không có số liệu Validation cho coin ngoài nhóm đó.
- **[KIỂM]** Ngưỡng tô xanh của trang Validation ("hơn ngẫu nhiên ≥ +2 điểm, dưới 50 lần không tô") — công thức chính xác nằm trong code trang, chưa trích. `app-reader.js` đang dùng giả định `thắng = r/(r+w)`; cần đối chiếu với trang trước khi lọc thật.

## 4. Điều bot phải làm với hợp đồng này
1. Kiểm `v` và tuổi `at` của mọi file (config/app-contract.json). Lạ/cũ → bỏ lượt, không vào lệnh.
2. Ghi nhớ `at` của từng khung đã xử lý để chạy lại không vào lệnh hai lần.
3. Chỉ GET, mỗi file tối đa 1 lần mỗi lượt. `ta.bubblelayer.com` không có cache trước R2, mỗi GET là một lượt đọc R2 tính vào tài khoản chính của app (hạn mức 10 triệu/tháng, chung với app). Mức của bot nhỏ (vài file × 96 lượt/ngày) nhưng đừng gọi liên tục.
4. Không tin giá trong file là giá khớp: giá khớp ảo lấy từ nến/sổ lệnh Binance do bot tự đọc.

## 5. Lệch giữa Validation và vào lệnh thật
Validation chấm từ **giá đóng** của nến tín hiệu, không phí, không trượt giá. Bot vào ở **mở nến kế tiếp** cộng phí và trượt giá, nên kết quả bot sẽ thấp hơn con số Validation. Đây là chênh lệch dự kiến, không phải lỗi. Mốc cắt/mục tiêu bot dùng cùng đơn vị ATR(14) và cùng giới hạn 10 nến để so được.

## 6. Việc cần kiểm khi nối với app thật
- [ ] `curl -I https://ta.bubblelayer.com/alerts-signals.json` → 200 và đúng đường dẫn (có/không tiền tố `ta/`).
- [ ] Mở 1 file thật, đối chiếu `v` và các trường với mục 3; lệch thì sửa `app-reader.js` + chạy `node test/app-reader.test.js`.
- [ ] Xác nhận công thức "xanh" của trang Validation (mục 3).
- [ ] Bot tự gọi Binance qua `data-api.binance.vision` (api.binance.com trả 451 với máy Mỹ của GitHub; futures không vào được từ đó — dữ liệu futures cần nguồn khác, quyết định ở B3).
