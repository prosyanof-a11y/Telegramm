import axios from 'axios';
import { Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { bot } from '../services/telegram.js';
import { db } from '../db/index.js';
import { users, channels, posts, documents } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { createPresentation } from '../services/figma.js';
import { generatePost, generateImagePrompt, regeneratePost, generateSlidesStructure } from '../services/claude.js';
import { generateImage } from '../services/flux.js';
import { parseFile } from '../services/fileParser.js';

// ── State machine ─────────────────────────────────────────────────────────────

type WizardState =
  | { type: 'upload'; step: 1 }
  | { type: 'upload'; step: 2; filename: string; content: string }
  | { type: 'add_channel'; step: number; data: Record<string, any> }
  | { type: 'generate'; step: 1 }
  | { type: 'generate'; step: 2; channelId: string }
  | { type: 'presentation'; step: 1 }
  | { type: 'presentation'; step: 2; channelId: string };

const state = new Map<number, WizardState>();

function clearState(userId: number) { state.delete(userId); }

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAIN_KEYBOARD = Markup.keyboard([
  ['➕ Добавить канал', '📋 Мои каналы'],
  ['✍️ Создать пост', '⏳ Очередь'],
  ['📊 Аналитика', '📁 Загрузить файл'],
]).resize();

async function getOrCreateUser(telegramId: string, username?: string) {
  const [existing] = await db.select().from(users).where(eq(users.telegramId, telegramId));
  if (existing) return existing;
  const [created] = await db.insert(users).values({ telegramId, username } as any).returning();
  return created;
}

async function getUserChannels(userId: string) {
  return db.select().from(channels).where(eq(channels.userId, userId));
}

// ── /start ────────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  try {
    if (!ctx.from) return;
    clearState(ctx.from.id);
    await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    await ctx.reply(
      '👋 Добро пожаловать в Telegram Channel Manager!\n\nВыбери действие:',
      MAIN_KEYBOARD
    );
  } catch (err) {
    console.error('[Bot] /start error:', err);
  }
});

// ── 📋 Мои каналы ─────────────────────────────────────────────────────────────

