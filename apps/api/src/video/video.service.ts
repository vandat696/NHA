import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { PrismaService } from '../database/prisma/prisma.service';
import type { Readable } from 'node:stream';
import { type MediaBorrow, StorageService } from '../storage/storage.service';
import {
  AiClientService,
  type StoryboardResult,
} from '../ai/ai-client.service';
import { AiContextService } from '../ai/ai-context.service';
import type { CreateVideoJobDto, StoryboardRequestDto } from './dto/video.dto';
import { FFMPEG, probeMedia, run } from './engine/exec';
import {
  concatWithTransitions,
  DEFAULT_PALETTE,
  ensureDirs,
  extraTailFor,
  loadFonts,
  renderCard,
  renderKenBurns,
  renderVideoClip,
} from './engine/videogen';
import { isIntroEnabled, renderIntro, renderOutro } from './engine/introgen';
import {
  CARD_SEC,
  introSecondsFor,
  outroSecondsFor,
} from './engine/cardTiming';
import {
  assignEffects,
  bodyTiming,
  JOIN_DUR,
  planBodyJoins,
  quantizeUpToBeat,
  quickSceneSec,
  seedFromIds,
  type Join,
} from './engine/videoTiming';
import {
  ensureTrack,
  isLibraryTrack,
  musicCatalog,
  reloadExternalLibrary,
  trackBpm,
} from './engine/musiclib';
import type { Aspect, IntroTemplateId, Palette, Scene } from './engine/types';

/**
 * Video kỷ niệm (màn 27-33) — orchestration quanh engine port từ demo onemoretime
 * (đã kiểm chứng bằng 92 smoke checks bên demo):
 *   storyboard (FastAPI, mock được) → user sửa ở màn 31 → VideoJob async →
 *   render memories engine (cut đúng nhịp + counter-slide/bloom/whip) → share về timeline.
 * Render là media-processing 0 token nên nằm ở NestJS (FastAPI chỉ lo call AI provider).
 */

type PlanJson = {
  title: string;
  subtitle: string;
  opening: string;
  closing: string;
  dedication: string;
  palette: Record<string, string>;
  scenes: {
    mediaId: string;
    kind: 'image' | 'video';
    durationS: number;
    caption: string;
    reason?: string;
    /** Giữ tiếng gốc của clip (mặc định giữ) — nút loa từng cảnh ở màn 31 */
    keepAudio?: boolean;
  }[];
};

type OptionsJson = {
  targetSec: number;
  mood: string;
  aspect: Aspect;
  style: IntroTemplateId;
  musicId: string;
  locale: string;
};

export interface VideoJobView {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  mode: string;
  title: string | null;
  progress: number;
  stage: string | null;
  duration_s: number | null;
  error: string | null;
  created_at: string;
  has_file: boolean;
  /** Video làm VỀ ai — composer dùng để tag sẵn người đó khi share. */
  about_member_id: string | null;
  plan: PlanJson | null;
  options: OptionsJson | null;
}

/**
 * Bao nhiêu video được dựng CÙNG LÚC trên máy này.
 *
 * Một lượt render đã tự chạy 5 ffmpeg song song (xem pool trong `renderWorker`),
 * nên hai lượt là 10 process trên 16 luồng — vừa đủ. Người thứ ba bấm "tạo" mà
 * cũng được chạy ngay thì 15 process giành nhau, và cái mất mát không chỉ là
 * video của họ chậm: API còn phải trả ảnh và bài đăng cho những người đang chỉ
 * xem, nên cả nhà thấy app đứng.
 *
 * Xếp hàng dễ chịu hơn thế: video vào hàng chậm hơn ít phút, còn app vẫn nhẹ.
 */
const MAX_CONCURRENT_RENDERS = Math.max(
  1,
  Number(process.env.VIDEO_MAX_CONCURRENT_RENDERS ?? 2) || 2,
);

/** `stage` của một job đang đợi tới lượt — app hiện "đang chờ" thay vì 0% đứng im. */
const STAGE_QUEUED = 'queued';

/**
 * Thư viện nhạc thật nằm trên R2 dưới prefix này (đẩy lên bằng
 * scripts/upload-music-library.mjs). Nhạc 甘茶の音楽工房 cho dùng thương mại
 * không cần ghi công nhưng cấm 2次配布, nên KHÔNG commit vào repo public; Render
 * lại không có đĩa bền → tải về đĩa tạm mỗi lần khởi động (~40MB, vài giây).
 */
const MUSIC_LIBRARY_PREFIX = 'music-library/';

@Injectable()
export class VideoService implements OnModuleInit {
  private readonly logger = new Logger(VideoService.name);

