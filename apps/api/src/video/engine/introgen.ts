// ===== 6 PHONG CÁCH MỞ ĐẦU video kỷ niệm — render 100% LOCAL, 0 token =====
// Cách làm: mỗi frame là 1 SVG do JS tính (vị trí/opacity/góc quay theo easing) → sharp rasterize
// ra PNG → ffmpeg ghép chuỗi PNG thành segment mp4. Không phụ thuộc asset ngoài, chạy offline.
// Màu sắc lấy từ PALETTE do AI thiết kế cho cả video → mở đầu & thân video cùng 1 chủ đề.
//
//   📖 album    — bìa album da mở ra, lộ trang giấy có ảnh dán băng dính
//   🎬 cinema   — nền đen letterbox, tiêu đề hiện dần + giãn chữ, vệt sáng quét ngang
//   📽️ film     — đếm ngược 3-2-1 kiểu phim nhựa cũ, khung rung nhẹ + grain
//   ✉️ letter   — thư tay trên giấy kẻ dòng, chữ hiện từng ký tự + con trỏ nháy
//   🌸 seasonal — cánh hoa/lá rơi theo nhịp sin, tiêu đề lớn hiện dần
//   📸 polaroid — 3 ảnh polaroid rơi xuống nền gỗ, xoay rồi ổn định
//
// Toàn bộ tham số ngẫu nhiên đều DETERMINISTIC (mulberry32 theo index) → cùng input ra cùng
// output → cache segment còn hiệu lực.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { FFMPEG, run } from './exec';
import {
  dims,
  FFMPEG_THREADS,
  FPS,
  segCacheFile,
  tmpDir,
  type SegmentResult,
} from './videogen';
import type { Aspect, IntroTemplateId, Palette } from './types';

// 6 phong cách có hoạt cảnh; 'none' không nằm ở đây vì nó dùng card gradient tĩnh của videogen.
export type IntroTemplate = {
  id: Exclude<IntroTemplateId, 'none'>;
  emoji: string;
  name_vi: string;
  desc_vi: string;
};

export const INTRO_TEMPLATES: IntroTemplate[] = [
  {
    id: 'album',
    emoji: '📖',
    name_vi: 'Mở album cũ',
    desc_vi: 'Bìa album da mở ra, lộ trang giấy có ảnh dán băng dính',
  },
  // (bản NHA bật lại album — design màn 30 liệt kê nó là phong cách chính thức)
  // Ghi chú cũ của demo: 📖 'album' TẠM TẮT theo yêu cầu (Sơn sẽ thiết kế lại) — hoạt cảnh svgAlbum/svgOutroAlbum
  // vẫn còn nguyên bên dưới, chỉ bị comment. Bật lại: bỏ comment dòng này + 2 case trong
  // buildFrameSvg/buildOutroSvg + mục 'album' trong ALBUM_DISABLED và IntroPicker.
  // { id: 'album', emoji: '📖', name_vi: 'Mở album cũ', desc_vi: 'Bìa album da mở ra, lộ trang giấy có ảnh dán băng dính' },
  {
    id: 'cinema',
    emoji: '🎬',
    name_vi: 'Điện ảnh',
    desc_vi: 'Nền đen letterbox, tiêu đề hiện dần, vệt sáng quét ngang',
  },
  {
    id: 'film',
    emoji: '📽️',
    name_vi: 'Phim nhựa cũ',
    desc_vi: 'Đếm ngược 3-2-1, khung rung nhẹ và hạt phim',
  },
  {
    id: 'letter',
    emoji: '✉️',
    name_vi: 'Thư tay',
    desc_vi: 'Giấy kẻ dòng, lời dẫn hiện ra từng ký tự như đang viết',
  },
  {
    id: 'seasonal',
    emoji: '🌸',
    name_vi: 'Cánh hoa rơi',
    desc_vi: 'Cánh hoa bay theo gió, tiêu đề lớn hiện dần',
  },
  {
    id: 'polaroid',
    emoji: '📸',
    name_vi: 'Ảnh polaroid',
    desc_vi: '3 ảnh polaroid lần lượt rơi xuống, xoay rồi ổn định',
  },
];

/** Phong cách đang tạm tắt → pipeline coi như 'none' (card gradient) để record cũ vẫn render được */
export const DISABLED_INTROS: readonly IntroTemplateId[] = [];
export const isIntroEnabled = (v: IntroTemplateId): boolean =>
  v !== 'none' &&
  !DISABLED_INTROS.includes(v) &&
  INTRO_TEMPLATES.some((t) => t.id === v);

// V9: giảm rung film (±0.09%, 15Hz — bản cũ ±0.22% 30Hz rung quá nhiều)
const CACHE_V = 9;
const ENC = [
  '-r',
  String(FPS),
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '20',
  '-pix_fmt',
  'yuv420p',
  '-threads',
  FFMPEG_THREADS,
  '-an',
];
const FONT_STACK = 'Yu Gothic, Meiryo, Segoe UI, sans-serif';

export type IntroCtx = {
  titleJa: string;
  subtitleJa: string;
  openingJa: string;
  palette: Palette;
  photoAbs: string[]; // ≤3 ảnh GỐC (có thể rỗng nếu toàn video clip)
  photoIds: string[]; // để cache
  // --- dùng cho CARD KẾT (renderOutro) — để đầu và cuối cùng một chất liệu, cùng một mạch ---
  closingJa?: string;
  dedicationJa?: string;
  /** 'One More Time · 2026-08-18 · Music: …' */
  creditLine?: string;
};