bot.hears('📋 Мои каналы', async (ctx) => {
  try {
    if (!ctx.from) return;
    clearState(ctx.from.id);
    const user = await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    const list = await getUserChannels(user.id);

    if (list.length === 0) {
      return ctx.reply('У тебя пока нет каналов.\nНажми "➕ Добавить канал".');
    }

    const text = list.map((c: any, i: number) =>
      `${i + 1}. *${c.name}*\n` +
      `   Ниша: ${c.niche || '—'}\n` +
      `   Тон: ${c.tone || '—'}\n` +
      `   Постов/день: ${c.postFrequency ?? 1}\n` +
      `   Статус: ${c.active ? '🟢 активен' : '🔴 выключен'}`
    ).join('\n\n');

    await ctx.reply(`*Каналы (${list.length}):*\n\n${text}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[Bot] channels error:', err);
    await ctx.reply('Ошибка при загрузке каналов.');
  }
});

// ── ➕ Добавить канал — wizard ─────────────────────────────────────────────────

const ADD_CHANNEL_STEPS = [
  { key: 'telegramChannelId', prompt: '1/8 Укажи @username канала (например: @mychannel):' },
  { key: 'name',              prompt: '2/8 Название канала (для отображения в боте):' },
  { key: 'niche',             prompt: '3/8 Ниша / тема канала (например: фитнес, финансы, маркетинг):' },
  { key: 'tone',              prompt: '4/8 Тон текста (например: дружелюбный, экспертный, продающий):' },
  { key: 'targetAudience',    prompt: '5/8 Целевая аудитория (кратко, кто читает):' },
  { key: 'productDescription',prompt: '6/8 Описание продукта / услуги (что продаёшь):' },
  { key: 'exampleGoodPost',   prompt: '7/8 Пример хорошего поста из этого канала (скопируй текст):' },
  { key: 'postFrequency',     prompt: '8/8 Сколько постов в день? (введи число, например: 2):' },
];

bot.hears('➕ Добавить канал', async (ctx) => {
  if (!ctx.from) return;
  state.set(ctx.from.id, { type: 'add_channel', step: 0, data: {} });
  await ctx.reply(
    '➕ *Добавление нового канала*\n\nОтвечай на вопросы по очереди. Для отмены нажми /cancel\n\n' +
    ADD_CHANNEL_STEPS[0].prompt,
    { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Отмена']]).resize() }
  );
});

// ── ✍️ Создать пост — wizard ──────────────────────────────────────────────────

bot.hears('✍️ Создать пост', async (ctx) => {
  try {
    if (!ctx.from) return;
    const user = await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    const list = await getUserChannels(user.id);

    if (list.length === 0) {
      return ctx.reply('Сначала добавь канал через "➕ Добавить канал".');
    }

    state.set(ctx.from.id, { type: 'generate', step: 1 });

    const buttons = list.map((c: any) =>
      [Markup.button.callback(c.name, `gen_chan_${c.id}`)]
    );

    await ctx.reply(
      '✍️ *Создание поста*\n\nДля какого канала генерировать?',
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
  } catch (err) {
    console.error('[Bot] generate start error:', err);
  }
});

bot.action(/gen_chan_(.+)/, async (ctx) => {
  if (!ctx.from) return;
  const channelId = ctx.match[1];
  state.set(ctx.from.id, { type: 'generate', step: 2, channelId });
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(
    '📝 Отправь исходный материал для поста:\n\n' +
    '• Напиши текст, тезисы или тему\n' +
    '• Или отправь файл (PDF, DOCX, TXT)\n\n' +
    'Для отмены — /cancel'
  );
});

// ── ⏳ Очередь ────────────────────────────────────────────────────────────────

bot.hears('⏳ Очередь', async (ctx) => {
  try {
    if (!ctx.from) return;
    clearState(ctx.from.id);
    const user = await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    const list = await getUserChannels(user.id);

    if (list.length === 0) {
      return ctx.reply('У тебя нет каналов.');
    }

    const pending = await db.select().from(posts)
      .where(eq(posts.status, 'pending_approval'))
      .orderBy(desc(posts.createdAt))
      .limit(5);

    if (pending.length === 0) {
      return ctx.reply('✅ Очередь пуста. Нет постов на одобрение.');
    }

    await ctx.reply(`📋 *Постов на одобрение: ${pending.length}*`, { parse_mode: 'Markdown' });

    for (const post of pending) {
      const channel = list.find((c: any) => c.id === post.channelId) as any;
      const chanName = channel?.name ?? 'Неизвестный канал';
      const preview = post.text.slice(0, 300) + (post.text.length > 300 ? '…' : '');

      await ctx.reply(
        `📢 *${chanName}*\n\n${preview}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Одобрить', `approve_${post.id}`),
              Markup.button.callback('❌ Отклонить', `reject_${post.id}`),
              Markup.button.callback('✏️ Переделать', `regen_${post.id}`),
            ],
          ]),
        }
      );
    }
  } catch (err) {
    console.error('[Bot] queue error:', err);
    await ctx.reply('Ошибка при загрузке очереди.');
  }
});

// ── 📊 Аналитика ──────────────────────────────────────────────────────────────

