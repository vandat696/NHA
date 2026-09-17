#!/usr/bin/env node
// Đẩy thư viện nhạc (library.json + *.m4a) lên R2 dưới prefix `music-library/`.
// VideoService tải prefix này về đĩa tạm khi API khởi động (Render không có
// đĩa bền, và nhạc Amacha không được phép commit vào repo public).
//
//   node apps/api/scripts/upload-music-library.mjs <thư-mục-chứa-library.json>
//
// Đọc R2_* từ apps/api/.env (cùng bucket API đang dùng). Idempotent: ghi đè.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'library.json'))) {
  console.error('Cần thư mục chứa library.json');
  process.exit(1);
}
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } =
  process.env;
if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_BUCKET
) {
  console.error(
    'Thiếu R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET trong .env',
  );
  process.exit(1);
}
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});
const PREFIX = 'music-library/';
const lib = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'));
let bytes = 0;
for (const t of lib.tracks) {
  const p = path.join(dir, t.file);
  const body = fs.readFileSync(p);
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: PREFIX + t.file,
      Body: body,
      ContentType: 'audio/mp4',
    }),
  );
  bytes += body.length;
  console.log('↑', t.file, `${(body.length / 1048576).toFixed(1)}MB`);
}
await s3.send(
  new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: PREFIX + 'library.json',
    Body: fs.readFileSync(path.join(dir, 'library.json')),
    ContentType: 'application/json',
  }),
);
console.log(
  `OK: ${lib.tracks.length} track, ${(bytes / 1048576).toFixed(1)}MB → r2://${R2_BUCKET}/${PREFIX}`,
);
