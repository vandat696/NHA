// ===== Render VIDEO KỶ NIỆM bằng ffmpeg — 0 token (Luồng C, bước 5c-d) =====
// 1920x1080 (hoặc 1080x1920) @ 30fps.
//
// ĐỘ MƯỢT (fix giật/lag của bản cũ):
//   1. Dùng ảnh GỐC (file_path) chứ không phải bản prep 768px → còn chi tiết để zoom.
//   2. zoompan chạy trên canvas SUPERSAMPLE 3x (5760x3240) → sai số làm tròn nguyên pixel
//      của zoompan chỉ còn 1/3 pixel đầu ra (bản cũ 1.5x → nhảy nguyên pixel = giật).
//   3. Easing smoothstep (vận tốc = 0 ở 2 đầu) thay vì tuyến tính.
//   4. Lia (pan) dùng zoom HẰNG SỐ → thuần tịnh tiến, không rescale từng frame (hết shimmer).
//   5. Input là 1 frame (bỏ -loop 1) → chuỗi blur/scale chạy MỘT lần, không lặp mỗi frame.
//
// BỘ HIỆU ỨNG (effect_profile):
//   memories  — MẶC ĐỊNH cho video mới, thiết kế theo bản bóc tách iPhone Memories của Sơn:
//               cut đúng nhịp là chủ đạo, Ken Burns tuyến tính ~1%/s (tổng 2-4%/shot),
//               counter-slide theo cụm + bloom trắng + whip-blur làm dấu câu, không overlay màu.
//   off/soft/cinematic/vintage — 4 profile CŨ, giữ để video cũ trong DB re-render y hệt
//               (user không còn chọn được trên UI).
//
// - Ảnh user tick "AI animate" → CHƯA có API image-to-video: GIỮ NGUYÊN ảnh +
//   chữ tiếng Nhật RẤT TO 「API待ち」 (prompt EN đã có sẵn trong plan.videogen — xem lib/videoai.ts)
// - Video gốc  → cắt đoạn đầu theo thời lượng cảnh
// - CACHE segment theo hash(media, type, caption, effect, style, profile, aspect) — re-render đổi ý gần như miễn phí

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { FFMPEG, run } from './exec';
import type { Join } from './videoTiming';
import type {
  Aspect,
  EffectProfile,
  Palette,
  Scene,
  SceneEffect,
  VideoStyle,
} from './types';

const CWD = () => process.cwd();
const OUT_DIR = () => path.join(CWD(), 'uploads', 'video_out');
const SEG_DIR = () => path.join(OUT_DIR(), 'seg');
const TMP_DIR = () => path.join(OUT_DIR(), 'tmp');
const MUSIC_DIR = () => path.join(CWD(), 'uploads', 'music');

export const tmpDir = TMP_DIR;

export const FPS = 30;
const SS = 3; // hệ số supersample cho zoompan (hạ xuống 2 nếu máy yếu)
// V5: engine memories (KB tuyến tính cực nhẹ + static), crf segment 18, tpad video clip
const CACHE_V = 5; // bump khi đổi thuật toán render → cache cũ tự bỏ

export function ensureDirs() {
  for (const d of [OUT_DIR(), SEG_DIR(), TMP_DIR(), MUSIC_DIR()])
    fs.mkdirSync(d, { recursive: true });
}

export function dims(aspect: Aspect): { W: number; H: number } {
  return aspect === 'portrait' ? { W: 1080, H: 1920 } : { W: 1920, H: 1080 };
}

export const DEFAULT_PALETTE: Palette = {
  primary: '#1c3d2e',
  secondary: '#2e8b57',
  accent: '#ffd23f',
  text_on_dark: '#ffffff',
};

// Tông màu theo style (LUT-lite): やさしい ấm nhẹ / 感動 tương phản mềm / 家族向け tươi sáng
const STYLE_FILTER: Record<VideoStyle, string> = {
  yasashii: 'eq=brightness=0.03:saturation=1.06,colorbalance=rs=.04:bs=-.03',
  kandou: 'eq=contrast=1.07:saturation=0.9:brightness=-0.01',
  kazoku: 'eq=brightness=0.05:saturation=1.16',
};

// ---- Font (Windows) — chữ Nhật trong video + fallback Latin/Việt ----
export type FontSet = { vn: string | null; jp: string | null };