bot.hears('📊 Аналитика', async (ctx) => {
  try {
    if (!ctx.from) return;
    clearState(ctx.from.id);
    const user = await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    const list = await getUserChannels(user.id);
    const allPosts = await db.select().from(posts).orderBy(desc(posts.createdAt));

    const published  = allPosts.filter((p: any) => p.status === 'published').length;
    const pending    = allPosts.filter((p: any) => p.status === 'pending_approval').length;
    const approved   = allPosts.filter((p: any) => p.status === 'approved').length;
    const rejected   = allPosts.filter((p: any) => p.status === 'rejected').length;
    const failed     = allPosts.filter((p: any) => p.status === 'failed').length;

    const week = new Date();
    week.setDate(week.getDate() - 7);
    const pubWeek = allPosts.filter((p: any) => p.status === 'published' && new Date(p.publishedAt) >= week).length;

    let channelStats = '';
    for (const ch of list as any[]) {
      const chPosts = allPosts.filter((p: any) => p.channelId === ch.id);
      channelStats += `\n• *${ch.name}*: ${chPosts.filter((p: any) => p.status === 'published').length} опубл., ${chPosts.filter((p: any) => p.status === 'pending_approval').length} в очереди`;
    }

    await ctx.reply(
      `📊 *Аналитика*\n\n` +
      `📅 За последние 7 дней: *${pubWeek}* публикаций\n\n` +
      `Всего постов:\n` +
      `✅ Опубликовано: ${published}\n` +
      `⏳ На одобрении: ${pending}\n` +
      `🕐 Одобрено (ждёт): ${approved}\n` +
      `❌ Отклонено: ${rejected}\n` +
      `🚫 Ошибки: ${failed}\n\n` +
      `*По каналам:*${channelStats || '\n— нет данных'}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('[Bot] analytics error:', err);
    await ctx.reply('Ошибка при загрузке аналитики.');
  }
});

// ── 📁 Загрузить файл ─────────────────────────────────────────────────────────

bot.hears('📁 Загрузить файл', async (ctx) => {
  if (!ctx.from) return;
  state.set(ctx.from.id, { type: 'upload', step: 1 });
  await ctx.reply(
    '📁 *Загрузка документа*\n\nОтправь файл (PDF, DOCX, TXT) прямо в этот чат.\n\nДля отмены — /cancel',
    { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Отмена']]).resize() }
  );
});

// ── /cancel ───────────────────────────────────────────────────────────────────

bot.command('cancel', async (ctx) => {
  if (!ctx.from) return;
  clearState(ctx.from.id);
  await ctx.reply('Отменено.', MAIN_KEYBOARD);
});

bot.hears('❌ Отмена', async (ctx) => {
  if (!ctx.from) return;
  clearState(ctx.from.id);
  await ctx.reply('Отменено.', MAIN_KEYBOARD);
});

// ── Inline: одобрение постов ──────────────────────────────────────────────────

bot.action(/approve_(.+)/, async (ctx) => {
  try {
    const postId = ctx.match[1];
    await db.update(posts).set({ status: 'approved' } as any).where(eq(posts.id, postId));
    await ctx.answerCbQuery('Одобрено ✅');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('✅ Пост одобрен и добавлен в очередь публикации.');
  } catch (err) {
    console.error('[Bot] approve error:', err);
  }
});

bot.action(/reject_(.+)/, async (ctx) => {
  try {
    const postId = ctx.match[1];
    await db.update(posts).set({ status: 'rejected' } as any).where(eq(posts.id, postId));
    await ctx.answerCbQuery('Отклонено ❌');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('❌ Пост отклонён.');
  } catch (err) {
    console.error('[Bot] reject error:', err);
  }
});

bot.action(/regen_(.+)/, async (ctx) => {
  try {
    const postId = ctx.match[1];
    await ctx.answerCbQuery('Регенерирую...');
    await ctx.editMessageReplyMarkup(undefined);

    const [post] = await db.select().from(posts).where(eq(posts.id, postId));
    if (!post) return ctx.reply('Пост не найден.');
    const [channel] = await db.select().from(channels).where(eq(channels.id, post.channelId));

    await ctx.reply('⏳ Генерирую новый вариант...');
    const newText = await regeneratePost(channel, post.text, 'Перепиши в другом стиле');
    await db.update(posts).set({ text: newText, status: 'pending_approval' } as any).where(eq(posts.id, postId));

    const preview = newText.slice(0, 300) + (newText.length > 300 ? '…' : '');
    await ctx.reply(
      `✏️ *Новый вариант:*\n\n${preview}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Одобрить', `approve_${postId}`),
            Markup.button.callback('❌ Отклонить', `reject_${postId}`),
            Markup.button.callback('✏️ Ещё раз', `regen_${postId}`),
          ],
        ]),
      }
    );
  } catch (err) {
    console.error('[Bot] regen error:', err);
    await ctx.reply('Ошибка при регенерации.');
  }
});

