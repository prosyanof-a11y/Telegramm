import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { MAX_POST_LENGTH } from './claude.js';

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

// Telegraf handlerTimeout: 30s to prevent hanging on slow Telegram API
export const bot = new Telegraf(botToken || 'placeholder_token_will_not_work', {
  handlerTimeout: 30_000,
});

export async function publishPost(channelId: string, text: string, imageUrl?: string | null): Promise<string> {
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not set');

  // Enforce Telegram's 4096 char limit (using our 4000 constant)
  const safeText = text.slice(0, MAX_POST_LENGTH);

  try {
    let message;
    if (imageUrl) {
      // Caption limit is 1024 for photos — fall back to text message if too long
      if (safeText.length > 1024) {
        await bot.telegram.sendPhoto(channelId, imageUrl);
        message = await bot.telegram.sendMessage(channelId, safeText, { parse_mode: 'HTML' });
      } else {
        message = await bot.telegram.sendPhoto(channelId, imageUrl, { caption: safeText, parse_mode: 'HTML' });
      }
    } else {
      message = await bot.telegram.sendMessage(channelId, safeText, { parse_mode: 'HTML' });
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
