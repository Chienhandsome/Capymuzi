# Discord Music Bot

## Chuẩn bị Discord

1. Tạo application tại https://discord.com/developers/applications, sau đó chọn **Bot** > **Add Bot**.
2. Lưu **Application ID** vào `DISCORD_CLIENT_ID`.
3. Tại **Bot**, tạo/copy token vào `DISCORD_BOT_TOKEN`. Không gửi token vào chat và không commit file `.env`.
4. Bật Developer Mode trong Discord: `User Settings` > `Advanced` > `Developer Mode`. Nhấp phải icon server thử nghiệm và chọn **Copy Server ID** để lấy `DISCORD_GUILD_ID`.
5. Tại `OAuth2` > `URL Generator`, chọn scopes `bot` và `applications.commands`. Bot permissions tối thiểu: `View Channels`, `Send Messages`, `Embed Links`, `Connect`, `Speak`. Mở link tạo ra để mời bot vào server.

Không cần bật Message Content Intent cho UI/slash command này.

## Chạy lần đầu

```powershell
Copy-Item .env.example .env
# Mở .env và điền ba giá trị Discord ở trên
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' run register:commands
& 'C:\Program Files\nodejs\npm.cmd' run dev
```

Trong server, gõ `/capymuzi`. Bot phải trả về bảng Music Player.

> Lưu ý: `npm` trong PATH của máy hiện tại đang lỗi cấu hình. Dùng chính xác lệnh `& 'C:\Program Files\nodejs\npm.cmd' ...` phía trên, hoặc cài lại Node.js LTS để sửa vĩnh viễn.

## Cách sử dụng

1. Chạy bot và dùng `/capymuzi` trong text channel.
2. Vào một voice channel.
3. Nhấn **Thêm nhạc**, nhập một hoặc nhiều tên bài/link YouTube (mỗi dòng một bài) rồi gửi form.
4. Dùng các nút để pause/resume, quay lại bài trước, skip, stop, shuffle, loop, xem queue, lịch sử và chỉnh âm lượng.

Người điều khiển phải ở cùng voice channel với bot. Queue hiện nằm trong RAM; lịch sử phát được lưu tại `data/music-bot.sqlite` và không mất khi bot khởi động lại.

Bot tự rời voice sau 5 phút khi queue trống. Nếu voice channel không còn người nghe, bot đợi 60 giây rồi dừng nhạc và rời kênh. Có thể thay đổi hai khoảng thời gian này bằng `IDLE_DISCONNECT_MS` và `EMPTY_CHANNEL_DISCONNECT_MS` trong `.env`.

Nút **Lịch sử** hỗ trợ phân trang và xóa dữ liệu; bot luôn yêu cầu xác nhận trước khi xóa.

Chỉ phát nội dung mà bạn có quyền truy cập và sử dụng; việc lấy audio có thể bị ảnh hưởng khi YouTube thay đổi cơ chế phân phối nội dung.
Nếu log cloud báo `Sign in to confirm you’re not a bot`, xem phần YouTube trong [DEPLOY.md](./DEPLOY.md) để cấu hình cookie xác thực cho `yt-dlp`.

## Docker và deploy

Project có sẵn `Dockerfile`, `compose.yaml`, health check và graceful shutdown. Xem [DEPLOY.md](./DEPLOY.md) để chạy bằng Docker, triển khai lên VPS hoặc Render Background Worker.
