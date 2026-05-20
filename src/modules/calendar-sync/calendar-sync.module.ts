import { Module, forwardRef } from '@nestjs/common';
import { CalendarSyncController } from './calendar-sync.controller';
import { CalendarSyncService } from './calendar-sync.service';
import { GoogleCalendarModule } from '../../integrations/google-calendar/google-calendar.module';
import { MailModule } from '../../integrations/mail/mail.module';
import { TelegramModule } from '../../integrations/telegram/telegram.module';

@Module({
  imports: [
    GoogleCalendarModule,
    MailModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [CalendarSyncController],
  providers: [CalendarSyncService],
})
export class CalendarSyncModule {}