export function findFont(kind: 'vn' | 'jp'): string | null {
  const dir = 'C:\\Windows\\Fonts';
  const cands =
    kind === 'jp'
      ? [
          'YuGothB.ttc',
          'yugothb.ttc',
          'meiryob.ttc',
          'meiryo.ttc',
          'YuGothM.ttc',
          'msgothic.ttc',
        ]
      : ['segoeuib.ttf', 'arialbd.ttf', 'segoeui.ttf', 'arial.ttf'];
  for (const f of cands) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function loadFonts(): FontSet {
  return { vn: findFont('vn'), jp: findFont('jp') };
}

// Chuỗi có ký tự CJK → phải dùng font Nhật (Segoe UI không có glyph kanji/kana)
const CJK_RE =
  /[\u2E80-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

export function pickFont(text: string, fonts: FontSet): string | null {
  return CJK_RE.test(text) ? (fonts.jp ?? fonts.vn) : (fonts.vn ?? fonts.jp);
}

/**
 * Bỏ dấu phần chữ Latin (Sơn → Son, Nguyễn → Nguyen).
 * VÌ SAO CẦN: chuỗi lẫn CJK sẽ được vẽ bằng font Nhật (Yu Gothic), mà font Nhật KHÔNG có
 * glyph cho ơ/ư/đ… → hiện ra ô vuông tofu (đã gặp thật: 「Sơnへ 家族より」 ra 「S□nへ」).
 * Chỉ áp khi thực sự vẽ bằng font Nhật, nên caption tiếng Việt (vẽ bằng font VN) vẫn còn dấu.
 */
export function stripLatinDiacritics(s: string): string {
  return (
    s
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .normalize('NFD')
      // chỉ xoá dấu kết hợp của Latin (U+0300–U+036F); dakuten của kana nằm ở U+3099 nên không bị ảnh hưởng
      .replace(/[̀-ͯ]/g, '')
      .normalize('NFC')
  );
}

/** Chuỗi sắp vẽ bằng font Nhật thì phải bỏ dấu Latin để không ra tofu */
function safeForFont(
  text: string,
  font: string | null,
  fonts: FontSet,
): string {
  return font && font === fonts.jp ? stripLatinDiacritics(text) : text;
}

function ffPath(p: string): string {
  // escape cho filter ffmpeg: dùng /, escape dấu :
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// drawtext dùng TEXTFILE (UTF-8) để né toàn bộ vấn đề escape tiếng Việt/Nhật
function writeTextFile(content: string): string {
  const p = path.join(
    TMP_DIR(),
    `txt_${crypto.randomBytes(4).toString('hex')}.txt`,
  );
  fs.writeFileSync(p, content.replace(/\r?\n/g, ' '), 'utf8');
  return p;
}

function drawText(opts: {
  font: string;
  text: string;
  fontsize: number;
  color: string;
  y: string;
  box?: boolean;
  borderw?: number;
}): string {
  const tf = writeTextFile(opts.text);
  return (
    `drawtext=fontfile='${ffPath(opts.font)}':textfile='${ffPath(tf)}'` +
    `:fontsize=${opts.fontsize}:fontcolor=${opts.color}` +
    `:borderw=${opts.borderw ?? 2}:bordercolor=black@0.75` +
    (opts.box ? `:box=1:boxcolor=black@0.38:boxborderw=16` : '') +
    `:x=(w-text_w)/2:y=${opts.y}`
  );
}

// ---- Xuống dòng: drawtext KHÔNG tự wrap, lại phải xử lý tiếng Nhật (không có dấu cách) ----
// Đo theo "đơn vị em": ký tự CJK full-width ≈ 1.0em, ký tự Latin ≈ 0.56em.
function charUnits(ch: string): number {
  return CJK_RE.test(ch) ? 1 : 0.56;
}

function textUnits(s: string): number {
  let u = 0;
  for (const ch of s) u += charUnits(ch);
  return u;
}

export function maxUnitsFor(W: number, fontsize: number): number {
  return Math.max(6, (W * 0.86) / fontsize);
}

// Kinsoku shori: các ký tự KHÔNG được đứng đầu dòng / KHÔNG được đứng cuối dòng
const KINSOKU_HEAD =
  '、。，．！？：；・ー〜…）」』】〕ぁぃぅぇぉっゃゅょゎゝゞ々!?,.)]';
const KINSOKU_TAIL = '（「『【〔([';

/**
 * Xuống dòng theo BỀ RỘNG HIỂN THỊ, có kinsoku cho tiếng Nhật.
 * Export vì thiệp (src/ai/card.service.ts) cần đúng luật này: tiếng Nhật không có
 * dấu cách nên cắt theo từ sẽ ra một dòng dài tràn khỏi trang.
 */
export function wrapLines(
  text: string,
  maxUnits: number,
  maxLines = 3,
): string[] {
  const src = text.trim();
  if (!src) return [];
  const lines: string[] = [];

  if (CJK_RE.test(src)) {
    // Tiếng Nhật: cắt theo KÝ TỰ + kinsoku (dấu câu không mở đầu dòng, ngoặc mở không kết dòng)
    const chars = Array.from(src);
    let cur = '';
    let curU = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const u = charUnits(ch);
      const overflow = curU + u > maxUnits && cur.length > 0;
      // dấu câu bị đẩy xuống dòng mới → cho phép tràn nhẹ, giữ nó ở cuối dòng hiện tại
      if (overflow && !KINSOKU_HEAD.includes(ch)) {
        // ngoặc mở không được kết dòng → đẩy nó sang dòng sau cùng ký tự này
        let carry = '';
        while (cur.length > 0 && KINSOKU_TAIL.includes(cur[cur.length - 1])) {
          carry = cur[cur.length - 1] + carry;
          cur = cur.slice(0, -1);
        }
        lines.push(cur);
        cur = carry + ch;
        curU = textUnits(cur);
      } else {
        cur += ch;
        curU += u;
      }
    }
    if (cur) lines.push(cur);
  } else {
    // Latin/Việt: cắt theo từ như cũ nhưng đo bằng đơn vị em
    const words = src.split(/\s+/);
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (textUnits(next) > maxUnits && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
  }

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1] + '…';
    return kept;
  }
  return lines;
}

// Vẽ text nhiều dòng, căn giữa quanh yCenterPx (hoặc neo đáy yBottomPx)
function drawTextBlock(opts: {
  fonts: FontSet;
  text: string;
  fontsize: number;
  color: string;
  W: number;
  yCenterPx?: number;
  yBottomPx?: number;
  box?: boolean;
  borderw?: number;
  maxLines?: number;
}): string[] {
  const font = pickFont(opts.text, opts.fonts);
  if (!font || !opts.text.trim()) return [];
  const text = safeForFont(opts.text, font, opts.fonts);
  const lines = wrapLines(
    text,
    maxUnitsFor(opts.W, opts.fontsize),
    opts.maxLines ?? 3,
  );
  const lineH = Math.round(opts.fontsize * 1.3);
  return lines.map((line, i) => {
    let y: string;
    if (opts.yBottomPx !== undefined) {
      y = String(
        opts.yBottomPx - (lines.length - 1 - i) * lineH - opts.fontsize,
      );
    } else {
      const startY = Math.round(
        (opts.yCenterPx ?? 0) - (lines.length * lineH) / 2,
      );
      y = String(startY + i * lineH);
    }
    return drawText({
      font,
      text: line,
      fontsize: opts.fontsize,
      color: opts.color,
      y,
      box: opts.box,
      borderw: opts.borderw,
    });
  });
}

function captionSize(aspect: Aspect): number {
  return aspect === 'portrait' ? 52 : 45;
}

// ---- Composite: ảnh GIỮ NGUYÊN tỉ lệ gốc (contain) trên nền blur từ chính ảnh đó ----
// Nền blur tính ở NỬA kích thước rồi upscale (gblur rẻ hơn nhiều, blur che hết vết upscale);
// foreground scale lanczos THẲNG từ ảnh gốc lên canvas đích (giữ tối đa chi tiết).
// trim=end_frame=1 để chặn GIF động; setpts reset cho chuỗi loop/zoompan phía sau.
function imageComposite(W: number, H: number): string {
  const bw = Math.round(W / 2 / 2) * 2;
  const bh = Math.round(H / 2 / 2) * 2;
  return [
    `[0:v]trim=end_frame=1,setpts=PTS-STARTPTS,split=2[bg][fg]`,
    `[bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=13,eq=brightness=-0.12,scale=${W}:${H}:flags=bicubic[bgL]`,
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fgL]`,
    `[bgL][fgL]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[comp]`,
  ].join(';');
}

// Composite cho VIDEO (mỗi frame một lần, không trim/setpts)
function videoComposite(W: number, H: number): string {
  const bw = Math.round(W / 2 / 2) * 2;
  const bh = Math.round(H / 2 / 2) * 2;
  return [
    `[0:v]fps=${FPS},split=2[bg][fg]`,
    `[bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=13,eq=brightness=-0.12,scale=${W}:${H}:flags=bicubic[bgL]`,
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fgL]`,
    `[bgL][fgL]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[comp]`,
  ].join(';');
}

// Giữ 1 frame tĩnh thành cả segment (dùng cho profile 'off', placeholder, card)
function holdStatic(frames: number): string {
  return `loop=loop=${frames - 1}:size=1:start=0,setpts=N/(${FPS}*TB),fps=${FPS}`;
}

// crf 18 cho SEGMENT (bị encode lần 2 khi ghép — chất lượng nguồn quyết định ảnh có mờ hay không),
// crf 19 cho file cuối. Preset giữ veryfast để cân bằng thời gian render.
//
// Số luồng x264/filter: mặc định ffmpeg lấy theo số nhân máy VẬT LÝ — trong
// container Render đó là host hàng chục nhân chứ không phải 1 CPU của gói, mỗi
// luồng x264 lại giữ thêm frame 1080x1920. Đo 2026-09-17 (ffmpeg 7.0.2 Linux,
// bước ghép 6 đoạn): mặc định 8 nhân 1279MB → 4 luồng 1089MB. Chỉnh được qua
// VIDEO_FFMPEG_THREADS khi máy dev muốn nhanh hơn.
export const FFMPEG_THREADS = String(
  Math.max(1, Number(process.env.VIDEO_FFMPEG_THREADS ?? 4) || 4),
);
const ENC = [
  '-r',
  String(FPS),
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-threads',
  FFMPEG_THREADS,
  '-an',
];
const FINAL_ENC = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '19',
  '-pix_fmt',
  'yuv420p',
  '-r',
  String(FPS),
  '-threads',
  FFMPEG_THREADS,
  '-movflags',
  '+faststart',
];