// ---- easing + ngẫu nhiên deterministic ----
const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeIO = (u: number) => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};
const easeOut = (u: number) => {
  const x = clamp01(u);
  return 1 - (1 - x) * (1 - x);
};
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Trộn màu để tạo biến thể sáng/tối từ palette (nền gỗ, giấy, bìa da…)
function hexMix(hex: string, target: string, u: number): string {
  const p = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
    const v = m ? parseInt(m[1], 16) : 0;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const [r1, g1, b1] = p(hex);
  const [r2, g2, b2] = p(target);
  const c = (a: number, b: number) => Math.round(lerp(a, b, clamp01(u)));
  return `#${[c(r1, r2), c(g1, g2), c(b1, b2)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const lighten = (hex: string, u: number) => hexMix(hex, '#ffffff', u);
const darken = (hex: string, u: number) => hexMix(hex, '#000000', u);

// ---- Wrap chữ trong SVG (CJK cắt theo ký tự, Latin theo từ) ----
const CJK_RE = /[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
const chUnits = (ch: string) => (CJK_RE.test(ch) ? 1 : 0.56);

// Kinsoku: những ký tự KHÔNG được đứng đầu dòng (đã gặp: 「お誕生日おめでとう」 rồi dòng mới chỉ có 「。」)
const NO_LINE_START =
  /[、。，．・：；！？」』）】〉》”’ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮーヽヾ]/;
// …và không được đứng cuối dòng
const NO_LINE_END = /[「『（【〈《“‘]/;

function svgWrap(text: string, maxUnits: number, maxLines = 3): string[] {
  const src = (text ?? '').trim();
  if (!src) return [];
  const lines: string[] = [];
  if (CJK_RE.test(src)) {
    // Khoảng trắng TOÀN GIÁC (U+3000) là điểm ngắt tự nhiên của tiếng Nhật: 「おばあちゃんへ 家族一同より」
    // phải ngắt Ở ĐÓ. Nên tách thành khối trước rồi xếp khối vào dòng (như word-wrap), chỉ cắt theo
    // ký tự khi một khối dài hơn cả dòng — nếu cắt ký tự ngay từ đầu sẽ ra dòng mồ côi 「り」.
    // giữ lại chính khoảng trắng đó khi 2 khối nằm CÙNG dòng (mất U+3000 là mất nhịp câu tiếng Nhật)
    const parts = src.split(/([\u3000 ]+)/);
    const chunks: { sep: string; text: string }[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i])
        chunks.push({ sep: i === 0 ? '' : parts[i - 1], text: parts[i] });
    }
    const width = (s: string) =>
      Array.from(s).reduce((a, ch) => a + chUnits(ch), 0);
    let cur = '';
    let u = 0;
    const flush = () => {
      if (cur) {
        lines.push(cur);
        cur = '';
        u = 0;
      }
    };
    for (const { sep, text } of chunks) {
      const cu = width(text);
      const su = cur ? width(sep) : 0;
      if (cu <= maxUnits) {
        if (cur && u + su + cu > maxUnits) {
          flush();
          cur = text;
          u = cu;
        } else {
          cur += (cur ? sep : '') + text;
          u += su + cu;
        }
        continue;
      }
      // khối dài hơn 1 dòng → cắt theo ký tự
      if (cur) {
        cur += sep;
        u += su;
      }
      for (const ch of Array.from(text)) {
        const w = chUnits(ch);
        if (u + w > maxUnits && cur) flush();
        cur += ch;
        u += w;
      }
    }
    flush();
    // Kinsoku: kéo ký tự cấm-đầu-dòng về cuối dòng trước; đẩy ký tự cấm-cuối-dòng xuống dòng sau
    for (let i = 1; i < lines.length; i++) {
      while (lines[i] && NO_LINE_START.test(lines[i][0])) {
        lines[i - 1] += lines[i][0];
        lines[i] = lines[i].slice(1);
      }
      if (!lines[i]) {
        lines.splice(i, 1);
        i--;
        continue;
      }
      const prev = lines[i - 1];
      if (prev.length > 1 && NO_LINE_END.test(prev[prev.length - 1])) {
        lines[i] = prev[prev.length - 1] + lines[i];
        lines[i - 1] = prev.slice(0, -1);
      }
    }
  } else {
    let cur = '';
    for (const w of src.split(/\s+/)) {
      const next = cur ? cur + ' ' + w : w;
      let nu = 0;
      for (const ch of next) nu += chUnits(ch);
      if (nu > maxUnits && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.length > maxLines
    ? [...lines.slice(0, maxLines - 1), lines[maxLines - 1] + '…']
    : lines;
}

/**
 * Xuống dòng mà KHÔNG cắt chữ: co dần cỡ chữ tới khi vừa maxLines.
 * Lời dẫn giờ dài 70-140 ký tự nên cắt bằng 「…」 là mất nội dung — thà chữ nhỏ hơn.
 */
function fitWrap(
  text: string,
  availPx: number,
  baseSize: number,
  maxLines: number,
): { lines: string[]; size: number } {
  const src = (text ?? '').trim();
  if (!src) return { lines: [], size: baseSize };
  let size = baseSize;
  for (let i = 0; i < 14; i++) {
    const lines = svgWrap(src, (availPx * 0.96) / size, 99);
    if (lines.length <= maxLines) return { lines, size: Math.round(size) };
    // chạm sàn cỡ chữ (chỉ xảy ra với chữ dài bất thường): cắt bằng 「…」 để lỗi HIỆN RÕ,
    // tuyệt đối không lặng lẽ bỏ bớt dòng — mất một câu mà không ai thấy thì tệ hơn nhiều
    if (size <= baseSize * 0.55) break;
    size *= 0.92;
  }
  return {
    lines: svgWrap(src, (availPx * 0.96) / size, maxLines),
    size: Math.round(size),
  };
}

/**
 * Tiêu đề: ưu tiên VỪA 1 DÒNG (co tối đa −28%), chỉ xuống 2 dòng khi thật sự quá dài.
 * Tiêu đề 9 ký tự trước đây bị ép maxUnits=8 nên tách ra 「…の一」/「年」 — một chữ mồ côi.
 */
function fitTitle(
  text: string,
  availPx: number,
  baseSize: number,
): { lines: string[]; size: number } {
  const src = (text ?? '').trim();
  if (!src) return { lines: [], size: baseSize };
  const w = Array.from(src).reduce((a, ch) => a + chUnits(ch), 0);
  const onePx = (availPx * 0.98) / Math.max(1, w);
  if (onePx >= baseSize * 0.72)
    return { lines: [src], size: Math.round(Math.min(baseSize, onePx)) };
  return fitWrap(src, availPx, baseSize, 2);
}

/** Như fitWrap nhưng giới hạn theo CHIỀU CAO khả dụng (px) — dùng khi khối chữ phải nằm trong một dải cố định. */
function fitBox(
  text: string,
  availPx: number,
  availH: number,
  baseSize: number,
  lhRatio = 1.34,
): { lines: string[]; size: number; lh: number } {
  const src = (text ?? '').trim();
  let size = baseSize;
  let lines: string[] = [];
  for (let i = 0; i < 16; i++) {
    lines = svgWrap(src, (availPx * 0.96) / size, 99);
    if (lines.length * size * lhRatio <= availH || size <= baseSize * 0.5)
      break;
    size *= 0.93;
  }
  size = Math.round(size);
  const lh = Math.round(size * lhRatio);
  const fit = Math.max(1, Math.floor(availH / lh));
  // nếu vẫn quá dài (chạm sàn cỡ chữ) thì cắt CÓ DẤU 「…」 — không lặng lẽ bỏ dòng cuối
  const kept =
    lines.length > fit
      ? [...lines.slice(0, fit - 1), lines[fit - 1] + '…']
      : lines;
  return { lines: kept, size, lh };
}

/**
 * Cỡ chữ PHỤ ĐỀ (dòng nhỏ ngay dưới tiêu đề) và LỜI DẪN, tính theo khổ.
 * Khổ DỌC phải lấy tỉ lệ LỚN HƠN nhiều: mọi cỡ chữ ở đây tính theo W, mà ở 9:16 thì W là cạnh
 * NGẮN (1080) nên cùng một tỉ lệ sẽ ra chữ nhỏ hơn hẳn so với 16:9 (W=1920).
 * Đó là lý do 「誕生日に贈る私の毎日」 bị nhỏ: 0.024×1080 = 26px trên khung cao 1920.
 */
const subSize = (W: number, portrait: boolean) =>
  Math.round(W * (portrait ? 0.042 : 0.025));
const narrSize = (W: number, portrait: boolean) =>
  Math.round(W * (portrait ? 0.041 : 0.023));

function textBlock(opts: {
  lines: string[];
  cx: number;
  yStart: number;
  size: number;
  color: string;
  opacity?: number;
  weight?: string;
  spacing?: number;
  anchor?: string;
  shadow?: boolean;
  /** ghi đè khoảng dòng (dùng khi chữ phải nằm đúng lưới dòng kẻ của giấy thư) */
  lh?: number;
}): string {
  const lh = opts.lh ?? Math.round(opts.size * 1.32);
  const anchor = opts.anchor ?? 'middle';
  return opts.lines
    .map((ln, i) => {
      const y = opts.yStart + i * lh;
      // Đã đo: librsvg ĐÃ tính letter-spacing khi canh text-anchor=middle → không bù trừ gì thêm
      // (bù tay sẽ làm chữ lệch sang trái).
      const x = opts.cx;
      const sp = opts.spacing ? ` letter-spacing="${opts.spacing}"` : '';
      const common = `font-family="${FONT_STACK}" font-size="${opts.size}" font-weight="${opts.weight ?? 'bold'}" text-anchor="${anchor}"${sp}`;
      const off = Math.max(2, opts.size * 0.03);
      const sh = opts.shadow
        ? `<text x="${x + off}" y="${y + off}" ${common} fill="#000000" fill-opacity="${(opts.opacity ?? 1) * 0.35}">${esc(ln)}</text>`
        : '';
      return `${sh}<text x="${x}" y="${y}" ${common} fill="${opts.color}" fill-opacity="${opts.opacity ?? 1}">${esc(ln)}</text>`;
    })
    .join('');
}

// Caption của cảnh chiếm dải đáy khung (đáy ở 0.92H, kèm hộp nền) — chữ của mở đầu phải
// DỪNG TRƯỚC dải này, vì 0.6s crossfade chồng 2 segment lên nhau, 2 dòng chữ sẽ đè nhau thành nhoè.
function safeBottomY(H: number, aspect: Aspect): number {
  return Math.round(H * (aspect === 'portrait' ? 0.83 : 0.8));
}

/**
 * Dải LỜI DẪN mở đầu, dùng chung cho film / seasonal / polaroid.
 * (cinema và letter tự vẽ lời dẫn theo chất liệu riêng của chúng.)
 * Lời dẫn giờ dài 2-4 câu nên MỌI phong cách đều phải hiện nó — nếu không, card mở đầu
 * đứng im tới 14s mà chỉ có tiêu đề.
 */
function narrationBlock(
  e: FrameEnv,
  o: {
    k: number;
    topY: number;
    bottomY: number;
    padX: number;
    color: string;
    scrim?: string;
    scrimOpacity?: number;
    shadow?: boolean;
  },
): string {
  const { W, ctx } = e;
  if (o.k <= 0) return '';
  const avail = W - o.padX * 2;
  const boxH = o.bottomY - o.topY;
  const fit = fitBox(
    ctx.openingJa ?? '',
    avail,
    boxH,
    narrSize(W, e.aspect === 'portrait'),
  );
  if (!fit.lines.length) return '';
  const h = fit.lines.length * fit.lh;
  const yStart = o.topY + Math.max(0, (boxH - h) / 2) + fit.size;
  const k = Math.min(1, o.k);
  // nền mờ cho các phong cách có hậu cảnh rối (cánh hoa bay, vân gỗ) để chữ vẫn đọc được
  const sx = Math.round(o.padX - W * 0.03);
  const sy = Math.round(yStart - fit.size * 1.35);
  const sw = Math.round(avail + W * 0.06);
  // +1.15em đáy: chiều cao khối tính theo BASELINE nên phải chừa phần chân chữ (đã thấy dòng
  // cuối 「します。」 nằm sát/ngoài rìa nền mờ ở phong cách 🌸 seasonal)
  const sh = Math.round(h + fit.size * 1.15);
  const scrim = o.scrim
    ? `<rect x="${sx + 5}" y="${sy + 8}" width="${sw}" height="${sh}" rx="${Math.round(W * 0.014)}" fill="#000000" opacity="${(k * 0.22).toFixed(3)}"/>` +
      `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${Math.round(W * 0.014)}" fill="${o.scrim}" opacity="${(k * (o.scrimOpacity ?? 0.4)).toFixed(3)}"/>`
    : '';
  return (
    scrim +
    textBlock({
      lines: fit.lines,
      cx: W / 2,
      yStart,
      size: fit.size,
      color: o.color,
      opacity: k * 0.96,
      weight: 'normal',
      shadow: o.shadow,
    })
  );
}

// ---- Ảnh: resize + base64 MỘT LẦN, nhúng lại vào mỗi frame SVG ----
type PhotoBuf = { uri: string };

