import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { splitMessage } from './claude.js';

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

// Telegraf handlerTimeout: 30s to prevent hanging on slow Telegram API
export const bot = new Telegraf(botToken || 'placeholder_token_will_not_work', {
  handlerTimeout: 30_000,
});

export async function publishPost(channelId: string, text: string, imageUrl?: string | null): Promise<string> {
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not set');

  try {
    console.log('[4/5] Передано в Telegram символов:', text.length);
    const parts = splitMessage(text);
    console.log('[4/5] Разбито на частей:', parts.length, '| длины:', parts.map(p => p.length));
    let message;
    if (imageUrl) {
      // Caption limit for photos is 1024 — send photo without caption, then text as messages
      if (parts[0].length > 1024) {
        await bot.telegram.sendPhoto(channelId, imageUrl);
        message = await bot.telegram.sendMessage(channelId, parts[0], { parse_mode: 'HTML' });
      } else {
        message = await bot.telegram.sendPhoto(channelId, imageUrl, { caption: parts[0], parse_mode: 'HTML' });
      }
    } else {
      message = await bot.telegram.sendMessage(channelId, parts[0], { parse_mode: 'HTML' });
    }
    for (let i = 1; i < parts.length; i++) {
      await bot.telegram.sendMessage(channelId, parts[i], { parse_mode: 'HTML' });
    }
    return message.message_id.toString();
  } catch (error: any) {
    console.error('[Telegram] publishPost error:', error.message || error);
    throw error;
  }
}

export async function notifyAdmin(message: string): Promise<void> {
  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminId || !botToken) return;
  try {
    await bot.telegram.sendMessage(adminId, message.slice(0, 4096));
  } catch (error: any) {
    console.error('[Telegram] notifyAdmin error:', error.message || error);
  }
}