export type SegmentResult = { file: string; cached: boolean };

export function segCacheFile(key: Record<string, unknown>): string {
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(key))
    .digest('hex')
    .slice(0, 16);
  return path.join(SEG_DIR(), `${hash}.mp4`);
}

// ---- Biên độ chuyển động + overlay theo từng bộ hiệu ứng ----
type Amp = { zoom: number; pan: number };
const AMPLITUDE: Record<EffectProfile, Amp> = {
  off: { zoom: 1, pan: 1 },
  soft: { zoom: 1.1, pan: 1.06 },
  cinematic: { zoom: 1.08, pan: 1.08 },
  vintage: { zoom: 1.12, pan: 1.08 },
  // memories: giá trị pan cố định; zoom được TÍNH THEO THỜI LƯỢNG trong memoriesAmp() —
  // bảng này chỉ là fallback khi ai đó gọi thẳng với profile memories.
  memories: { zoom: 1.03, pan: 1.03 },
};

/**
 * Biên độ kiểu Memories — đo từ video Ký ức iPhone: zoom 0-1.5%/s, pan 0.5-1.7%/s,
 * TỔNG dịch chuyển chỉ 2-4%/shot. Bản cũ của mình 8-12%/shot là "đủ lớn để người xem
 * nhận ra nó đang zoom" — chính là lý do trông rẻ tiền.
 */
function memoriesAmp(durS: number): Amp {
  const total = Math.min(0.045, Math.max(0.022, 0.011 * durS)); // ≈1.1%/s, chặn 2.2-4.5%
  return { zoom: 1 + total, pan: 1 + total };
}

function letterboxH(H: number): number {
  return Math.round((H * 0.11) / 2) * 2;
}

// grade = áp TRƯỚC caption (không làm mờ chữ) · finish = áp SAU caption (vignette/grain trùm cả chữ)
function profileOverlays(
  profile: EffectProfile,
  H: number,
): { grade: string[]; finish: string[] } {
  switch (profile) {
    case 'cinematic': {
      const bar = letterboxH(H);
      return {
        grade: [
          `curves=master='0/0.03 0.5/0.52 1/0.97'`,
          'eq=saturation=1.05:contrast=1.06',
          `drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill`,
          `drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`,
        ],
        finish: ['vignette=PI/5'],
      };
    }
    case 'vintage':
      return {
        grade: ['curves=preset=vintage', 'eq=brightness=0.02:saturation=0.85'],
        finish: ['vignette=PI/4.4', 'noise=alls=6:allf=t'],
      };
    default:
      return { grade: [], finish: [] };
  }
}

// Caption phải nằm TRÊN thanh letterbox của profile điện ảnh
function captionBottom(profile: EffectProfile, H: number): number {
  return profile === 'cinematic'
    ? H - letterboxH(H) - 28
    : Math.round(H * 0.92);
}

// ---- Chuyển động trong ảnh ----
// Hai chế độ easing:
//  · 'smooth' (4 profile cũ): E = p²(3−2p) — vận tốc 0 ở hai đầu, hợp với crossfade dài.
//  · 'linear' (memories): E = p — nguồn đo cho thấy Ken Burns của Apple chạy ĐỀU suốt shot,
//    ease chỉ dành cho chuyển cảnh. Biên độ nhỏ (≈1%/s trên canvas SS=3) nên không giật bậc.
// Lia dùng zoom HẰNG SỐ (chỉ dịch khung) — mượt hơn hẳn vừa zoom vừa dịch.
function zoompanExpr(
  motion: SceneEffect,
  frames: number,
  W: number,
  H: number,
  amp: Amp,
  ease: 'smooth' | 'linear' = 'smooth',
): string {
  const D = Math.max(2, frames);
  const p = `(on/${D - 1})`;
  const E = ease === 'linear' ? p : `${p}*${p}*(3-2*${p})`;
  const cx = `(iw-iw/zoom)/2`;
  const cy = `(ih-ih/zoom)/2`;
  const tail = `:d=${D}:s=${W}x${H}:fps=${FPS}`;
  const dz = (amp.zoom - 1).toFixed(3);
  const pz = amp.pan.toFixed(3);
  switch (motion) {
    case 'zoom_out':
      return `zoompan=z='${amp.zoom.toFixed(3)}-${dz}*${E}':x='${cx}':y='${cy}'${tail}`;
    case 'pan_lr':
      return `zoompan=z='${pz}':x='(iw-iw/zoom)*${E}':y='${cy}'${tail}`;
    case 'pan_rl':
      return `zoompan=z='${pz}':x='(iw-iw/zoom)*(1-${E})':y='${cy}'${tail}`;
    case 'pan_ud':
      return `zoompan=z='${pz}':x='${cx}':y='(ih-ih/zoom)*${E}'${tail}`;
    case 'pan_du':
      return `zoompan=z='${pz}':x='${cx}':y='(ih-ih/zoom)*(1-${E})'${tail}`;
    case 'zoom_in':
    default:
      return `zoompan=z='1+${dz}*${E}':x='${cx}':y='${cy}'${tail}`;
  }
}

