// ===== Thư viện nhạc nền (BGM) — tự tổng hợp, 0 token, 0 vấn đề bản quyền =====
// Giai điệu PHỔ BIẾN thuộc PUBLIC DOMAIN (Happy Birthday, Canon in D, Twinkle Twinkle, Für Elise)
// + 2 track pad nhẹ. Synthesizer viết bằng Node: sine + bồi âm + envelope pluck → WAV → ffmpeg encode m4a.
// User NGHE THỬ trước khi ghép vào video (GET /api/music/:id).

import fs from 'fs';
import path from 'path';
import { FFMPEG, run } from './exec';

const SR = 44100;
const MUSIC_DIR = () => path.join(process.cwd(), 'uploads', 'music');

export type MusicTrack = {
  id: string;
  name: string;
  emoji: string;
  desc: string;
};

// 6 track tổng hợp tại chỗ — fallback khi chưa chạy `node scripts/fetch-music.mjs`
export const SYNTH_LIBRARY: MusicTrack[] = [
  {
    id: 'happy_birthday',
    name: 'Happy Birthday',
    emoji: '🎂',
    desc: 'Giai điệu sinh nhật kinh điển (public domain)',
  },
  {
    id: 'canon',
    name: 'Canon in D',
    emoji: '🎼',
    desc: 'Pachelbel — ấm áp, trang trọng (public domain)',
  },
  {
    id: 'twinkle',
    name: 'Twinkle Twinkle',
    emoji: '✨',
    desc: 'Nhẹ nhàng, trong trẻo (public domain)',
  },
  {
    id: 'fur_elise',
    name: 'Für Elise',
    emoji: '🌙',
    desc: 'Beethoven — dịu dàng, hoài niệm (public domain)',
  },
  {
    id: 'am_ap',
    name: 'Pad Ấm áp',
    emoji: '🎵',
    desc: 'Hợp âm nền êm, không giai điệu',
  },
  {
    id: 'trong_treo',
    name: 'Pad Trong trẻo',
    emoji: '🎵',
    desc: 'Hợp âm nền sáng, không giai điệu',
  },
];

// ===== Thư viện nhạc THẬT tải từ nguồn free (assets/music, xem scripts/fetch-music.mjs) =====
// Nhạc Nhật (甘茶の音楽工房) + giai điệu nổi tiếng (Wikimedia Commons), chia theo chủ đề dịp kỷ niệm.

export type ExternalTrack = {
  id: string;
  theme: string;
  title: string;
  lang: 'ja' | 'intl';
  instrumental: boolean;
  artist: string;
  license: string;
  attribution: string | null;
  source_url: string;
  file: string;
  duration_s: number;
  /** đo offline 1 lần bằng scripts/analyze-bpm.mjs; null/thiếu = không tự tin → không quantize nhịp */
  bpm?: number | null;
  bpm_conf?: number;
};
export type MusicTheme = {
  id: string;
  emoji: string;
  name: string;
  name_ja: string;
  occasion_keys: string[];
};
type LibraryFile = {
  generated_at: string;
  themes: MusicTheme[];
  tracks: ExternalTrack[];
};

// Thư mục chứa library.json + file nhạc. Mặc định là apps/api/assets/music tính
// từ __dirname (KHÔNG từ cwd — trên Render startCommand chạy từ gốc repo).
// MUSIC_ASSETS_DIR ghi đè: VideoService đặt nó khi tải thư viện từ R2 về đĩa
// tạm lúc khởi động (nhạc Amacha không được phép commit vào repo public — điều
// khoản cấm 2次配布 — nên nằm trong bucket riêng, xem docs/04-devops/deploy.md).
const ASSETS_MUSIC = () =>
  process.env.MUSIC_ASSETS_DIR ??
  path.resolve(__dirname, '..', '..', '..', 'assets', 'music');
let _lib: LibraryFile | null | undefined;

/** Gọi sau khi thư viện trên đĩa thay đổi (tải xong từ R2) để đọc lại library.json */
export function reloadExternalLibrary(): void {
  _lib = undefined;
}

export function externalLibrary(): LibraryFile | null {
  if (_lib !== undefined) return _lib;
  try {
    const p = path.join(ASSETS_MUSIC(), 'library.json');
    _lib = fs.existsSync(p)
      ? (JSON.parse(fs.readFileSync(p, 'utf8')) as LibraryFile)
      : null;
  } catch {
    _lib = null;
  }
  return _lib;
}

