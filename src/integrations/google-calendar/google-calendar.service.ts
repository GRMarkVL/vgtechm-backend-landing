import { Injectable, Logger } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

export const ALMATY_TZ = 'Asia/Almaty';

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private readonly calendar: calendar_v3.Calendar;
  private readonly calendarId: string;

  constructor() {
    const oauth2: OAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
    oauth2.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });
    this.calendar = google.calendar({ version: 'v3', auth: oauth2 });
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  }

  async getBusy(from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>> {
    const res = await this.calendar.freebusy.query({
      requestBody: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        timeZone: ALMATY_TZ,
        items: [{ id: this.calendarId }],
      },
    });
    const busy = res.data.calendars?.[this.calendarId]?.busy ?? [];
    return busy
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
  }

  async createEvent(params: {
    summary: string;
    description: string;
    start: Date;
    end: Date;
    attendeeEmail?: string;
    tentative?: boolean;
  }): Promise<string> {
    const res = await this.calendar.events.insert({
      calendarId: this.calendarId,
      sendUpdates: 'none',
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.start.toISOString(), timeZone: ALMATY_TZ },
        end: { dateTime: params.end.toISOString(), timeZone: ALMATY_TZ },
        status: params.tentative ? 'tentative' : 'confirmed',
        attendees: params.attendeeEmail
          ? [{ email: params.attendeeEmail }]
          : undefined,
      },
    });
    if (!res.data.id) {
      throw new Error('Calendar event id missing');
    }
    return res.data.id;
  }

  async confirmEvent(eventId: string): Promise<void> {
    await this.calendar.events.patch({
      calendarId: this.calendarId,
      eventId,
      requestBody: { status: 'confirmed' },
    });
  }

  async deleteEvent(eventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId,
      });
    } catch (err) {
      this.logger.warn(`Failed to delete event ${eventId}: ${err}`);
    }
  }
}