// ---- Cảnh ảnh tĩnh: Ken Burns eased (hoặc khung tĩnh nếu profile = off) ----
export async function renderKenBurns(opts: {
  imageAbs: string;
  scene: Scene;
  style: VideoStyle;
  profile: EffectProfile;
  aspect: Aspect;
  fonts: FontSet;
}): Promise<SegmentResult> {
  const { W, H } = dims(opts.aspect);
  const dur = opts.scene.duration_s;
  const out = segCacheFile({
    v: CACHE_V,
    t: 'kb',
    img: opts.scene.media_id,
    d: dur,
    c: opts.scene.caption_ja,
    e: opts.scene.effect,
    s: opts.style,
    p: opts.profile,
    a: opts.aspect,
  });
  if (fs.existsSync(out)) return { file: out, cached: true };

  const frames = Math.round(dur * FPS);
  const { grade, finish } = profileOverlays(opts.profile, H);
  const captions = drawTextBlock({
    fonts: opts.fonts,
    text: opts.scene.caption_ja,
    fontsize: captionSize(opts.aspect),
    color: 'white',
    W,
    yBottomPx: captionBottom(opts.profile, H),
    box: true,
    maxLines: 2,
  });

  let graph: string;
  if (opts.profile === 'off' || opts.scene.effect === 'static') {
    // Khung tĩnh: composite ở đúng kích thước đầu ra rồi giữ N frame.
    // ('static' là 1 trong 5 biến thể memories — nguồn có shot "rất tĩnh")
    graph =
      imageComposite(W, H) +
      `;[comp]` +
      [
        holdStatic(frames),
        STYLE_FILTER[opts.style],
        ...grade,
        ...captions,
        ...finish,
        'format=yuv420p',
      ].join(',') +
      `[v]`;
  } else {
    const SW = Math.round((W * SS) / 2) * 2;
    const SH = Math.round((H * SS) / 2) * 2;
    const memories = opts.profile === 'memories';
    const amp = memories ? memoriesAmp(dur) : AMPLITUDE[opts.profile];
    graph =
      imageComposite(SW, SH) +
      `;[comp]` +
      [
        zoompanExpr(
          opts.scene.effect,
          frames,
          W,
          H,
          amp,
          memories ? 'linear' : 'smooth',
        ),
        STYLE_FILTER[opts.style],
        ...grade,
        ...captions,
        ...finish,
        'format=yuv420p',
      ].join(',') +
      `[v]`;
  }

  await run(FFMPEG, [
    '-y',
    '-i',
    opts.imageAbs,
    '-filter_complex',
    graph,
    '-map',
    '[v]',
    '-t',
    String(dur),
    ...ENC,
    out,
  ]);
  return { file: out, cached: false };
}

// ---- Cảnh "AI animate" — PLACEHOLDER chờ API image-to-video ----
// Prompt EN cho cảnh này đã có sẵn trong plan.videogen.scenes[].prompt_en (xem lib/videoai.ts)
export async function renderAiPlaceholder(opts: {
  imageAbs: string;
  scene: Scene;
  style: VideoStyle;
  profile: EffectProfile;
  aspect: Aspect;
  fonts: FontSet;
}): Promise<SegmentResult> {
  const { W, H } = dims(opts.aspect);
  const dur = opts.scene.duration_s;
  const out = segCacheFile({
    v: CACHE_V,
    t: 'ai',
    img: opts.scene.media_id,
    d: dur,
    c: opts.scene.caption_ja,
    s: opts.style,
    p: opts.profile,
    a: opts.aspect,
  });
  if (fs.existsSync(out)) return { file: out, cached: true };

  const frames = Math.round(dur * FPS);
  const bandH = Math.round(H * 0.34);
  const mainSize = Math.round(W * (opts.aspect === 'portrait' ? 0.19 : 0.13)); // chữ RẤT to
  const subSize = Math.round(mainSize * 0.3);
  const { grade, finish } = profileOverlays(opts.profile, H);
  const jp = opts.fonts.jp;
  const overlays = [
    holdStatic(frames),
    STYLE_FILTER[opts.style],
    ...grade,
    `drawbox=y=(ih-${bandH})/2:h=${bandH}:color=black@0.55:t=fill`,
    ...(jp
      ? [
          drawText({
            font: jp,
            text: 'API待ち',
            fontsize: mainSize,
            color: '#ffd23f',
            y: `(h-${bandH})/2+${Math.round(bandH * 0.12)}`,
            borderw: 5,
          }),
          drawText({
            font: jp,
            text: 'AIアニメーション生成準備中…',
            fontsize: subSize,
            color: 'white',
            y: `(h+${bandH})/2-${Math.round(subSize * 1.6)}`,
            borderw: 3,
          }),
        ]
      : opts.fonts.vn
        ? [
            drawText({
              font: opts.fonts.vn,
              text: 'DANG CHO API (AI animate)',
              fontsize: subSize,
              color: '#ffd23f',
              y: '(h-text_h)/2',
              borderw: 4,
            }),
          ]
        : []),
    ...drawTextBlock({
      fonts: opts.fonts,
      text: opts.scene.caption_ja,
      fontsize: captionSize(opts.aspect),
      color: 'white',
      W,
      yBottomPx: captionBottom(opts.profile, H),
      box: true,
      maxLines: 2,
    }),
    ...finish,
    'format=yuv420p',
  ].join(',');
  const graph = imageComposite(W, H) + `;[comp]${overlays}[v]`;
  await run(FFMPEG, [
    '-y',
    '-i',
    opts.imageAbs,
    '-filter_complex',
    graph,
    '-map',
    '[v]',
    '-t',
    String(dur),
    ...ENC,
    out,
  ]);
  return { file: out, cached: false };
}

