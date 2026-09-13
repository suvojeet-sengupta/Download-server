/**
 * Environment parsing and validation. Fails fast and loudly: a missing
 * password must stop the process rather than boot an unprotected server.
 */

const PLACEHOLDERS = new Set(['YOUR_TELEGRAM_BOT_TOKEN', 'YOUR_TELEGRAM_CHAT_ID', '']);

export interface TelegramConfig {
  token: string | null;
  chatId: string | null;
  /** True only when both values are real, so callers need one check. */
  enabled: boolean;
}

export interface AppConfig {
  port: number;
  password: string;
  /** Empty string means "derive links from the incoming request". */
  publicUrl: string;
  maxStorageGb: number;
  maxStorageBytes: number;
  /** archiver zlib level, 0-9. */
  zipCompressionLevel: number;
  /** Hard per-request upload ceiling in bytes. */
  maxUploadBytes: number;
  telegram: TelegramConfig;
}

function readInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readTelegram(): TelegramConfig {
  const rawToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const rawChatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? '';
  const token = PLACEHOLDERS.has(rawToken) ? null : rawToken;
  const chatId = PLACEHOLDERS.has(rawChatId) ? null : rawChatId;
  return { token, chatId, enabled: token !== null && chatId !== null };
}

export function loadConfig(): AppConfig {
  const password = process.env.PASSWORD;
  if (!password) {
    console.error('FATAL ERROR: PASSWORD environment variable is not defined.');
    process.exit(1);
  }

  const maxStorageGb = readInt(process.env.MAX_STORAGE_LIMIT_GB, 20);

  return {
    port: readInt(process.env.PORT, 3009),
    password,
    publicUrl: (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, ''),
    maxStorageGb,
    maxStorageBytes: maxStorageGb * 1024 * 1024 * 1024,
    zipCompressionLevel: clamp(readInt(process.env.ZIP_COMPRESSION_LEVEL, 1), 0, 9),
    maxUploadBytes: 20 * 1024 * 1024 * 1024,
    telegram: readTelegram(),
  };
}

export const config: AppConfig = loadConfig();
