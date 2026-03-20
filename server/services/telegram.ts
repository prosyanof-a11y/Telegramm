import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

// Create bot instance - will fail gracefully if token is missing
export const bot = new Telegraf(botToken || 'placeholder_token_will_not_work');

export async function publishPost(channelId: string, text: string, imageUrl?: string | null): Promise<string> {
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  try {
    let message;
    if (imageUrl) {
      message = await bot.telegram.sendPhoto(channelId, imageUrl, { caption: text, parse_mode: 'HTML' });
    } else {
      message = await bot.telegram.sendMessage(channelId, text, { parse_mode: 'HTML' });
    }
    return message.message_id.toString();
  } catch (error) {
    console.error('Error publishing post:', error);
    throw error;
  }
}

export async function notifyAdmin(message: string): Promise<void> {
  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminId || !botToken) return;
  try {
    await bot.telegram.sendMessage(adminId, message);
  } catch (error) {
    console.error('Error notifying admin:', error);
  }
}
