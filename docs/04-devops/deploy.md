# Deploy — web lên Vercel, API + AI lên Render

Trạng thái: bản đầu tiên (2026-08-31). Trước file này repo chưa có hướng dẫn
deploy nào, nên mọi thứ ở đây là quyết định mới, không phải ghi lại cái đã có.

## Vì sao chia làm hai chỗ

Web là file tĩnh — Vercel làm việc đó tốt và miễn phí. API thì không:
`VideoService` gọi ffmpeg render video hàng chục giây tới hàng phút, `sharp`
sinh thumbnail, `MediaService` trích ảnh xem trước. Đó là tiến trình chạy dài,
không phải serverless function — Vercel không phải chỗ cho nó. AI là FastAPI
(Python), cũng vậy.

| Thành phần               | Chỗ chạy            | Ghi chú                            |
| ------------------------ | ------------------- | ---------------------------------- |
| `apps/mobile` (Expo web) | Vercel              | tĩnh, `expo export`                |
| `apps/api` (NestJS)      | Render, Node 24     | ffmpeg đi kèm trong `node_modules` |
| `apps/ai` (FastAPI)      | Render, Python 3.12 | chỗ DUY NHẤT gọi OpenAI            |
| Postgres                 | Neon                | đã có sẵn                          |
| Ảnh/video                | Cloudflare R2       | đã có sẵn, bucket **private**      |

`apps/web` (Next.js) vẫn là scaffold rỗng — **không deploy nó**, nó không phải
giao diện của sản phẩm.

## Thứ tự bắt buộc

API trước, web sau. Web cần biết URL API **lúc build** (xem dưới), nên deploy
web trước là phải build lại lần nữa.

### 1. Render — hai service từ `render.yaml`

`render.yaml` ở gốc repo là Render Blueprint. New → Blueprint → chọn repo. Nó
tạo `nha-api` và `nha-ai`; Render hỏi từng biến có `sync: false`.

Xong thì ghi lại hai URL Render cấp (dạng `https://nha-api.onrender.com`).

- `AI_SERVICE_URL` của `nha-api` = URL của `nha-ai`.
- `AI_INTERNAL_TOKEN` (nha-api) và `INTERNAL_TOKEN` (nha-ai) phải **trùng nhau**.
  Đó là thứ duy nhất ngăn người ngoài gọi thẳng endpoint AI và đốt token OpenAI.
- `plan: starter` (512MB) là mức tối thiểu. Render video có thể OOM ở mức này —
  nâng `standard` (2GB) nếu gặp. Gói **free ngủ sau 15 phút** (lần gọi đầu chờ
  ~50s) nên đừng dùng để diễn demo.