// ---- Cảnh cắt từ VIDEO GỐC (cảm xúc thật, 0 token) ----
export async function renderVideoClip(opts: {
  videoAbs: string;
  scene: Scene;
  style: VideoStyle;
  profile: EffectProfile;
  aspect: Aspect;
  fonts: FontSet;
}): Promise<SegmentResult> {
  const { W, H } = dims(opts.aspect);
  const dur = opts.scene.duration_s;
  const out = segCacheFile({
    v: CACHE_V,
    t: 'clip',
    img: opts.scene.media_id,
    d: dur,
    c: opts.scene.caption_ja,
    s: opts.style,
    p: opts.profile,
    a: opts.aspect,
  });
  if (fs.existsSync(out)) return { file: out, cached: true };

  const { grade, finish } = profileOverlays(opts.profile, H);
  const overlays = [
    STYLE_FILTER[opts.style],
    ...grade,
    ...drawTextBlock({
      fonts: opts.fonts,
      text: opts.scene.caption_ja,
      fontsize: captionSize(opts.aspect),
      color: 'white',
      W,
      yBottomPx: captionBottom(opts.profile, H),
      box: true,
      maxLines: 2,
    }),
    ...finish,
    // video gốc NGẮN hơn duration_s khai báo → giữ frame cuối cho đủ (tpad), rồi -t cắt đúng.
    // Không có dòng này thì segment ngắn hơn khai báo → offset xfade/counter-slide phía sau lệch hết.
    `tpad=stop_mode=clone:stop_duration=${dur}`,
    'format=yuv420p',
  ].join(',');
  const graph = videoComposite(W, H) + `;[comp]${overlays}[v]`;
  await run(FFMPEG, [
    '-y',
    '-ss',
    '0',
    '-t',
    String(dur),
    '-i',
    opts.videoAbs,
    '-filter_complex',
    graph,
    '-map',
    '[v]',
    '-t',
    String(dur),
    ...ENC,
    out,
  ]);
  return { file: out, cached: false };
}

// ---- Title / outro card (nền gradient theo PALETTE của AI, KHÔNG ảnh ngoài) ----
export async function paletteBgPng(
  W: number,
  H: number,
  palette: Palette,
  kind: 'title' | 'outro',
): Promise<string> {
  const p = path.join(
    TMP_DIR(),
    `bg_${crypto.randomBytes(4).toString('hex')}.png`,
  );
  const [from, to] =
    kind === 'title'
      ? [palette.primary, palette.secondary]
      : [palette.secondary, palette.primary];
  const cx = W / 2;
  const ruleW = Math.round(W * 0.18);
  const ruleY = kind === 'title' ? Math.round(H * 0.56) : Math.round(H * 0.58);
  const dotR = Math.max(3, Math.round(W * 0.004));
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62">
        <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.18"/>
        <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    <rect x="${cx - ruleW / 2}" y="${ruleY}" width="${ruleW}" height="${Math.max(2, Math.round(H * 0.0025))}" fill="${palette.accent}" opacity="0.85"/>
    <circle cx="${cx - ruleW / 2 - dotR * 4}" cy="${ruleY + dotR}" r="${dotR}" fill="${palette.accent}" opacity="0.7"/>
    <circle cx="${cx + ruleW / 2 + dotR * 4}" cy="${ruleY + dotR}" r="${dotR}" fill="${palette.accent}" opacity="0.7"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(p);
  return p;
}

export async function renderCard(opts: {
  kind: 'title' | 'outro';
  title: string;
  subtitle: string;
  dedication?: string;
  palette: Palette;
  aspect: Aspect;
  fonts: FontSet;
  durationS?: number;
}): Promise<SegmentResult> {
  const { W, H } = dims(opts.aspect);
  const dur = opts.durationS ?? 3;
  const ded = opts.dedication ?? '';
  const out = segCacheFile({
    v: CACHE_V,
    t: opts.kind,
    title: opts.title,
    sub: opts.subtitle,
    ded,
    pal: opts.palette,
    a: opts.aspect,
    d: dur,
  });
  if (fs.existsSync(out)) return { file: out, cached: true };

  const bg = await paletteBgPng(W, H, opts.palette, opts.kind);
  const frames = Math.round(dur * FPS);
  // Chữ dài → tự xuống dòng + co cỡ chữ để KHÔNG tràn khung
  let titleSize = Math.round(W * 0.055);
  if (textUnits(opts.title) > 14) titleSize = Math.round(titleSize * 0.8);
  if (textUnits(opts.title) > 26) titleSize = Math.round(titleSize * 0.82);
  const subSize = Math.round(W * 0.026);
  const filters = [
    holdStatic(frames),
    ...drawTextBlock({
      fonts: opts.fonts,
      text: opts.title,
      fontsize: titleSize,
      color: opts.palette.text_on_dark,
      W,
      yCenterPx: Math.round(H * 0.44),
      borderw: 3,
      maxLines: 3,
    }),
    ...(ded
      ? drawTextBlock({
          fonts: opts.fonts,
          text: ded,
          fontsize: Math.round(subSize * 1.15),
          color: opts.palette.accent,
          W,
          yCenterPx: Math.round(H * 0.66),
          borderw: 2,
          maxLines: 2,
        })
      : []),
    ...drawTextBlock({
      fonts: opts.fonts,
      text: opts.subtitle,
      fontsize: subSize,
      color: opts.palette.accent,
      W,
      yCenterPx: Math.round(H * (ded ? 0.78 : 0.66)),
      borderw: 2,
      maxLines: 2,
    }),
    'format=yuv420p',
  ].join(',');
  await run(FFMPEG, [
    '-y',
    '-i',
    bg,
    '-vf',
    filters,
    '-t',
    String(dur),
    ...ENC,
    out,
  ]);
  fs.rmSync(bg, { force: true });
  return { file: out, cached: false };
}

// ---- Ghép segment + trộn nhạc ----
// profile 'memories' → concatMemories (cut mặc định + counter-slide/bloom/whip theo joins[])
// profile 'off'      → cắt thẳng (concat demuxer), chỉ fade đen ở đầu/cuối cả video
// profile cũ khác    → CROSSFADE xfade giữa các cảnh (đường legacy, giữ nguyên)
const XFADE_SETS: Record<
  Exclude<EffectProfile, 'off' | 'memories'>,
  string[]
> = {
  soft: ['fade'],
  cinematic: ['fade', 'smoothleft', 'circleopen'],
  vintage: ['fade', 'dissolve'],
};
const XFADE_D = 0.6;