export function findExternalTrack(id: string): ExternalTrack | null {
  const lib = externalLibrary();
  if (!lib) return null;
  const t = lib.tracks.find((x) => x.id === id);
  return t && fs.existsSync(path.join(ASSETS_MUSIC(), t.file)) ? t : null;
}

export function isLibraryTrack(id: string): boolean {
  return SYNTH_LIBRARY.some((t) => t.id === id) || !!findExternalTrack(id);
}

// BPM của track synth: chính là tham số bpm trong trackData/padData bên dưới — biết chắc 100%.
const SYNTH_BPM: Record<string, number> = {
  happy_birthday: 116,
  canon: 58,
  twinkle: 100,
  fur_elise: 76,
  am_ap: 60,
  trong_treo: 60,
};

/**
 * BPM của track nhạc — để thân video kiểu Memories quantize thời lượng cảnh theo LƯỚI NHỊP
 * ("nếu bạn chỉ làm được một việc, hãy làm việc này"). Trả null khi không biết chắc
 * (nhạc upload, 'khong_nhac', track chưa đo, độ tin cậy thấp) → pipeline giữ nguyên thời lượng.
 */
export function trackBpm(musicId: string): number | null {
  if (SYNTH_BPM[musicId]) return SYNTH_BPM[musicId];
  const ext = findExternalTrack(musicId);
  const bpm = ext?.bpm;
  return typeof bpm === 'number' && bpm >= 50 && bpm <= 200
    ? Math.round(bpm)
    : null;
}

// Thư viện cho UI: gom theo chủ đề (external) + nhóm "tổng hợp tại chỗ" (synth).
// `bpm` đi kèm để UI ước lượng thời lượng bằng ĐÚNG lưới nhịp server dùng khi render.
export function musicCatalog(): {
  themes: (MusicTheme & {
    tracks: {
      id: string;
      title: string;
      lang: string;
      duration_s: number;
      attribution: string | null;
      license: string;
      source_url: string;
      bpm: number | null;
    }[];
  })[];
} {
  const lib = externalLibrary();
  const themes: ReturnType<typeof musicCatalog>['themes'] = [];
  if (lib) {
    for (const th of lib.themes) {
      const tracks = lib.tracks
        .filter(
          (t) =>
            t.theme === th.id &&
            fs.existsSync(path.join(ASSETS_MUSIC(), t.file)),
        )
        .map((t) => ({
          id: t.id,
          title: t.title,
          lang: t.lang,
          duration_s: t.duration_s,
          attribution: t.attribution,
          license: t.license,
          source_url: t.source_url,
          bpm: trackBpm(t.id),
        }));
      if (tracks.length) themes.push({ ...th, tracks });
    }
  }
  themes.push({
    id: 'synth',
    emoji: '🎹',
    name: 'Tổng hợp tại chỗ (không cần tải)',
    name_ja: '内蔵音源',
    occasion_keys: [],
    tracks: SYNTH_LIBRARY.map((t) => ({
      id: t.id,
      title: `${t.emoji} ${t.name}`,
      lang: 'synth',
      duration_s: 75,
      attribution: null,
      license: 'Public domain (tự tổng hợp)',
      source_url: '',
      bpm: trackBpm(t.id),
    })),
  });
  return { themes };
}

