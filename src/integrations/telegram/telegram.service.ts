import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { Bot } from 'grammy';
import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import { ALMATY_TZ } from '../google-calendar/google-calendar.service';
import { BookingService } from '../../modules/booking/booking.service';
import { PrismaService } from '../prisma/prisma.service';

type BookingForNotify = {
  id: string;
  direction: 'MARKETING' | 'IT';
  name: string;
  email: string;
  phone: string;
  slotAt: Date;
  answers: unknown;
  comment: string | null;
  calendarFailed?: boolean;
};

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: Bot | null;
  private readonly adminChatId: string | undefined;

  constructor(
    @Inject(forwardRef(() => BookingService))
    private readonly booking: BookingService,
    private readonly prisma: PrismaService,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    this.adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    this.bot = token ? new Bot(token) : null;
    if (!this.bot) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — telegram disabled');
    }
  }

  async onModuleInit() {
    if (!this.bot) return;
    this.registerHandlers();
    void this.bot.start({ onStart: (me) => this.logger.log(`Bot @${me.username} started`) });
  }

  async onModuleDestroy() {
    if (this.bot) await this.bot.stop();
  }

  private fmt(d: Date): string {
    return formatInTimeZone(d, ALMATY_TZ, 'd MMMM yyyy, HH:mm', { locale: ru });
  }

  private registerHandlers() {
    if (!this.bot) return;

    const isAdmin = (fromId: number | undefined): boolean =>
      !!this.adminChatId && fromId !== undefined && String(fromId) === this.adminChatId;

    this.bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
      if (!isAdmin(ctx.from?.id)) {
        await ctx.answerCallbackQuery({ text: 'Доступ запрещён', show_alert: true });
        return;
      }
      const id = ctx.match![1];
      try {
        await this.booking.confirm(id);
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        await ctx.answerCallbackQuery({ text: '✅ Подтверждено' });
        await ctx.reply(`✅ Заявка ${id} подтверждена`);
      } catch (err) {
        this.logger.error(err);
        await ctx.answerCallbackQuery({ text: 'Ошибка' });
      }
    });

    this.bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
      if (!isAdmin(ctx.from?.id)) {
        await ctx.answerCallbackQuery({ text: 'Доступ запрещён', show_alert: true });
        return;
      }
      const id = ctx.match![1];
      try {
        await this.booking.cancel(id);
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        await ctx.answerCallbackQuery({ text: '❌ Отклонено' });
        await ctx.reply(`❌ Заявка ${id} отклонена`);
      } catch (err) {
        this.logger.error(err);
        await ctx.answerCallbackQuery({ text: 'Ошибка' });
      }
    });

    const requireAdmin = async (ctx: {
      from?: { id: number };
      reply: (s: string) => Promise<unknown>;
    }): Promise<boolean> => {
      if (!isAdmin(ctx.from?.id)) {
        await ctx.reply('Доступ запрещён');
        return false;
      }
      return true;
    };

    this.bot.command('today', async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      await this.replyList(ctx, now, end, 'Сегодня');
    });

    this.bot.command('week', async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const now = new Date();
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      await this.replyList(ctx, now, end, 'На неделю');
    });

    this.bot.command('pending', async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const items = await this.prisma.booking.findMany({
        where: { status: 'PENDING' },
        orderBy: { slotAt: 'asc' },
        take: 20,
      });
      if (!items.length) {
        await ctx.reply('Нет ожидающих заявок');
        return;
      }
      await ctx.reply(
        items.map((b) => `• ${this.fmt(b.slotAt)} — ${b.name} (${b.direction})`).join('\n'),
      );
    });
  }

  private async replyList(
    ctx: { reply: (s: string) => Promise<unknown> },
    from: Date,
    to: Date,
    title: string,
  ) {
    const items = await this.prisma.booking.findMany({
      where: { slotAt: { gte: from, lte: to }, status: { in: ['PENDING', 'CONFIRMED'] } },
      orderBy: { slotAt: 'asc' },
    });
    if (!items.length) {
      await ctx.reply(`${title}: записей нет`);
      return;
    }
    await ctx.reply(
      `${title}:\n` +
        items
          .map(
            (b) =>
              `• ${this.fmt(b.slotAt)} — ${b.name} (${b.direction}) [${b.status}] ${b.phone}`,
          )
          .join('\n'),
    );
  }

  async notifyNewBooking(b: BookingForNotify): Promise<void> {
    if (!this.bot || !this.adminChatId) return;
    const answers = formatAnswers(b.direction, b.answers);
    const calendarLine = b.calendarFailed
      ? `\n⚠️ <b>Не удалось создать событие в календаре</b> — добавьте вручную.\n`
      : '';
    const text =
      `🔔 <b>Новая заявка</b>${calendarLine}\n` +
      `<b>Направление:</b> ${b.direction === 'MARKETING' ? 'Маркетинг' : 'IT'}\n` +
      `<b>Имя:</b> ${escapeHtml(b.name)}\n` +
      `<b>Email:</b> ${escapeHtml(b.email)}\n` +
      `<b>Телефон:</b> ${escapeHtml(b.phone)}\n` +
      `<b>Слот:</b> ${this.fmt(b.slotAt)}\n\n` +
      `<b>Ответы:</b>\n${answers}\n` +
      (b.comment ? `\n<b>Комментарий:</b>\n${escapeHtml(b.comment)}` : '');

    await this.bot.api.sendMessage(this.adminChatId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Подтвердить', callback_data: `confirm:${b.id}` },
            { text: '❌ Отклонить', callback_data: `reject:${b.id}` },
          ],
        ],
      },
    });
  }

  async notifyReminder(b: BookingForNotify): Promise<void> {
    if (!this.bot || !this.adminChatId) return;
    await this.bot.api.sendMessage(
      this.adminChatId,
      `⏰ Через час: ${this.fmt(b.slotAt)} — ${b.name} (${b.direction}), тел. ${b.phone}`,
    );
  }
}

function formatAnswers(direction: 'MARKETING' | 'IT', answers: unknown): string {
  if (!answers || typeof answers !== 'object') return '—';
  const obj = answers as Record<string, string>;
  const labels: Record<string, Record<string, string>> = {
    MARKETING: { goal: 'Цель', budget: 'Бюджет', channels: 'Текущие каналы' },
    IT: { kind: 'Тип проекта', stage: 'Стадия', deadline: 'Срок' },
  };
  const map = labels[direction] || {};
  return Object.entries(obj)
    .map(([k, v]) => `• ${map[k] || k}: ${escapeHtml(String(v))}`)
    .join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