export async function concatWithTransitions(opts: {
  segments: { file: string; durationS: number }[];
  profile: EffectProfile;
  musicPath: string | null;
  outAbs: string;
  aspect: Aspect;
  /**
   * Profile 'memories': mối nối do lib/videoTiming.ts phân bổ (cut mặc định + counter-slide
   * theo cụm + bloom/whip điểm xuyết). Bắt buộc dài đúng segments.length−1.
   */
  joins?: Join[];
  /** tiếng nói trích từ clip gốc, đặt đúng vị trí timeline — nhạc tự nhỏ xuống dưới nó */
  voiceTracks?: VoiceTrack[];
}): Promise<{ totalDur: number; transitions: string[] }> {
  const segs = opts.segments;
  if (segs.length === 0) throw new Error('Không có segment nào để ghép');

  if (opts.profile === 'memories' && segs.length > 1) {
    if (!opts.joins || opts.joins.length !== segs.length - 1) {
      throw new Error(
        `memories cần joins[] dài ${segs.length - 1}, nhận ${opts.joins?.length ?? 0}`,
      );
    }
    const { W, H } = dims(opts.aspect);
    return concatMemories({
      segs,
      joins: opts.joins,
      musicPath: opts.musicPath,
      outAbs: opts.outAbs,
      W,
      H,
      voiceTracks: opts.voiceTracks,
    });
  }

  // ----- Cắt thẳng: concat demuxer (nhanh nhất) -----
  if (opts.profile === 'off' || segs.length === 1) {
    const totalDur = segs.reduce((s, x) => s + x.durationS, 0);
    const listFile = path.join(
      TMP_DIR(),
      `list_${crypto.randomBytes(4).toString('hex')}.txt`,
    );
    fs.writeFileSync(
      listFile,
      segs.map((s) => `file '${s.file.replace(/\\/g, '/')}'`).join('\n'),
      'utf8',
    );
    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile];
    if (opts.musicPath) args.push('-stream_loop', '-1', '-i', opts.musicPath);
    args.push(
      '-vf',
      `fade=t=in:st=0:d=0.4,fade=t=out:st=${Math.max(0, totalDur - 0.5).toFixed(2)}:d=0.5`,
    );
    args.push('-map', '0:v');
    if (opts.musicPath) {
      args.push('-map', '1:a');
      args.push(
        '-af',
        `volume=1.0,afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, totalDur - 2.5).toFixed(2)}:d=2.5`,
      );
      args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
    }
    args.push('-t', totalDur.toFixed(2), ...FINAL_ENC, opts.outAbs);
    await run(FFMPEG, args);
    return { totalDur, transitions: [] };
  }

  // ----- Crossfade: filter_complex xfade nối chuỗi -----
  // offset_i = (thời lượng tích luỹ hiện tại) − XFADE_D ; tích luỹ += d_i − XFADE_D
  // VD: 3s + 5s + 4s, overlap 0.6 → offset 2.4 rồi 6.8 ; tổng = 10.8s
  // tới đây chỉ còn 3 profile cũ có crossfade (memories + off + 1-segment đã rẽ nhánh ở trên)
  const set =
    XFADE_SETS[opts.profile as Exclude<EffectProfile, 'off' | 'memories'>];
  const parts: string[] = [];
  const transitions: string[] = [];
  segs.forEach((_, i) =>
    parts.push(`[${i}:v]fps=${FPS},settb=AVTB,format=yuv420p[s${i}]`),
  );
  let cum = segs[0].durationS;
  let prev = '[s0]';
  for (let i = 1; i < segs.length; i++) {
    const tr = set[(i - 1) % set.length];
    transitions.push(tr);
    const offset = Math.max(0, cum - XFADE_D);
    const label = i === segs.length - 1 ? '[vx]' : `[x${i}]`;
    parts.push(
      `${prev}[s${i}]xfade=transition=${tr}:duration=${XFADE_D}:offset=${offset.toFixed(3)}${label}`,
    );
    cum = cum + segs[i].durationS - XFADE_D;
    prev = label;
  }
  const totalDur = cum;
  parts.push(
    `[vx]fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, totalDur - 0.8).toFixed(2)}:d=0.8[v]`,
  );

  const args = ['-y'];
  for (const s of segs) args.push('-i', s.file);
  if (opts.musicPath) args.push('-stream_loop', '-1', '-i', opts.musicPath);
  args.push('-filter_complex', parts.join(';'), '-map', '[v]');
  if (opts.musicPath) {
    args.push('-map', `${segs.length}:a`);
    args.push(
      '-af',
      `volume=1.0,afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, totalDur - 2.5).toFixed(2)}:d=2.5`,
    );
    args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  }
  args.push('-t', totalDur.toFixed(2), ...FINAL_ENC, opts.outAbs);
  await run(FFMPEG, args);
  return { totalDur, transitions };
}

// ============================================================================
// Ghép kiểu MEMORIES: cut đúng nhịp là mặc định, hiệu ứng là dấu câu.
//
// MÔ HÌNH THỜI GIAN (đúng số đo của nguồn — "cut và counter-slide BẮT ĐẦU đúng trên nhịp,
// chạy tràn qua ranh giới"): ranh giới giữa cảnh i và i+1 nằm CHÍNH XÁC tại Σd (bội nhịp).
// Mối nối có hiệu ứng chiếm [ranh_giới, ranh_giới + D] — tức ăn vào ĐẦU cảnh sau, còn cảnh
// trước phải được render DƯ đúng D giây (pipeline lo, xem extraTail bên dưới).
// → totalDur = Σ durationS khai báo, mọi ranh giới đều trên lưới nhịp.
//
//   cut         → concat filter (không chồng lấn)
//   fade        → xfade fade (dissolve — nguồn dùng ngay sau title card)
//   fadewhite   → xfade fadewhite (bloom trắng — đổi ảnh tại đỉnh trắng)
//   hblur       → xfade hblur (whip-blur)
//   counterslide→ TỰ DỰNG (xfade không có): 2 dải ngang trượt ngược chiều, khe đen ~0.39%H,
//                 easing easeOutCubic (xấp xỉ bezier(.24,.38,.15,.90) đo được, RMSE 0.03)
// ============================================================================

/** Cảnh đứng TRƯỚC mối nối có hiệu ứng phải render dư đúng phần chồng lấn này */
export function extraTailFor(joinAfter: Join | undefined): number {
  return joinAfter && joinAfter.type !== 'cut' ? joinAfter.dur : 0;
}

/** Tiếng nói trong clip gốc, đặt đúng vị trí timeline — nhạc sẽ tự nhỏ xuống dưới nó */
export type VoiceTrack = { file: string; startS: number };

/**
 * Tiếng gốc của clip chỉ còn 20% âm lượng.
 *
 * Ở mức 100% nó át hẳn nhạc: clip điện thoại quay ngoài trời phần lớn là gió và
 * tiếng đám đông, to hơn nhiều so với một bản nhạc nền. 20% đủ để nghe ra
 * "đây là tiếng thật của khoảnh khắc" mà không giành chỗ của nhạc — và nhạc vẫn
 * cúi xuống dưới nó nhờ sidechaincompress, nên câu nói vẫn nổi lên.
 */
const CLIP_AUDIO_GAIN = 0.2;

