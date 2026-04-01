import axios from 'axios';
import { Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { bot } from '../services/telegram.js';
import { db } from '../db/index.js';
import { users, channels, posts, documents, schedules } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { createPresentation, formatSlidesAsText, exportByUrl as figmaExportByUrl } from '../services/figma.js';
import { createPresentationInCanva, exportByUrl as canvaExportByUrl } from '../services/canva.js';
import { generatePost, generateImagePrompt, regeneratePost, generateSlidesStructure, splitMessage } from '../services/claude.js';
import { generateImage } from '../services/flux.js';
import { parseFile } from '../services/fileParser.js';
import { publishPost, notifyAdmin } from '../services/telegram.js';

// ── State machine ─────────────────────────────────────────────────────────────

type AddChannelData = {
  telegramChannelId?: string;
  name?: string;
  niche?: string;
  targetAudience?: string;
  productDescription?: string;
  tone?: string;
  exampleGoodPost?: string;
  postFrequency?: number;
  timeSlots?: string[];
};

type WizardState =
  | { type: 'upload'; step: 1 }
  | { type: 'upload'; step: 2; filename: string; content: string }
  | { type: 'add_channel'; step: number; data: AddChannelData }
  | { type: 'generate'; step: 1 }
  | { type: 'generate'; step: 2; channelId: string }
  | { type: 'generate'; step: 'awaiting_text'; channelId: string }
  | { type: 'generate'; step: 'awaiting_feedback'; channelId: string; postId: string }
  | { type: 'generate'; step: 'awaiting_schedule'; postId: string }
  | { type: 'presentation'; step: 1 }
  | { type: 'presentation'; step: 2; channelId: string };

const state = new Map<number, WizardState>();
function clearState(userId: number) { state.delete(userId); }

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAIN_KEYBOARD = Markup.keyboard([
  ['➕ Добавить канал', '📋 Мои каналы'],
  ['✍️ Создать пост', '⏳ Очередь постов'],
  ['📊 Аналитика', '📁 Загрузить файл'],
]).resize();

async function getOrCreateUser(telegramId: string, username?: string) {
  const [existing] = await db.select().from(users).where(eq(users.telegramId, telegramId));
  if (existing) return existing;
  const [created] = await db.insert(users).values({ telegramId, username } as any).returning();
  return created;
}

function approvalKeyboard(postId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Опубликовать сейчас', `pub_now_${postId}`),
      Markup.button.callback('📅 Запланировать', `pub_schedule_${postId}`),
    ],
    [
      Markup.button.callback('✏️ Переделать', `regen_${postId}`),
      Markup.button.callback('⏭️ Пропустить', `reject_${postId}`),
    ],
  ]);
}

async function sendPostPreview(ctx: any, postId: string, channelName: string) {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) return;

  // Заголовок отдельно (Markdown-safe), текст поста без parse_mode чтобы не крашить
  await ctx.reply(`📢 *${escapeMarkdown(channelName)}*`, { parse_mode: 'Markdown' });

  // Отправляем полный текст поста частями (без Markdown — текст от AI может содержать спецсимволы)
  const parts = splitMessage(post.text, 4000);

  if (post.imageUrl) {
    const firstPart = parts[0];
    if (firstPart.length <= 1024) {
      await ctx.replyWithPhoto(post.imageUrl, { caption: firstPart });
    } else {
      await ctx.replyWithPhoto(post.imageUrl);
      await ctx.reply(firstPart);
    }
  } else {
    await ctx.reply(parts[0]);
  }
  for (let i = 1; i < parts.length; i++) {
    await ctx.reply(parts[i]);
  }
  await ctx.reply(`📊 Длина поста: ${post.text.length} символов`, approvalKeyboard(postId));
}

