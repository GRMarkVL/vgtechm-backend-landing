import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Post } from '@prisma/client';
import { PrismaService } from '../../integrations/prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ListQueryDto } from './dto/list-query.dto';

export const LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';
const PAGE_SIZE = 12;

type LocalizedJson = Record<string, string>;

@Injectable()
export class BlogService {
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
    try {
      const post = await this.prisma.post.create({
        data: {
          slug,
          status,
          title: this.toJson(dto.title),
          excerpt: this.toJson(dto.excerpt),
          content: this.toJson(dto.content),
          coverImageUrl: dto.coverImageUrl,
          tags: dto.tags ?? [],
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
    if (dto.excerpt) data.excerpt = this.toJson(dto.excerpt);
    if (dto.content) data.content = this.toJson(dto.content);
    if (dto.coverImageUrl !== undefined) data.coverImageUrl = dto.coverImageUrl;
    if (dto.tags !== undefined) data.tags = dto.tags;

    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === 'PUBLISHED' && !existing.publishedAt) {
        data.publishedAt = new Date();
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
