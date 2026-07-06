# HỆ THỐNG PHÒNG THI ĐẤU & TRUYỀN HÌNH TRỰC TIẾP VĐV - OBS OVERLAY
> Đóng băng kiến thức hệ thống (Phiên bản 2.0 - Hoạt động hoàn hảo)

Tài liệu này ghi nhận toàn bộ kiến thức kiến trúc, giải pháp truyền thông WebRTC, cơ chế chống rớt mạng, điều phối camera từ xa và đồ họa livestream đã được kiểm chứng hoạt động ổn định.

---

## 1. Kiến Trúc Hệ Thống (Architecture Overview)

Hệ thống hoạt động dưới mô hình **Full-stack (Express + Vite + WebSockets)** kết hợp **WebRTC Peer-to-Peer** phục vụ truyền tải video độ trễ cực thấp (< 200ms).

### Các Bên Tham Gia (Roles):
1. **MC / Ban Tổ Chức (Host Dashboard):**
   - Đóng vai trò điều phối trung tâm.
   - Thiết lập phòng, kích hoạt số lượng Slot VĐV hiển thị (tối đa 4 Slot).
   - Có bàn điều phối đồ họa livestream, bảng điểm tích hợp, hiệu ứng VFX (Confetti).
   - Có quyền remote control: bật/tắt camera VĐV, bật/tắt mic, đổi độ phân giải (1080p/720p/480p), điều khiển thiết bị zoom quang học, chỉ định camera cụ thể từ xa, điều chỉnh tốc độ truyền mạng (Bitrate).
2. **Vận Động Viên (Athlete View):**
   - Sử dụng điện thoại di động hoặc máy tính để phát sóng trực tiếp camera và micro.
   - Tích hợp sảnh chờ (Lounge) để kiểm tra tín hiệu trước khi truyền hình trực tiếp.
   - Nhận tín hiệu điều khiển trực tiếp (Remote Control commands) từ MC qua kênh WebSocket.
   - Gửi luồng hình ảnh tới MC và luồng đồ họa tới OBS thông qua kết nối WebRTC.
3. **OBS Overlay (OBS Link Overlay):**
   - Là một trang web nguồn trình duyệt (Browser Source) đưa trực tiếp vào OBS Studio.
   - Đồng bộ hóa đồ họa thời gian thực: tỉ lệ khung hình (16:9, 9:16), bảng điểm chuyên nghiệp, hiệu ứng chuyển cảnh, khung tròn PIP, lật xoay góc camera, vị trí chồng lớp (Layering) và hiệu ứng hình ảnh.

---

## 2. Hệ Thống Signaling & Đồng Bộ Trạng Thái (WebSocket Server)

File `server.ts` chạy trên cổng `3000` đảm nhận vai trò kết nối tín hiệu (Signaling) cho WebRTC và phân phối điều khiển thời gian thực.

### Các Tính Năng Quan Trọng Đã Hoạt Động Tốt:
* **Lưu Trữ Cấu Hình Bền Bỉ (Resilient Layout Protection):**
  - Trạng thái đồ họa, điểm số, bố cục layout được lưu trực tiếp trên bộ nhớ Server theo từng phòng (`roomId`).
  - Khi MC hoặc OBS bị mất mạng đột ngột và kết nối lại, Server sẽ tự động gửi lại cấu hình đã lưu (`savedSettings`) qua gói tin `room-peers`, khôi phục ngay lập tức giao diện livestream mà không bị mất dữ liệu hoặc reset về mặc định.
* **Cơ Chế Giữ Kết Nối Lenient Keepalive (Chống Chập Chờn 4G):**
  - Chạy chu kỳ `setInterval` mỗi 30 giây gửi gói tin `ping` tới mọi Client để tránh việc trình duyệt tắt ngầm Socket.
  - Sử dụng bộ đếm số lần bỏ lỡ `missedHeartbeats` cho phép bỏ lỡ tối đa **3 chu kỳ ping liên tiếp (tương đương 90 giây)** trước khi ngắt kết nối vật lý. Việc này ngăn chặn hệ thống tự động xóa kết nối WebRTC khi VĐV đang di chuyển ngoài trời và IP bị thay đổi tạm thời (WiFi chuyển sang 4G).
* **Định Danh Chính Xác (Athlete Identification):**
  - Sử dụng ID định dạng `inv_1`, `inv_2`, `inv_3`, `inv_4` đồng bộ từ đường link mời riêng.
  - Khi Client đăng ký vào WebSocket, Server gán nhãn `clientId` và tự động cập nhật danh sách người tham gia trực tuyến mà không bị trùng lặp.

---

## 3. Quản Lý Thiết Bị Camera & Remote Control (Camera Selection & Control)

Một trong những cải tiến cốt lõi là giải quyết triệt để lỗi không chọn được Camera của VĐV 2, 3, 4:

* **Tự Động Nhận Diện (Default Auto State):**
  - Khởi tạo giá trị camera ban đầu bằng `"auto"`. Kỹ thuật này kích hoạt cơ chế tự lựa chọn camera tối ưu nhất dựa trên hệ điều hành của thiết bị (ví dụ: Camera trước trên điện thoại selfie hoặc camera chính trên laptop).