function escapeMarkdown(text: string): string {
  return text.replace(/([*_`\[\]])/g, '\\$1');
}

// ── /start ────────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  try {
    if (!ctx.from) return;
    clearState(ctx.from.id);
    await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    await ctx.reply(
      '👋 *Telegram Channel Manager*\n\nУправляй всеми каналами из одного места.',
      { parse_mode: 'Markdown', ...MAIN_KEYBOARD }
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
    const list = await db.select().from(channels).where(eq(channels.userId, user.id));

    if (!list.length) {
      return ctx.reply('Каналов пока нет.\nНажми "➕ Добавить канал".');
    }

    await ctx.reply(`*Каналы (${list.length}):*`, { parse_mode: 'Markdown' });

    for (const ch of list as any[]) {
      const pubCount = await db.select().from(posts)
        .where(and(eq(posts.channelId, ch.id), eq(posts.status, 'published')));
      const text =
        `📢 *${ch.name}*\n` +
        `Ниша: ${ch.niche || '—'} | Тон: ${ch.tone || '—'}\n` +
        `Статус: ${ch.active ? '🟢 активен' : '🔴 на паузе'}\n` +
        `Опубликовано постов: ${pubCount.length}`;

      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('⚙️ Настройки', `ch_settings_${ch.id}`),
            ch.active
              ? Markup.button.callback('⏸ Пауза', `ch_pause_${ch.id}`)
              : Markup.button.callback('▶️ Активировать', `ch_resume_${ch.id}`),
            Markup.button.callback('🗑 Удалить', `ch_delete_${ch.id}`),
          ],
        ]),
      });
    }
  } catch (err) {
    console.error('[Bot] channels error:', err);
    await ctx.reply('Ошибка при загрузке каналов.');
  }
});

bot.action(/ch_settings_(.+)/, async (ctx) => {
  try {
    const [ch] = await db.select().from(channels).where(eq(channels.id, ctx.match[1]));
    if (!ch) return ctx.answerCbQuery('Канал не найден');
    await ctx.answerCbQuery();
    await ctx.reply(
      `⚙️ *${(ch as any).name}*\n\n` +
      `@username: ${(ch as any).telegramChannelId}\n` +
      `Ниша: ${(ch as any).niche || '—'}\n` +
      `Аудитория: ${(ch as any).targetAudience || '—'}\n` +
      `Продукт: ${(ch as any).productDescription || '—'}\n` +
      `Тон: ${(ch as any).tone || '—'}\n` +
      `Постов/день: ${(ch as any).postFrequency ?? 1}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) { console.error('[Bot] ch_settings error:', err); }
});

bot.action(/ch_pause_(.+)/, async (ctx) => {
  try {
    await db.update(channels).set({ active: false } as any).where(eq(channels.id, ctx.match[1]));
    await ctx.answerCbQuery('Канал на паузе ⏸');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('Канал поставлен на паузу.');
  } catch (err) { console.error('[Bot] ch_pause error:', err); await ctx.answerCbQuery('Ошибка'); }
});

bot.action(/ch_resume_(.+)/, async (ctx) => {
  try {
    await db.update(channels).set({ active: true } as any).where(eq(channels.id, ctx.match[1]));
    await ctx.answerCbQuery('Канал активирован ▶️');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('Канал снова активен.');
  } catch (err) { console.error('[Bot] ch_resume error:', err); await ctx.answerCbQuery('Ошибка'); }
});

bot.action(/ch_delete_(.+)/, async (ctx) => {
  const channelId = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(
    '⚠️ Удалить канал и все его данные?',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🗑 Да, удалить', `ch_confirm_delete_${channelId}`),
        Markup.button.callback('Отмена', 'ch_cancel_delete'),
      ],
    ])
  );
});

bot.action(/ch_confirm_delete_(.+)/, async (ctx) => {
  const channelId = ctx.match[1];
  await db.delete(schedules).where(eq(schedules.channelId, channelId));
  await db.delete(posts).where(eq(posts.channelId, channelId));
  await db.delete(documents).where(eq(documents.channelId, channelId));
  await db.delete(channels).where(eq(channels.id, channelId));
  await ctx.answerCbQuery('Удалено');
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply('Канал удалён.', MAIN_KEYBOARD);
});

bot.action('ch_cancel_delete', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
});

// ── ➕ Добавить канал — 9-шаговый wizard ──────────────────────────────────────

const ADD_CHANNEL_STEPS = [
  { key: 'telegramChannelId', prompt: '1/9 📢 Укажи @username или числовой ID канала:\n(например: @mychannel или -1001234567890)' },
  { key: 'name',              prompt: '2/9 📝 Название канала (для отображения в боте):' },
  { key: 'niche',             prompt: '3/9 🎯 Ниша / тема канала:\n(например: фитнес, финансы, маркетинг, недвижимость)' },
  { key: 'targetAudience',    prompt: '4/9 👥 Целевая аудитория:\n(кратко, кто читает, их боли и желания)' },
  { key: 'productDescription',prompt: '5/9 📦 Описание продукта / услуги:\n(что продаёшь, главные преимущества)' },
  { key: 'tone',              prompt: '6/9 🗣 Тон постов:\n(например: дружелюбный, экспертный, продающий, разговорный)' },
  { key: 'exampleGoodPost',   prompt: '7/9 ✨ Пример хорошего поста из этого канала:\n(скопируй текст или отправь /skip)' },
  { key: 'postFrequency',     prompt: '8/9 📅 Постов в день? (введи число от 1 до 5):' },
  { key: 'timeSlots',         prompt: '9/9 🕐 Время публикаций через запятую:\n(например: 09:00, 13:00, 18:00)' },
];

