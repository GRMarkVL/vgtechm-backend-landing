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

type Variant = 'pending' | 'confirmed' | 'cancelled' | 'reminder' | 'rescheduled';

type RescheduledPayload = {
  to: string;
  name: string;
  direction: 'MARKETING' | 'IT';
  oldSlot: Date;
  newSlot: Date;
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
    return d === 'MARKETING' ? 'Маркетинг' : 'IT';
  }

  async sendPending(p: BookingPayload): Promise<void> {
    await this.send(
      p.to,
      'Заявка принята — VGTechM',
      this.renderTemplate('pending', p),
    );
  }

  async sendConfirmed(p: BookingPayload): Promise<void> {
    await this.send(
      p.to,
      'Встреча подтверждена — VGTechM',
      this.renderTemplate('confirmed', p),
    );
  }

  async sendCancelled(p: BookingPayload): Promise<void> {
    await this.send(
      p.to,
      'Заявка отклонена — VGTechM',
      this.renderTemplate('cancelled', p),
    );
  }

  async sendReminder(p: BookingPayload): Promise<void> {
    await this.send(
      p.to,
      'Напоминание о встрече через час — VGTechM',
      this.renderTemplate('reminder', p),
    );
  }

  async sendRescheduled(p: RescheduledPayload): Promise<void> {
    const oldWhen = this.fmt(p.oldSlot);
    const newWhen = this.fmt(p.newSlot);
    const content = this.buildContent('rescheduled', {
      name: escapeHtml(p.name),
      when: newWhen,
      dirLabel: this.directionLabel(p.direction),
      oldWhen,
    });
    await this.send(
      p.to,
      'Время встречи изменилось — VGTechM',
      this.layout(content),
    );
  }

  private renderTemplate(variant: Variant, p: BookingPayload): string {
    const when = this.fmt(p.slotAt);
    const dirLabel = this.directionLabel(p.direction);
    const name = escapeHtml(p.name);

    const content = this.buildContent(variant, { name, when, dirLabel });
    return this.layout(content);
  }

  private buildContent(
    variant: Variant,
    v: { name: string; when: string; dirLabel: string; oldWhen?: string },
  ): {
    eyebrow: string;
    heading: string;
    intro: string;
    detailRows: Array<[string, string]>;
    note?: string;
    accent: 'blue' | 'green' | 'red' | 'amber';
  } {
    switch (variant) {
      case 'pending':
        return {
          eyebrow: 'Заявка принята',
          heading: `Спасибо, ${v.name}`,
          intro:
            'Мы получили вашу заявку и свяжемся в течение рабочего дня. Слот зарезервирован — после подтверждения вы получите письмо со ссылкой на встречу.',
          detailRows: [
            ['Направление', v.dirLabel],
            ['Предварительное время', `${v.when} · Алматы`],
            ['Длительность', '60 минут'],
            ['Статус', 'Ожидает подтверждения'],
          ],
          accent: 'blue',
        };
      case 'confirmed':
        return {
          eyebrow: 'Встреча подтверждена',
          heading: `${v.name}, до встречи!`,
          intro:
            'Время согласовано — ждём вас на консультации. Ссылку для подключения пришлём отдельным письмом ближе к началу.',
          detailRows: [
            ['Направление', v.dirLabel],
            ['Когда', `${v.when} · Алматы`],
            ['Длительность', '60 минут'],
            ['Статус', 'Подтверждено'],
          ],
          note:
            'Если планы изменились — просто ответьте на это письмо, и мы перенесём встречу.',
          accent: 'green',
        };
      case 'cancelled':
        return {
          eyebrow: 'Слот отменён',
          heading: `${v.name}, к сожалению…`,
          intro:
            'Мы не сможем провести встречу в выбранное время. Свободные слоты можно посмотреть на сайте — будем рады продолжить разговор.',
          detailRows: [
            ['Направление', v.dirLabel],
            ['Отменённый слот', `${v.when} · Алматы`],
          ],
          accent: 'red',
        };
      case 'reminder':
        return {
          eyebrow: 'Через час',
          heading: `${v.name}, напоминаем о встрече`,
          intro:
            'Ваша консультация начнётся через час. Заранее подготовьте материалы — это поможет провести встречу плотнее.',
          detailRows: [
            ['Направление', v.dirLabel],
            ['Старт', `${v.when} · Алматы`],
            ['Длительность', '60 минут'],
          ],
          accent: 'amber',
        };
      case 'rescheduled':
        return {
          eyebrow: 'Время изменилось',
          heading: `${v.name}, у нас перенос`,
          intro:
            'Мы немного сдвинули встречу. Если новое время не подходит — ответьте на письмо, согласуем другое.',
          detailRows: [
            ['Направление', v.dirLabel],
            ['Было', `${v.oldWhen ?? '—'} · Алматы`],
            ['Стало', `${v.when} · Алматы`],
            ['Длительность', '60 минут'],
          ],
          accent: 'amber',
        };
    }
  }

  private layout(content: ReturnType<MailService['buildContent']>): string {
    const accentGradient = {
      blue: 'linear-gradient(135deg,#4ea8ff 0%,#7ddfff 100%)',
      green: 'linear-gradient(135deg,#22c55e 0%,#86efac 100%)',
      red: 'linear-gradient(135deg,#ff5b6b 0%,#ff2e8a 100%)',
      amber: 'linear-gradient(135deg,#f59e0b 0%,#fbbf24 100%)',
    }[content.accent];

    const accentText = {
      blue: '#4ea8ff',
      green: '#16a34a',
      red: '#ff2e8a',
      amber: '#d97706',
    }[content.accent];

    const detailsRows = content.detailRows
      .map(
        ([label, value]) => `
          <tr>
            <td style="padding:14px 0;border-bottom:1px solid #eef0f4;color:#6b7280;font-size:13px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;width:45%;">${escapeHtml(label)}</td>
            <td style="padding:14px 0;border-bottom:1px solid #eef0f4;color:#0a0a14;font-size:15px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;text-align:right;">${value}</td>
          </tr>`,
      )
      .join('');

    const noteBlock = content.note
      ? `<p style="margin:24px 0 0;padding:16px 18px;background:#f7f8fb;border-left:3px solid ${accentText};border-radius:8px;color:#4b5563;font-size:14px;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escapeHtml(content.note)}</p>`
      : '';

    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>VGTechM</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#0a0a14;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 18px 48px -24px rgba(15,23,42,0.18);">
          <!-- accent bar -->
          <tr>
            <td style="height:6px;background:${accentGradient};"></td>
          </tr>

          <!-- brand -->
          <tr>
            <td style="padding:32px 36px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:700;font-size:20px;letter-spacing:-0.02em;color:#0a0a14;">
                    VG<span style="color:#4ea8ff;">Tech</span><span style="color:#ff2e8a;">M</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- content -->
          <tr>
            <td style="padding:24px 36px 8px;">
              <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:${accentText}15;color:${accentText};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                ${escapeHtml(content.eyebrow)}
              </div>
              <h1 style="margin:18px 0 12px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;font-size:26px;line-height:1.25;letter-spacing:-0.02em;color:#0a0a14;">
                ${content.heading}
              </h1>
              <p style="margin:0 0 24px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#4b5563;">
                ${escapeHtml(content.intro)}
              </p>
            </td>
          </tr>

          <!-- details -->
          <tr>
            <td style="padding:0 36px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafbfd;border-radius:14px;padding:6px 18px;">
                ${detailsRows}
              </table>
              ${noteBlock}
            </td>
          </tr>

          <!-- footer -->
          <tr>
            <td style="padding:32px 36px 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-top:1px solid #eef0f4;padding-top:20px;">
                    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b7280;">
                      Команда <b style="color:#0a0a14;">VGTechM</b><br/>
                      Разработка и маркетинг под одним контрактом.
                    </p>
                    <p style="margin:14px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9ca3af;">
                      Это автоматическое письмо. Если у вас есть вопросы — просто ответьте на него.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <p style="margin:18px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:#9ca3af;letter-spacing:0.06em;">
          © VGTechM · Алматы, Казахстан
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.resend.emails.send({ from: this.from, to, subject, html });
    } catch (err) {
      this.logger.error(`Resend send failed: ${err}`);
    }
  }
}

function escapeHtml(s: string): string {
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