// ---- Nốt nhạc ----
const NOTE_BASE: Record<string, number> = {
  C: -9,
  'C#': -8,
  Db: -8,
  D: -7,
  'D#': -6,
  Eb: -6,
  E: -5,
  F: -4,
  'F#': -3,
  Gb: -3,
  G: -2,
  'G#': -1,
  Ab: -1,
  A: 0,
  'A#': 1,
  Bb: 1,
  B: 2,
};
function freq(note: string): number {
  // 'A4' = 440; 'R' = nghỉ
  const m = note.match(/^([A-G][b#]?)(\d)$/);
  if (!m) return 0;
  const semitone = NOTE_BASE[m[1]] + (parseInt(m[2], 10) - 4) * 12;
  return 440 * Math.pow(2, semitone / 12);
}

type Ev = [string, number]; // [nốt hoặc 'R', số phách]

// Tổng hợp 1 dòng nhạc (melody hoặc bass) thành mảng sample
function synthLine(
  events: Ev[],
  bpm: number,
  opts: {
    gain: number;
    pluck: number;
    harm2: number;
    harm3: number;
    vibrato?: boolean;
  },
): Float64Array {
  const spb = (60 / bpm) * SR; // samples per beat
  const total = Math.ceil(events.reduce((a, [, b]) => a + b, 0) * spb);
  const out = new Float64Array(total);
  let pos = 0;
  for (const [note, beats] of events) {
    const len = Math.round(beats * spb);
    const f = note === 'R' ? 0 : freq(note);
    if (f > 0) {
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const env =
          Math.min(1, i / (0.012 * SR)) * Math.exp((-opts.pluck * i) / len); // attack + decay theo độ dài nốt
        const vib = opts.vibrato
          ? 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t)
          : 1;
        const w =
          Math.sin(2 * Math.PI * f * vib * t) +
          opts.harm2 * Math.sin(2 * Math.PI * 2 * f * t) +
          opts.harm3 * Math.sin(2 * Math.PI * 3 * f * t);
        out[pos + i] += opts.gain * env * w;
      }
    }
    pos += len;
  }
  return out;
}

function mixLoop(lines: Float64Array[], targetSec: number): Int16Array {
  const loopLen = Math.max(...lines.map((l) => l.length));
  const mixed = new Float64Array(loopLen);
  for (const l of lines) for (let i = 0; i < l.length; i++) mixed[i] += l[i];
  // normalize về đỉnh 0.88 cho nhạc NỔI BẬT rõ ràng
  let peak = 0;
  for (let i = 0; i < loopLen; i++) peak = Math.max(peak, Math.abs(mixed[i]));
  const k = peak > 0 ? 0.88 / peak : 1;
  const totalLen = Math.ceil(targetSec * SR);
  const pcm = new Int16Array(totalLen);
  for (let i = 0; i < totalLen; i++) {
    const v = mixed[i % loopLen] * k;
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return pcm;
}

function writeWav(file: string, pcm: Int16Array) {
  const dataSize = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  fs.writeFileSync(file, buf);
}

// ---- Bản phối từng track (giai điệu public domain, phối đơn giản) ----
function trackData(
  id: string,
): { melody: Ev[]; bass: Ev[]; bpm: number; vibrato?: boolean } | null {
  switch (id) {
    case 'happy_birthday':
      return {
        bpm: 116,
        melody: [
          ['C4', 0.75],
          ['C4', 0.25],
          ['D4', 1],
          ['C4', 1],
          ['F4', 1],
          ['E4', 2],
          ['C4', 0.75],
          ['C4', 0.25],
          ['D4', 1],
          ['C4', 1],
          ['G4', 1],
          ['F4', 2],
          ['C4', 0.75],
          ['C4', 0.25],
          ['C5', 1],
          ['A4', 1],
          ['F4', 1],
          ['E4', 1],
          ['D4', 1.5],
          ['R', 0.5],
          ['Bb4', 0.75],
          ['Bb4', 0.25],
          ['A4', 1],
          ['F4', 1],
          ['G4', 1],
          ['F4', 2],
          ['R', 1],
        ],
        bass: [
          ['F2', 3],
          ['C3', 3],
          ['C3', 3],
          ['F2', 3],
          ['F2', 3],
          ['Bb2', 2],
          ['R', 1],
          ['Bb2', 2],
          ['C3', 2],
          ['F2', 2],
          ['R', 1],
        ],
      };
    case 'canon':
      return {
        bpm: 58,
        vibrato: true,
        melody: [
          ['F#5', 2],
          ['E5', 2],
          ['D5', 2],
          ['C#5', 2],
          ['B4', 2],
          ['A4', 2],
          ['B4', 2],
          ['C#5', 2],
          ['D5', 2],
          ['C#5', 2],
          ['B4', 2],
          ['A4', 2],
          ['G4', 2],
          ['F#4', 2],
          ['G4', 2],
          ['E4', 2],
        ],
        bass: [
          ['D3', 2],
          ['A2', 2],
          ['B2', 2],
          ['F#2', 2],
          ['G2', 2],
          ['D2', 2],
          ['G2', 2],
          ['A2', 2],
          ['D3', 2],
          ['A2', 2],
          ['B2', 2],
          ['F#2', 2],
          ['G2', 2],
          ['D2', 2],
          ['G2', 2],
          ['A2', 2],
        ],
      };
    case 'twinkle':
      return {
        bpm: 100,
        melody: [
          ['C4', 1],
          ['C4', 1],
          ['G4', 1],
          ['G4', 1],
          ['A4', 1],
          ['A4', 1],
          ['G4', 2],
          ['F4', 1],
          ['F4', 1],
          ['E4', 1],
          ['E4', 1],
          ['D4', 1],
          ['D4', 1],
          ['C4', 2],
          ['G4', 1],
          ['G4', 1],
          ['F4', 1],
          ['F4', 1],
          ['E4', 1],
          ['E4', 1],
          ['D4', 2],
          ['G4', 1],
          ['G4', 1],
          ['F4', 1],
          ['F4', 1],
          ['E4', 1],
          ['E4', 1],
          ['D4', 2],
        ],
        bass: [
          ['C3', 2],
          ['E3', 2],
          ['F3', 2],
          ['C3', 2],
          ['F3', 2],
          ['C3', 2],
          ['G2', 2],
          ['C3', 2],
          ['C3', 2],
          ['D3', 2],
          ['C3', 2],
          ['G2', 2],
          ['C3', 2],
          ['D3', 2],
          ['C3', 2],
          ['G2', 2],
        ],
      };
    case 'fur_elise':
      return {
        bpm: 76,
        vibrato: true,
        melody: [
          ['E5', 0.5],
          ['D#5', 0.5],
          ['E5', 0.5],
          ['D#5', 0.5],
          ['E5', 0.5],
          ['B4', 0.5],
          ['D5', 0.5],
          ['C5', 0.5],
          ['A4', 1.5],
          ['R', 0.5],
          ['C4', 0.5],
          ['E4', 0.5],
          ['A4', 0.5],
          ['B4', 1.5],
          ['R', 0.5],
          ['E4', 0.5],
          ['G#4', 0.5],
          ['B4', 0.5],
          ['C5', 1.5],
          ['R', 0.5],
          ['E4', 0.5],
          ['E5', 0.5],
          ['D#5', 0.5],
          ['E5', 0.5],
          ['D#5', 0.5],
          ['E5', 0.5],
          ['B4', 0.5],
          ['D5', 0.5],
          ['C5', 0.5],
          ['A4', 2],
        ],
        bass: [
          ['R', 4],
          ['A2', 1],
          ['E3', 1],
          ['A3', 1.5],
          ['R', 0.5],
          ['E2', 1],
          ['E3', 1],
          ['G#3', 1.5],
          ['R', 0.5],
          ['A2', 1],
          ['E3', 1],
          ['A3', 1],
          ['R', 4.5],
        ],
      };
    default:
      return null;
  }
}

// Pad hợp âm (không giai điệu) — 4 hợp âm × 4 phách
function padData(id: 'am_ap' | 'trong_treo'): {
  melody: Ev[];
  bass: Ev[];
  bpm: number;
} {
  const oct = id === 'am_ap' ? 3 : 4;
  return {
    bpm: 60,
    melody: [
      [`E${oct}`, 4],
      [`C${oct}`, 4],
      [`A${oct - 1}`, 4],
      [`B${oct - 1}`, 4],
    ],
    bass: [
      [`C${oct - 1}`, 4],
      [`A${oct - 2}`, 4],
      [`F${oct - 2}`, 4],
      [`G${oct - 2}`, 4],
    ],
  };
}

export async function ensureTrack(id: string): Promise<string> {
  fs.mkdirSync(MUSIC_DIR(), { recursive: true });
  const out = path.join(MUSIC_DIR(), `${id}.m4a`);
  if (fs.existsSync(out)) return out;

  // Track tải sẵn trong assets/music → copy sang uploads để phục vụ nghe thử/render
  const ext = findExternalTrack(id);
  if (ext) {
    fs.copyFileSync(path.join(ASSETS_MUSIC(), ext.file), out);
    return out;
  }

  const data =
    trackData(id) ??
    (id === 'am_ap' || id === 'trong_treo' ? padData(id) : null);
  if (!data) throw new Error(`Không có track "${id}" trong thư viện`);

  const isPad = id === 'am_ap' || id === 'trong_treo';
  const melody = synthLine(data.melody, data.bpm, {
    gain: isPad ? 0.4 : 0.62,
    pluck: isPad ? 0.8 : 2.6,
    harm2: 0.35,
    harm3: 0.12,
    vibrato: (data as { vibrato?: boolean }).vibrato,
  });
  const bass = synthLine(data.bass, data.bpm, {
    gain: isPad ? 0.35 : 0.3,
    pluck: isPad ? 0.6 : 1.6,
    harm2: 0.2,
    harm3: 0,
  });

  const wav = path.join(MUSIC_DIR(), `${id}.wav`);
  writeWav(wav, mixLoop([melody, bass], 75)); // 75s, loop giai điệu
  await run(FFMPEG, [
    '-y',
    '-i',
    wav,
    '-af',
    'aecho=0.7:0.6:60:0.25,volume=0.95',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    out,
  ]);
  try {
    fs.unlinkSync(wav);
  } catch {
    // File WAV trung gian còn lại chỉ là rác trong tmp — không đáng làm hỏng track.
  }
  return out;
}
