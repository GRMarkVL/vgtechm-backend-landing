import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../integrations/prisma/prisma.service';
import {
  ALMATY_TZ,
  GoogleCalendarService,
} from '../../integrations/google-calendar/google-calendar.service';
import { MailService } from '../../integrations/mail/mail.service';
import { TelegramService } from '../../integrations/telegram/telegram.service';
import { CreateBookingDto, DirectionDto } from './dto/create-booking.dto';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addMinutes } from 'date-fns';

const SLOT_MINUTES = 60;
const WORK_HOUR_START = 10;
const WORK_HOUR_END = 18;

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: GoogleCalendarService,
    private readonly mail: MailService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegram: TelegramService,
  ) {}

  async getSlots(fromIso: string, toIso: string): Promise<string[]> {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) {
      throw new BadRequestException('Invalid range');
    }

    const candidates = this.generateCandidates(from, to);

    const [busyCal, busyDb] = await Promise.all([
      this.calendar.getBusy(from, to).catch((err) => {
        this.logger.warn(`Calendar busy fetch failed: ${err}`);
        return [];
      }),
      this.prisma.booking.findMany({
        where: {
          slotAt: { gte: from, lte: to },
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        select: { slotAt: true },
      }),
    ]);

    const occupied = [
      ...busyCal,
      ...busyDb.map((b) => ({
        start: b.slotAt,
        end: addMinutes(b.slotAt, SLOT_MINUTES),
      })),
    ];

    return candidates
      .filter((slot) => {
        const end = addMinutes(slot, SLOT_MINUTES);
        return !occupied.some((b) => slot < b.end && end > b.start);
      })
      .map((d) => d.toISOString());
  }

  private generateCandidates(from: Date, to: Date): Date[] {
    const out: Date[] = [];
    const now = new Date();
    const minStart = addMinutes(now, 60);
    const cursorZoned = toZonedTime(from, ALMATY_TZ);
    cursorZoned.setHours(WORK_HOUR_START, 0, 0, 0);

    let current = fromZonedTime(cursorZoned, ALMATY_TZ);

    while (current < to) {
      const zoned = toZonedTime(current, ALMATY_TZ);
      const dow = zoned.getDay();
      const hour = zoned.getHours();
      const isWeekday = dow >= 1 && dow <= 5;
      const isWorkHour = hour >= WORK_HOUR_START && hour < WORK_HOUR_END;

      if (isWeekday && isWorkHour && current >= minStart && current >= from) {
        out.push(new Date(current));
      }

      current = addMinutes(current, SLOT_MINUTES);

      const z2 = toZonedTime(current, ALMATY_TZ);
      if (z2.getHours() >= WORK_HOUR_END) {
        z2.setDate(z2.getDate() + 1);
        z2.setHours(WORK_HOUR_START, 0, 0, 0);
        current = fromZonedTime(z2, ALMATY_TZ);
      }
    }
    return out;
  }

  async create(dto: CreateBookingDto): Promise<{ id: string; slotAt: string }> {
    const slotAt = new Date(dto.slotAt);
    if (isNaN(slotAt.getTime())) {
      throw new BadRequestException('Invalid slotAt');
    }
    const slotEnd = addMinutes(slotAt, SLOT_MINUTES);

    const dbConflict = await this.prisma.booking.findFirst({
      where: {
        slotAt,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    });
    if (dbConflict) throw new ConflictException('Slot taken');

    const busy = await this.calendar
      .getBusy(slotAt, slotEnd)
      .catch(() => []);
    if (busy.some((b) => slotAt < b.end && slotEnd > b.start)) {
      throw new ConflictException('Slot taken');
    }

    let booking;
    try {
      booking = await this.prisma.booking.create({
        data: {
          direction: dto.direction,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          answers: dto.answers,
          comment: dto.comment,
          slotAt,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Slot taken');
      }
      throw err;
    }

    let calendarFailed = false;
    try {
      const eventId = await this.calendar.createEvent({
        summary: `[ОЖИДАЕТ] ${booking.direction} — ${booking.name}`,
        description: this.buildEventDescription(booking),
        start: slotAt,
        end: slotEnd,
        attendeeEmail: booking.email,
        tentative: true,
      });
      booking = await this.prisma.booking.update({
        where: { id: booking.id },
        data: { calendarEventId: eventId },
      });
    } catch (err) {
      calendarFailed = true;
      this.logger.error(`Calendar event create failed for ${booking.id}: ${err}`);
    }

    await Promise.allSettled([
      this.telegram.notifyNewBooking({
        id: booking.id,
        direction: booking.direction as 'MARKETING' | 'IT',
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
        slotAt: booking.slotAt,
        answers: booking.answers,
        comment: booking.comment,
        calendarFailed,
      }),
      this.mail.sendPending({
        to: booking.email,
        name: booking.name,
        slotAt: booking.slotAt,
        direction: booking.direction as 'MARKETING' | 'IT',
      }),
    ]);

    return { id: booking.id, slotAt: booking.slotAt.toISOString() };
  }

  async confirm(id: string): Promise<void> {
    const b = await this.prisma.booking.findUnique({ where: { id } });
    if (!b) throw new NotFoundException();
    if (b.status === 'CONFIRMED') return;

    await this.prisma.booking.update({
      where: { id },
      data: { status: 'CONFIRMED' },
    });

    if (b.calendarEventId) {
      await this.calendar.confirmEvent(b.calendarEventId).catch((err) => {
        this.logger.warn(`Calendar confirm failed: ${err}`);
      });
    }

    await this.mail.sendConfirmed({
      to: b.email,
      name: b.name,
      slotAt: b.slotAt,
      direction: b.direction as 'MARKETING' | 'IT',
    });
  }

  async cancel(id: string): Promise<void> {
    const b = await this.prisma.booking.findUnique({ where: { id } });
    if (!b) throw new NotFoundException();
    if (b.status === 'CANCELLED') return;

    await this.prisma.booking.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    if (b.calendarEventId) {
      await this.calendar.deleteEvent(b.calendarEventId);
    }

    await this.mail.sendCancelled({
      to: b.email,
      name: b.name,
      slotAt: b.slotAt,
      direction: b.direction as 'MARKETING' | 'IT',
    });
  }

  private buildEventDescription(b: {
    direction: string;
    name: string;
    email: string;
    phone: string;
    answers: unknown;
    comment: string | null;
  }): string {
    const lines = [
      `Направление: ${b.direction}`,
      `Имя: ${b.name}`,
      `Email: ${b.email}`,
      `Телефон: ${b.phone}`,
      '',
      'Ответы:',
    ];
    if (b.answers && typeof b.answers === 'object') {
      for (const [k, v] of Object.entries(b.answers as Record<string, string>)) {
        lines.push(`• ${k}: ${v}`);
      }
    }
    if (b.comment) {
      lines.push('', 'Комментарий:', b.comment);
    }
    return lines.join('\n');
  }
}

export { DirectionDto };
