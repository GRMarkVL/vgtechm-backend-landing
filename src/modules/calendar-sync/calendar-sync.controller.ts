import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../integrations/prisma/prisma.service';
import { CalendarSyncService } from './calendar-sync.service';

@SkipThrottle()
@Controller('calendar')
export class CalendarSyncController {
  private readonly logger = new Logger(CalendarSyncController.name);

  constructor(
    private readonly sync: CalendarSyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-goog-channel-token') token: string | undefined,
    @Headers('x-goog-resource-state') state: string | undefined,
    @Headers('x-goog-channel-id') channelId: string | undefined,
  ): Promise<void> {
    const expected = process.env.GOOGLE_WEBHOOK_SECRET;
    if (expected && token !== expected) {
      this.logger.warn(`Webhook auth failed for channel ${channelId}`);
      return;
    }
    if (state === 'sync') {
      return;
    }

    if (channelId) {
      const active = await this.prisma.calendarChannel.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { channelId: true },
      });
      if (active && active.channelId !== channelId) {
        this.logger.warn(
          `Ignoring webhook for stale channel ${channelId} (active: ${active.channelId})`,
        );
        return;
      }
    }

    void this.sync.triggerReconcile().catch((err) => {
      this.logger.error(`Reconcile failed: ${err}`);
    });
  }
}
