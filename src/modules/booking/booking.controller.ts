import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@Controller('booking')
export class BookingController {
  constructor(private readonly booking: BookingService) {}

  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  @Get('slots')
  async slots(@Query('from') from: string, @Query('to') to: string) {
    return { slots: await this.booking.getSlots(from, to) };
  }

  @Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 20, ttl: 3_600_000 } })
  @Post()
  async create(@Body() dto: CreateBookingDto) {
    return this.booking.create(dto);
  }
}
