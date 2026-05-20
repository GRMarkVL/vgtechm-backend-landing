import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../integrations/prisma/prisma.service';
import { GoogleCalendarService } from '../../integrations/google-calendar/google-calendar.service';
import { MailService } from '../../integrations/mail/mail.service';
import { TelegramService } from '../../integrations/telegram/telegram.service';

const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CalendarSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CalendarSyncService.name);
  private syncRunning = false;
  private syncQueued = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: GoogleCalendarService,
    private readonly mail: MailService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegram: TelegramService,
  ) {}

  async onApplicationBootstrap() {
    if (!process.env.GOOGLE_WEBHOOK_URL) {
      this.logger.warn('GOOGLE_WEBHOOK_URL not set — calendar sync disabled');
      return;
    }
    try {
      await this.ensureChannel();
    } catch (err) {
      this.logger.error(`Failed to ensure calendar channel: ${err}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async renewIfNeeded() {
    if (!process.env.GOOGLE_WEBHOOK_URL) return;
    try {
      const channel = await this.prisma.calendarChannel.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      if (!channel || channel.expiresAt.getTime() - Date.now() < RENEW_BEFORE_MS) {
        this.logger.log('Calendar channel renewal triggered');
        await this.ensureChannel();
      }
    } catch (err) {
      this.logger.error(`Channel renewal failed: ${err}`);
    }
  }

  private async ensureChannel() {
    const webhookUrl = process.env.GOOGLE_WEBHOOK_URL!;
    const secret = process.env.GOOGLE_WEBHOOK_SECRET || '';

    // NOTE: assumes single-replica deploy. In a multi-replica setup each replica
    // would race to create its own channel — add a distributed lock if scaled out.

    const existing = await this.prisma.calendarChannel.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    // Register NEW channel BEFORE removing the old one — no gap where webhook
    // would find no channel in DB.
    const { channelId, resourceId, expiresAt } = await this.calendar.startWatch({
      webhookUrl,
      secret,
    });

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.calendarChannel.delete({ where: { id: existing.id } });
      }
      await tx.calendarChannel.create({
        data: {
          channelId,
          resourceId,
          expiresAt,
          syncToken: existing?.syncToken ?? null,
        },
      });
    });

    if (existing) {
      // Best-effort cleanup of the old Google-side channel — orphan callbacks
      // for it will be filtered out by the controller's channelId check.
      await this.calendar.stopWatch(existing.channelId, existing.resourceId);
    }

    this.logger.log(
      `Calendar watch channel registered: ${channelId}, expires ${expiresAt.toISOString()}`,
    );
  }

  async triggerReconcile() {
    if (this.syncRunning) {
      this.syncQueued = true;
      return;
    }
    this.syncRunning = true;
    try {
      do {
        this.syncQueued = false;
        await this.reconcile();
      } while (this.syncQueued);
    } finally {
      this.syncRunning = false;
    }
  }

  private async reconcile() {
    const channel = await this.prisma.calendarChannel.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!channel) {
      this.logger.warn('No active calendar channel — skipping reconcile');
      return;
    }

    let result = await this.calendar.incrementalSync(channel.syncToken);
    if (result.expired) {
      result = await this.calendar.incrementalSync(null);
    }

    if (result.events.length > 0) {
      this.logger.log(`Reconcile: ${result.events.length} event(s) changed`);
    }

    for (const ev of result.events) {
      try {
        await this.applyEventChange(ev);
      } catch (err) {
        this.logger.error(`Apply change for event ${ev.id} failed: ${err}`);
      }
    }

    if (result.nextSyncToken && result.nextSyncToken !== channel.syncToken) {
      await this.prisma.calendarChannel.update({
        where: { id: channel.id },
        data: { syncToken: result.nextSyncToken },
      });
    }
  }

  private async applyEventChange(ev: {
    id: string;
    status: 'cancelled' | 'confirmed' | 'tentative';
    start?: Date;
  }) {
    const booking = await this.prisma.booking.findFirst({
      where: { calendarEventId: ev.id },
    });
    if (!booking) return;
    if (booking.status === 'CANCELLED') return;

    if (ev.status === 'cancelled') {
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED' },
      });
      this.logger.log(`Booking ${booking.id} cancelled via calendar deletion`);
      await Promise.allSettled([
        this.mail.sendCancelled({
          to: booking.email,
          name: booking.name,
          slotAt: booking.slotAt,
          direction: booking.direction as 'MARKETING' | 'IT',
        }),
        this.telegram.notifyCalendarChange(booking.id, 'cancelled', booking.slotAt),
      ]);
      return;
    }

    if (ev.start && ev.start.getTime() !== booking.slotAt.getTime()) {
      const oldSlot = booking.slotAt;
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { slotAt: ev.start, reminderSent: false },
      });
      this.logger.log(
        `Booking ${booking.id} rescheduled ${oldSlot.toISOString()} -> ${ev.start.toISOString()}`,
      );
      await Promise.allSettled([
        this.mail.sendRescheduled({
          to: booking.email,
          name: booking.name,
          direction: booking.direction as 'MARKETING' | 'IT',
          oldSlot,
          newSlot: ev.start,
        }),
        this.telegram.notifyCalendarChange(booking.id, 'rescheduled', ev.start),
      ]);
    }
  }
}