// ── /presentation wizard ──────────────────────────────────────────────────────

bot.command('presentation', async (ctx) => {
  try {
    if (!ctx.from) return;
    const user = await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    const list = await getUserChannels(user.id);
    if (list.length === 0) return ctx.reply('Сначала добавь канал.');

    state.set(ctx.from.id, { type: 'presentation', step: 1 });

    const buttons = list.map((c: any) => [{ text: c.name, callback_data: `pres_chan_${c.id}` }]);
    await ctx.reply('Для какого канала создать презентацию?', {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (err) {
    console.error('[Bot] /presentation error:', err);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
});

bot.action(/pres_chan_(.+)/, async (ctx) => {
  if (!ctx.from) return;
  const channelId = ctx.match[1];
  const s = state.get(ctx.from.id);
  if (s?.type === 'presentation' && s.step === 1) {
    state.set(ctx.from.id, { type: 'presentation', step: 2, channelId });
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('Пришли данные о продукте для презентации.');
  }
});

// ── File upload handler ───────────────────────────────────────────────────────

bot.on(message('document'), async (ctx) => {
  try {
    if (!ctx.from) return;
    const s = state.get(ctx.from.id);
    const doc = ctx.message.document;
    const filename = doc.file_name ?? 'file';
    const ext = filename.split('.').pop()?.toLowerCase();

    // Accept in generate wizard too (step 2)
    const isUploadWizard  = s?.type === 'upload' && s.step === 1;
    const isGenerateWizard = s?.type === 'generate' && s.step === 2;

    if (!isUploadWizard && !isGenerateWizard) {
      return ctx.reply('Для загрузки файла нажми "📁 Загрузить файл" или "✍️ Создать пост".');
    }

    if (!['pdf', 'docx', 'txt'].includes(ext ?? '')) {
      return ctx.reply('Поддерживаются только PDF, DOCX, TXT файлы.');
    }

    await ctx.reply('⏳ Читаю файл...');

    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const content = await parseFile(buffer, filename);

    if (!content.trim()) {
      return ctx.reply('Файл пустой или не удалось извлечь текст.');
    }

    if (isGenerateWizard && s.type === 'generate' && s.step === 2) {
      // Continue generate wizard with file content
      await handleGenerateSource(ctx, s.channelId, content);
      return;
    }

    // Upload wizard: ask which channel
    const user = await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    const list = await getUserChannels(user.id);

    if (list.length === 0) {
      clearState(ctx.from.id);
      return ctx.reply('Сначала добавь канал.');
    }

    state.set(ctx.from.id, { type: 'upload', step: 2, filename, content });

    const buttons = list.map((c: any) => [Markup.button.callback(c.name, `upload_chan_${c.id}`)]);
    await ctx.reply(
      `✅ Файл прочитан (${content.length} символов).\n\nДля какого канала сохранить документ?`,
      Markup.inlineKeyboard(buttons)
    );
  } catch (err: any) {
    console.error('[Bot] document error:', err);
    clearState(ctx.from?.id ?? 0);
    await ctx.reply(`Ошибка при обработке файла: ${err.message}`);
  }
});

bot.action(/upload_chan_(.+)/, async (ctx) => {
  try {
    if (!ctx.from) return;
    const s = state.get(ctx.from.id);
    if (s?.type !== 'upload' || s.step !== 2) return ctx.answerCbQuery();

    const channelId = ctx.match[1];
    await ctx.answerCbQuery('Сохраняю...');
    await ctx.editMessageReplyMarkup(undefined);

    const [doc] = await db.insert(documents).values({
      channelId,
      filename: s.filename,
      content: s.content,
    } as any).returning();

    clearState(ctx.from.id);

    await ctx.reply(
      `✅ Документ *${s.filename}* сохранён!\n\nСоздать пост из этого документа?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✍️ Создать пост', `doc_post_${doc.id}`),
            Markup.button.callback('Позже', 'doc_skip'),
          ],
        ]),
      }
    );
    await ctx.reply('Главное меню:', MAIN_KEYBOARD);
  } catch (err) {
    console.error('[Bot] upload_chan error:', err);
    await ctx.reply('Ошибка при сохранении.');
  }
});

bot.action('doc_skip', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
});

bot.action(/doc_post_(.+)/, async (ctx) => {
  try {
    if (!ctx.from) return;
    await ctx.answerCbQuery('Генерирую...');
    await ctx.editMessageReplyMarkup(undefined);

    const docId = ctx.match[1];
    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    if (!doc) return ctx.reply('Документ не найден.');
    const [channel] = await db.select().from(channels).where(eq(channels.id, doc.channelId));

    await ctx.reply('⏳ Генерирую пост...');
    const text = await generatePost(channel, doc.content ?? '');

    const [post] = await db.insert(posts).values({
      channelId: channel.id,
      text,
      status: 'pending_approval',
      sourceType: 'document',
    } as any).returning();

    await db.update(documents).set({ processed: true } as any).where(eq(documents.id, docId));

    const preview = text.slice(0, 300) + (text.length > 300 ? '…' : '');
    await ctx.reply(
      `✅ *Пост сгенерирован:*\n\n${preview}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Одобрить', `approve_${post.id}`),
            Markup.button.callback('❌ Отклонить', `reject_${post.id}`),
            Markup.button.callback('✏️ Переделать', `regen_${post.id}`),
          ],
        ]),
      }
    );
  } catch (err) {
    console.error('[Bot] doc_post error:', err);
    await ctx.reply('Ошибка при генерации поста.');
  }
});

