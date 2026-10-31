> **ĐÃ THAY THẾ (31/10/2026)** bởi `docs/ARCHITECTURE.md` (kiến trúc v2: AI quyết định mỗi 15 phút) và `docs/PLAN.md`. Giữ file này làm lịch sử thiết kế B0; không làm theo mục 6–8 nữa.

# BOT-AI-DESIGN — bản nháp B0 (chờ chốt mục 7)

Bot paper trading (tiền ảo), chạy riêng, chỉ đọc dữ liệu app qua `src/app-reader.js`. Xóa thư mục `Bot-AI/` = xóa bot.

## 1. Nguyên tắc
1. Bot chỉ có hai việc: **vào lệnh** và **thoát lệnh**. Không đưa lời khuyên, không có giao diện trong app.
2. Không tự tính lại chỉ báo/tín hiệu: dùng `alerts-signals/brief/validation`.
3. AI chỉ đề xuất. Bộ quản lý rủi ro bằng luật cứng quyết định, AI không sửa được.
4. Dữ liệu lạ, cũ, thiếu → bỏ lượt, không đoán.
5. Không ghi vào hạ tầng của app (R2 `bl-ta`, Worker, CSP…).

## 2. Chạy ở đâu
Repo + workflow + secrets **riêng** của bot (không chung job với scanner). Trạng thái và sổ lệnh là JSON trong nhánh dữ liệu của repo bot (hoặc bucket riêng), chỉ ghi thêm. Chạy sau mỗi nến đóng; GitHub Actions theo lịch thường trễ vài phút — chấp nhận với 1H/4H. Một lượt tại một thời điểm (concurrency group).

## 3. Vào lệnh
- Ứng viên = coin có hit V8 hướng lên ở khung 1H/4H, mã đó "xanh" ở **cả hai** giai đoạn 70/30 của Validation (công thức xanh: xem DATA-CONTRACT mục 3, **[KIỂM]**).
- Giá khớp ảo = mở nến kế tiếp + trượt giá lấy từ sổ lệnh Binance thật − phí (hằng số cấu hình). Spread/độ sâu kém → bỏ.
- Mốc cắt/mục tiêu theo ATR(14) của nến tín hiệu, tối đa 10 nến — cùng thước với Validation.

## 4. Thoát lệnh
Mỗi lượt lấy nến 1 phút từ lúc vào đến giờ, xét chạm mốc theo thứ tự thời gian. Một nến chạm cả hai mốc → tính cắt lỗ. Hết 10 nến → thoát ở giá mở nến kế.

## 5. Quản lý rủi ro (luật cứng)
Rủi ro mỗi lệnh, số vị thế tối đa, giới hạn lỗ ngày, nghỉ sau mỗi lệnh trên cùng coin, công tắc dừng khẩn. Con số xem mục 7.

## 6. AI (B4, sau khi bot luật chạy ổn)
Đầu vào: gói số gọn mỗi coin (brief, mã V8 đang bật kèm điểm validation, khoảng cách tới hỗ trợ/kháng cự theo ATR, thanh khoản, bối cảnh thị trường), mỗi giá trị kèm thời điểm. Đầu ra JSON bắt buộc: vào/bỏ qua, độ tin cậy, mốc cắt/mục tiêu theo ATR, lý do ngắn. Sai định dạng = bỏ qua. Lệnh đang giữ vẫn chạy theo mốc đã đặt khi AI lỗi. Ghi lại mọi lần gọi.
**Không backtest AI trên quá khứ** (mô hình đã biết lịch sử); chỉ chạy tiến, ít nhất ~200 lệnh đã đóng mỗi bot, so với bot luật cùng tín hiệu, cùng rủi ro, cùng phí. AI hòa hoặc thua bot luật → bỏ AI.

## 7. Cần chốt (mặc định đề xuất — nói "đồng ý" là đủ)
1. Chỉ mua giao ngay (long-only), không đòn bẩy.
2. Rủi ro 1% vốn ảo/lệnh · tối đa 5 vị thế · dừng vào lệnh mới khi lỗ trong ngày chạm 3% · nghỉ vài nến sau mỗi lệnh cùng coin.
3. Khung giờ: 1H và 4H (không dùng 15m).
4. Repo bot riêng tư hay công khai (ảnh hưởng hạn mức phút Actions — chưa kiểm số hiện tại).
5. Nhà cung cấp AI đang có tài khoản dùng được (để kiểm giới hạn miễn phí rồi đặt hạn mức ngày).

## 8. Các bước
B1 khung repo + `app-reader` (**xong khung, chưa nối app thật**) · B2 bot luật + sổ lệnh ảo, chạy ~2 tuần · B3 dữ liệu bổ sung (sổ lệnh/spread, futures, stablecoin, F&G; mỗi nguồn một lượt, có thời điểm, có trạng thái "không có") · B4 lớp AI · B5 so sánh bot luật vs bot AI.
