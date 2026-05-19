import { Module, forwardRef } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { GoogleCalendarModule } from '../../integrations/google-calendar/google-calendar.module';
import { MailModule } from '../../integrations/mail/mail.module';
import { TelegramModule } from '../../integrations/telegram/telegram.module';

@Module({
  imports: [
    GoogleCalendarModule,
    MailModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
