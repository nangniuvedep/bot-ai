# CHANGELOG

## 2026-10-31 — kiến trúc v2 (chỉ tài liệu, chưa đổi code)
- Viết lại `docs/ARCHITECTURE.md` và `docs/PLAN.md`: AI thật phân tích mỗi 15 phút và tự quyết định đặt lệnh ảo; Governor cứng; nhiều agent; chạy trên Cloudflare Worker; ưu tiên AI miễn phí (Workers AI 10.000 neuron/ngày + Gemini free cho Decider).
- Đánh dấu `BOT-AI-DESIGN.md` đã được thay thế. Cập nhật `README.md`.
- Code, config và test giữ nguyên (4 bộ test cũ vẫn qua). Phát hiện cần sửa ở P1: vào lệnh hồi tố (nhìn trước tương lai), parser JSON giòn, timeout 20s quá ngắn.
- Còn dở: toàn bộ P0–P7; yêu cầu app A1–A5 chưa gửi.
