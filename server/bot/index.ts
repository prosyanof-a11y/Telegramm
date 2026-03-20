import { bot } from '../services/telegram.js';
import { db } from '../db/index.js';
import { users, channels, posts } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createPresentation } from '../services/figma.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

bot.start(async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const username = ctx.from.username;

  const [existingUser] = await db.select().from(users).where(eq(users.telegramId, telegramId));
  if (!existingUser) {
    await db.insert(users).values({ telegramId, username });
  }

  ctx.reply('Добро пожаловать в Telegram Channel Manager! Ваш аккаунт зарегистрирован.');
});

bot.action(/approve_(.+)/, async (ctx) => {
  const postId = ctx.match[1];
  await db.update(posts).set({ status: 'approved' }).where(eq(posts.id, postId));
  ctx.reply('Пост одобрен и добавлен в очередь.');
});

bot.action(/reject_(.+)/, async (ctx) => {
  const postId = ctx.match[1];
  await db.update(posts).set({ status: 'rejected' }).where(eq(posts.id, postId));
  ctx.reply('Пост отклонен.');
});

// Presentation state
const presentationState = new Map<number, { step: number, channelId?: string }>();

bot.command('presentation', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
  if (!user) return ctx.reply('Пользователь не найден.');

  const userChannels = await db.select().from(channels).where(eq(channels.userId, user.id));
  if (userChannels.length === 0) return ctx.reply('У вас нет каналов.');

  const buttons = userChannels.map(c => [{ text: c.name, callback_data: `pres_chan_${c.id}` }]);
  
  presentationState.set(ctx.from.id, { step: 1 });
  
  ctx.reply('Для какого канала создать презентацию?', {
    reply_markup: { inline_keyboard: buttons }
  });
});

bot.action(/pres_chan_(.+)/, async (ctx) => {
  const channelId = ctx.match[1];
  const state = presentationState.get(ctx.from.id);
  if (state && state.step === 1) {
    state.step = 2;
    state.channelId = channelId;
    ctx.reply('Пришлите данные о продукте для презентации.');
  }
});

bot.on('text', async (ctx) => {
  const state = presentationState.get(ctx.from.id);
  if (state && state.step === 2 && state.channelId) {
    ctx.reply('Генерирую структуру презентации...');
    
    try {
      const prompt = `Создай структуру презентации для продукта.
Данные: ${ctx.message.text}
Верни ТОЛЬКО валидный JSON массив объектов SlideData.
Формат SlideData:
{
  "type": "title" | "problem" | "solution" | "benefits" | "price" | "cta",
  "heading": "string",
  "subheading": "string",
  "text": "string",
  "points": ["string"],
  "items": [{"icon": "string", "text": "string"}],
  "plans": [{"name": "string", "price": "string", "features": ["string"]}],
  "contact": "string"
}`;

      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      const jsonStr = (response.content[0] as any).text;
      const slides = JSON.parse(jsonStr.replace(/```json\n?|\n?```/g, ''));

      ctx.reply('Создаю презентацию в Figma...');
      const url = await createPresentation(slides);
      
      ctx.reply(`Презентация готова: ${url}`);
      presentationState.delete(ctx.from.id);
    } catch (error) {
      console.error(error);
      ctx.reply('Произошла ошибка при создании презентации.');
      presentationState.delete(ctx.from.id);
    }
  }
});

export function startBot() {
  bot.launch().then(() => {
    console.log('[Bot] Telegram бот запущен');
  }).catch(err => {
    console.error('[Bot] Ошибка запуска бота:', err);
  });
}
