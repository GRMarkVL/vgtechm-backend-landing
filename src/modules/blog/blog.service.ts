import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, Post } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { PrismaService } from '../../integrations/prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ListQueryDto } from './dto/list-query.dto';
import { ScheduleQueueDto } from './dto/schedule-queue.dto';

export const LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';
const PAGE_SIZE = 12;
const ALMATY_TZ = 'Asia/Almaty';

type LocalizedJson = Record<string, string>;

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(private readonly prisma: PrismaService) {}

  private resolveLocale(lang?: string): Locale {
    return (LOCALES as readonly string[]).includes(lang ?? '')
      ? (lang as Locale)
      : DEFAULT_LOCALE;
  }

  /** Достаёт строку нужной локали из Json-поля с фолбэком на ru. */
  private pick(value: Prisma.JsonValue, locale: Locale): string {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as LocalizedJson;
      return obj[locale] || obj[DEFAULT_LOCALE] || '';
    }
    return '';
  }

  private slugify(input: string): string {
    const map: Record<string, string> = {
      а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
      з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
      п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
      ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
    };
    return input
      .toLowerCase()
      .split('')
      .map((ch) => (ch in map ? map[ch] : ch))
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
  }

  private async ensureUniqueSlug(base: string, exceptId?: string): Promise<string> {
    const root = base || 'post';
    let slug = root;
    let n = 1;
    for (;;) {
      const existing = await this.prisma.post.findUnique({ where: { slug } });
      if (!existing || existing.id === exceptId) return slug;
      n += 1;
      slug = `${root}-${n}`;
    }
  }

  // ---------- Public ----------

  async list(query: ListQueryDto) {
    const locale = this.resolveLocale(query.lang);
    const page = query.page && query.page > 0 ? query.page : 1;

    const where: Prisma.PostWhereInput = {
      status: 'PUBLISHED',
      ...(query.tag ? { tags: { has: query.tag } } : {}),
    };

    const [total, posts] = await Promise.all([
      this.prisma.post.count({ where }),
      this.prisma.post.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    return {
      page,
      pageSize: PAGE_SIZE,
      total,
      locale,
      posts: posts.map((p) => this.toCard(p, locale)),
    };
  }

  async getBySlug(slug: string, lang?: string) {
    const locale = this.resolveLocale(lang);
    const post = await this.prisma.post.findUnique({ where: { slug } });
    if (!post || post.status !== 'PUBLISHED') {
      throw new NotFoundException('Post not found');
    }
    return this.toFull(post, locale);
  }

  // ---------- Admin ----------

  async adminList() {
    const posts = await this.prisma.post.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return posts.map((p) => ({
      id: p.id,
      slug: p.slug,
      status: p.status,
      title: p.title,
      coverImageUrl: p.coverImageUrl,
      tags: p.tags,
      scheduledAt: p.scheduledAt,
      publishedAt: p.publishedAt,
      updatedAt: p.updatedAt,
    }));
  }

  async adminGet(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async create(dto: CreatePostDto) {
    const slugBase = dto.slug ? this.slugify(dto.slug) : this.slugify(dto.title.ru);
    if (!slugBase) throw new BadRequestException('Cannot derive slug');
    const slug = await this.ensureUniqueSlug(slugBase);

    const status = dto.status ?? 'DRAFT';
    const scheduledAt =
      status === 'SCHEDULED' && dto.scheduledAt
        ? new Date(dto.scheduledAt)
        : null;
    if (status === 'SCHEDULED' && !scheduledAt) {
      throw new BadRequestException('scheduledAt is required for SCHEDULED');
    }
    try {
      const post = await this.prisma.post.create({
        data: {
          slug,
          status,
          title: this.toJson(dto.title),
          excerpt: this.toJson({
            ru: dto.excerpt?.ru ?? '',
            en: dto.excerpt?.en,
          }),
          content: this.toJson(dto.content),
          coverImageUrl: dto.coverImageUrl,
          tags: dto.tags ?? [],
          scheduledAt,
          publishedAt: status === 'PUBLISHED' ? new Date() : null,
        },
      });
      return post;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Slug already exists');
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdatePostDto) {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Post not found');

    const data: Prisma.PostUpdateInput = {};

    if (dto.slug !== undefined) {
      data.slug = await this.ensureUniqueSlug(this.slugify(dto.slug), id);
    }
    if (dto.title) data.title = this.toJson(dto.title);
    if (dto.excerpt)
      data.excerpt = this.toJson({
        ru: dto.excerpt.ru ?? '',
        en: dto.excerpt.en,
      });
    if (dto.content) data.content = this.toJson(dto.content);
    if (dto.coverImageUrl !== undefined) data.coverImageUrl = dto.coverImageUrl;
    if (dto.tags !== undefined) data.tags = dto.tags;

    if (dto.scheduledAt !== undefined) {
      data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === 'PUBLISHED' && !existing.publishedAt) {
        data.publishedAt = new Date();
      }
      if (dto.status === 'DRAFT') {
        data.scheduledAt = null;
      }
      if (dto.status === 'SCHEDULED') {
        const when =
          dto.scheduledAt !== undefined
            ? dto.scheduledAt
              ? new Date(dto.scheduledAt)
              : null
            : existing.scheduledAt;
        if (!when) {
          throw new BadRequestException('scheduledAt is required for SCHEDULED');
        }
        data.scheduledAt = when;
      }
    }

    return this.prisma.post.update({ where: { id }, data });
  }

  async remove(id: string) {
    try {
      await this.prisma.post.delete({ where: { id } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException('Post not found');
      }
      throw err;
    }
    return { id };
  }

  // ---------- Scheduling ----------

  /** Раскладывает посты в очередь: по одному в день в заданное время (Almaty). */
  async scheduleQueue(dto: ScheduleQueueDto) {
    const posts = dto.postIds?.length
      ? await this.prisma.post.findMany({
          where: { id: { in: dto.postIds } },
          orderBy: { createdAt: 'asc' },
        })
      : await this.prisma.post.findMany({
          where: { status: 'DRAFT' },
          orderBy: { createdAt: 'asc' },
        });

    if (posts.length === 0) {
      return { scheduled: [] as { id: string; scheduledAt: Date }[] };
    }

    // Стартовый день: указанный startDate или завтра (по Almaty).
    const startDate =
      dto.startDate ?? this.addDaysToDateStr(this.almatyDateString(new Date()), 1);
    const weekdaysOnly = dto.weekdaysOnly ?? false;

    const out: { id: string; scheduledAt: Date }[] = [];
    let dateStr = startDate;

    for (const post of posts) {
      while (weekdaysOnly && this.isWeekend(dateStr)) {
        dateStr = this.addDaysToDateStr(dateStr, 1);
      }
      const slot = this.almatySlot(dateStr, dto.time);
      await this.prisma.post.update({
        where: { id: post.id },
        data: { status: 'SCHEDULED', scheduledAt: slot },
      });
      out.push({ id: post.id, scheduledAt: slot });
      dateStr = this.addDaysToDateStr(dateStr, 1);
    }

    return { scheduled: out };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async publishDue() {
    const now = new Date();
    const due = await this.prisma.post.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
    });
    for (const post of due) {
      try {
        await this.prisma.post.update({
          where: { id: post.id },
          data: { status: 'PUBLISHED', publishedAt: post.scheduledAt ?? now },
        });
        this.logger.log(`Auto-published post ${post.slug} (${post.id})`);
      } catch (err) {
        this.logger.error(`Auto-publish failed for ${post.id}: ${err}`);
      }
    }
  }

  /** UTC-инстант для конкретной даты/времени по часовому поясу Almaty. */
  private almatySlot(dateStr: string, time: string): Date {
    return fromZonedTime(`${dateStr}T${time}:00`, ALMATY_TZ);
  }

  /** YYYY-MM-DD для даты в зоне Almaty. */
  private almatyDateString(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ALMATY_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  /** Прибавляет n календарных дней к строке YYYY-MM-DD (TZ-независимо). */
  private addDaysToDateStr(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
    return next.toISOString().slice(0, 10);
  }

  /** Суббота/воскресенье для строки YYYY-MM-DD. */
  private isWeekend(dateStr: string): boolean {
    const [y, m, d] = dateStr.split('-').map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return day === 0 || day === 6;
  }

  // ---------- Mappers ----------

  private toJson(text: { ru: string; en?: string }): Prisma.InputJsonValue {
    const out: LocalizedJson = { ru: text.ru };
    if (text.en) out.en = text.en;
    return out;
  }

  private toCard(p: Post, locale: Locale) {
    return {
      id: p.id,
      slug: p.slug,
      title: this.pick(p.title, locale),
      excerpt: this.pick(p.excerpt, locale),
      coverImageUrl: p.coverImageUrl,
      tags: p.tags,
      publishedAt: p.publishedAt,
    };
  }

  private toFull(p: Post, locale: Locale) {
    return {
      ...this.toCard(p, locale),
      content: this.pick(p.content, locale),
    };
  }
}