async function preparePhotos(
  paths: string[],
  maxEdge: number,
): Promise<PhotoBuf[]> {
  const out: PhotoBuf[] = [];
  for (const p of paths.slice(0, 3)) {
    try {
      const buf = await sharp(p)
        .rotate()
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 78 })
        .toBuffer();
      out.push({ uri: `data:image/jpeg;base64,${buf.toString('base64')}` });
    } catch {
      // ảnh lỗi → bỏ qua, template tự vẽ ô placeholder màu palette
    }
  }
  return out;
}

// Ô ảnh: dùng photo nếu có, không thì ô màu palette (không bao giờ crash khi thiếu ảnh)
function photoRect(opts: {
  photo: PhotoBuf | undefined;
  x: number;
  y: number;
  w: number;
  h: number;
  palette: Palette;
  clipId: string;
}): string {
  const { x, y, w, h, clipId } = opts;
  if (!opts.photo) {
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${darken(opts.palette.secondary, 0.25)}"/>` +
      `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) * 0.16}" fill="none" stroke="${opts.palette.accent}" stroke-opacity="0.45" stroke-width="${Math.max(2, w * 0.008)}"/>`
    );
  }
  return (
    `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>` +
    `<image href="${opts.photo.uri}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
  );
}

// durS: thời lượng THẬT của segment (5-14s, giãn theo độ dài lời dẫn). Template cần nó để
// quy đổi mốc theo GIÂY — ví dụ đếm ngược 3-2-1 của film phải luôn ~3.6s, không được
// chiếm 56% timeline (14s × 0.56 = 7.8s đếm ngược thì quá chậm).
type FrameEnv = {
  W: number;
  H: number;
  ctx: IntroCtx;
  photos: PhotoBuf[];
  aspect: Aspect;
  durS: number;
};
/** đổi mốc giây → tỉ lệ t (0..1) của segment */
const at = (e: FrameEnv, sec: number) => clamp01(sec / Math.max(0.1, e.durS));

// ============================ 📖 ALBUM ============================
// BẬT LẠI trong bản NHA: design màn 30 (11o) liệt kê "Album — A leather album opens on the
// first page" là 1 trong 6 phong cách chính thức.
function svgAlbum(t: number, e: FrameEnv): string {
  const { W, H, ctx, photos } = e;
  const pal = ctx.palette;
  const bookW = Math.round(W * (e.aspect === 'portrait' ? 0.82 : 0.62));
  const bookH = Math.round(H * (e.aspect === 'portrait' ? 0.52 : 0.72));
  const bx = Math.round((W - bookW) / 2);
  const by = Math.round((H - bookH) / 2 - H * 0.02);
  const open = easeIO((t - 0.12) / 0.32); // 0 = bìa đóng, 1 = mở hết
  const paper = lighten(pal.secondary, 0.86);

  // Trang giấy + 2 ảnh dán băng dính
  const pad = Math.round(bookW * 0.055);
  const inW = bookW - pad * 2;
  const inH = bookH - pad * 2;
  const twoCols = e.aspect !== 'portrait';
  const pw = twoCols ? Math.round((inW - pad) / 2) : inW;
  const ph = twoCols ? Math.round(inH * 0.74) : Math.round((inH - pad) / 2);
  const allSlots = twoCols
    ? [
        { x: bx + pad, y: by + pad + Math.round(inH * 0.06), rot: -2.5 },
        { x: bx + pad * 2 + pw, y: by + pad + Math.round(inH * 0.1), rot: 2.2 },
      ]
    : [
        { x: bx + pad, y: by + pad, rot: -2 },
        { x: bx + pad, y: by + pad * 2 + ph, rot: 1.8 },
      ];
  // Ít ảnh hơn số ô → chỉ vẽ số ô có ảnh (không hiện ô rỗng); không có ảnh nào → 1 ô placeholder
  const slots = allSlots.slice(
    0,
    Math.max(1, Math.min(allSlots.length, photos.length || 1)),
  );

  const photoLayer = slots
    .map((s, i) => {
      // Ảnh bắt đầu hiện NGAY khi bìa đang lật (0.36) → không có khoảng trang trắng trống trơn
      const k = easeOut((t - 0.36 - i * 0.13) / 0.24);
      if (k <= 0) return '';
      const dy = (1 - k) * H * 0.05;
      const tapeW = Math.round(pw * 0.26);
      return (
        `<g opacity="${k.toFixed(3)}" transform="translate(${s.x}, ${(s.y + dy).toFixed(1)}) rotate(${s.rot}, ${pw / 2}, ${ph / 2})">` +
        `<rect x="-6" y="-6" width="${pw + 12}" height="${ph + 12}" fill="#ffffff" opacity="0.96"/>` +
        photoRect({
          photo: photos[i],
          x: 0,
          y: 0,
          w: pw,
          h: ph,
          palette: pal,
          clipId: `ap${i}`,
        }) +
        `<rect x="${(pw - tapeW) / 2}" y="-18" width="${tapeW}" height="26" fill="${pal.accent}" opacity="0.42" transform="rotate(-3, ${pw / 2}, 0)"/>` +
        `</g>`
      );
    })
    .join('');

  // Bìa da: cụp lại quanh gáy sách bên trái (scaleX 1 → 0)
  const coverK = 1 - open;
  const titleLines = svgWrap(ctx.titleJa, e.aspect === 'portrait' ? 9 : 12, 2);
  const tSize = Math.round(bookW * 0.085);
  const cover =
    coverK > 0.01
      ? `<g transform="translate(${bx}, 0) scale(${coverK.toFixed(4)}, 1)">` +
        `<rect x="0" y="${by}" width="${bookW}" height="${bookH}" rx="${Math.round(bookW * 0.012)}" fill="${darken(pal.primary, 0.25)}"/>` +
        `<rect x="${Math.round(bookW * 0.035)}" y="${by + Math.round(bookH * 0.035)}" width="${bookW - Math.round(bookW * 0.07)}" height="${bookH - Math.round(bookH * 0.07)}" rx="${Math.round(bookW * 0.008)}" fill="none" stroke="${pal.accent}" stroke-opacity="0.75" stroke-width="${Math.max(2, bookW * 0.0045)}"/>` +
        `<rect x="${Math.round(bookW * 0.055)}" y="${by + Math.round(bookH * 0.055)}" width="${bookW - Math.round(bookW * 0.11)}" height="${bookH - Math.round(bookH * 0.11)}" rx="${Math.round(bookW * 0.006)}" fill="none" stroke="${pal.accent}" stroke-opacity="0.35" stroke-width="${Math.max(1, bookW * 0.002)}"/>` +
        textBlock({
          lines: titleLines,
          cx: bookW / 2,
          yStart: by + bookH / 2,
          size: tSize,
          color: pal.accent,
          opacity: Math.min(1, coverK * 1.6),
          shadow: true,
        }) +
        `</g>`
      : '';

  const subK = easeIO((t - 0.74) / 0.22);
  const subY = Math.min(
    by + bookH + Math.round(H * 0.055),
    safeBottomY(H, e.aspect),
  );
  // Bị kéo lên trong dải an toàn thì phụ đề rơi LÊN TRANG GIẤY sáng → phải đổi sang mực tối mới đọc được
  const subOnPage = subY < by + bookH;
  const sub =
    subK > 0
      ? textBlock({
          lines: svgWrap(ctx.subtitleJa, 20, 1),
          cx: W / 2,
          yStart: subY,
          size: Math.round(W * 0.024),
          color: subOnPage ? darken(pal.primary, 0.05) : pal.text_on_dark,
          opacity: subK,
          weight: 'normal',
        })
      : '';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <defs><radialGradient id="vg" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0" stop-color="${lighten(pal.primary, 0.12)}"/><stop offset="1" stop-color="${darken(pal.primary, 0.55)}"/>
    </radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#vg)"/>
    <rect x="${bx}" y="${by}" width="${bookW}" height="${bookH}" rx="${Math.round(bookW * 0.01)}" fill="${paper}"/>
    <rect x="${bx}" y="${by}" width="${Math.round(bookW * 0.02)}" height="${bookH}" fill="${darken(paper, 0.18)}"/>
    ${photoLayer}${cover}${sub}
  </svg>`;
}

