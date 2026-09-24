# Đóng gói và triển khai Capymuzi

## Kiểm tra Docker trên máy local

Đảm bảo file `.env` đã có đủ ba biến Discord, sau đó chạy:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f capymuzi
```

Khi log hiện `Ready as ...`, bot đã online. Dừng container bằng:

```powershell
docker compose down
```

Không thêm `-v` khi muốn giữ lịch sử. `docker compose down -v` sẽ xóa cả volume SQLite.

## Triển khai trên VPS

Yêu cầu VPS Linux có Docker Engine và Docker Compose plugin.

```bash
git clone https://github.com/Chienhandsome/Capymuzi.git
cd Capymuzi
cp .env.example .env
# Điền DISCORD_CLIENT_ID, DISCORD_GUILD_ID và DISCORD_BOT_TOKEN vào .env
docker compose up --build -d
docker compose logs -f capymuzi
```

Cập nhật phiên bản mới:

```bash
git pull
docker compose up --build -d
```

SQLite nằm trong Docker volume `capymuzi-data` và được giữ lại qua các lần recreate container.

## Triển khai trên Render

File `render.yaml` tạo một Docker Background Worker và disk 1 GB. Trong Render Dashboard:

1. Chọn **New > Blueprint** và kết nối repository `Chienhandsome/Capymuzi`.
2. Xác nhận service `capymuzi`.
3. Điền ba secret Discord khi Render yêu cầu.
4. Deploy và theo dõi log đến khi thấy `Ready as ...`.

Background Worker và persistent disk của Render cần gói trả phí. Không dùng Free Web Service cho bot voice: service có thể sleep và free service không gắn được persistent disk.

## Kiểm tra sức khỏe

Container cung cấp endpoint nội bộ `GET /health` trên cổng `3000`. Docker tự gọi endpoint này mỗi 30 giây. Endpoint không trả token hoặc dữ liệu nhạy cảm.

## Secrets và dữ liệu

- Không commit `.env`.
- Không chia sẻ output của `docker compose config` vì lệnh này có thể hiển thị giá trị secret đã được resolve.
- Nếu token từng bị lộ, reset token trong Discord Developer Portal.
- Backup volume hoặc file `music-bot.sqlite` trước khi chuyển máy.
