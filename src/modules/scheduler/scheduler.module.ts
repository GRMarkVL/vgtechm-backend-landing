import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { MailModule } from '../../integrations/mail/mail.module';
import { TelegramModule } from '../../integrations/telegram/telegram.module';

@Module({
  imports: [ScheduleModule.forRoot(), MailModule, TelegramModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
