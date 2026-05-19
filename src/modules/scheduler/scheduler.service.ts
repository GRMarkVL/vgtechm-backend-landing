import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../integrations/prisma/prisma.service';
import { MailService } from '../../integrations/mail/mail.service';
import { TelegramService } from '../../integrations/telegram/telegram.service';
import { addMinutes } from 'date-fns';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendReminders() {
    const now = new Date();
    const windowStart = addMinutes(now, 50);
    const windowEnd = addMinutes(now, 70);

    const due = await this.prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        reminderSent: false,
        slotAt: { gte: windowStart, lte: windowEnd },
      },
    });

    for (const b of due) {
      try {
        await this.mail.sendReminder({
          to: b.email,
          name: b.name,
          slotAt: b.slotAt,
          direction: b.direction as 'MARKETING' | 'IT',
        });
        await this.telegram.notifyReminder({
          id: b.id,
          direction: b.direction as 'MARKETING' | 'IT',
          name: b.name,
          email: b.email,
          phone: b.phone,
          slotAt: b.slotAt,
          answers: b.answers,
          comment: b.comment,
        });
        await this.prisma.booking.update({
          where: { id: b.id },
          data: { reminderSent: true },
        });
      } catch (err) {
        this.logger.error(`Reminder send failed for ${b.id}: ${err}`);
      }
    }
  }
}
