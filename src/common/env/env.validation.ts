import { Logger } from '@nestjs/common';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ADMIN_CHAT_ID',
  'RESEND_API_KEY',
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    new Logger('Bootstrap').warn(
      `Missing env vars: ${missing.join(', ')} — related features will be disabled or fail.`,
    );
  }
}

export function parseCorsOrigins(): string[] | boolean {
  const raw = process.env.FRONTEND_URL;
  if (!raw) return false;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