// ============================ 🎬 CINEMA ============================
function svgCinema(t: number, e: FrameEnv): string {
  const { W, H, ctx } = e;
  const pal = ctx.palette;
  const bar = Math.round(H * 0.13);
  // Mốc theo GIÂY: lời dẫn (2-4 câu) phải hiện xong sớm để còn thời gian đọc.
  const k = (sec: number, dur: number) =>
    easeIO((t - at(e, sec)) / Math.max(0.02, at(e, dur)));
  const tk = k(0.5, 1.2);
  const subK = k(1.9, 0.9);
  // vệt sáng quét ngang
  const sw = k(1, 1.8);
  const sweepX = lerp(-W * 0.6, W * 1.1, sw);
  const sweepOp =
    Math.sin(clamp01((t - at(e, 1)) / Math.max(0.02, at(e, 1.8))) * Math.PI) *
    0.14;

  // Lời dẫn mở đầu (2-4 câu) — trước đây cinema chỉ hiện tiêu đề, phần kể chuyện bị mất.
  const portrait = e.aspect === 'portrait';
  const padX = Math.round(W * (portrait ? 0.1 : 0.16));
  const open = fitWrap(
    ctx.openingJa ?? '',
    W - padX * 2,
    narrSize(W, portrait),
    portrait ? 7 : 4,
  );
  const openK = k(2.8, 1.2);

  // Tiêu đề: co chữ cho vừa 1 dòng thay vì ép theo số ký tự (tiêu đề 9 chữ từng bị tách
  // thành 「おばあちゃんの一」 / 「年」 — một chữ mồ côi ở dòng 2).
  const tFit = fitTitle(
    ctx.titleJa,
    W - padX * 2,
    Math.round(W * (portrait ? 0.088 : 0.062)),
  );
  const titleLines = tFit.lines;
  const tSize = tFit.size;
  const spacing = lerp(tSize * 0.34, tSize * 0.05, k(0.5, 2.2)); // giãn chữ thu dần
  // phụ đề cũng tự co (trước đây ép maxUnits=22 nên phụ đề dài bị cắt 「…」)
  const sFit = fitTitle(ctx.subtitleJa, W - padX * 2, subSize(W, portrait));

  // Xếp khối từ trên xuống rồi căn giữa vùng an toàn (trên dải caption ở đáy)
  const titleH = titleLines.length * Math.round(tSize * 1.32);
  const subH = sFit.lines.length * Math.round(sFit.size * 1.32);
  const openH = open.lines.length * Math.round(open.size * 1.32);
  const blockH =
    titleH + Math.round(H * 0.03) + subH + Math.round(H * 0.045) + openH;
  // căn giữa vùng GIỮA HAI THANH letterbox (0.13H..0.87H), không phải giữa cả khung —
  // nếu không, khối chữ nằm cao và nửa dưới trống trơn
  const titleY = Math.round((bar + (H - bar)) / 2 - blockH / 2) + tSize;
  const subY = titleY + titleH + Math.round(H * 0.03);
  const openY = subY + subH + Math.round(H * 0.045);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${darken(pal.primary, 0.82)}"/>
    <g opacity="${Math.max(0, sweepOp).toFixed(3)}">
      <rect x="${sweepX.toFixed(0)}" y="${-H * 0.2}" width="${Math.round(W * 0.16)}" height="${H * 1.4}" fill="${pal.accent}" transform="rotate(14, ${W / 2}, ${H / 2})"/>
    </g>
    ${textBlock({ lines: titleLines, cx: W / 2, yStart: titleY, size: tSize, color: pal.text_on_dark, opacity: tk, spacing: Number(spacing.toFixed(1)) })}
    ${subK > 0 ? textBlock({ lines: sFit.lines, cx: W / 2, yStart: subY, size: sFit.size, color: pal.accent, opacity: subK, weight: 'normal', spacing: Math.round(W * 0.004) }) : ''}
    ${openK > 0 ? textBlock({ lines: open.lines, cx: W / 2, yStart: openY, size: open.size, color: lighten(pal.text_on_dark, 0.02), opacity: openK * 0.92, weight: 'normal' }) : ''}
    <rect x="0" y="0" width="${W}" height="${bar}" fill="#000000"/>
    <rect x="0" y="${H - bar}" width="${W}" height="${bar}" fill="#000000"/>
  </svg>`;
}

// ============================ 📽️ FILM ============================
function svgFilm(t: number, e: FrameEnv, frameIdx: number): string {
  const { W, H, ctx } = e;
  const pal = ctx.palette;
  const paper = hexMix(lighten(pal.secondary, 0.72), '#d8c9a3', 0.55);
  // Rung khung "gate weave": biên độ ±0.09% (Sơn chê bản ±0.22% rung quá nhiều) và giữ mỗi
  // vị trí trong 2 frame (15Hz thay vì 30Hz) — phim nhựa thật trôi chậm, không giật từng frame.
  const rnd = mulberry32(Math.floor(frameIdx / 2) * 2654435761);
  const jx = (rnd() * 2 - 1) * W * 0.0009;
  const jy = (rnd() * 2 - 1) * H * 0.0009;
  const cx = W / 2;
  const cy = H * 0.46;
  const R = Math.round(Math.min(W, H) * 0.19);

  // Đếm ngược cố định ~3.6s (1.2s/số) bất kể segment dài 5s hay 14s
  const cdEnd = Math.min(0.6, at(e, 3.6));
  let core = '';
  if (t < cdEnd) {
    const slot = cdEnd / 3;
    const idx = Math.min(2, Math.floor(t / slot));
    const local = (t - idx * slot) / slot;
    const num = 3 - idx;
    const arcLen = 2 * Math.PI * R;
    core =
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${darken(pal.primary, 0.3)}" stroke-opacity="0.35" stroke-width="${Math.max(3, R * 0.045)}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${pal.primary}" stroke-width="${Math.max(3, R * 0.05)}" stroke-linecap="round"
        stroke-dasharray="${arcLen.toFixed(1)}" stroke-dashoffset="${(arcLen * (1 - local)).toFixed(1)}" transform="rotate(-90, ${cx}, ${cy})"/>` +
      `<line x1="${cx - R * 1.35}" y1="${cy}" x2="${cx + R * 1.35}" y2="${cy}" stroke="${darken(pal.primary, 0.2)}" stroke-opacity="0.28" stroke-width="2"/>` +
      `<line x1="${cx}" y1="${cy - R * 1.35}" x2="${cx}" y2="${cy + R * 1.35}" stroke="${darken(pal.primary, 0.2)}" stroke-opacity="0.28" stroke-width="2"/>` +
      `<text x="${cx}" y="${cy + R * 0.42}" font-family="${FONT_STACK}" font-size="${Math.round(R * 1.25)}" font-weight="bold" fill="${darken(pal.primary, 0.15)}" text-anchor="middle">${num}</text>`;
  } else {
    // các mốc tính theo giây SAU khi đếm ngược xong → nhịp không đổi khi segment dài ra
    const after = (sec: number, dur: number) =>
      easeIO((t - cdEnd - at(e, sec)) / Math.max(0.02, at(e, dur)));
    const k = after(0.15, 0.6);
    core =
      textBlock({
        lines: ['♦ presents ♦'],
        cx,
        yStart: Math.round(H * 0.24),
        size: Math.round(W * 0.02),
        color: darken(pal.primary, 0.1),
        opacity: k * 0.8,
        weight: 'normal',
        spacing: Math.round(W * 0.006),
      }) +
      ((tf) =>
        textBlock({
          lines: tf.lines,
          cx,
          yStart: Math.round(H * 0.36),
          size: tf.size,
          color: darken(pal.primary, 0.05),
          opacity: k,
        }))(
        fitTitle(
          ctx.titleJa,
          W - Math.round(W * 0.11) * 2,
          Math.round(W * (e.aspect === 'portrait' ? 0.082 : 0.06)),
        ),
      ) +
      ((sf) =>
        textBlock({
          lines: sf.lines,
          cx,
          yStart: Math.round(H * 0.46),
          size: sf.size,
          color: hexMix(pal.primary, '#7a6a4a', 0.6),
          opacity: after(0.9, 0.6),
          weight: 'normal',
        }))(
        fitTitle(
          ctx.subtitleJa,
          W - Math.round(W * 0.11) * 2,
          subSize(W, e.aspect === 'portrait'),
        ),
      ) +
      narrationBlock(e, {
        k: after(1.5, 0.8),
        topY: Math.round(H * 0.52),
        bottomY: safeBottomY(H, e.aspect),
        padX: Math.round(W * 0.11),
        color: darken(pal.primary, 0.02),
      });
  }

  // lỗ răng phim 2 bên
  const holes: string[] = [];
  const hw = Math.round(W * 0.022);
  const hh = Math.round(H * 0.045);
  const step = Math.round(H * 0.1);
  for (let y = Math.round(step * 0.4); y < H; y += step) {
    holes.push(
      `<rect x="${Math.round(W * 0.014)}" y="${y}" width="${hw}" height="${hh}" rx="${Math.round(hw * 0.22)}" fill="${darken(pal.primary, 0.6)}" opacity="0.5"/>`,
    );
    holes.push(
      `<rect x="${W - Math.round(W * 0.014) - hw}" y="${y}" width="${hw}" height="${hh}" rx="${Math.round(hw * 0.22)}" fill="${darken(pal.primary, 0.6)}" opacity="0.5"/>`,
    );
  }

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${paper}"/>
    <g transform="translate(${jx.toFixed(2)}, ${jy.toFixed(2)})">
      ${holes.join('')}
      ${core}
    </g>
    <rect width="${W}" height="${H}" fill="none" stroke="${darken(pal.primary, 0.55)}" stroke-opacity="0.25" stroke-width="${Math.round(W * 0.012)}"/>
  </svg>`;
}

// ============================ ✉️ LETTER ============================
function svgLetter(t: number, e: FrameEnv, frameIdx: number): string {
  const { W, H, ctx } = e;
  const pal = ctx.palette;
  const paper = hexMix(lighten(pal.secondary, 0.82), '#fdf6e3', 0.6);
  const px = Math.round(W * 0.11);
  const py = Math.round(H * 0.12);
  const pw = W - px * 2;
  const ph = H - py * 2;
  const full = ctx.openingJa || ctx.titleJa;

  // Lời dẫn dài 70-140 ký tự: co chữ cho vừa CẢ chiều ngang và khoảng trống trên chữ ký,
  // thay vì cắt bằng 「…」 (cắt là mất nội dung câu chuyện).
  const baseSize = Math.round(W * (e.aspect === 'portrait' ? 0.055 : 0.038));
  const textTop = py + Math.round(H * 0.1);
  const sigY = py + Math.round(ph * 0.86);
  const availV = sigY - textTop - Math.round(H * 0.055);
  let size = baseSize;
  let lines: string[] = [];
  for (let i = 0; i < 16; i++) {
    lines = svgWrap(full, (pw * 0.86) / size, 99);
    if ((lines.length - 1) * (size * 1.9) <= availV || size <= baseSize * 0.5)
      break;
    size *= 0.93;
  }
  size = Math.round(size);
  const lineH = Math.round(size * 1.9);
  lines = lines.slice(0, Math.max(1, Math.floor(availV / lineH) + 1));
  const totalChars = lines.reduce((s, l) => s + Array.from(l).length, 0) || 1;
  const shown = Math.floor(totalChars * clamp01(t / 0.7));

  // Kẻ dòng giấy
  const rules: string[] = [];
  for (let i = 0; i < Math.floor((ph - Math.round(H * 0.1)) / lineH); i++) {
    const y = textTop + i * lineH + Math.round(size * 0.35);
    rules.push(
      `<line x1="${px + Math.round(pw * 0.06)}" y1="${y}" x2="${px + pw - Math.round(pw * 0.06)}" y2="${y}" stroke="${hexMix(pal.primary, paper, 0.72)}" stroke-width="1.5"/>`,
    );
  }

  // Chữ hiện dần + con trỏ nháy ở cuối chuỗi đang gõ
  let used = 0;
  let caret: { x: number; y: number } | null = null;
  const textLines: string[] = [];
  lines.forEach((ln, i) => {
    const arr = Array.from(ln);
    const take = Math.max(0, Math.min(arr.length, shown - used));
    used += arr.length;
    const partial = arr.slice(0, take).join('');
    const y = textTop + i * lineH;
    if (partial) {
      textLines.push(
        `<text x="${px + Math.round(pw * 0.07)}" y="${y}" font-family="${FONT_STACK}" font-size="${size}" fill="${darken(pal.primary, 0.1)}" text-anchor="start">${esc(partial)}</text>`,
      );
    }
    if (take > 0 && take < arr.length && !caret) {
      let u = 0;
      for (const ch of partial) u += chUnits(ch);
      caret = { x: px + Math.round(pw * 0.07) + u * size, y };
    }
  });

  const blink = Math.floor(frameIdx / 9) % 2 === 0 && shown < totalChars;
  const caretSvg =
    caret && blink
      ? `<rect x="${(caret as { x: number; y: number }).x + 4}" y="${(caret as { x: number; y: number }).y - size * 0.82}" width="${Math.max(2, size * 0.06)}" height="${size}" fill="${darken(pal.primary, 0.1)}" opacity="0.8"/>`
      : '';

  const sigK = easeIO((t - 0.78) / 0.2);
  const sig =
    sigK > 0
      ? `<g opacity="${sigK.toFixed(3)}" transform="rotate(-2.5, ${px + pw * 0.7}, ${py + ph * 0.86})">` +
        // chữ ký giữ cỡ gốc (baseSize) — không co theo thân chữ, để luôn đọc rõ
        textBlock({
          lines: svgWrap(ctx.titleJa, 16, 1),
          cx: px + pw * 0.72,
          yStart: py + ph * 0.86,
          size: Math.round(baseSize * 1.05),
          color: darken(pal.accent, 0.35),
          opacity: sigK,
          anchor: 'middle',
        }) +
        `<line x1="${px + pw * 0.5}" y1="${py + ph * 0.9}" x2="${px + pw * 0.92}" y2="${py + ph * 0.9}" stroke="${darken(pal.accent, 0.35)}" stroke-opacity="${(sigK * 0.6).toFixed(2)}" stroke-width="2"/></g>`
      : '';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${darken(pal.primary, 0.45)}"/>
    <rect x="${px + 8}" y="${py + 10}" width="${pw}" height="${ph}" fill="#000000" opacity="0.28"/>
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${paper}"/>
    <rect x="${px}" y="${py}" width="${pw}" height="${Math.round(H * 0.012)}" fill="${pal.accent}" opacity="0.5"/>
    ${rules.join('')}${textLines.join('')}${caretSvg}${sig}
  </svg>`;
}

