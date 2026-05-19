import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './integrations/prisma/prisma.module';
import { GoogleCalendarModule } from './integrations/google-calendar/google-calendar.module';
import { MailModule } from './integrations/mail/mail.module';
import { TelegramModule } from './integrations/telegram/telegram.module';
import { BookingModule } from './modules/booking/booking.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 60_000, limit: 30 },
      { name: 'long', ttl: 3_600_000, limit: 200 },
    ]),
    PrismaModule,
    GoogleCalendarModule,
    MailModule,
    BookingModule,
    TelegramModule,
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