bot.hears('➕ Добавить канал', async (ctx) => {
  if (!ctx.from) return;
  clearState(ctx.from.id);
  state.set(ctx.from.id, { type: 'add_channel', step: 0, data: {} });
  await ctx.reply(
    '➕ *Добавление нового канала*\n\nОтвечай на вопросы по очереди.\nДля отмены — /cancel\n\n' +
    ADD_CHANNEL_STEPS[0].prompt,
    { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Отмена']]).resize() }
  );
});

// ── ✍️ Создать пост — wizard ──────────────────────────────────────────────────

bot.hears('✍️ Создать пост', async (ctx) => {
  try {
    if (!ctx.from) return;
    clearState(ctx.from.id);
    const channelList = await db.select().from(channels).where(eq(channels.active, true));

    if (!channelList.length) {
      return ctx.reply(
        'Каналов пока нет. Сначала добавь канал.',
        Markup.keyboard([['➕ Добавить канал']]).resize()
      );
    }

    state.set(ctx.from.id, { type: 'generate', step: 1 });
    await ctx.reply(
      '✍️ *Создание поста*\n\nДля какого канала генерировать?',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(
          channelList.map((c: any) => [Markup.button.callback(c.name, `gen_channel:${c.id}`)])
        ),
      }
    );
  } catch (err) {
    console.error('[Bot] generate start error:', err);
  }
});

bot.action(/^gen_channel:(.+)$/, async (ctx) => {
  if (!ctx.from) return;
  const channelId = ctx.match[1];
  state.set(ctx.from.id, { type: 'generate', step: 2, channelId });
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    'Источник материала для поста:',
    Markup.inlineKeyboard([
      [Markup.button.callback('✍️ Ввести текст', `gen_text:${channelId}`)],
      [Markup.button.callback('🚀 Авто по профилю канала', `gen_auto:${channelId}`)],
      [Markup.button.callback('📁 Из загруженных файлов', `gen_docs:${channelId}`)],
    ])
  );
});

bot.action(/^gen_text:(.+)$/, async (ctx) => {
  if (!ctx.from) return;
  const channelId = ctx.match[1];
  state.set(ctx.from.id, { type: 'generate', step: 'awaiting_text', channelId });
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply('📝 Напиши или вставь исходный материал для поста:\n\nДля отмены — /cancel');
});

bot.action(/^gen_auto:(.+)$/, async (ctx) => {
  try {
    if (!ctx.from) return;
    const channelId = ctx.match[1];
    await ctx.answerCbQuery('Генерирую...');
    await ctx.editMessageReplyMarkup(undefined);
    clearState(ctx.from.id);

    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel) return ctx.reply('Канал не найден.');

    await ctx.reply('⏳ Генерирую пост по профилю канала...');
    const autoSource =
      `Канал: ${(channel as any).name}. ` +
      `Ниша: ${(channel as any).niche}. ` +
      `Продукт: ${(channel as any).productDescription}`;
    await handleGenerateSource(ctx, channelId, autoSource, (channel as any).name);
  } catch (err) {
    console.error('[Bot] gen_auto error:', err);
    await ctx.reply('Ошибка при генерации.');
  }
});

bot.action(/^gen_docs:(.+)$/, async (ctx) => {
  try {
    if (!ctx.from) return;
    const channelId = ctx.match[1];
    await ctx.answerCbQuery();

    const docList = await db.select().from(documents).where(eq(documents.channelId, channelId));
    if (!docList.length) {
      await ctx.editMessageText('У этого канала нет загруженных документов.\nЗагрузи файл через "📁 Загрузить файл".');
      return;
    }
    await ctx.editMessageText(
      'Выбери документ:',
      Markup.inlineKeyboard(
        docList.map((d: any) => [Markup.button.callback(d.filename, `doc_post_${d.id}`)])
      )
    );
  } catch (err) {
    console.error('[Bot] gen_docs error:', err);
  }
});

// ── ⏳ Очередь постов ─────────────────────────────────────────────────────────