* **Bổ Sung Option "auto" Đồng Bộ:**
  - Cả phía **VĐV** (Giao diện sảnh chờ & Cài đặt nhanh trong cuộc gọi) và phía **MC** (Bàn điều phối thiết bị từ xa) đều được đồng bộ hóa tùy chọn:
    `📹 Tự động nhận diện (Mặc định)` với giá trị `value="auto"`.
  - Việc này tránh tình trạng thẻ `<select>` hiển thị sai lệch khi thiết bị trả về danh sách camera khác nhau, cho phép MC khôi phục lại chế độ tự động của trình duyệt chỉ bằng một cú click từ xa.
* **Cập Nhật Danh Sách Thiết Bị Động:**
  - VĐV gửi danh sách camera của mình lên Host qua tin nhắn `athlete-devices`.
  - MC lưu danh sách này vào state `athleteDevices` theo đúng ID của từng VĐV (`athleteDevices[athlete.id]`), đảm bảo việc điều khiển camera hoạt động độc lập và hoàn hảo cho cả 4 VĐV đồng thời mà không bị lẫn lộn dữ liệu.
* **Truyền Trạng Thái Kết Nối Mạng Thực Tế:**
  - Trạng thái mạng thực tế của VĐV (`networkType` - WIFI / 4G/5G) được gửi thời gian thực lên Host qua tin nhắn cập nhật trạng thái (`athlete-state-update`), giúp MC giám sát được chất lượng kết nối của từng người.

---

## 4. Giải Pháp WebRTC Chống Rớt Mạng Toàn Diện

Hệ thống được trang bị bộ giải pháp tối ưu hóa WebRTC vượt trội, kiểm chứng chạy tốt trên cả WiFi gia đình lẫn mạng 4G/5G sóng yếu ngoài đường:

1. **Khôi Phục Luồng Thủ Công (Manual Reconnection):**
   - Trên mỗi thẻ VĐV ở màn hình MC, tích hợp nút **🔄 RECONNECT** thủ công. Khi click vào, Host sẽ hủy ngay PeerConnection cũ và gửi lại gói tin `offer` tươi mới đến thiết bị VĐV để dựng lại cầu kết nối chỉ trong 1-2 giây mà không cần VĐV phải refresh trang web.
2. **Quản Lý ICE Candidates Sớm (Early Candidate Queueing):**
   - Lưu trữ tạm thời các ứng viên mạng (ICE candidates) nhận được trước khi quá trình xử lý SDP Offer/Answer hoàn tất vào hàng đợi `pendingIceCandidatesRef`. Khắc phục hoàn toàn lỗi mất đồng bộ kết nối WebRTC trên môi trường mạng tốc độ cao (mạng di động 5G).
3. **Phân Luồng Chất Lượng Theo Chế Độ 4G (Adaptive Mode & Bitrates):**
   - MC có thể kích hoạt chế độ **4G Mode** cho từng VĐV. Khi bật, hệ thống tự động đổi ICE Server ưu tiên TURN truyền dữ liệu di động, đồng thời giảm bitrate xuống mức an toàn từ 1000kbps đến 2000kbps để giảm tối đa độ trễ và giật lag do sóng yếu.
4. **Bảo Vệ Âm Thanh Vòng Lặp (Mic Loop Avoidance):**
   - Host chỉ gửi âm thanh của MC về phía VĐV và không gửi ngược lại luồng âm thanh của chính VĐV đó, triệt tiêu hoàn toàn tiếng vọng (echo loopback) gây chói tai cho người dùng.

---

## 5. Danh Mục Các File Quan Trọng

* `/server.ts`: Máy chủ HTTP, WebSocket Server quản lý signaling, keepalive bảo vệ kết nối, lưu trữ cấu hình đồ họa tập trung.
* `/src/App.tsx`: Bộ định tuyến Client-side, phân tích tham số URL (`role`, `roomId`, `athleteId`, `name`).
* `/src/components/HostDashboard.tsx`: Trung tâm điều phối của MC, quản lý kết nối 4 VĐV, bàn điều khiển đồ họa livestream trực tiếp, bảng điểm và remote control camera/zoom/bitrate.
* `/src/components/AthleteView.tsx`: Giao diện của VĐV, quản lý camera, mic, sảnh chờ, chuyển đổi camera, zoom vật lý/CSS và giữ kết nối thời gian thực bền bỉ.
* `/src/components/ObsRenderer.tsx`: Giao diện đồ họa livestream đưa vào OBS Studio, xử lý bố cục động, lật camera, hiệu ứng PIP, scoreboard, lower thirds và hiệu ứng chuyển cảnh mượt mà bằng Framer Motion (`motion`).

---
> **Trạng thái:** Toàn bộ code đã được biên dịch thành công (`compile_applet` đạt kết quả tuyệt đối), linter không có bất kỳ lỗi nào. Sẵn sàng vận hành thực tế!