async function concatMemories(opts: {
  /** durationS = thời lượng TRÊN TIMELINE (đã quantize nhịp); file thật dài hơn extraTailFor(join sau) */
  segs: { file: string; durationS: number }[];
  joins: Join[];
  musicPath: string | null;
  outAbs: string;
  W: number;
  H: number;
  voiceTracks?: VoiceTrack[];
}): Promise<{ totalDur: number; transitions: string[] }> {
  const { segs, joins, W, H } = opts;
  const parts: string[] = [];
  const transitions: string[] = [];
  // setsar=1 BẮT BUỘC: filter `concat` đòi SAR khớp tuyệt đối giữa các nhánh — segment cắt từ
  // video gốc có thể mang SAR lẻ kiểu 4907:4906 (scale giữ tỉ lệ), còn color source là 1:1.
  // setpts=PTS-STARTPTS: input được đưa vào với -itsoffset = mốc timeline của đoạn
  // (xem phần args bên dưới) nên phải kéo về 0 trước khi vào xfade/concat.
  segs.forEach((_, i) =>
    parts.push(
      `[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},settb=AVTB,setsar=1,format=yuv420p[s${i}]`,
    ),
  );

  let uid = 0;
  const lbl = (p: string) => `[${p}${uid++}]`;

  // Đầu ra của `concat` KHÔNG mang frame rate (1/0). ffmpeg 6.1 (bản Windows của
  // ffmpeg-static) bỏ qua, nhưng ffmpeg 7.0 (bản Linux cùng gói — Render) từ chối
  // ngay khi chuỗi đó đi vào `xfade`: "The inputs needs to be a constant frame
  // rate; current rate of 1/0 is invalid" → cả video 0 frame (sự cố 2026-09-17).
  // Gắn lại CFR sau mỗi concat; với nguồn đã 30fps thì đây là no-op về nội dung.
  const CFR = `,fps=${FPS},settb=AVTB`;

  // Bất biến: chuỗi `prev` dài đúng T + extra(join sắp tới); T = ranh giới timeline hiện tại.
  let prev = '[s0]';
  let T = segs[0].durationS;
  // Mốc timeline mà đoạn i bắt đầu được dùng — cho -itsoffset bên dưới.
  const starts: number[] = [0];
  for (let i = 1; i < segs.length; i++) {
    const j = joins[i - 1];
    const d = segs[i].durationS;
    starts.push(T);
    if (j.type === 'cut') {
      const outL = lbl('c');
      parts.push(`${prev}[s${i}]concat=n=2:v=1:a=0${CFR}${outL}`);
      prev = outL;
    } else if (j.type === 'counterslide') {
      const D = j.dur;
      const dir = j.dir ?? 1;
      // Hiệu ứng chiếm [T, T+D]: đuôi dư của chuỗi cũ + đầu cảnh mới cùng trượt
      const [pa, pb, na, nb] = [lbl('p'), lbl('p'), lbl('n'), lbl('n')];
      const [Lmain, Ltail, Rhead, Rmain] = [
        lbl('lm'),
        lbl('lt'),
        lbl('rh'),
        lbl('rm'),
      ];
      parts.push(`${prev}split${pa}${pb}`);
      parts.push(`${pa}trim=end=${T.toFixed(3)},setpts=PTS-STARTPTS${Lmain}`);
      parts.push(`${pb}trim=start=${T.toFixed(3)},setpts=PTS-STARTPTS${Ltail}`);
      parts.push(`[s${i}]split${na}${nb}`);
      parts.push(`${na}trim=end=${D.toFixed(3)},setpts=PTS-STARTPTS${Rhead}`);
      parts.push(`${nb}trim=start=${D.toFixed(3)},setpts=PTS-STARTPTS${Rmain}`);
      const Tclip = counterSlideGraph(parts, Ltail, Rhead, D, dir, W, H, lbl);
      const [half, outL] = [lbl('cs'), lbl('cs')];
      parts.push(`${Lmain}${Tclip}concat=n=2:v=1:a=0${half}`);
      parts.push(`${half}${Rmain}concat=n=2:v=1:a=0${CFR}${outL}`);
      prev = outL;
      transitions.push(`counterslide(${dir > 0 ? 'phải' : 'trái'})`);
      T += d;
      continue;
    } else {
      // fade / fadewhite / hblur — xfade bắt đầu ĐÚNG tại ranh giới nhịp T
      const outL = lbl('x');
      parts.push(
        `${prev}[s${i}]xfade=transition=${j.type}:duration=${j.dur}:offset=${T.toFixed(3)}${outL}`,
      );
      prev = outL;
    }
    transitions.push(j.type === 'cut' ? 'cut' : j.type);
    T += d;
  }
  const totalDur = Math.round(T * 1000) / 1000;
  parts.push(
    `${prev}fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, totalDur - 0.8).toFixed(2)}:d=0.8[v]`,
  );

  // RAM của bước ghép (đo 2026-09-17, ffmpeg 7.0.2 Linux, video 6 đoạn 1080x1920):
  // mặc định 1.8GB → Render 2GB OOM-kill ngay ở stage 'music'. Nguyên nhân không
  // phải hiệu ứng: ffmpeg đọc và giải mã CẢ 6 đoạn song song từ giây 0 (pts đều
  // bắt đầu ở 0 nên đoạn nào cũng "cũ nhất"), frame của đoạn chưa tới lượt nằm
  // chờ trong graph — ép luồng chỉ làm encode chậm hơn và hàng đợi dài hơn (2.1GB).
  //   · -itsoffset = mốc timeline thật của đoạn → scheduler chỉ kéo đoạn i khi
  //     timeline chạm tới nó (setpts=PTS-STARTPTS ở đầu chuỗi kéo pts về 0 lại).
  //   · -threads 1 cho decoder: mỗi decoder h264 đa luồng giữ ~60MB frame pool,
  //     6 đoạn = ~370MB; giải mã 1 luồng vẫn nhanh hơn encode nhiều lần.
  // Cùng graph: 1.8GB → 1.3GB với mốc xấp xỉ; mốc chính xác bên dưới.
  const args = ['-y'];
  segs.forEach((s, i) => {
    if (starts[i] > 0) args.push('-itsoffset', starts[i].toFixed(3));
    args.push('-threads', '1', '-i', s.file);
  });

  // ---------- audio ----------
  // Thiết kế màn 29: "The music fades under the voices in your clips." — tiếng nói trong
  // clip gốc GIỮ NGUYÊN, đặt đúng chỗ trên timeline (adelay), nhạc bị nén xuống bằng
  // sidechaincompress mỗi khi có tiếng nói, rồi trộn lại (amix normalize=0 để không tự chia âm lượng).
  const voices = opts.voiceTracks ?? [];
  const musicIdx = opts.musicPath ? segs.length : -1;
  const firstVoiceIdx = segs.length + (opts.musicPath ? 1 : 0);

  const audioParts: string[] = [];
  let audioOut: string | null = null;
  if (voices.length) {
    voices.forEach((v, k) => {
      const delayMs = Math.max(0, Math.round(v.startS * 1000));
      audioParts.push(
        `[${firstVoiceIdx + k}:a]aresample=44100,volume=${CLIP_AUDIO_GAIN},adelay=${delayMs}|${delayMs},apad[vc${k}]`,
      );
    });
    const vAll = voices.map((_, k) => `[vc${k}]`).join('');
    audioParts.push(
      voices.length > 1
        ? `${vAll}amix=inputs=${voices.length}:normalize=0[voice]`
        : `${vAll}anull[voice]`,
    );
    if (opts.musicPath) {
      audioParts.push(`[voice]asplit[voiceMix][voiceKey]`);
      audioParts.push(
        `[${musicIdx}:a]aresample=44100,volume=1.0,afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, totalDur - 2.5).toFixed(2)}:d=2.5[mus]`,
      );
      // Nhạc cúi xuống dưới tiếng nói: threshold thấp + ratio mạnh + release dài
      // cho tự nhiên. Ngưỡng phải theo mức tiếng clip ĐÃ GIẢM (0.2), nếu giữ
      // 0.03 như khi tiếng còn 100% thì gần như không bao giờ chạm ngưỡng nữa.
      audioParts.push(
        `[mus][voiceKey]sidechaincompress=threshold=${(0.03 * CLIP_AUDIO_GAIN).toFixed(4)}:ratio=12:attack=80:release=600[duck]`,
      );
      audioParts.push(`[duck][voiceMix]amix=inputs=2:normalize=0[aout]`);
    } else {
      audioParts.push(`[voice]anull[aout]`);
    }
    audioOut = '[aout]';
  } else if (opts.musicPath) {
    audioParts.push(
      `[${musicIdx}:a]volume=1.0,afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, totalDur - 2.5).toFixed(2)}:d=2.5[aout]`,
    );
    audioOut = '[aout]';
  }

  if (opts.musicPath) args.push('-stream_loop', '-1', '-i', opts.musicPath);
  for (const v of voices) args.push('-i', v.file);
  args.push(
    '-filter_complex_threads',
    '2',
    '-filter_complex',
    [...parts, ...audioParts].join(';'),
    '-map',
    '[v]',
  );
  if (audioOut) {
    args.push('-map', audioOut, '-c:a', 'aac', '-b:a', '128k');
  }
  args.push('-t', totalDur.toFixed(2), ...FINAL_ENC, opts.outAbs);
  await run(FFMPEG, args);
  return { totalDur, transitions };
}