// ============================ 🌸 SEASONAL ============================
function svgSeasonal(t: number, e: FrameEnv): string {
  const { W, H, ctx } = e;
  const pal = ctx.palette;
  const N = 14;
  const sprites: string[] = [];
  for (let i = 0; i < N; i++) {
    const rnd = mulberry32(i * 97 + 13);
    const x0 = rnd() * W;
    const y0 = rnd() * (H + 160) - 80;
    const amp = W * (0.02 + rnd() * 0.05);
    const speed = H * (0.5 + rnd() * 0.85);
    const phase = rnd();
    const spin = 0.5 + rnd() * 2;
    const size = W * (0.008 + rnd() * 0.013);
    const x =
      x0 + amp * Math.sin(2 * Math.PI * (t * (0.6 + rnd() * 0.8) + phase));
    const y = ((((y0 + t * speed) % (H + 160)) + H + 160) % (H + 160)) - 80;
    const col =
      i % 3 === 0
        ? lighten(pal.accent, 0.25)
        : i % 3 === 1
          ? lighten(pal.secondary, 0.5)
          : '#ffffff';
    sprites.push(
      `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${size.toFixed(1)}" ry="${(size * 1.7).toFixed(1)}" fill="${col}" opacity="${(0.35 + (i % 5) * 0.12).toFixed(2)}" transform="rotate(${(t * 360 * spin).toFixed(1)}, ${x.toFixed(1)}, ${y.toFixed(1)})"/>`,
    );
  }
  const tk = easeIO((t - at(e, 0.6)) / Math.max(0.05, at(e, 1.4)));
  const scale = lerp(0.955, 1, tk);
  const padX = Math.round(W * 0.1);
  const tFit = fitTitle(
    ctx.titleJa,
    W - padX * 2,
    Math.round(W * (e.aspect === 'portrait' ? 0.095 : 0.068)),
  );
  const tSize = tFit.size;
  const subK = easeIO((t - at(e, 1.8)) / Math.max(0.05, at(e, 1)));
  const sFit = fitTitle(
    ctx.subtitleJa,
    W - padX * 2,
    subSize(W, e.aspect === 'portrait'),
  );
  const titleY = Math.round(H * (e.aspect === 'portrait' ? 0.3 : 0.34));
  const subY =
    titleY +
    tFit.lines.length * Math.round(tSize * 1.32) +
    Math.round(H * 0.02);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stop-color="${lighten(pal.secondary, 0.35)}"/><stop offset="1" stop-color="${pal.primary}"/>
      </linearGradient>
      <radialGradient id="halo" cx="0.5" cy="0.44" r="0.55">
        <stop offset="0" stop-color="${pal.accent}" stop-opacity="0.3"/><stop offset="1" stop-color="${pal.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <rect width="${W}" height="${H}" fill="url(#halo)"/>
    ${sprites.join('')}
    <g transform="translate(${(W / 2).toFixed(1)}, ${titleY.toFixed(1)}) scale(${scale.toFixed(4)}) translate(${(-W / 2).toFixed(1)}, ${(-titleY).toFixed(1)})">
      ${textBlock({ lines: tFit.lines, cx: W / 2, yStart: titleY, size: tSize, color: pal.text_on_dark, opacity: tk, shadow: true })}
    </g>
    ${subK > 0 ? textBlock({ lines: sFit.lines, cx: W / 2, yStart: subY, size: sFit.size, color: lighten(pal.accent, 0.15), opacity: subK, weight: 'normal' }) : ''}
    ${narrationBlock(e, {
      k: easeIO((t - at(e, 2.8)) / Math.max(0.05, at(e, 1.2))),
      topY:
        subY +
        sFit.lines.length * Math.round(sFit.size * 1.32) +
        Math.round(H * 0.03),
      bottomY: safeBottomY(H, e.aspect),
      padX,
      color: pal.text_on_dark,
      scrim: darken(pal.primary, 0.6),
      shadow: true,
    })}
  </svg>`;
}

// ============================ 📸 POLAROID ============================

/**
 * Mặt bàn gỗ — dùng CHUNG cho card mở đầu và card kết của 📸 polaroid.
 * Vân gỗ: dải RẤT nhạt bề rộng ngẫu nhiên + sợi vân dọc — tránh trông như mã vạch.
 * (Trước đây card kết tự trộn màu riêng và thiếu sợi vân → hai card như hai cái bàn khác nhau.)
 */
function woodDesk(
  W: number,
  H: number,
  pal: Palette,
): { wood: string; grain: string[] } {
  const wood = hexMix(darken(pal.primary, 0.35), '#5b3a22', 0.45);
  const grain: string[] = [];
  let gy = 0;
  for (let i = 0; gy < H; i++) {
    const rnd = mulberry32(i * 7919 + 17);
    const h = Math.round(H * (0.03 + rnd() * 0.05));
    grain.push(
      `<rect x="0" y="${gy}" width="${W}" height="${h}" fill="${i % 2 === 0 ? lighten(wood, 0.02 + rnd() * 0.02) : darken(wood, 0.02 + rnd() * 0.025)}"/>`,
    );
    grain.push(
      `<rect x="0" y="${gy + Math.round(h * (0.3 + rnd() * 0.4))}" width="${W}" height="${Math.max(1, Math.round(H * 0.0016))}" fill="${darken(wood, 0.16)}" opacity="0.35"/>`,
    );
    gy += h;
  }
  for (let k = 0; k < 5; k++) {
    const rnd = mulberry32(k * 104729 + 5);
    const x = Math.round(rnd() * W);
    grain.push(
      `<ellipse cx="${x}" cy="${Math.round(rnd() * H)}" rx="${Math.round(W * 0.004)}" ry="${Math.round(H * (0.06 + rnd() * 0.1))}" fill="${darken(wood, 0.2)}" opacity="0.22"/>`,
    );
  }
  return { wood, grain };
}

function svgPolaroid(t: number, e: FrameEnv): string {
  const { W, H, ctx, photos } = e;
  const pal = ctx.palette;
  const { wood, grain } = woodDesk(W, H, pal);

  const portrait = e.aspect === 'portrait';
  // Ảnh nhỏ hơn + dồn lên trên so với trước, để chừa dải LỜI DẪN ở dưới (lời dẫn giờ 2-4 câu)
  const pw = Math.round(W * (portrait ? 0.46 : 0.21));
  const frameH = Math.round(pw * 1.2);
  const imgH = Math.round(pw * 0.92);
  const allSlots = portrait
    ? [
        { x: Math.round(W * 0.09), y: Math.round(H * 0.035), rot: -6 },
        { x: Math.round(W * 0.34), y: Math.round(H * 0.15), rot: 4.5 },
        { x: Math.round(W * 0.16), y: Math.round(H * 0.265), rot: -2.5 },
      ]
    : [
        { x: Math.round(W * 0.14), y: Math.round(H * 0.07), rot: -7 },
        { x: Math.round(W * 0.39), y: Math.round(H * 0.04), rot: 3 },
        { x: Math.round(W * 0.64), y: Math.round(H * 0.085), rot: -3.5 },
      ];
  // Ít ảnh hơn 3 → chỉ rơi đúng số ảnh có (khỏi lộ ô placeholder), căn lại cho cân khung
  const nCards = Math.max(1, Math.min(3, photos.length || 1));
  const slots = allSlots.slice(0, nCards).map((s) => ({
    ...s,
    x: nCards < 3 ? s.x + Math.round(W * 0.075 * (3 - nCards)) : s.x,
  }));

  const cards = slots
    .map((s, i) => {
      // rơi theo GIÂY: mỗi ảnh cách nhau 0.55s, rơi trong 0.85s — không giãn ra khi segment dài
      const k = easeOut(
        (t - at(e, 0.35 + i * 0.55)) / Math.max(0.03, at(e, 0.85)),
      );
      if (k <= 0) return '';
      const kk = Math.min(1, k);
      const y =
        lerp(-frameH * 1.2, s.y, kk) +
        Math.sin(kk * Math.PI) * H * 0.012 * (1 - kk);
      const rot = lerp(s.rot * 2.6, s.rot, kk);
      const pad = Math.round(pw * 0.055);
      return (
        `<g transform="translate(${s.x}, ${y.toFixed(1)}) rotate(${rot.toFixed(2)}, ${pw / 2}, ${frameH / 2})" opacity="${Math.min(1, kk * 1.4).toFixed(3)}">` +
        `<rect x="6" y="10" width="${pw}" height="${frameH}" fill="#000000" opacity="0.32"/>` +
        `<rect x="0" y="0" width="${pw}" height="${frameH}" fill="#fbfaf6"/>` +
        photoRect({
          photo: photos[i],
          x: pad,
          y: pad,
          w: pw - pad * 2,
          h: imgH,
          palette: pal,
          clipId: `pp${i}`,
        }) +
        `</g>`
      );
    })
    .join('');

  const tk = easeIO(
    (t - at(e, 0.35 + nCards * 0.55)) / Math.max(0.03, at(e, 0.8)),
  );
  const tapeW = Math.round(W * (portrait ? 0.7 : 0.4));
  const tapeH = Math.round(H * (portrait ? 0.07 : 0.08));
  const tapeX = Math.round((W - tapeW) / 2);
  // Nhãn băng dính nằm giữa ảnh và dải lời dẫn (dải lời dẫn lại nằm trên dải caption của cảnh —
  // crossfade 0.6s chồng 2 segment nên 2 lớp chữ tuyệt đối không được trùng vùng)
  // Dồn ảnh + nhãn lên trên để tờ giấy ghi lời dẫn có thêm ~30px chiều cao — tờ giấy là chỗ
  // BỊ GIỚI HẠN nhất, nếu chật thì chữ tự co lại nhỏ dù cỡ gốc đã tăng.
  const tapeY = Math.round(H * (portrait ? 0.585 : 0.545));
  const title =
    tk > 0
      ? `<g opacity="${tk.toFixed(3)}" transform="rotate(-1.5, ${W / 2}, ${tapeY + tapeH / 2})">` +
        `<rect x="${tapeX}" y="${tapeY}" width="${tapeW}" height="${tapeH}" fill="${lighten(pal.accent, 0.55)}" opacity="0.92"/>` +
        textBlock({
          lines: svgWrap(ctx.titleJa, portrait ? 11 : 15, 1),
          cx: W / 2,
          yStart: tapeY + Math.round(tapeH * 0.68),
          size: Math.round(tapeH * 0.5),
          color: darken(pal.primary, 0.25),
          opacity: tk,
        }) +
        `</g>`
      : '';

  // Lời dẫn viết trên một tờ giấy nhớ kem đặt trên bàn gỗ — cùng chất liệu với viền polaroid
  const narr = narrationBlock(e, {
    k: easeIO((t - at(e, 1.1 + nCards * 0.55)) / Math.max(0.03, at(e, 1))),
    topY: tapeY + tapeH + Math.round(H * 0.025),
    bottomY: safeBottomY(H, e.aspect),
    padX: Math.round(W * (portrait ? 0.085 : 0.145)),
    color: darken(pal.primary, 0.3),
    scrim: '#fbfaf6',
    scrimOpacity: 0.95,
  });

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${wood}"/>
    ${grain.join('')}
    <rect width="${W}" height="${H}" fill="#000000" opacity="0.12"/>
    ${cards}${narr}${title}
  </svg>`;
}

// ============================ CARD KẾT ============================
// Mở đầu và kết PHẢI cùng một chất liệu, nếu không video bị "hai nửa rời nhau" (lỗi đã gặp:
// mở đầu là album giấy nhưng kết lại là card gradient trơn). Nên mỗi phong cách có card kết
// dùng lại đúng nền/đạo cụ của nó, chỉ đổi nội dung sang: câu kết → vạch → lời đề tặng → ghi công.

type OutroSkin = {
  /** nền + đạo cụ (đã bao trọn khung) */
  bg: string;
  ink: string; // màu chữ câu kết
  inkStrong: string; // màu lời đề tặng
  accent: string;
  /** vùng an toàn cho chữ (tránh răng phim / thanh letterbox) */
  padX: number;
  /** lớp phủ trên cùng (letterbox…) */
  fg?: string;
  shadow?: boolean;
  /**
   * Nền có LƯỚI DÒNG KẺ (giấy thư): chữ phải nằm ĐÚNG trên dòng, y hệt card mở đầu.
   * Không có cái này thì chữ card kết trôi lơ lửng giữa 2 dòng kẻ — trông như dán vào,
   * đúng cái cảm giác "đầu và cuối không cùng một thứ" mà thiết kế này muốn tránh.
   */
  ruleGrid?: { top: number; pitch: number };
  /**
   * Màu dòng ghi công. Mặc định dùng `ink`, nhưng ở 📸 polaroid dòng này rơi RA NGOÀI tấm ảnh
   * kem, xuống mặt gỗ tối → mực đậm thành vô hình. Skin nào có nền 2 vùng sáng/tối phải tự khai.
   */
  creditColor?: string;
  /**
   * Đáy an toàn cho chữ. 🎬 cinema có thanh letterbox đen 0.13H ở dưới — dòng ghi công đặt ở
   * 0.9H rơi ĐÚNG vào thanh đó và mất hẳn. Skin nào có lớp phủ (`fg`) che đáy phải khai báo.
   */
  bottomSafeY?: number;
};

/** 4 khối chữ của card kết, hiện dần so le */
function outroText(t: number, e: FrameEnv, s: OutroSkin): string {
  const { W, H, ctx } = e;
  const portrait = e.aspect === 'portrait';
  const cx = W / 2;
  const avail = W - s.padX * 2;

  // Tự co chữ cho vừa khung thay vì cắt bằng 「…」 (lời dẫn dài 95-140 ký tự)
  const grid = s.ruleGrid;
  const close = fitWrap(
    ctx.closingJa ?? '',
    avail,
    Math.round(W * (portrait ? 0.047 : 0.027)),
    portrait ? 8 : 5,
  );
  const dedBase = Math.round(W * (portrait ? 0.06 : 0.036));
  const ded = fitWrap(
    ctx.dedicationJa ?? '',
    avail,
    grid ? Math.min(dedBase, Math.round(grid.pitch * 0.8)) : dedBase,
    2,
  );
  const creditSize = Math.round(W * (portrait ? 0.027 : 0.016));

  // Bố cục: câu kết ở trên → vạch → lời đề tặng, căn quanh giữa khung.
  // Nền có dòng kẻ (giấy thư) → SNAP từng dòng chữ vào đúng lưới dòng, y như card mở đầu.
  let topY: number;
  let ruleY: number;
  let dedY: number;
  let creditY: number;
  let gridLh: number | undefined;
  if (grid) {
    const rows = close.lines.length + 1 + ded.lines.length; // +1 dòng trống cho vạch nhấn
    const wantTop = H * 0.44 - (rows * grid.pitch) / 2;
    const startIdx = Math.max(
      1,
      Math.round((wantTop - grid.top) / grid.pitch) + 1,
    );
    const rowY = (k: number) => grid.top + (startIdx - 1 + k) * grid.pitch;
    gridLh = grid.pitch;
    topY = Math.round(rowY(0) - close.size * 0.35);
    ruleY = Math.round(rowY(close.lines.length) - grid.pitch * 0.45);
    dedY = Math.round(rowY(close.lines.length + 1) - ded.size * 0.35);
    creditY = Math.round(
      grid.top +
        Math.round((H * 0.9 - grid.top) / grid.pitch) * grid.pitch -
        creditSize * 0.35,
    );
    creditY = Math.min(creditY, (s.bottomSafeY ?? H * 0.93) - creditSize * 0.3);
  } else {
    const closeH = close.lines.length * Math.round(close.size * 1.42);
    const dedH = ded.lines.length * Math.round(ded.size * 1.32);
    const blockH = closeH + Math.round(H * 0.05) + dedH;
    topY = Math.round(H * 0.46 - blockH / 2) + close.size;
    ruleY = topY + closeH + Math.round(H * 0.022);
    dedY = ruleY + Math.round(H * 0.038) + ded.size;
    creditY = Math.min(
      Math.round(H * (portrait ? 0.9 : 0.88)),
      (s.bottomSafeY ?? H * 0.93) - creditSize * 0.3,
    );
  }

  const kClose = easeIO((t - 0.12) / 0.3);
  const kRule = easeIO((t - 0.4) / 0.18);
  const kDed = easeIO((t - 0.5) / 0.24);
  const kCredit = easeIO((t - 0.72) / 0.2);

  const rule =
    kRule > 0
      ? `<g opacity="${kRule.toFixed(3)}">
           <rect x="${cx - avail * 0.11}" y="${ruleY}" width="${avail * 0.22}" height="${Math.max(2, Math.round(H * 0.0016))}" fill="${s.accent}" opacity="0.85"/>
           <circle cx="${cx - avail * 0.11 - 10}" cy="${ruleY + 1}" r="4" fill="${s.accent}" opacity="0.7"/>
           <circle cx="${cx + avail * 0.11 + 10}" cy="${ruleY + 1}" r="4" fill="${s.accent}" opacity="0.7"/>
         </g>`
      : '';

  return (
    (kClose > 0
      ? textBlock({
          lines: close.lines,
          cx,
          yStart: topY,
          size: close.size,
          color: s.ink,
          opacity: kClose,
          weight: 'normal',
          shadow: s.shadow,
          lh: gridLh,
        })
      : '') +
    rule +
    (kDed > 0
      ? textBlock({
          lines: ded.lines,
          cx,
          yStart: dedY,
          size: ded.size,
          color: s.inkStrong,
          opacity: kDed,
          shadow: s.shadow,
          lh: gridLh,
        })
      : '') +
    // Dòng ghi công trước đây tô bằng s.accent (vàng nhạt) → gần như không đọc được trên giấy kem.
    // Dùng chính màu chữ câu kết, chỉ giảm độ đậm — vẫn khiêm tốn nhưng đọc rõ.
    (kCredit > 0 && ctx.creditLine
      ? textBlock({
          lines: svgWrap(ctx.creditLine, (avail * 0.9) / creditSize, 2),
          cx,
          yStart: creditY,
          size: creditSize,
          color: s.creditColor ?? s.ink,
          opacity: kCredit * 0.8,
          weight: 'normal',
          spacing: Math.round(creditSize * 0.14),
        })
      : '')
  );
}

function outroSkin(
  tpl: IntroTemplate['id'],
  t: number,
  e: FrameEnv,
): OutroSkin {
  const { W, H, ctx } = e;
  const pal = ctx.palette;
  switch (tpl) {
    case 'cinema': {
      const bar = Math.round(H * 0.13);
      return {
        bg: `<rect width="${W}" height="${H}" fill="${darken(pal.primary, 0.82)}"/>
             <rect width="${W}" height="${H}" fill="url(#glowC)"/>`,
        fg: `<rect x="0" y="0" width="${W}" height="${bar}" fill="#000"/><rect x="0" y="${H - bar}" width="${W}" height="${bar}" fill="#000"/>`,
        ink: pal.text_on_dark,
        inkStrong: pal.text_on_dark,
        accent: pal.accent,
        padX: Math.round(W * 0.1),
        shadow: true,
        bottomSafeY: H - bar - Math.round(H * 0.02), // chữ phải dừng TRÊN thanh letterbox
      };
    }
    case 'film': {
      const paper = hexMix(lighten(pal.secondary, 0.72), '#d8c9a3', 0.55);
      const hw = Math.round(W * 0.022);
      const hh = Math.round(H * 0.045);
      const step = Math.round(H * 0.1);
      const holes: string[] = [];
      for (let y = Math.round(step * 0.4); y < H; y += step) {
        holes.push(
          `<rect x="${Math.round(W * 0.014)}" y="${y}" width="${hw}" height="${hh}" rx="${Math.round(hw * 0.22)}" fill="${darken(pal.primary, 0.6)}" opacity="0.5"/>`,
        );
        holes.push(
          `<rect x="${W - Math.round(W * 0.014) - hw}" y="${y}" width="${hw}" height="${hh}" rx="${Math.round(hw * 0.22)}" fill="${darken(pal.primary, 0.6)}" opacity="0.5"/>`,
        );
      }
      // 0.72→1: leader cháy sáng dần rồi giữ — khép lại đúng kiểu cuộn phim hết
      const burn = easeIO((t - 0.72) / 0.28) * 0.55;
      return {
        bg: `<rect width="${W}" height="${H}" fill="${paper}"/>${holes.join('')}
             <rect width="${W}" height="${H}" fill="${lighten(paper, 0.6)}" opacity="${burn.toFixed(3)}"/>`,
        fg: `<rect width="${W}" height="${H}" fill="none" stroke="${darken(pal.primary, 0.55)}" stroke-opacity="0.25" stroke-width="${Math.round(W * 0.012)}"/>`,
        ink: hexMix(pal.primary, '#5d5342', 0.55),
        inkStrong: darken(pal.primary, 0.1),
        accent: hexMix('#c98a3f', pal.accent, 0.4),
        padX: Math.round(W * 0.11),
      };
    }
    case 'letter': {
      const paper = hexMix(lighten(pal.secondary, 0.82), '#fdf6e3', 0.6);
      const px = Math.round(W * 0.09);
      const py = Math.round(H * 0.08);
      const pw = W - px * 2;
      const ph = H - py * 2;
      const lineH = Math.round(W * 0.055);
      const rules: string[] = [];
      for (let i = 1; i * lineH < ph - lineH; i++) {
        rules.push(
          `<line x1="${px + pw * 0.06}" y1="${py + i * lineH}" x2="${px + pw * 0.94}" y2="${py + i * lineH}" stroke="${hexMix(pal.primary, paper, 0.76)}" stroke-width="1.4"/>`,
        );
      }
      return {
        bg: `<rect width="${W}" height="${H}" fill="${darken(pal.primary, 0.45)}"/>
             <rect x="${px + 8}" y="${py + 10}" width="${pw}" height="${ph}" fill="#000" opacity="0.28"/>
             <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${paper}"/>
             <rect x="${px}" y="${py}" width="${pw}" height="${Math.round(H * 0.009)}" fill="${pal.accent}" opacity="0.5"/>
             ${rules.join('')}`,
        ink: hexMix(pal.primary, '#3a3226', 0.5),
        inkStrong: darken(pal.primary, 0.12),
        accent: darken(pal.accent, 0.28),
        padX: px + Math.round(pw * 0.08),
        ruleGrid: { top: py + lineH, pitch: lineH },
      };
    }
    case 'seasonal': {
      const N = 12;
      const sprites: string[] = [];
      for (let i = 0; i < N; i++) {
        const rnd = mulberry32(i * 131 + 7);
        const x0 = rnd() * W;
        const y0 = rnd() * (H + 160) - 80;
        const amp = W * (0.02 + rnd() * 0.04);
        const speed = H * (0.35 + rnd() * 0.5);
        const size = W * (0.007 + rnd() * 0.011);
        const x =
          x0 + amp * Math.sin(2 * Math.PI * (t * (0.5 + rnd() * 0.6) + rnd()));
        const y = ((((y0 + t * speed) % (H + 160)) + H + 160) % (H + 160)) - 80;
        const col =
          i % 3 === 0
            ? lighten(pal.accent, 0.3)
            : i % 3 === 1
              ? lighten(pal.secondary, 0.5)
              : '#ffffff';
        sprites.push(
          `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${size.toFixed(1)}" ry="${(size * 1.7).toFixed(1)}" fill="${col}" opacity="${(0.3 + (i % 4) * 0.1).toFixed(2)}" transform="rotate(${(t * 300 * (0.5 + rnd())).toFixed(1)}, ${x.toFixed(1)}, ${y.toFixed(1)})"/>`,
        );
      }
      return {
        bg: `<rect width="${W}" height="${H}" fill="url(#skyO)"/><rect width="${W}" height="${H}" fill="url(#haloO)"/>${sprites.join('')}`,
        ink: pal.text_on_dark,
        inkStrong: pal.text_on_dark,
        accent: lighten(pal.accent, 0.2),
        padX: Math.round(W * 0.1),
        shadow: true,
      };
    }
    case 'polaroid': {
      // Mặt gỗ phải tạo bằng ĐÚNG công thức của card mở đầu (woodDesk) — trước đây skin này
      // tự trộn màu khác và thiếu sợi vân dọc nên hai card trông như hai cái bàn khác nhau.
      const { wood, grain } = woodDesk(W, H, pal);
      // tấm polaroid kem KHÔNG ảnh, chữ viết lên đó — đúng cách người ta ghi lời nhắn sau ảnh
      const cw = Math.round(W * (e.aspect === 'portrait' ? 0.8 : 0.42));
      const ch = Math.round(cw * 1.22);
      const cxx = Math.round((W - cw) / 2);
      const cyy = Math.round(H * 0.5 - ch / 2);
      return {
        bg: `<rect width="${W}" height="${H}" fill="${wood}"/>${grain.join('')}
             <rect width="${W}" height="${H}" fill="#000" opacity="0.14"/>
             <rect x="${cxx + 8}" y="${cyy + 12}" width="${cw}" height="${ch}" fill="#000" opacity="0.3"/>
             <rect x="${cxx}" y="${cyy}" width="${cw}" height="${ch}" fill="#fbfaf6"/>
             <rect x="${cxx + Math.round(cw * 0.05)}" y="${cyy + Math.round(cw * 0.05)}" width="${cw - Math.round(cw * 0.1)}" height="${Math.round(cw * 0.9)}" fill="${hexMix('#f1ebda', lighten(pal.secondary, 0.8), 0.4)}"/>`,
        ink: '#4a443c',
        inkStrong: '#33302b',
        accent: darken(pal.accent, 0.3),
        padX: cxx + Math.round(cw * 0.1),
        // dòng ghi công nằm dưới tấm ảnh, trên mặt gỗ tối → phải dùng màu sáng
        creditColor: lighten(wood, 0.62),
      };
    }
    case 'album': {
      // Card kết cùng chất liệu album: trang giấy kem trên nền bìa da (tối) — chữ mực nâu.
      const leather = hexMix(darken(pal.primary, 0.35), '#4a2f1d', 0.55);
      const paper = lighten(pal.secondary, 0.86);
      const px = Math.round(W * 0.08);
      const py = Math.round(H * 0.1);
      const pw = W - px * 2;
      const ph = H - py * 2;
      return {
        bg: `<rect width="${W}" height="${H}" fill="${leather}"/>
             <rect x="${px + 10}" y="${py + 12}" width="${pw}" height="${ph}" fill="#000" opacity="0.3"/>
             <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${paper}"/>
             <rect x="${px}" y="${py}" width="${Math.round(pw * 0.015)}" height="${ph}" fill="${darken(paper, 0.18)}"/>`,
        ink: hexMix(pal.primary, '#3a3226', 0.55),
        inkStrong: darken(pal.primary, 0.15),
        accent: darken(pal.accent, 0.25),
        padX: px + Math.round(pw * 0.09),
      };
    }
    default: {
      return {
        bg: `<rect width="${W}" height="${H}" fill="url(#skyO)"/>`,
        ink: pal.text_on_dark,
        inkStrong: pal.text_on_dark,
        accent: pal.accent,
        padX: Math.round(W * 0.1),
        shadow: true,
      };
    }
  }
}

function buildOutroSvg(
  tpl: IntroTemplate['id'],
  t: number,
  e: FrameEnv,
): string {
  const { W, H, ctx } = e;
  const pal = ctx.palette;
  const s = outroSkin(tpl, t, e);
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <defs>
      <linearGradient id="skyO" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stop-color="${lighten(pal.secondary, 0.28)}"/><stop offset="1" stop-color="${darken(pal.primary, 0.15)}"/>
      </linearGradient>
      <radialGradient id="haloO" cx="0.5" cy="0.42" r="0.6">
        <stop offset="0" stop-color="${pal.accent}" stop-opacity="0.26"/><stop offset="1" stop-color="${pal.accent}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glowC" cx="0.5" cy="0.44" r="0.62">
        <stop offset="0" stop-color="${lighten(pal.primary, 0.3)}" stop-opacity="0.3"/><stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>
    ${s.bg}
    ${outroText(t, e, s)}
    ${s.fg ?? ''}
  </svg>`;
}

// ---- Điều phối: sinh frame → ffmpeg ----
function buildFrameSvg(
  tpl: IntroTemplate['id'],
  t: number,
  env: FrameEnv,
  frameIdx: number,
): string {
  switch (tpl) {
    case 'album':
      return svgAlbum(t, env);
    case 'cinema':
      return svgCinema(t, env);
    case 'film':
      return svgFilm(t, env, frameIdx);
    case 'letter':
      return svgLetter(t, env, frameIdx);
    case 'seasonal':
      return svgSeasonal(t, env);
    case 'polaroid':
      return svgPolaroid(t, env);
    default:
      return svgCinema(t, env);
  }
}

// Ảnh chỉ dùng ở template có khung ảnh — các template khác bỏ qua để SVG nhẹ
const USES_PHOTOS: Partial<Record<IntroTemplateId, boolean>> = {
  album: true,
  polaroid: true,
};

/** Chuỗi frame SVG → segment mp4. Dùng chung cho cả mở đầu và card kết. */
async function renderSvgSequence(opts: {
  out: string;
  frames: number;
  W: number;
  H: number;
  durationS: number;
  grain: boolean;
  buildSvg: (t: number, frameIdx: number) => string;
}): Promise<void> {
  const seqDir = path.join(
    tmpDir(),
    `svgseq_${crypto.randomBytes(5).toString('hex')}`,
  );
  fs.mkdirSync(seqDir, { recursive: true });
  try {
    const POOL = 4; // sharp có thread pool riêng — 4 frame/lượt là điểm ngọt
    let next = 0;
    await Promise.all(
      Array.from({ length: POOL }, async () => {
        for (;;) {
          const i = next++;
          if (i >= opts.frames) return;
          const svg = opts.buildSvg(i / Math.max(1, opts.frames - 1), i);
          await sharp(Buffer.from(svg), { density: 96 })
            .png({ compressionLevel: 1 })
            .toFile(path.join(seqDir, `f_${String(i).padStart(5, '0')}.png`));
        }
      }),
    );
    const vf = [
      `scale=${opts.W}:${opts.H}`,
      ...(opts.grain ? ['noise=alls=8:allf=t'] : []),
      'format=yuv420p',
    ].join(',');
    await run(FFMPEG, [
      '-y',
      '-framerate',
      String(FPS),
      '-i',
      path.join(seqDir, 'f_%05d.png'),
      '-vf',
      vf,
      '-t',
      String(opts.durationS),
      ...ENC,
      opts.out,
    ]);
  } finally {
    fs.rmSync(seqDir, { recursive: true, force: true });
  }
}

/**
 * CARD KẾT cùng chất liệu với phong cách mở đầu → video không bị "hai nửa rời nhau".
 * Nội dung: câu kết (closingJa) → vạch nhấn → lời đề tặng → dòng ghi công.
 */
export async function renderOutro(opts: {
  template: IntroTemplate['id'];
  ctx: IntroCtx;
  aspect: Aspect;
  durationS?: number;
}): Promise<SegmentResult> {
  const { W, H } = dims(opts.aspect);
  const dur = opts.durationS ?? 5;
  const out = segCacheFile({
    v: CACHE_V,
    t: 'outro_styled',
    tpl: opts.template,
    close: opts.ctx.closingJa ?? '',
    ded: opts.ctx.dedicationJa ?? '',
    credit: opts.ctx.creditLine ?? '',
    pal: opts.ctx.palette,
    a: opts.aspect,
    d: dur,
  });
  if (fs.existsSync(out)) return { file: out, cached: true };

  const env: FrameEnv = {
    W,
    H,
    ctx: opts.ctx,
    photos: [],
    aspect: opts.aspect,
    durS: dur,
  };
  await renderSvgSequence({
    out,
    frames: Math.round(dur * FPS),
    W,
    H,
    durationS: dur,
    grain: opts.template === 'film',
    buildSvg: (t) => buildOutroSvg(opts.template, t, env),
  });
  return { file: out, cached: false };
}

export async function renderIntro(opts: {
  template: IntroTemplate['id'];
  ctx: IntroCtx;
  aspect: Aspect;
  durationS?: number;
}): Promise<SegmentResult> {
  const { W, H } = dims(opts.aspect);
  const dur = opts.durationS ?? 4;
  const usePhotos = !!USES_PHOTOS[opts.template];
  const out = segCacheFile({
    v: CACHE_V,
    t: 'intro',
    tpl: opts.template,
    title: opts.ctx.titleJa,
    sub: opts.ctx.subtitleJa,
    open: opts.ctx.openingJa,
    pal: opts.ctx.palette,
    photos: usePhotos ? opts.ctx.photoIds.slice(0, 3) : [],
    a: opts.aspect,
    d: dur,
  });
  if (fs.existsSync(out)) return { file: out, cached: true };

  const photos = usePhotos
    ? await preparePhotos(
        opts.ctx.photoAbs,
        opts.template === 'polaroid' ? 600 : 700,
      )
    : [];
  const env: FrameEnv = {
    W,
    H,
    ctx: opts.ctx,
    photos,
    aspect: opts.aspect,
    durS: dur,
  };
  await renderSvgSequence({
    out,
    frames: Math.round(dur * FPS),
    W,
    H,
    durationS: dur,
    grain: opts.template === 'film',
    buildSvg: (t, i) => buildFrameSvg(opts.template, t, env, i),
  });
  return { file: out, cached: false };
}
