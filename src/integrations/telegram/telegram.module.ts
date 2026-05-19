import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { BookingModule } from '../../modules/booking/booking.module';

@Module({
  imports: [forwardRef(() => BookingModule)],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
