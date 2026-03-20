import { bot } from '../services/telegram.js';
import { db } from '../db/index.js';
import { users, channels, posts } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createPresentation } from '../services/figma.js';
import { generateSlidesStructure } from '../services/claude.js';

bot.start(async (ctx) => {
  try {
    if (!ctx.from) return;
    const telegramId = ctx.from.id.toString();
    const username = ctx.from.username;

    console.log(`[Bot] /start from user ${telegramId}`);

    try {
      const [existingUser] = await db.select().from(users).where(eq(users.telegramId, telegramId));
      if (!existingUser) {
        await db.insert(users).values({ telegramId, username } as any);
        console.log(`[Bot] New user registered: ${telegramId}`);
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
        const slides = await generateSlidesStructure(ctx.message.text);

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

export function setupWebhook(app: any, domain: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[Bot] TELEGRAM_BOT_TOKEN не установлен, webhook не настроен');
    return;
  }

  const webhookPath = `/bot${token}`;
  const webhookUrl = `https://${domain}${webhookPath}`;
  
  console.log('[Bot] Настройка webhook:', webhookUrl);
  
  // Set webhook
  bot.telegram.setWebhook(webhookUrl).then(() => {
    console.log('[Bot] Webhook установлен:', webhookUrl);
  }).catch((err: any) => {
    console.error('[Bot] Ошибка установки webhook:', err.message || err);
    // Fallback to polling
    startBot();
  });
  
  // Handle webhook requests
  app.post(webhookPath, (req: any, res: any) => {
    bot.handleUpdate(req.body, res);
  });
  
  console.log('[Bot] Webhook endpoint зарегистрирован:', webhookPath);
}

export function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token) {
    console.warn('[Bot] TELEGRAM_BOT_TOKEN не установлен, бот не запущен');
    return;
  }
  
  console.log('[Bot] Запуск Telegram бота через long polling...');
  
  // Delete webhook first to ensure polling works
  bot.telegram.deleteWebhook().then(() => {
    bot.launch({
      allowedUpdates: ['message', 'callback_query'],
    }).then(() => {
      console.log('[Bot] Telegram бот остановлен');
    }).catch((err: any) => {
      console.error('[Bot] Ошибка запуска бота:', err.message || err);
    });
    console.log('[Bot] Long polling запущен успешно');
  }).catch((err: any) => {
    console.error('[Bot] Ошибка удаления webhook:', err.message || err);
  });

  // Enable graceful stop
  process.once('SIGINT', () => {
    console.log('[Bot] Получен SIGINT, останавливаем бота...');
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    console.log('[Bot] Получен SIGTERM, останавливаем бота...');
    bot.stop('SIGTERM');
  });
}