  /**
   * Hàng đợi nằm trong tiến trình, không nằm trong DB — cùng một lựa chọn với
   * bản thân worker render (fire-and-forget, mất khi restart). Khi nào tách
   * render sang tiến trình riêng thì cả hai chuyển sang hàng đợi bền một lượt.
   */
  private rendering = 0;
  private readonly waiting: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiClientService,
    private readonly context: AiContextService,
  ) {}

  onModuleInit(): void {
    // Không chờ: API lên ngay, catalog hiện thêm nhạc thật khi tải xong.
    void this.syncMusicLibrary().catch((err: unknown) =>
      this.logger.warn(`không tải được thư viện nhạc từ R2: ${String(err)}`),
    );
  }

  /**
   * Tải library.json + các file nhạc từ R2 về uploads/music-lib rồi trỏ
   * musiclib vào đó. Bỏ qua nếu bucket không có thư viện (máy dev dùng
   * assets/music cục bộ, hoặc chưa ai đẩy lên). File đã có đúng kích cỡ thì
   * không tải lại — restart giữa ngày không tốn băng thông.
   */
  private async syncMusicLibrary(): Promise<void> {
    const libKey = `${MUSIC_LIBRARY_PREFIX}library.json`;
    if (!(await this.storage.exists(libKey))) return;
    const dir = path.join(process.cwd(), 'uploads', 'music-lib');
    fs.mkdirSync(dir, { recursive: true });
    const lib = JSON.parse(
      (await this.storage.readAll(libKey)).toString('utf8'),
    ) as { tracks: { id: string; file: string }[] };
    let fetched = 0;
    for (const t of lib.tracks) {
      const key = `${MUSIC_LIBRARY_PREFIX}${t.file}`;
      const dest = path.join(dir, t.file);
      try {
        const want = await this.storage.sizeOf(key);
        if (fs.existsSync(dest) && fs.statSync(dest).size === want) continue;
        fs.writeFileSync(dest, await this.storage.readAll(key));
        fetched++;
      } catch (err) {
        this.logger.warn(`thư viện nhạc: bỏ qua ${t.file}: ${String(err)}`);
      }
    }
    fs.writeFileSync(
      path.join(dir, 'library.json'),
      JSON.stringify(lib, null, 2),
    );
    process.env.MUSIC_ASSETS_DIR = dir;
    reloadExternalLibrary();
    this.logger.log(
      `thư viện nhạc: ${lib.tracks.length} track sẵn sàng (${fetched} tải mới) từ R2`,
    );
  }

  musicLibrary(): ReturnType<typeof musicCatalog> {
    return musicCatalog();
  }

  /** Màn 29 — stream preview track THƯ VIỆN (synth/asset dựng sẵn, không phải dữ liệu người dùng) */
  async musicFileFor(trackId: string): Promise<{ path: string; size: number }> {
    if (!isLibraryTrack(trackId))
      throw new NotFoundException('Không có track này trong thư viện');
    const p = await ensureTrack(trackId);
    return { path: p, size: fs.statSync(p).size };
  }

  /** Màn 27→31: xin storyboard (sync) để user duyệt/sửa TRƯỚC khi tạo job — 1 call AI (mock được) */
  async storyboard(
    userId: string,
    familyId: string,
    dto: StoryboardRequestDto,
  ): Promise<StoryboardResult> {
    const bundle = await this.context.buildFor(userId, familyId, dto.memberId);
    const media = await this.loadMedia(userId, familyId, dto.mediaIds);
    return this.ai.videoStoryboard({
      member: bundle.context,
      title_hint: dto.storyRequest?.slice(0, 60) ?? null,
      kind_label: dto.kindLabel?.trim() || dto.kind || null,
      media: media.map((m) => ({
        media_id: m.id,
        kind: m.kind,
        caption: m.caption,
        taken_at: m.createdAt.toISOString(),
        duration_s: null,
      })),
      target_sec: dto.targetSec ?? 90,
      mood: dto.mood ?? 'warm',
      locale: dto.locale ?? 'ja',
    });
  }

  /** Tạo job (PENDING). mode 'quick' = server tự dựng plan tối giản (0 AI, không caption, không card). */
  async create(
    userId: string,
    familyId: string,
    dto: CreateVideoJobDto,
  ): Promise<VideoJobView> {
    await this.context.assertMembership(userId, familyId);
    const media = await this.loadMedia(userId, familyId, dto.mediaIds);
    const musicId = await this.resolveMusicId(userId, dto.musicId);
    // nhạc riêng ('media:...') không có beat grid — bodyTiming chấp nhận bpm null (cắt theo giây)
    const bpm = isLibraryTrack(musicId) ? trackBpm(musicId) : null;

    let plan: PlanJson;
    if (dto.mode === 'quick') {
      const base = quickSceneSec(bpm);
      plan = {
        title: '',
        subtitle: '',
        opening: '',
        closing: '',
        dedication: '',
        palette: { ...DEFAULT_PALETTE },
        scenes: media.map((m) => ({
          mediaId: m.id,
          kind: m.kind,
          durationS: base,
          caption: '',
        })),
      };
    } else {
      if (!dto.plan)
        throw new BadRequestException(
          'mode "ai" cần plan (storyboard đã duyệt ở màn Story & scenes)',
        );
      const byId = new Map(media.map((m) => [m.id, m] as const));
      const scenes = dto.plan.scenes
        .filter((s) => byId.has(s.mediaId))
        .map((s) => ({
          mediaId: s.mediaId,
          kind: byId.get(s.mediaId)!.kind,
          durationS: Math.min(10, Math.max(2, s.durationS)),
          caption: s.caption.trim(),
          reason: s.reason?.trim() || undefined,
          // Nút loa từng cảnh ở màn 31. Không mang theo thì lựa chọn của người
          // dùng biến mất giữa đường và mọi clip đều giữ tiếng.
          keepAudio: s.keepAudio,
        }));
      if (scenes.length === 0)
        throw new BadRequestException('Plan không còn cảnh hợp lệ');
      plan = {
        title: dto.plan.title.trim(),
        subtitle: dto.plan.subtitle?.trim() ?? '',
        opening: dto.plan.opening?.trim() ?? '',
        closing: dto.plan.closing?.trim() ?? '',
        dedication: dto.plan.dedication?.trim() ?? '',
        palette: this.safePalette(dto.plan.palette),
        scenes,
      };
    }

    const options: OptionsJson = {
      targetSec: dto.targetSec ?? 90,
      mood: dto.mood ?? 'warm',
      aspect: dto.aspect ?? 'portrait',
      style: dto.mode === 'quick' ? 'none' : this.safeStyle(dto.style),
      musicId,
      locale: 'ja',
    };

    const job = await this.prisma.videoJob.create({
      data: {
        requesterUserId: userId,
        familyId,
        aboutMemberId: dto.memberId ?? null,
        title: plan.title || null,
        mode: dto.mode,
        options: options,
        plan: plan,
        inputMediaIds: dto.mediaIds,
      },
    });
    return this.toView(job);
  }

  /** Bắt đầu render async — fire-and-forget; mobile poll GET /video-jobs/:id (màn 32) */
  async startRender(userId: string, jobId: string): Promise<{ ok: boolean }> {
    const job = await this.ownJob(userId, jobId);
    if (job.status === 'PROCESSING') return { ok: true };
    if (this.waiting.includes(jobId)) return { ok: true };

    if (this.rendering >= MAX_CONCURRENT_RENDERS) {
      this.waiting.push(jobId);
      await this.prisma.videoJob.update({
        where: { id: jobId },
        data: {
          status: 'PENDING',
          progress: 0,
          stage: STAGE_QUEUED,
          error: null,
        },
      });
      this.logger.log(
        `render ${jobId} vào hàng đợi (đang dựng ${this.rendering}, chờ ${this.waiting.length})`,
      );
      return { ok: true };
    }

    await this.launchRender(jobId);
    return { ok: true };
  }

  /** Chiếm một chỗ, dựng, rồi nhường chỗ cho người đang đợi. */
  private async launchRender(jobId: string): Promise<void> {
    this.rendering++;
    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: {
        status: 'PROCESSING',
        progress: 0,
        stage: 'opening',
        error: null,
      },
    });
    const media = this.storage.newBorrow();
    void this.renderWorker(jobId, media)
      .catch(async (err) => {
        this.logger.error(`render ${jobId} failed: ${String(err)}`);
        await this.prisma.videoJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            error: String((err as Error)?.message ?? err).slice(0, 500),
          },
        });
      })
      // Nhường chỗ phải chạy CẢ KHI render lỗi, nếu không một lần thất bại là
      // hàng đợi tắc vĩnh viễn cho tới lúc restart.
      .finally(() => {
        void media.dispose();
        this.rendering--;
        void this.startNextWaiting();
      });
  }

  private async startNextWaiting(): Promise<void> {
    const next = this.waiting.shift();
    if (next === undefined) return;
    // Job có thể đã bị xoá trong lúc đợi — bỏ qua và gọi người kế tiếp.
    const still = await this.prisma.videoJob.findUnique({
      where: { id: next },
      select: { id: true, status: true },
    });
    if (!still || still.status !== 'PENDING') {
      await this.startNextWaiting();
      return;
    }
    await this.launchRender(next).catch((err: unknown) =>
      this.logger.error(`không khởi động được ${next}: ${String(err)}`),
    );
  }

  async get(userId: string, jobId: string): Promise<VideoJobView> {
    return this.toView(await this.ownJob(userId, jobId));
  }

  /** "Your videos" — màn 33 */
  async listMine(userId: string): Promise<VideoJobView[]> {
    const jobs = await this.prisma.videoJob.findMany({
      where: { requesterUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return jobs.map((j) => this.toView(j));
  }

  /** Stream file kết quả (Range 206 để mobile seek được) */
  async fileFor(
    userId: string,
    jobId: string,
  ): Promise<{ key: string; size: number }> {
    const job = await this.ownJob(userId, jobId);
    if (job.status !== 'DONE' || !job.resultStorageKey)
      throw new NotFoundException('Video chưa render xong');
    return {
      key: job.resultStorageKey,
      size: await this.storage.sizeOf(job.resultStorageKey),
    };
  }

  stream(storageKey: string, start?: number, end?: number): Readable {
    return this.storage.openRead(storageKey, start, end);
  }

  /** Màn 33 "Share with the family — Everyone sees it on Grandma's timeline" */
  async share(
    userId: string,
    jobId: string,
    caption?: string,
  ): Promise<{ post_id: string }> {
    const job = await this.ownJob(userId, jobId);
    if (job.status !== 'DONE' || !job.resultStorageKey || !job.familyId) {
      throw new BadRequestException('Video chưa render xong');
    }

    // Bài đăng nhận một BẢN SAO vật lý của file, không dùng chung storageKey với
    // job: xoá post sẽ xoá file của mọi media đính kèm (post.service →
    // removeAllBestEffort), mà nếu đó cũng là file của job thì "Your videos" vẫn
    // ghi DONE nhưng bấm phát là hỏng — mất vĩnh viễn video đã render (đã dính).
    const tmpCopy = path.join(
      this.storage.tempDir,
      `share_${jobId}_${Date.now()}.mp4`,
    );
    await this.storage.withLocalCopy(job.resultStorageKey, (sourceAbs) => {
      fs.mkdirSync(path.dirname(tmpCopy), { recursive: true });
      fs.copyFileSync(sourceAbs, tmpCopy);
    });
    const postStorageKey = await this.storage.promote(tmpCopy, 'video/mp4');
    const size = await this.storage.sizeOf(postStorageKey);

    const plan = job.plan as PlanJson | null;
    const post = await this.prisma.post.create({
      data: {
        authorUserId: userId,
        type: 'POST',
        // `||` chứ không phải `??`: plan.title của quick mode là chuỗi RỖNG, và
        // `caption ?? '' ?? fallback` dừng ở '' — bài share ra timeline không lời.
        content: caption?.trim() || plan?.title?.trim() || 'Memory video',
        families: { create: [{ familyId: job.familyId }] },
        ...(job.aboutMemberId
          ? { memberTags: { create: [{ memberId: job.aboutMemberId }] } }
          : {}),
        media: {
          create: [
            {
              uploaderUserId: userId,
              storageKey: postStorageKey,
              mimeType: 'video/mp4',
              sizeBytes: size,
            },
          ],
        },
      },
      select: { id: true },
    });
    return { post_id: post.id };
  }

  /**
   * Xuất video DONE thành MỘT Media row độc lập (bản sao vật lý, cùng lý do
   * với share ở trên) — cho luồng mới 26/08: mobile mang media này qua màn
   * soạn bài để người dùng DUYỆT rồi tự đăng, thay vì server tự tạo post.
   * Media chưa gắn bài nào và uploader là chính người gọi, nên POST /posts
   * nhận nó như một upload thường.
   */
  async exportMedia(
    userId: string,
    jobId: string,
  ): Promise<{ media_id: string }> {
    const job = await this.ownJob(userId, jobId);
    if (job.status !== 'DONE' || !job.resultStorageKey) {
      throw new BadRequestException('Video chưa render xong');
    }

    // Cùng cách với share(): storage giờ chỉ CHO MƯỢN đường dẫn local trong
    // một callback (refactor 26/08 của team), không còn absolutePathOf.
    const tmpCopy = path.join(
      this.storage.tempDir,
      `export_${jobId}_${Date.now()}.mp4`,
    );
    await this.storage.withLocalCopy(job.resultStorageKey, (sourceAbs) => {
      fs.mkdirSync(path.dirname(tmpCopy), { recursive: true });
      fs.copyFileSync(sourceAbs, tmpCopy);
    });
    const storageKey = await this.storage.promote(tmpCopy, 'video/mp4');
    const size = await this.storage.sizeOf(storageKey);

    const media = await this.prisma.media.create({
      data: {
        uploaderUserId: userId,
        storageKey,
        mimeType: 'video/mp4',
        sizeBytes: size,
      },
      select: { id: true },
    });
    return { media_id: media.id };
  }

  // ---------------- worker ----------------

  private async renderWorker(jobId: string, media: MediaBorrow): Promise<void> {
    const job = await this.prisma.videoJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    const plan = job.plan as PlanJson;
    const options = job.options as OptionsJson;
    if (!plan || !options) throw new Error('Job thiếu plan/options');

    ensureDirs();
    const fonts = loadFonts();
    // Thiếu font thì engine bỏ chữ chứ không fail — phải nói ra ở đây, nếu không
    // video "không có phụ đề" trông như lỗi thiết kế (đã xảy ra trên Render 09-17).
    if (!fonts.jp || !fonts.vn) {
      this.logger.warn(
        `job ${jobId}: thiếu font (jp=${fonts.jp ?? 'null'}, vn=${fonts.vn ?? 'null'}) — caption/card sẽ không có chữ. Kiểm tra apps/api/assets/fonts.`,
      );
    }
    const aspect: Aspect =
      options.aspect === 'landscape' ? 'landscape' : 'portrait';
    const quick = job.mode === 'quick';
    const styled =
      !quick && options.style !== 'none' && isIntroEnabled(options.style);
    const styleTpl = styled
      ? (options.style as Exclude<IntroTemplateId, 'none'>)
      : null;
    const palette = this.safePalette(plan.palette) as unknown as Palette;

    const setStage = async (stage: string, progress: number) =>
      this.prisma.videoJob.update({
        where: { id: jobId },
        data: { stage, progress: Math.min(99, Math.round(progress)) },
      });

    // --- media path + probe video clip (clamp thời lượng cảnh clip về độ dài thật) ---
    const mediaRows = await this.prisma.media.findMany({
      where: { id: { in: plan.scenes.map((s) => s.mediaId) } },
      select: { id: true, storageKey: true, mimeType: true },
    });
    const byId = new Map(mediaRows.map((m) => [m.id, m] as const));

    // Lưới an toàn cuối cùng trước ffmpeg: cảnh nào mất row HOẶC mất file
    // (Neon chung, file nằm máy khác; ảnh bị xoá giữa lúc tạo job và render)
    // thì bỏ cảnh đó, phim ngắn đi một nhịp còn hơn chết với một cục stderr.
    // Chỉ khi không còn cảnh nào mới fail — bằng câu người đọc hiểu được.
    const usable: typeof plan.scenes = [];
    const dropped: string[] = [];
    for (const s of plan.scenes) {
      const row = byId.get(s.mediaId);
      if (row && (await this.storage.exists(row.storageKey))) usable.push(s);
      else dropped.push(row?.storageKey ?? s.mediaId);
    }
    if (usable.length === 0) {
      throw new Error(
        'Không có ảnh/clip nào của video này còn file trên máy chủ. Hãy chọn lại ảnh — ảnh bạn tự tải lên từ máy này luôn dùng được.',
      );
    }
    if (dropped.length > 0) {
      this.logger.warn(
        `job ${jobId}: bỏ ${dropped.length} cảnh không có file (${dropped.join(', ')})`,
      );
      plan.scenes = usable;
    }

    const musicId = options.musicId;
    const bpm = isLibraryTrack(musicId) ? trackBpm(musicId) : null;
    const musicPath = await this.musicPathFor(musicId, media);

    for (const s of plan.scenes) {
      if (s.kind === 'video') {
        const abs = await media.path(byId.get(s.mediaId)!.storageKey);
        const probe = await probeMedia(abs).catch(() => null);
        if (probe && probe.duration > 0.5)
          s.durationS = Math.max(2, Math.min(s.durationS, probe.duration));
      }
    }

    // --- timing kiểu memories (port memoryVideo.ts của demo) ---
    const effects = assignEffects(
      plan.scenes.map((s) => ({
        media_id: s.mediaId,
        type: s.kind === 'video' ? 'video_clip' : 'kenburns',
      })),
      seedFromIds(plan.scenes.map((s) => s.mediaId)),
    );
    const bodyJoins = planBodyJoins(
      plan.scenes.length,
      seedFromIds(plan.scenes.map((s) => s.mediaId)),
    );
    const edge = quick
      ? { head: 0, tail: 0 }
      : { head: JOIN_DUR.fade, tail: JOIN_DUR.fade };
    const bt = bodyTiming(
      plan.scenes.map((s) => s.durationS),
      bodyJoins,
      bpm,
      edge,
    );
    const fullJoins: Join[] = quick
      ? bodyJoins
      : [
          { type: 'fade', dur: JOIN_DUR.fade },
          ...bodyJoins,
          { type: 'fade', dur: JOIN_DUR.fade },
        ];
    const tailOf = (segIdx: number) => extraTailFor(fullJoins[segIdx]);

    const introDur = quantizeUpToBeat(
      styled ? introSecondsFor(plan.opening, styleTpl!) : CARD_SEC,
      bpm,
    );
    const outroDur = quantizeUpToBeat(
      styled ? outroSecondsFor(plan.closing, plan.dedication) : CARD_SEC,
      bpm,
    );

    const n = plan.scenes.length;

    // --- render SONG SONG: intro, outro, từng cảnh và trích voice là các process
    // ffmpeg ĐỘC LẬP — trước đây chạy nối đuôi nhau nên máy 16 luồng ngồi chơi
    // (filter gblur/zoompan phần lớn đơn luồng, một process không ăn hết CPU).
    // Pool theo số nhân: đo 20/08 trên i5-1250P (16 luồng) — tuần tự 49s,
    // pool 3 = 38s, pool 5 = 24s cho cùng video 41s; máy ít nhân tự hạ xuống 2.
    // Thứ tự LẮP RÁP vẫn tuyệt đối cố định: ghi kết quả theo chỗ ngồi định sẵn,
    // không theo thứ tự hoàn thành.
    const defaultConcurrency = Math.max(
      2,
      Math.min(5, Math.floor(os.cpus().length / 3)),
    );
    const concurrency = Math.max(
      1,
      Number(process.env.VIDEO_RENDER_CONCURRENCY ?? defaultConcurrency) ||
        defaultConcurrency,
    );
    const sceneSegs = new Array<{ file: string; durationS: number }>(n);
    let introSeg: { file: string; durationS: number } | null = null;
    let outroSeg: { file: string; cached: boolean } | null = null;
    const voiceTracks: { file: string; startS: number }[] = [];

    const tasks: (() => Promise<void>)[] = [];
    if (!quick) {
      const photoScenes = plan.scenes
        .filter((s) => s.kind !== 'video')
        .slice(0, 3);
      const introCtx = {
        titleJa: plan.title,
        subtitleJa: plan.subtitle,
        openingJa: plan.opening,
        closingJa: plan.closing,
        dedicationJa: plan.dedication,
        creditLine: `NHA · ${new Date().toISOString().slice(0, 10)}`,
        palette,
        photoAbs: await Promise.all(
          photoScenes.map((s) => media.path(byId.get(s.mediaId)!.storageKey)),
        ),
        photoIds: photoScenes.map((s) => s.mediaId),
      };
      tasks.push(async () => {
        const intro = styleTpl
          ? await renderIntro({
              template: styleTpl,
              aspect,
              durationS: introDur + tailOf(0),
              ctx: introCtx,
            })
          : await renderCard({
              kind: 'title',
              title: plan.title,
              subtitle: plan.subtitle,
              palette,
              aspect,
              fonts,
              durationS: introDur + tailOf(0),
            });
        introSeg = { file: intro.file, durationS: introDur };
      });
      tasks.push(async () => {
        outroSeg = styleTpl
          ? await renderOutro({
              template: styleTpl,
              aspect,
              durationS: outroDur,
              ctx: introCtx,
            })
          : await renderCard({
              kind: 'outro',
              title: plan.closing || plan.title || 'NHA',
              subtitle: '',
              dedication: plan.dedication,
              palette,
              aspect,
              fonts,
              durationS: outroDur,
            });
      });
    }
    for (let i = 0; i < n; i++) {
      const s = plan.scenes[i];
      const segIdx = quick ? i : i + 1;
      const renderDur = bt.durations[i] + tailOf(segIdx);
      const scene: Scene = {
        media_id: s.mediaId,
        type: s.kind === 'video' ? 'video_clip' : 'kenburns',
        duration_s: renderDur,
        caption_ja: s.caption,
        caption_vi: '',
        effect: effects[i],
        ai_animate: false,
        motion_prompt: '',
        reason: '',
      };
      const abs = await media.path(byId.get(s.mediaId)!.storageKey);
      tasks.push(async () => {
        const seg =
          s.kind === 'video'
            ? await renderVideoClip({
                videoAbs: abs,
                scene,
                style: 'yasashii',
                profile: 'memories',
                aspect,
                fonts,
              })
            : await renderKenBurns({
                imageAbs: abs,
                scene,
                style: 'yasashii',
                profile: 'memories',
                aspect,
                fonts,
              });
        sceneSegs[i] = { file: seg.file, durationS: bt.durations[i] };
      });
    }
    // Tiếng nói trong clip gốc (màn 29: "music fades under the voices in your clips")
    // — startS tính từ timing đã chốt, không phụ thuộc file cảnh nên vào chung pool.
    for (let i = 0; i < n; i++) {
      const s = plan.scenes[i];
      if (s.kind !== 'video') continue;
      // Người dùng tắt tiếng cảnh này ở màn duyệt → không trích tiếng của nó
      if (s.keepAudio === false) continue;
      const abs = await media.path(byId.get(s.mediaId)!.storageKey);
      const startS =
        (quick ? 0 : introDur) +
        bt.durations.slice(0, i).reduce((a, d) => a + d, 0);
      tasks.push(async () => {
        const probe = await probeMedia(abs).catch(() => null);
        if (!probe?.hasAudio) return;
        const voiceFile = path.join(
          process.cwd(),
          'uploads',
          'video_out',
          'tmp',
          `${jobId}_voice_${i}.m4a`,
        );
        fs.mkdirSync(path.dirname(voiceFile), { recursive: true });
        await run(FFMPEG, [
          '-y',
          '-ss',
          '0',
          '-t',
          String(bt.durations[i]),
          '-i',
          abs,
          '-vn',
          '-ac',
          '2',
          '-ar',
          '44100',
          '-c:a',
          'aac',
          voiceFile,
        ]);
        voiceTracks.push({ file: voiceFile, startS });
      });
    }

    // Tiến độ: cùng format 'scene:i/n' mobile đang parse — i = số việc đã xong
    // quy về thang cảnh, đơn điệu tăng dù các cảnh hoàn thành lộn xộn thứ tự.
    await setStage(quick ? `scene:1/${n}` : 'opening', 3);
    let doneCount = 0;
    const tick = async () => {
      doneCount++;
      const shownScene = Math.max(
        1,
        Math.min(n, Math.round((doneCount / tasks.length) * n)),
      );
      await setStage(
        `scene:${shownScene}/${n}`,
        5 + (doneCount / tasks.length) * 78,
      );
    };
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
        for (;;) {
          const idx = cursor++;
          if (idx >= tasks.length) return;
          await tasks[idx]();
          await tick();
        }
      }),
    );

    // Cast lại sau pool: TS không thấy các phép gán nằm trong closure của worker
    const introDone = introSeg as { file: string; durationS: number } | null;
    const outroDone = outroSeg as { file: string; cached: boolean } | null;
    const segs: { file: string; durationS: number }[] = [
      ...(introDone ? [introDone] : []),
      ...sceneSegs,
    ];
    if (outroDone) segs.push({ file: outroDone.file, durationS: outroDur });

    // --- ghép + nhạc ---
    await setStage('music', 85);
    const outAbs = path.join(
      process.cwd(),
      'uploads',
      'video_out',
      `${jobId}.mp4`,
    );
    const { totalDur } = await concatWithTransitions({
      segments: segs,
      profile: 'memories',
      musicPath,
      outAbs,
      aspect,
      joins: fullJoins,
      voiceTracks,
    });
    for (const v of voiceTracks) fs.rmSync(v.file, { force: true });

    // --- đưa vào storage + DONE ---
    const storageKey = await this.storage.promote(outAbs, 'video/mp4');
    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE',
        progress: 100,
        stage: null,
        resultStorageKey: storageKey,
        durationS: totalDur,
      },
    });
    // "You can leave this screen — we will let you know" (màn 32)
    const job2 = await this.prisma.videoJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    await this.prisma.notification.create({
      data: {
        recipientUserId: job2.requesterUserId,
        type: 'AI_SUGGESTION',
        payload: { kind: 'video_done', video_job_id: jobId, title: job2.title },
      },
    });
  }

  // ---------------- helpers ----------------

  /** 'none' | track thư viện | 'media:<id>' = "Use your own song" (màn 29) — audio phải do chính user upload */
  private async resolveMusicId(
    userId: string,
    raw: string | undefined,
  ): Promise<string> {
    if (!raw || raw === 'none') return 'none';
    if (isLibraryTrack(raw)) return raw;
    if (raw.startsWith('media:')) {
      const row = await this.prisma.media.findFirst({
        where: { id: raw.slice('media:'.length), uploaderUserId: userId },
        select: { id: true, mimeType: true },
      });
      if (!row)
        throw new BadRequestException(
          'Không truy cập được file nhạc đã upload',
        );
      if (!/^(audio|video)\//.test(row.mimeType))
        throw new BadRequestException('File nhạc phải là audio');
      return raw;
    }
    return 'none';
  }

  private async musicPathFor(
    musicId: string,
    media: MediaBorrow,
  ): Promise<string | null> {
    if (musicId === 'none') return null;
    if (isLibraryTrack(musicId)) return ensureTrack(musicId);
    if (musicId.startsWith('media:')) {
      const row = await this.prisma.media.findUnique({
        where: { id: musicId.slice('media:'.length) },
        select: { storageKey: true },
      });
      // Nhạc riêng mà file không có trên máy này → dựng phim không nhạc còn
      // hơn fail cả video vì một track.
      if (!row || !(await this.storage.exists(row.storageKey))) {
        this.logger.warn(
          `nhạc ${musicId} không có file trên máy chủ — bỏ nhạc`,
        );
        return null;
      }
      return await media.path(row.storageKey);
    }
    return null;
  }

  // Kiểu trả về khai tường minh: 'image' | 'video' phải giữ nguyên literal, nếu để
  // TypeScript tự suy thì nó nới thành string và cả pipeline mất kiểu.
  private async loadMedia(
    userId: string,
    familyId: string,
    mediaIds: string[],
  ): Promise<
    {
      id: string;
      kind: 'image' | 'video';
      caption: string | null;
      createdAt: Date;
    }[]
  > {
    // Authorization: media thuộc bài đăng trong family này, HOẶC do chính requester upload
    const rows = await this.prisma.media.findMany({
      where: {
        id: { in: mediaIds },
        OR: [
          { post: { families: { some: { familyId } } } },
          { uploaderUserId: userId },
        ],
      },
      select: {
        id: true,
        mimeType: true,
        storageKey: true,
        createdAt: true,
        post: { select: { content: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const missing = mediaIds.filter((id) => !byId.has(id));
    if (missing.length)
      throw new ForbiddenException(
        `Không truy cập được media: ${missing.join(', ')}`,
      );

    // Row có mà FILE không (Neon chung, file trên máy người khác) → bỏ qua
    // ngay từ đây thay vì để ffmpeg chết giữa render. Chỉ khi không còn tấm
    // nào mới từ chối — và nói rõ vì sao.
    const present = new Set<string>();
    await Promise.all(
      rows.map(async (r) => {
        if (await this.storage.exists(r.storageKey)) present.add(r.id);
      }),
    );
    const usable = mediaIds.filter((id) => present.has(id));
    if (usable.length < mediaIds.length) {
      this.logger.warn(
        `bỏ ${mediaIds.length - usable.length}/${mediaIds.length} media không có file trên máy chủ này`,
      );
    }
    if (usable.length === 0) {
      throw new BadRequestException(
        'Không tấm nào trong số đã chọn có file trên máy chủ này — hãy chọn ảnh khác (ảnh do chính bạn tải lên từ máy này luôn dùng được).',
      );
    }

    // giữ đúng THỨ TỰ user chọn (màn 28 — "Numbers are the order they will appear")
    return usable.map((id) => {
      const r = byId.get(id)!;
      return {
        id: r.id,
        kind: r.mimeType.startsWith('video/') ? 'video' : 'image',
        caption: r.post?.content ?? null,
        createdAt: r.createdAt,
      };
    });
  }

  private async ownJob(userId: string, jobId: string) {
    const job = await this.prisma.videoJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Không tìm thấy video job');
    if (job.requesterUserId !== userId)
      throw new ForbiddenException('Không phải video của bạn');
    return job;
  }

  private safeStyle(v: string | undefined): IntroTemplateId {
    const all: IntroTemplateId[] = [
      'album',
      'cinema',
      'film',
      'letter',
      'seasonal',
      'polaroid',
      'none',
    ];
    return all.includes(v as IntroTemplateId) &&
      (v === 'none' || isIntroEnabled(v as IntroTemplateId))
      ? (v as IntroTemplateId)
      : 'cinema';
  }

  private safePalette(
    p: Record<string, string> | undefined,
  ): Record<string, string> {
    const hex = /^#[0-9a-fA-F]{6}$/;
    const out: Record<string, string> = { ...DEFAULT_PALETTE };
    for (const k of Object.keys(out))
      if (p && hex.test(p[k] ?? '')) out[k] = p[k];
    return out;
  }

  private toView(job: {
    id: string;
    status: string;
    mode: string;
    title: string | null;
    progress: number;
    stage: string | null;
    durationS: number | null;
    error: string | null;
    createdAt: Date;
    resultStorageKey: string | null;
    aboutMemberId: string | null;
    plan: unknown;
    options: unknown;
  }): VideoJobView {
    return {
      id: job.id,
      status: job.status as VideoJobView['status'],
      mode: job.mode,
      title: job.title,
      progress: job.progress,
      stage: job.stage,
      duration_s: job.durationS,
      error: job.error,
      created_at: job.createdAt.toISOString(),
      has_file: !!job.resultStorageKey,
      about_member_id: job.aboutMemberId,
      plan: (job.plan as PlanJson) ?? null,
      options: (job.options as OptionsJson) ?? null,
    };
  }
}
