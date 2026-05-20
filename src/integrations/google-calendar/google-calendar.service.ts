import { Injectable, Logger } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'node:crypto';

export type CalendarEventChange = {
  id: string;
  status: 'cancelled' | 'confirmed' | 'tentative';
  start?: Date;
  end?: Date;
};

export type IncrementalSyncResult = {
  events: CalendarEventChange[];
  nextSyncToken: string | null;
  expired: boolean;
};

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

  async startWatch(params: {
    webhookUrl: string;
    secret: string;
  }): Promise<{ channelId: string; resourceId: string; expiresAt: Date }> {
    const channelId = randomUUID();
    const res = await this.calendar.events.watch({
      calendarId: this.calendarId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: params.webhookUrl,
        token: params.secret,
      },
    });
    const resourceId = res.data.resourceId;
    const expirationMs = res.data.expiration ? Number(res.data.expiration) : 0;
    if (!resourceId || !expirationMs) {
      throw new Error('Calendar watch: missing resourceId or expiration in response');
    }
    return {
      channelId,
      resourceId,
      expiresAt: new Date(expirationMs),
    };
  }

  async stopWatch(channelId: string, resourceId: string): Promise<void> {
    try {
      await this.calendar.channels.stop({
        requestBody: { id: channelId, resourceId },
      });
    } catch (err) {
      this.logger.warn(`stopWatch failed for ${channelId}: ${err}`);
    }
  }

  async incrementalSync(syncToken?: string | null): Promise<IncrementalSyncResult> {
    const events: CalendarEventChange[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    try {
      while (true) {
        const res = await this.calendar.events.list({
          calendarId: this.calendarId,
          ...(syncToken ? { syncToken } : { timeMin: new Date().toISOString() }),
          pageToken,
          showDeleted: true,
          singleEvents: true,
          maxResults: 250,
        });

        for (const e of res.data.items ?? []) {
          if (!e.id) continue;
          const status =
            e.status === 'cancelled'
              ? 'cancelled'
              : e.status === 'tentative'
                ? 'tentative'
                : 'confirmed';
          events.push({
            id: e.id,
            status,
            start: e.start?.dateTime ? new Date(e.start.dateTime) : undefined,
            end: e.end?.dateTime ? new Date(e.end.dateTime) : undefined,
          });
        }

        if (res.data.nextPageToken) {
          pageToken = res.data.nextPageToken;
          continue;
        }
        nextSyncToken = res.data.nextSyncToken ?? null;
        break;
      }
      return { events, nextSyncToken, expired: false };
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 410) {
        this.logger.warn('syncToken expired (410 Gone), will perform full re-sync');
        return { events: [], nextSyncToken: null, expired: true };
      }
      throw err;
    }
  }
}
