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

Trong server, gõ `/music`. Bot phải trả về bảng Music Player.

> Lưu ý: `npm` trong PATH của máy hiện tại đang lỗi cấu hình. Dùng chính xác lệnh `& 'C:\Program Files\nodejs\npm.cmd' ...` phía trên, hoặc cài lại Node.js LTS để sửa vĩnh viễn.

## Phạm vi hiện tại

Khung này chỉ xác minh bot, slash command và UI hoạt động. Bước phát triển tiếp theo sẽ là: join voice channel, tìm/lấy audio YouTube, phát stream, queue và các thao tác UI thực tế.
