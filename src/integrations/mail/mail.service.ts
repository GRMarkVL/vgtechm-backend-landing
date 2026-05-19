import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import { ALMATY_TZ } from '../google-calendar/google-calendar.service';

type BookingPayload = {
  to: string;
  name: string;
  slotAt: Date;
  direction: 'MARKETING' | 'IT';
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);
  private readonly from = process.env.RESEND_FROM || 'onboarding@resend.dev';

  private fmt(d: Date): string {
    return formatInTimeZone(d, ALMATY_TZ, 'd MMMM yyyy, HH:mm', { locale: ru });
  }

  private directionLabel(d: 'MARKETING' | 'IT'): string {
    return d === 'MARKETING' ? 'маркетингу' : 'IT';
  }

  async sendPending(p: BookingPayload): Promise<void> {
    const when = this.fmt(p.slotAt);
    await this.send(
      p.to,
      'Заявка принята — VGTechM',
      `<p>Здравствуйте, ${escape(p.name)}!</p>
       <p>Ваша заявка на консультацию по ${this.directionLabel(p.direction)} принята.</p>
       <p><b>Предварительное время:</b> ${when} (Алматы).</p>
       <p>Мы свяжемся с вами после подтверждения — обычно в течение рабочего дня.</p>
       <p>— Команда VGTechM</p>`,
    );
  }

  async sendConfirmed(p: BookingPayload): Promise<void> {
    const when = this.fmt(p.slotAt);
    await this.send(
      p.to,
      'Встреча подтверждена — VGTechM',
      `<p>Здравствуйте, ${escape(p.name)}!</p>
       <p>Ваша консультация по ${this.directionLabel(p.direction)} подтверждена.</p>
       <p><b>Когда:</b> ${when} (Алматы).</p>
       <p>Длительность — 60 минут. Ссылку на встречу пришлём отдельным письмом.</p>
       <p>— Команда VGTechM</p>`,
    );
  }

  async sendCancelled(p: BookingPayload): Promise<void> {
    await this.send(
      p.to,
      'Заявка отклонена — VGTechM',
      `<p>Здравствуйте, ${escape(p.name)}!</p>
       <p>К сожалению, мы не сможем провести встречу в выбранное время.
       Пожалуйста, выберите другой слот на сайте — мы будем рады обсудить ваш проект.</p>
       <p>— Команда VGTechM</p>`,
    );
  }

  async sendReminder(p: BookingPayload): Promise<void> {
    const when = this.fmt(p.slotAt);
    await this.send(
      p.to,
      'Напоминание о встрече через час — VGTechM',
      `<p>Здравствуйте, ${escape(p.name)}!</p>
       <p>Напоминаем — ваша консультация по ${this.directionLabel(p.direction)} начнётся в <b>${when}</b> (Алматы).</p>
       <p>— Команда VGTechM</p>`,
    );
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.resend.emails.send({ from: this.from, to, subject, html });
    } catch (err) {
      this.logger.error(`Resend send failed: ${err}`);
    }
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  );
}