// ── Text message router ───────────────────────────────────────────────────────

async function handleGenerateSource(ctx: any, channelId: string, sourceContent: string) {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) return ctx.reply('Канал не найден.');

  clearState(ctx.from.id);
  await ctx.reply('⏳ Генерирую пост...');

  const text = await generatePost(channel, sourceContent);

  let imageUrl: string | null = null;
  if (process.env.FAL_API_KEY) {
    try {
      await ctx.reply('🖼 Генерирую картинку...');
      const imagePrompt = await generateImagePrompt(text);
      imageUrl = await generateImage(imagePrompt);
    } catch (e) {
      console.warn('[Bot] Image generation skipped:', e);
    }
  }

  const [post] = await db.insert(posts).values({
    channelId,
    text,
    imageUrl,
    status: 'pending_approval',
    sourceType: 'text',
  } as any).returning();

  const preview = text.slice(0, 300) + (text.length > 300 ? '…' : '');
  const caption = imageUrl
    ? `✅ *Пост + картинка готовы:*\n\n${preview}`
    : `✅ *Пост готов:*\n\n${preview}`;

  const approvalMarkup = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Одобрить', `approve_${post.id}`),
      Markup.button.callback('❌ Отклонить', `reject_${post.id}`),
      Markup.button.callback('✏️ Переделать', `regen_${post.id}`),
    ],
  ]);

  if (imageUrl) {
    await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: 'Markdown', ...approvalMarkup });
  } else {
    await ctx.reply(caption, { parse_mode: 'Markdown', ...approvalMarkup });
  }
}