- **Bốn biến bắt buộc cho `nha-api` để render video không OOM** (đặt tay
  trong dashboard, sự cố 2026-09-17: mọi job chết ở 3% với "Ran out of
  memory (used over 2GB)" kể cả trên `standard`):

      VIDEO_RENDER_CONCURRENCY=1
      VIDEO_MAX_CONCURRENT_RENDERS=1
      UV_THREADPOOL_SIZE=4
      MALLOC_ARENA_MAX=2

  Lý do: trong container, `os.cpus()` trả số nhân của **máy vật lý** Render
  (hàng chục), không phải 1 CPU của gói, nên mặc định trong code tự bật tới
  5 ffmpeg song song (đo local: ~550MB mỗi ffmpeg ở bước cảnh, 1.2GB ở bước
  ghép) và nới threadpool lên 16. `MALLOC_ARENA_MAX=2` là khuyến nghị của
  `sharp` cho Linux glibc. Với 4 biến này một video 30s mất ~4 phút trên
  `standard`.

  Riêng bước ghép cuối (stage `music`) từng cần **1.8GB cho một ffmpeg** trên
  ffmpeg 7.0.2 Linux, đủ để OOM cả khi chỉ chạy một ffmpeg — một filter graph
  gom cả 8 đoạn giải mã song song từ giây 0 và giữ frame của đoạn chưa tới lượt;
  vặn luồng hay `-itsoffset` chỉ hạ được tới sàn ~1.0GB, vẫn chết trên Render.
  Từ 2026-09-18 engine ghép **hai giai đoạn**: mỗi cảnh và mỗi chuyển cảnh là
  một ffmpeg riêng chạm 1–2 đoạn, rồi nối bằng concat demuxer (video copy) +
  trộn nhạc. Đo trên 7.0.2 Linux: từng lệnh 308–545MB, lệnh nối 29MB — không
  tăng theo số cảnh. x264 4 luồng (`VIDEO_FFMPEG_THREADS`). Không cần biến
  thêm cho việc này.

Kiểm tra: `GET https://<api>/api` phải trả 200, và log khởi động phải có dòng
`Using Cloudflare R2 bucket …` — không có nghĩa là nó đang ghi vào đĩa tạm của
Render và ảnh sẽ mất sau mỗi lần deploy.

### 2. Vercel — project trỏ vào gốc repo

`vercel.json` đã khai sẵn install/build/output. Chỉ cần thêm **một** biến:

```
EXPO_PUBLIC_API_URL=https://<api>.onrender.com/api
```

**Biến này bị nướng vào bundle lúc build.** Đổi nó xong phải Redeploy — F5
không đủ, vì giá trị cũ đã nằm trong file JS.

### 3. Nối hai đầu lại

Sau khi biết tên miền Vercel, đặt trên `nha-api`:

```
CORS_ORIGINS=https://nha.vercel.app
OAUTH_APP_REDIRECTS=https://nha.vercel.app/auth/callback
```

`main.ts` mặc định chỉ cho localhost mọi cổng, nên thiếu `CORS_ORIGINS` là
trình duyệt chặn mọi request và app trông như "server không phản hồi".

## Ba cái bẫy đã tính trước

1. **`packages/tokens/dist` bị gitignore** nhưng `apps/mobile/tailwind.config.js`
   `require('@nha/tokens')` lúc build. Vì thế build command **phải** có
   `pnpm build:tokens` trước `expo export`. Thiếu nó, build sập với
   `Cannot convert undefined or null to object`.
2. **`web.output = "single"`** (app.json) ⇒ `expo export` ra đúng một
   `index.html`. Không có rewrite thì vào thẳng `/ai/gift` là 404. `vercel.json`
   đã rewrite `/(.*)` → `/index.html`.
3. **`sharp`, `argon2`, `@prisma/client` là native.** Phải để host tự
   `pnpm install` trên Linux; đừng upload `node_modules` từ Windows.
4. **Metro cache ăn mất `EXPO_PUBLIC_API_URL`.** Đo được 2026-08-31: export lần
   hai với URL production vẫn ra **đúng hash bundle cũ** và bên trong vẫn là
   `localhost:3000` — biến được babel nhúng lúc transform, mà khoá cache của
   Metro không tính giá trị biến. Vì thế script `export` có sẵn `--clear`.
   Đừng bỏ cờ đó đi: hậu quả là một bản deploy trông thành công nhưng gọi API
   vào localhost của người xem, và không có lỗi build nào chỉ ra điều đó.
5. **`ffmpeg-static` 5.3.0 tải ffmpeg 6.1.1 cho Windows nhưng 7.0.2 cho
   Linux.** Cùng một phiên bản npm, hai binary khác phiên bản lớn — render
   chạy ở máy dev không có nghĩa là chạy trên Render. Đã dính 2026-09-17:
   ffmpeg 7 đòi đầu vào `xfade` có frame rate cố định, đầu ra `concat` thì
   không, nên mọi video có cut/counter-slide đứng trước xfade fail ở bước
   ghép (`Could not open encoder before EOF`). Muốn tái hiện lỗi Linux từ
   Windows: tải `ffmpeg-linux-x64` từ release `b6.1.1` của
   `eugeneware/ffmpeg-static` và chạy qua WSL.
6. **Bản ffmpeg Linux đó KHÔNG có filter `drawtext`** (build thiếu libharfbuzz),
   và Render không có font Nhật. Hậu quả tới 2026-09-18: video production
   không có phụ đề, tiêu đề mở đầu rơi về font hệ thống — trông "chán" so với
   render ở máy dev Windows. Engine giờ đóng gói Noto Sans JP + Noto Sans
   (`apps/api/assets/fonts`, OFL), vẽ chữ bằng libass (`subtitles` +
   `fontsdir`, có ở cả hai bản ffmpeg) thay drawtext, và trỏ sharp/librsvg
   tới cùng bộ font qua `FONTCONFIG_PATH`. Không cài thêm gì trên Render.

## HTTPS

Vercel và Render tự cấp chứng chỉ. Không mua gì. Nhưng API **phải** là HTTPS:
trang HTTPS trên Vercel gọi `http://` sẽ bị trình duyệt chặn thẳng
(mixed content), không cảnh báo.

## Còn thiếu, có chủ đích

- **Đăng ký đang mở.** Ai vào được URL cũng tạo được tài khoản. Ảnh vẫn được
  `canView` chặn theo từng người nên không lộ giữa các nhà, nhưng nếu muốn kín
  thì phải thêm cổng (mã mời bắt buộc / tắt đăng ký) — chưa làm.
- **Đăng nhập Google/Facebook** cần khoá tự tạo ở Google/Meta console. Để trống
  thì nút trả 503; đăng nhập bằng email vẫn chạy.
- **Bytes ảnh vẫn đi qua NestJS** (bucket private, để giữ `canView`) — khoảng
  0.7s mỗi ảnh. Presigned URL hoặc CDN là bước sau.
- **`autoDeploy: false`** trong `render.yaml`: mỗi commit của team không tự đẩy
  lên production. Deploy bằng tay khi đã kiểm.