bot.hears('⏳ Очередь постов', async (ctx) => {
  try {
    if (!ctx.from) return;
    clearState(ctx.from.id);

    const pending = await db.select().from(posts)
      .where(eq(posts.status, 'pending_approval'))
      .orderBy(desc(posts.createdAt))
      .limit(10);

    if (!pending.length) {
      return ctx.reply('Очередь пуста. Создай новый пост через "✍️ Создать пост".');
    }

    await ctx.reply(`📋 *Постов на одобрение: ${pending.length}*`, { parse_mode: 'Markdown' });

    for (const post of pending) {
      const [ch] = await db.select().from(channels).where(eq(channels.id, post.channelId));
      const chanName = (ch as any)?.name ?? 'Неизвестный канал';
      const preview = post.text.slice(0, 200) + (post.text.length > 200 ? '…' : '');
      const scheduled = post.scheduledAt
        ? `\n🕐 Запланировано: ${new Date(post.scheduledAt).toLocaleString('ru-RU')}`
        : '';

      await ctx.reply(
        `📢 ${chanName}${scheduled}\n\n${preview}`,
        {
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Одобрить', `approve_${post.id}`),
              Markup.button.callback('❌ Отклонить', `reject_${post.id}`),
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
    const userChannels = await db.select().from(channels).where(eq(channels.userId, user.id));
    const allPosts = await db.select().from(posts).orderBy(desc(posts.createdAt));

    const published = allPosts.filter((p: any) => p.status === 'published').length;
    const pending   = allPosts.filter((p: any) => p.status === 'pending_approval').length;
    const approved  = allPosts.filter((p: any) => p.status === 'approved').length;
    const rejected  = allPosts.filter((p: any) => p.status === 'rejected').length;
    const failed    = allPosts.filter((p: any) => p.status === 'failed').length;

    const week = new Date();
    week.setDate(week.getDate() - 7);
    const pubWeek = allPosts.filter(
      (p: any) => p.status === 'published' && p.publishedAt && new Date(p.publishedAt) >= week
    ).length;

    let chStats = '';
    for (const ch of userChannels as any[]) {
      const n = allPosts.filter((p: any) => p.channelId === ch.id && p.status === 'published').length;
      chStats += `\n• *${ch.name}*: ${n} опубл.`;
    }

    await ctx.reply(
      `📊 *Аналитика*\n\n` +
      `📅 За 7 дней: *${pubWeek}* публикаций\n\n` +
      `Всего постов:\n` +
      `✅ Опубликовано: ${published}\n` +
      `⏳ На одобрении: ${pending}\n` +
      `🕐 Одобрено (ждёт): ${approved}\n` +
      `❌ Отклонено: ${rejected}\n` +
      `🚫 Ошибки: ${failed}\n\n` +
      `*По каналам:*${chStats || '\n— нет данных'}`,
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

bot.action(/^approve_(.+)$/, async (ctx) => {
  try {
    const postId = ctx.match[1];
    await db.update(posts).set({ status: 'approved' } as any).where(eq(posts.id, postId));
    await ctx.answerCbQuery('Одобрено ✅');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('✅ Пост одобрен и добавлен в очередь публикации.');
  } catch (err) { console.error('[Bot] approve error:', err); }
});

bot.action(/^reject_(.+)$/, async (ctx) => {
  try {
    const postId = ctx.match[1];
    await db.update(posts).set({ status: 'rejected' } as any).where(eq(posts.id, postId));
    await ctx.answerCbQuery('Отклонено ❌');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('❌ Пост отклонён.');
  } catch (err) { console.error('[Bot] reject error:', err); }
});

// ── Публикация прямо сейчас ───────────────────────────────────────────────────

bot.action(/^pub_now_(.+)$/, async (ctx) => {
  try {
    const postId = ctx.match[1];
    await ctx.answerCbQuery('Публикую...');
    await ctx.editMessageReplyMarkup(undefined);

    const [post] = await db.select().from(posts).where(eq(posts.id, postId));
    if (!post) return ctx.reply('Пост не найден.');
    const [channel] = await db.select().from(channels).where(eq(channels.id, post.channelId));
    if (!channel) return ctx.reply('Канал не найден.');

    const msgId = await publishPost((channel as any).telegramChannelId, post.text, post.imageUrl);
    await db.update(posts).set({
      status: 'published',
      publishedAt: new Date(),
      telegramMessageId: msgId,
    } as any).where(eq(posts.id, postId));

    await ctx.reply(`✅ Пост опубликован в *${(channel as any).name}*!`, { parse_mode: 'Markdown' });
  } catch (err: any) {
    console.error('[Bot] pub_now error:', err);
    await ctx.reply(`❌ Ошибка публикации: ${err.message}\n\nУбедись, что бот добавлен как администратор в канал.`);
  }
});

// ── Запланировать публикацию ──────────────────────────────────────────────────

bot.action(/^pub_schedule_(.+)$/, async (ctx) => {
  if (!ctx.from) return;
  const postId = ctx.match[1];
  state.set(ctx.from.id, { type: 'generate', step: 'awaiting_schedule', postId });
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(
    '📅 Укажи дату и время публикации:\n\nФормат: ДД.ММ.ГГГГ ЧЧ:ММ\nПример: 25.12.2024 15:00\n\nДля отмены — /cancel'
  );
});

// ── Переделать пост ───────────────────────────────────────────────────────────

bot.action(/^regen_(.+)$/, async (ctx) => {
  try {
    if (!ctx.from) return;
    const postId = ctx.match[1];
    const [post] = await db.select().from(posts).where(eq(posts.id, postId));
    if (!post) return ctx.reply('Пост не найден.');

    state.set(ctx.from.id, { type: 'generate', step: 'awaiting_feedback', channelId: post.channelId, postId });
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('✏️ Напиши комментарий — что изменить в посте?\n(или /skip чтобы переделать без комментария)');
  } catch (err) { console.error('[Bot] regen error:', err); }
});

// ── /presentation wizard ──────────────────────────────────────────────────────

bot.command('presentation', async (ctx) => {
  try {
    if (!ctx.from) return;
    const user = await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    const list = await db.select().from(channels).where(eq(channels.userId, user.id));
    if (!list.length) return ctx.reply('Сначала добавь канал.');

    state.set(ctx.from.id, { type: 'presentation', step: 1 });
    const buttons = list.map((c: any) => [{ text: c.name, callback_data: `pres_chan_${c.id}` }]);
    await ctx.reply('Для какого канала создать презентацию?', { reply_markup: { inline_keyboard: buttons } });
  } catch (err) {
    console.error('[Bot] /presentation error:', err);
    await ctx.reply('Произошла ошибка. Попробуй позже.');
  }
});

bot.action(/pres_chan_(.+)/, async (ctx) => {
  if (!ctx.from) return;
  const s = state.get(ctx.from.id);
  if (s?.type === 'presentation' && s.step === 1) {
    state.set(ctx.from.id, { type: 'presentation', step: 2, channelId: ctx.match[1] });
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

    const isUploadWizard   = s?.type === 'upload' && s.step === 1;
    const isGenerateWizard = s?.type === 'generate' && (s.step === 2 || s.step === 'awaiting_text');

    if (!isUploadWizard && !isGenerateWizard) {
      return ctx.reply('Для загрузки файла нажми "📁 Загрузить файл" или "✍️ Создать пост".');
    }
    if (!['pdf', 'docx', 'txt'].includes(ext ?? '')) {
      return ctx.reply('Поддерживаются только PDF, DOCX, TXT файлы.');
    }

    await ctx.reply('⏳ Читаю файл...');
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 30000 });
    const content = await parseFile(Buffer.from(response.data), filename);

    if (!content.trim()) return ctx.reply('Файл пустой или не удалось извлечь текст.');

    if (isGenerateWizard && s.type === 'generate' && (s.step === 2 || s.step === 'awaiting_text')) {
      const [channel] = await db.select().from(channels).where(eq(channels.id, s.channelId));
      await handleGenerateSource(ctx, s.channelId, content, (channel as any)?.name ?? '');
      return;
    }

    // Upload wizard: pick channel
    const user = await getOrCreateUser(ctx.from.id.toString(), ctx.from.username);
    const list = await db.select().from(channels).where(eq(channels.userId, user.id));
    if (!list.length) { clearState(ctx.from.id); return ctx.reply('Сначала добавь канал.'); }

    state.set(ctx.from.id, { type: 'upload', step: 2, filename, content });
    await ctx.reply(
      `✅ Файл прочитан (${content.length} символов).\n\nДля какого канала сохранить?`,
      Markup.inlineKeyboard(list.map((c: any) => [Markup.button.callback(c.name, `upload_chan_${c.id}`)]))
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
          [Markup.button.callback('✍️ Создать пост', `doc_post_${doc.id}`), Markup.button.callback('Позже', 'doc_skip')],
        ]),
      }
    );
    await ctx.reply('Главное меню:', MAIN_KEYBOARD);
  } catch (err) { console.error('[Bot] upload_chan error:', err); await ctx.reply('Ошибка при сохранении.'); }
});

bot.action('doc_skip', async (ctx) => { await ctx.answerCbQuery(); await ctx.editMessageReplyMarkup(undefined); });

bot.action(/doc_post_(.+)/, async (ctx) => {
  try {
    if (!ctx.from) return;
    await ctx.answerCbQuery('Генерирую...');
    await ctx.editMessageReplyMarkup(undefined);

    const [doc] = await db.select().from(documents).where(eq(documents.id, ctx.match[1]));
    if (!doc) return ctx.reply('Документ не найден.');
    const [channel] = await db.select().from(channels).where(eq(channels.id, (doc as any).channelId));
    if (!channel) return ctx.reply('Канал не найден.');

    await ctx.reply('⏳ Генерирую пост...');
    const text = await generatePost(channel, (doc as any).content ?? '');

    const [post] = await db.insert(posts).values({
      channelId: (channel as any).id,
      text,
      status: 'pending_approval',
      sourceType: 'document',
    } as any).returning();

    await db.update(documents).set({ processed: true } as any).where(eq(documents.id, (doc as any).id));
    await sendPostPreview(ctx, (post as any).id, (channel as any).name);
  } catch (err) { console.error('[Bot] doc_post error:', err); await ctx.reply('Ошибка при генерации поста.'); }
});

// ── Core generate logic ───────────────────────────────────────────────────────

async function handleGenerateSource(ctx: any, channelId: string, sourceContent: string, channelName = '') {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) return ctx.reply('Канал не найден.');

  clearState(ctx.from.id);
  await ctx.reply('⏳ Генерирую пост...');
  const text = await generatePost(channel, sourceContent);
  console.log('[3/5] Сохраняется в БД символов:', text.length);

  let imageUrl: string | null = null;
  if (process.env.FAL_API_KEY) {
    try {
      await ctx.reply('🖼 Генерирую картинку...');
      const imgPrompt = await generateImagePrompt(text);
      imageUrl = await generateImage(imgPrompt);
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

  await sendPostPreview(ctx, (post as any).id, channelName || (channel as any).name);
}

// ── Text message router ───────────────────────────────────────────────────────

bot.on(message('text'), async (ctx) => {
  try {
    if (!ctx.from) return;
    const s = state.get(ctx.from.id);
    const text = ctx.message.text;

    // ── awaiting text for generate wizard ──
    if (s?.type === 'generate' && s.step === 'awaiting_text') {
      const [ch] = await db.select().from(channels).where(eq(channels.id, s.channelId));
      await handleGenerateSource(ctx, s.channelId, text, (ch as any)?.name ?? '');
      return;
    }

    // ── awaiting schedule datetime ──
    if (s?.type === 'generate' && s.step === 'awaiting_schedule') {
      const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
      if (!match) {
        return ctx.reply('Неверный формат. Введи дату в формате ДД.ММ.ГГГГ ЧЧ:ММ\nПример: 25.12.2024 15:00');
      }
      const [, dd, mm, yyyy, hh, min] = match;
      const scheduledAt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`);
      if (isNaN(scheduledAt.getTime())) {
        return ctx.reply('Некорректная дата. Попробуй ещё раз.');
      }

      await db.update(posts).set({ scheduledAt, status: 'approved' } as any).where(eq(posts.id, s.postId));
      clearState(ctx.from.id);
      await ctx.reply(
        `📅 Пост запланирован на *${scheduledAt.toLocaleString('ru-RU')}*`,
        { parse_mode: 'Markdown', ...MAIN_KEYBOARD }
      );
      return;
    }

    // ── awaiting feedback for regen ──
    if (s?.type === 'generate' && s.step === 'awaiting_feedback') {
      const feedback = text === '/skip' ? 'Перепиши в другом стиле' : text;
      const [post] = await db.select().from(posts).where(eq(posts.id, s.postId));
      if (!post) { clearState(ctx.from.id); return ctx.reply('Пост не найден.'); }
      const [channel] = await db.select().from(channels).where(eq(channels.id, s.channelId));

      clearState(ctx.from.id);
      await ctx.reply('⏳ Переделываю пост...');
      const newText = await regeneratePost(channel, post.text, feedback);
      await db.update(posts).set({ text: newText, status: 'pending_approval' } as any).where(eq(posts.id, s.postId));
      await sendPostPreview(ctx, s.postId, (channel as any)?.name ?? '');
      return;
    }

    // ── presentation wizard step 2 ──
    if (s?.type === 'presentation' && s.step === 2) {
      clearState(ctx.from.id);
      await ctx.reply('⏳ Генерирую структуру презентации...');
      const slides = await generateSlidesStructure(text);

      // Figma REST API не поддерживает создание — пробуем Canva, потом текст
      let result: string;
      try {
        await ctx.reply('🎨 Создаю презентацию в Canva...');
        result = await createPresentationInCanva(slides);
      } catch (canvaErr: any) {
        console.warn('[Bot] Canva failed, returning text summary:', canvaErr.message);
        await ctx.reply('⚠️ Canva недоступна, показываю текстовую структуру.');
        result = formatSlidesAsText(slides);
      }

      // result может быть URL (Canva) или Markdown-текст (formatSlidesAsText)
      try {
        await ctx.reply(`✅ Презентация готова:\n${result}`, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
      } catch {
        await ctx.reply(`✅ Презентация готова:\n${result}`, MAIN_KEYBOARD);
      }
      return;
    }

    // ── add_channel wizard ──
    if (s?.type === 'add_channel') {
      const step = s.step;
      const { key } = ADD_CHANNEL_STEPS[step];

      // /skip for exampleGoodPost
      if (key === 'exampleGoodPost' && text === '/skip') {
        s.data.exampleGoodPost = '';
      } else if (key === 'postFrequency') {
        const n = parseInt(text);
        s.data.postFrequency = (isNaN(n) || n < 1 || n > 5) ? 1 : n;
      } else if (key === 'timeSlots') {
        s.data.timeSlots = text.split(',').map(t => t.trim()).filter(Boolean);
      } else {
        (s.data as any)[key] = text;
      }

      if (step < ADD_CHANNEL_STEPS.length - 1) {
        s.step += 1;
        state.set(ctx.from.id, s);
        await ctx.reply(ADD_CHANNEL_STEPS[s.step].prompt, { parse_mode: 'Markdown' });
        return;
      }

      // Last step — show summary
      clearState(ctx.from.id);
      const d = s.data;
      const summary =
        `📋 *Проверь данные канала:*\n\n` +
        `📢 ID/username: ${d.telegramChannelId}\n` +
        `📝 Название: ${d.name}\n` +
        `🎯 Ниша: ${d.niche}\n` +
        `👥 Аудитория: ${d.targetAudience}\n` +
        `📦 Продукт: ${d.productDescription}\n` +
        `🗣 Тон: ${d.tone}\n` +
        `✨ Пример поста: ${d.exampleGoodPost || '(не указан)'}\n` +
        `📅 Постов/день: ${d.postFrequency ?? 1}\n` +
        `🕐 Время: ${(d.timeSlots ?? []).join(', ') || '(не указано)'}`;

      // Store data temporarily for save action
      const pendingKey = `pending_channel_${ctx.from.id}`;
      (global as any)[pendingKey] = d;

      await ctx.reply(summary, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Сохранить', `save_channel_${ctx.from.id}`),
            Markup.button.callback('✏️ Начать заново', `restart_channel_${ctx.from.id}`),
          ],
        ]),
      });
      return;
    }
  } catch (err) {
    console.error('[Bot] text handler error:', err);
    clearState(ctx.from?.id ?? 0);
    await ctx.reply('Произошла ошибка. Попробуй ещё раз.', MAIN_KEYBOARD);
  }
});

bot.action(/save_channel_(\d+)/, async (ctx) => {
  try {
    if (!ctx.from) return;
    const userId = ctx.from.id;
    const pendingKey = `pending_channel_${userId}`;
    const d: AddChannelData = (global as any)[pendingKey];
    if (!d) return ctx.answerCbQuery('Данные устарели. Начни заново.');

    await ctx.answerCbQuery('Сохраняю...');
    await ctx.editMessageReplyMarkup(undefined);

    const user = await getOrCreateUser(userId.toString(), ctx.from.username);

    const [ch] = await db.insert(channels).values({
      userId: user.id,
      telegramChannelId: d.telegramChannelId!,
      name: d.name!,
      niche: d.niche,
      tone: d.tone,
      targetAudience: d.targetAudience,
      productDescription: d.productDescription,
      exampleGoodPost: d.exampleGoodPost,
      postFrequency: d.postFrequency ?? 1,
      active: true,
    } as any).returning();

    if (d.timeSlots?.length) {
      await db.insert(schedules).values({
        channelId: (ch as any).id,
        timeSlots: d.timeSlots,
        timezone: 'Europe/Moscow',
        active: true,
      } as any);
    }

    delete (global as any)[pendingKey];

    await ctx.reply(
      `✅ Канал *${d.name}* добавлен!\n\n` +
      `Теперь добавь бота как администратора в канал *${d.telegramChannelId}*\n\n` +
      `После этого нажми "✍️ Создать пост" для первого поста.`,
      { parse_mode: 'Markdown', ...MAIN_KEYBOARD }
    );
  } catch (err: any) {
    console.error('[Bot] save_channel error:', err);
    await ctx.reply(
      `❌ Ошибка сохранения: ${err.message}

Попробуй снова: /start → ➕ Добавить канал`
    );
  }
});

bot.action(/restart_channel_(\d+)/, async (ctx) => {
  if (!ctx.from) return;
  delete (global as any)[`pending_channel_${ctx.from.id}`];
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  state.set(ctx.from.id, { type: 'add_channel', step: 0, data: {} });
  await ctx.reply(
    '➕ *Добавление канала — начнём заново*\n\n' + ADD_CHANNEL_STEPS[0].prompt,
    { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Отмена']]).resize() }
  );
});

// ── /figma [url] — загрузить презентацию из Figma ────────────────────────────

bot.command('figma', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const figmaUrl = args[0];

  if (!figmaUrl) {
    return ctx.reply(
      '📐 *Использование:* /figma [ссылка]\n\n' +
      'Пример:\n`/figma https://www.figma.com/design/XXXX/Title`\n\n' +
      'Бот скачает все фреймы файла и отправит их как изображения.',
      { parse_mode: 'Markdown' }
    );
  }

  if (!figmaUrl.includes('figma.com')) {
    return ctx.reply('❌ Некорректная ссылка. Нужна ссылка на файл figma.com');
  }

  const loadingMsg = await ctx.reply('⏳ Загружаю файл из Figma...');

  try {
    const result = await figmaExportByUrl(figmaUrl);

    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

    if (!result.frameImages.length) {
      return ctx.reply(
        `📐 *${result.fileName}*\n\n` +
        `Фреймы не найдены. Убедись, что файл содержит фреймы на первой странице.\n\n` +
        `🔗 Файл: ${figmaUrl}`,
        { parse_mode: 'Markdown' }
      );
    }

    await ctx.reply(`📐 *${result.fileName}*\n${result.frameImages.length} фреймов`, { parse_mode: 'Markdown' });

    // Отправляем фреймы группами по 10
    const chunks: typeof result.frameImages[] = [];
    for (let i = 0; i < result.frameImages.length; i += 10) {
      chunks.push(result.frameImages.slice(i, i + 10));
    }

    for (const chunk of chunks) {
      if (chunk.length === 1) {
        await ctx.replyWithPhoto(chunk[0].url, { caption: chunk[0].name });
      } else {
        await ctx.replyWithMediaGroup(
          chunk.map((f) => ({
            type: 'photo' as const,
            media: f.url,
            caption: f.name,
          }))
        );
      }
    }
  } catch (err: any) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    console.error('[Bot] /figma error:', err.message);

    if (err.message?.includes('FIGMA_TOKEN')) {
      return ctx.reply(
        '❌ FIGMA_TOKEN не задан.\n\n' +
        'Получи токен: figma.com → Settings → Security → Personal access tokens\n' +
        'Добавь в .env: `FIGMA_TOKEN=your_token`',
        { parse_mode: 'Markdown' }
      );
    }
    await ctx.reply(`❌ Ошибка загрузки из Figma: ${err.message}`);
  }
});

// ── /canva [url] — загрузить дизайн из Canva ─────────────────────────────────

bot.command('canva', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const canvaUrl = args[0];

  if (!canvaUrl) {
    return ctx.reply(
      '🎨 *Использование:* /canva [ссылка]\n\n' +
      'Пример:\n`/canva https://www.canva.com/design/DAFxxx.../view`\n\n' +
      'Бот загрузит дизайн и экспортирует его как изображение.',
      { parse_mode: 'Markdown' }
    );
  }

  if (!canvaUrl.includes('canva.com')) {
    return ctx.reply('❌ Некорректная ссылка. Нужна ссылка на дизайн canva.com');
  }

  const loadingMsg = await ctx.reply('⏳ Загружаю дизайн из Canva...');

  try {
    const result = await canvaExportByUrl(canvaUrl);

    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

    if (result.exportUrl) {
      await ctx.replyWithPhoto(result.exportUrl, {
        caption: `🎨 *${result.title}*\n\n✏️ Редактировать: ${result.editUrl}`,
        parse_mode: 'Markdown',
      });
    } else {
      await ctx.reply(
        `🎨 *${result.title}*\n\n` +
        `✏️ Редактировать: ${result.editUrl}\n` +
        `👁 Просмотр: ${result.viewUrl}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err: any) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    console.error('[Bot] /canva error:', err.message);

    if (err.message?.includes('CANVA_CLIENT_ID')) {
      return ctx.reply(
        '❌ CANVA_CLIENT_ID / CANVA_CLIENT_SECRET не заданы.\n\n' +
        'Получи ключи: canva.com/developers → Create App\n' +
        'Добавь в .env:\n`CANVA_CLIENT_ID=xxx`\n`CANVA_CLIENT_SECRET=xxx`',
        { parse_mode: 'Markdown' }
      );
    }

    // Fallback: предложить Figma
    await ctx.reply(
      `❌ Ошибка загрузки из Canva: ${err.message}\n\n` +
      `Попробуй /figma [ссылка] если у тебя есть Figma-файл.`
    );
  }
});

// ── Bot lifecycle ─────────────────────────────────────────────────────────────

const BOT_COMMANDS = [
  { command: 'start',        description: 'Главное меню' },
  { command: 'cancel',       description: 'Отменить текущее действие' },
  { command: 'presentation', description: 'Создать презентацию (AI)' },
  { command: 'figma',        description: 'Загрузить файл из Figma по ссылке' },
  { command: 'canva',        description: 'Загрузить дизайн из Canva по ссылке' },
];

export function setupWebhook(app: any, domain: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.warn('[Bot] TELEGRAM_BOT_TOKEN не установлен'); return; }

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

  app.post(webhookPath, (req: any, res: any) => { bot.handleUpdate(req.body, res); });
  console.log('[Bot] Webhook endpoint зарегистрирован:', webhookPath);
}

export async function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.warn('[Bot] TELEGRAM_BOT_TOKEN не установлен, бот не запущен'); return; }

  try {
    await db.select().from(channels).limit(1);
    console.log('[DB] Таблица channels доступна');
  } catch (err: any) {
    console.error('[DB] Таблица channels недоступна:', err.message);
    console.error('[DB] Нужно выполнить миграции: pnpm db:push');
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
  process.once('SIGINT',  () => { bot.stop('SIGINT'); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); });
}