bot.on(message('text'), async (ctx) => {
  try {
    if (!ctx.from) return;
    const s = state.get(ctx.from.id);
    const text = ctx.message.text;

    // ── generate wizard step 2 ──
    if (s?.type === 'generate' && s.step === 2) {
      await handleGenerateSource(ctx, s.channelId, text);
      return;
    }

    // ── presentation wizard step 2 ──
    if (s?.type === 'presentation' && s.step === 2) {
      clearState(ctx.from.id);
      await ctx.reply('⏳ Генерирую структуру презентации...');
      const slides = await generateSlidesStructure(text);
      await ctx.reply('🎨 Создаю презентацию в Figma...');
      const url = await createPresentation(slides);
      await ctx.reply(`✅ Презентация готова:\n${url}`, MAIN_KEYBOARD);
      return;
    }

    // ── add_channel wizard ──
    if (s?.type === 'add_channel') {
      const step = s.step;
      const { key } = ADD_CHANNEL_STEPS[step];
      s.data[key] = key === 'postFrequency' ? parseInt(text) || 1 : text;

      if (step < ADD_CHANNEL_STEPS.length - 1) {
        s.step += 1;
        state.set(ctx.from.id, s);
        await ctx.reply(ADD_CHANNEL_STEPS[s.step].prompt);
        return;
      }

      // Last step — save channel
      clearState(ctx.from.id);
      const user = await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);

      await db.insert(channels).values({
        userId: user.id,
        telegramChannelId: s.data.telegramChannelId,
        name: s.data.name,
        niche: s.data.niche,
        tone: s.data.tone,
        targetAudience: s.data.targetAudience,
        productDescription: s.data.productDescription,
        exampleGoodPost: s.data.exampleGoodPost,
        postFrequency: s.data.postFrequency ?? 1,
        active: true,
      } as any);

      await ctx.reply(
        `✅ Канал *${s.data.name}* добавлен!\n\nТеперь добавь бота как администратора в канал *${s.data.telegramChannelId}*`,
        { parse_mode: 'Markdown', ...MAIN_KEYBOARD }
      );
      return;
    }
  } catch (err) {
    console.error('[Bot] text handler error:', err);
    clearState(ctx.from?.id ?? 0);
    await ctx.reply('Произошла ошибка. Попробуй ещё раз.', MAIN_KEYBOARD);
  }
});

// ── Bot lifecycle ─────────────────────────────────────────────────────────────

const BOT_COMMANDS = [
  { command: 'start',        description: 'Главное меню' },
  { command: 'cancel',       description: 'Отменить текущее действие' },
  { command: 'presentation', description: 'Создать презентацию в Figma' },
];

export function setupWebhook(app: any, domain: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[Bot] TELEGRAM_BOT_TOKEN не установлен');
    return;
  }

  bot.telegram.setMyCommands(BOT_COMMANDS).catch((err: any) =>
    console.error('[Bot] Ошибка регистрации команд:', err.message)
  );

  const webhookPath = `/bot${token}`;
  const webhookUrl  = `https://${domain}${webhookPath}`;

  bot.telegram.setWebhook(webhookUrl).then(() => {
    console.log('[Bot] Webhook установлен:', webhookUrl);
  }).catch((err: any) => {
    console.error('[Bot] Ошибка webhook:', err.message || err);
    startBot();
  });

  app.post(webhookPath, (req: any, res: any) => {
    bot.handleUpdate(req.body, res);
  });

  console.log('[Bot] Webhook endpoint зарегистрирован:', webhookPath);
}

export async function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[Bot] TELEGRAM_BOT_TOKEN не установлен, бот не запущен');
    return;
  }

  console.log('[Bot] Запуск Telegram бота через long polling...');

  await bot.telegram.deleteWebhook();
  await bot.telegram.setMyCommands(BOT_COMMANDS).catch((err: any) =>
    console.error('[Bot] Ошибка регистрации команд:', err.message)
  );

  bot.launch({ allowedUpdates: ['message', 'callback_query'] })
    .then(() => console.log('[Bot] Telegram бот остановлен'))
    .catch((err: any) => console.error('[Bot] Ошибка запуска:', err.message || err));

  console.log('[Bot] Long polling запущен успешно');

  process.once('SIGINT',  () => { console.log('[Bot] SIGINT'); bot.stop('SIGINT'); });
  process.once('SIGTERM', () => { console.log('[Bot] SIGTERM'); bot.stop('SIGTERM'); });
}
