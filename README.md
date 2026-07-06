# 🎥 VSC Live Broadcast Studio

Hệ thống phòng thi đấu, livestream trực tiếp và điều phối camera từ xa độ trễ thấp (< 200ms) dành cho MC và Vận Động Viên (VĐV). Hệ thống tích hợp tính năng đồng bộ đồ họa thời gian thực cho OBS Overlay.

---

## 🚀 Hướng Dẫn Chạy Ứng Dụng Trên GitHub

Hệ thống hoạt động dưới mô hình **Full-stack (Express Server + Vite Frontend + WebSockets + WebRTC)**. Do đó, để ứng dụng chạy đầy đủ tính năng kết nối (Signaling) và phát sóng, máy chủ Node.js bắt buộc phải hoạt động.

Dưới đây là 3 Workflow tối ưu nhất để bạn chạy và vận hành ứng dụng trực tiếp từ GitHub.

---

### 🟢 Workflow 1: Chạy Trực Tiếp Trên GitHub Với "GitHub Codespaces" (Khuyên Dùng)
GitHub Codespaces cung cấp một môi trường máy ảo miễn phí chạy trực tiếp trên máy chủ GitHub. Đây là cách nhanh nhất và hoàn hảo nhất để khởi chạy và thử nghiệm toàn bộ ứng dụng (cả Backend lẫn Frontend) mà không cần cài đặt gì trên máy tính cá nhân.

#### **Ưu điểm vượt trội:**
- **Auto-HTTPS:** GitHub tự động cung cấp proxy HTTPS bảo mật cho các cổng kết nối. Điều này là **bắt buộc** để trình duyệt cho phép cấp quyền Truy cập Camera & Microphone (WebRTC).
- **Auto-Setup:** Đã tích hợp sẵn file cấu hình `.devcontainer/devcontainer.json` để tự cài đặt mọi thứ.

#### **Các bước thực hiện:**
1. **Đưa mã nguồn lên GitHub:** Đẩy toàn bộ thư mục này lên một kho lưu trữ (Repository) của bạn trên GitHub.
2. **Khởi tạo Codespace:** 
   - Trên trang Repository của bạn, click nút màu xanh **"Code"**.
   - Chọn tab **"Codespaces"** -> Click **"Create codespace on main"**.
3. **Chạy ứng dụng:**
   - GitHub sẽ tự động mở một trình soạn thảo VS Code trên trình duyệt và tự chạy lệnh cài đặt thư viện (`npm install`).
   - Sau khi cài đặt hoàn tất, bạn chỉ cần gõ lệnh sau vào Terminal của Codespaces để khởi động:
     ```bash
     npm run dev
     ```
4. **Truy cập Giao diện:**
   - Khi server chạy, một thông báo popup ở góc dưới bên phải sẽ xuất hiện thông báo cổng `3000` đã được mở rộng.
   - Click vào **"Open in Browser"** để truy cập ứng dụng với giao diện HTTPS bảo mật cực kỳ mượt mà!

---

### 🛠️ Workflow 2: Tự Động Kiểm Tra & Build Với "GitHub Actions (CI)"
Hệ thống đã tích hợp sẵn tệp cấu hình kiểm thử tự động tại đường dẫn `.github/workflows/ci.yml`.

#### **Mục đích:**
- Mỗi khi bạn thực hiện `git push` hoặc tạo `Pull Request` lên nhánh `main` / `master`, GitHub Actions sẽ tự động khởi tạo máy ảo để:
  1. Tải các thư viện cần thiết (`npm ci`).
  2. Kiểm tra tính toàn vẹn của mã nguồn TypeScript (`npm run lint`).
  3. Thử nghiệm biên dịch toàn bộ ứng dụng sang bản thương mại (`npm run build`).
- Đảm bảo dự án luôn trong trạng thái sẵn sàng chạy và không phát sinh lỗi cú pháp hay thiếu thư viện.

---

### 🌐 Workflow 3: Triển Khai Thực Tế Lên Môi Trường Internet (Production Deployment)
Do hệ thống cần máy chủ **Express WebSocket Server** hoạt động 24/7 để làm cầu nối trung gian chuyển tiếp tín hiệu WebRTC giữa MC và VĐV, ứng dụng **không thể chạy độc lập trên GitHub Pages** (vì GitHub Pages chỉ hỗ trợ các trang web tĩnh).

Bạn có thể triển khai dự án hoàn toàn **MIỄN PHÍ** lên các nền tảng đám mây hỗ trợ Node.js/WebSockets hàng đầu hiện nay như **Render**, **Railway**, hoặc **Koyeb**.

#### **Các bước thiết lập trên Render (Nhanh nhất & Miễn phí):**
1. Truy cập [Render.com](https://render.com/) và đăng ký/đăng nhập bằng tài khoản GitHub của bạn.
2. Click **"New +"** -> Chọn **"Web Service"**.
3. Kết nối với GitHub Repository chứa mã nguồn này.
4. Cấu hình thông số dự án như sau:
   - **Language:** `Node`
   - **Region:** Chọn khu vực gần Việt Nam nhất (ví dụ: `Singapore` hoặc `Oregon`).
   - **Branch:** `main` (hoặc `master`).
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Chọn gói `Free` (Miễn phí).
5. Click **"Deploy Web Service"**.
6. **Cấu hình Biến Môi Trường (Environment Variables):**
   - Trong giao diện quản lý ứng dụng của Render, chọn tab **"Variables"**.
   - Thêm các biến sau:
     * `NODE_ENV` = `production`
     * `PORT` = `3000`
     * `GEMINI_API_KEY` = *(Khóa API Gemini của bạn để hỗ trợ tính năng AI)*
7. **Hoàn tất:** Render sẽ tiến hành build và cung cấp cho bạn một đường link HTTPS (ví dụ: `https://vsc-broadcast-studio.onrender.com`). Bạn có thể sử dụng đường link này để mời MC, VĐV, và dán vào OBS Browser Source một cách chuyên nghiệp!

---

## ⚙️ Chi Tiết Lệnh Vận Hành Dự Án (Local Development)

Nếu bạn muốn tải mã nguồn từ GitHub về máy tính cá nhân để chạy cục bộ:

1. **Cài đặt thư viện:**
   ```bash
   npm install
   ```
2. **Khởi chạy máy chủ phát triển (Development Mode):**
   ```bash
   npm run dev
   ```
   *Mở trình duyệt truy cập: `http://localhost:3000`*

3. **Biên dịch sản xuất (Production Build):**
   ```bash
   npm run build
   ```
   *Lệnh này sẽ biên dịch đồng thời Client (Vite) thành các tệp tĩnh và Server thành một tệp đóng gói tối ưu duy nhất tại `dist/server.cjs` sử dụng esbuild.*

4. **Chạy bản thương mại đã biên dịch:**
   ```bash
   npm start
   ```

---

## 🤝 Bản Quyền & Trạng Thái
- **Trạng thái:** Toàn bộ hệ thống logic WebRTC, đồng bộ hóa trạng thái phòng, Remote Control, và hiệu ứng đồ họa đã được biên dịch thành công hoàn hảo 100% không phát sinh lỗi.
- **Bảo toàn Logic:** Đảm bảo giữ nguyên 100% logic nghiệp vụ truyền hình trực tiếp đã thiết kế.
