import https from 'node:https';
import { config } from '../config/env';
import { formatBytes } from '../utils/format';

/**
 * Fire-and-forget upload alerts. Disabled unless both the bot token and the
 * chat id are set to real values, so a default install stays silent instead of
 * erroring on every upload.
 */
function send(text: string): void {
  const { token, chatId, enabled } = config.telegram;
  if (!enabled || !token || !chatId) return;

  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });

  const request = https.request({
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  });

  request.on('error', (error) => console.error('Failed to send Telegram alert:', error));
  request.end(payload);
}

export function notifyFileUploaded(params: {
  name: string;
  size: number;
  mimeType: string;
  downloadUrl: string;
}): void {
  send(
    `📤 <b>New File Uploaded on SuvShare!</b>\n\n` +
      `📁 <b>Name:</b> <code>${params.name}</code>\n` +
      `⚖️ <b>Size:</b> <code>${formatBytes(params.size)}</code>\n` +
      `🏷️ <b>Type:</b> <code>${params.mimeType}</code>\n\n` +
      `🔗 <b>Link:</b> <a href="${params.downloadUrl}">${params.downloadUrl}</a>`,
  );
}

export function notifyFolderCreated(params: {
  name: string;
  size: number;
  downloadUrl: string;
}): void {
  send(
    `📤 <b>New Folder Uploaded on SuvShare!</b>\n\n` +
      `📁 <b>Name:</b> <code>${params.name}</code>\n` +
      `⚖️ <b>Size:</b> <code>${formatBytes(params.size)}</code>\n\n` +
      `🔗 <b>Link:</b> <a href="${params.downloadUrl}">${params.downloadUrl}</a>`,
  );
}