/**
 * Dựng clip chuyển cảnh counter-slide dài D giây từ 2 nguồn cùng độ dài D:
 * dải TRÊN nhận ảnh mới từ hướng `dir` (1 = phải), dải DƯỚI ngược lại — hai mép gặp nhau
 * ở giữa khung tại cùng khoảnh khắc (đối xứng tuyệt đối, như Bảng 2 của bản bóc tách:
 * hai mép cùng chạm 356px ở frame giữa). Khe đen giữa 2 dải ~0.39%H, đen tuyệt đối,
 * không viền không shadow ("mọi thứ thêm cho đẹp ở đây đều làm hỏng").
 * Trả về label của clip; các dòng filter được push thẳng vào `parts`.
 */
function counterSlideGraph(
  parts: string[],
  Ltail: string,
  Rhead: string,
  D: number,
  dir: 1 | -1,
  W: number,
  H: number,
  lbl: (p: string) => string,
): string {
  // Chiều cao dải chẵn (yuv420); khe = phần còn lại ở giữa (≈0.39%H, tối thiểu 4px)
  const G = Math.max(4, Math.round((H * 0.0039) / 2) * 2);
  const bandH = Math.floor((H - G) / 4) * 2;
  const botY = H - bandH;
  const Ds = D.toFixed(3);
  // e(t) = easeOutCubic — xấp xỉ tốt của bezier(.24,.38,.15,.90) đo được (RMSE 0.030):
  // nửa quãng đường đi xong trong ~22% thời lượng, đuôi rất dài.
  const e = `(1-pow(1-min(t/${Ds},1),3))`;
  // Dải trên: ảnh cũ trượt ra phía NGƯỢC dir, ảnh mới vào TỪ phía dir; dải dưới đảo dấu.
  const xOldTop = dir > 0 ? `-${W}*${e}` : `${W}*${e}`;
  const xNewTop = dir > 0 ? `${W}*(1-${e})` : `-${W}*(1-${e})`;
  const xOldBot = dir > 0 ? `${W}*${e}` : `-${W}*${e}`;
  const xNewBot = dir > 0 ? `-${W}*(1-${e})` : `${W}*(1-${e})`;

  const [lt1, lt2, rh1, rh2] = [lbl('a'), lbl('a'), lbl('a'), lbl('a')];
  parts.push(`${Ltail}split${lt1}${lt2}`);
  parts.push(`${Rhead}split${rh1}${rh2}`);
  const [to, ti, bo, bi] = [lbl('b'), lbl('b'), lbl('b'), lbl('b')];
  parts.push(`${lt1}crop=${W}:${bandH}:0:0${to}`);
  parts.push(`${rh1}crop=${W}:${bandH}:0:0${ti}`);
  parts.push(`${lt2}crop=${W}:${bandH}:0:${botY}${bo}`);
  parts.push(`${rh2}crop=${W}:${bandH}:0:${botY}${bi}`);
  const base = lbl('bg');
  parts.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${Ds}${base}`);
  const [o1, o2, o3, o4] = [lbl('o'), lbl('o'), lbl('o'), lbl('o')];
  parts.push(`${base}${to}overlay=x='${xOldTop}':y=0:eval=frame${o1}`);
  parts.push(`${o1}${ti}overlay=x='${xNewTop}':y=0:eval=frame${o2}`);
  parts.push(`${o2}${bo}overlay=x='${xOldBot}':y=${botY}:eval=frame${o3}`);
  parts.push(`${o3}${bi}overlay=x='${xNewBot}':y=${botY}:eval=frame${o4}`);
  const T = lbl('T');
  parts.push(`${o4}fps=${FPS},settb=AVTB,setsar=1,format=yuv420p${T}`);
  return T;
}
