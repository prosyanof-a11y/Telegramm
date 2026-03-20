import { bot } from '../services/telegram.js';
import { db } from '../db/index.js';
import { users, channels, posts } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createPresentation } from '../services/figma.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

bot.start(async (ctx) => {
  try {
    if (!ctx.from) return;
    const telegramId = ctx.from.id.toString();
    const username = ctx.from.username;

    try {
      const [existingUser] = await db.select().from(users).where(eq(users.telegramId, telegramId));
      if (!existingUser) {
        await db.insert(users).values({ telegramId, username } as any);
      }
    } catch (dbError) {
      console.error('[Bot] DB error in /start:', dbError);
    }

    await ctx.reply('Добро пожаловать в Telegram Channel Manager! Ваш аккаунт зарегистрирован.');
  } catch (error) {
    console.error('[Bot] Error in /start handler:', error);
  }
});

bot.action(/approve_(.+)/, async (ctx) => {
  try {
    const postId = ctx.match[1];
    await db.update(posts).set({ status: 'approved' } as any).where(eq(posts.id, postId));
    await ctx.reply('Пост одобрен и добавлен в очередь.');
  } catch (error) {
    console.error('[Bot] Error in approve action:', error);
  }
});

bot.action(/reject_(.+)/, async (ctx) => {
  try {
    const postId = ctx.match[1];
    await db.update(posts).set({ status: 'rejected' } as any).where(eq(posts.id, postId));
    await ctx.reply('Пост отклонен.');
  } catch (error) {
    console.error('[Bot] Error in reject action:', error);
  }
});

// Presentation state
const presentationState = new Map<number, { step: number, channelId?: string }>();

bot.command('presentation', async (ctx) => {
  try {
    if (!ctx.from) return;
    const telegramId = ctx.from.id.toString();
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    if (!user) return ctx.reply('Пользователь не найден. Отправьте /start для регистрации.');

    const userChannels = await db.select().from(channels).where(eq(channels.userId, user.id));
    if (userChannels.length === 0) return ctx.reply('У вас нет каналов. Добавьте канал через веб-интерфейс.');

    const buttons = userChannels.map((c: any) => [{ text: c.name, callback_data: `pres_chan_${c.id}` }]);
    
    presentationState.set(ctx.from.id, { step: 1 });
    
    await ctx.reply('Для какого канала создать презентацию?', {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('[Bot] Error in /presentation command:', error);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
});

bot.action(/pres_chan_(.+)/, async (ctx) => {
  try {
    if (!ctx.from) return;
    const channelId = ctx.match[1];
    const state = presentationState.get(ctx.from.id);
    if (state && state.step === 1) {
      state.step = 2;
      state.channelId = channelId;
      await ctx.reply('Пришлите данные о продукте для презентации.');
    }
  } catch (error) {
    console.error('[Bot] Error in pres_chan action:', error);
  }
});

bot.on('text', async (ctx) => {
  try {
    if (!ctx.from) return;
    const state = presentationState.get(ctx.from.id);
    if (state && state.step === 2 && state.channelId) {
      await ctx.reply('Генерирую структуру презентации...');
      
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
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });

        const jsonStr = (response.content[0] as any).text;
        const slides = JSON.parse(jsonStr.replace(/```json\n?|\n?```/g, ''));

        await ctx.reply('Создаю презентацию в Figma...');
        const url = await createPresentation(slides);
        
        await ctx.reply(`Презентация готова: ${url}`);
        presentationState.delete(ctx.from.id);
      } catch (error) {
        console.error('[Bot] Error creating presentation:', error);
        await ctx.reply('Произошла ошибка при создании презентации.');
        presentationState.delete(ctx.from.id);
      }
    }
  } catch (error) {
    console.error('[Bot] Error in text handler:', error);
  }
});

export function startBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn('[Bot] TELEGRAM_BOT_TOKEN не установлен, бот не запущен');
    return;
  }
  
  console.log('[Bot] Запуск Telegram бота...');
  
  bot.launch({
    allowedUpdates: ['message', 'callback_query'],
  }).then(() => {
    console.log('[Bot] Telegram бот запущен успешно');
  }).catch((err: any) => {
    console.error('[Bot] Ошибка запуска бота:', err.message || err);
  });

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
