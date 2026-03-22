import cron from 'node-cron';
import { db } from '../db/index.js';
import { posts, channels } from '../db/schema.js';
import { eq, and, lte, lt } from 'drizzle-orm';
import { publishPost, notifyAdmin } from '../services/telegram.js';

const MAX_RETRIES = 3;

export function startScheduler() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      const pendingPosts = await db.select()
        .from(posts)
        .where(and(
          eq(posts.status, 'approved'),
          lte(posts.scheduledAt, now),
          lt(posts.retryCount, MAX_RETRIES)
        ));

      for (const post of pendingPosts) {
        try {
          const [channel] = await db.select().from(channels).where(eq(channels.id, post.channelId));
          if (!channel) continue;

          const messageId = await publishPost(
            (channel as any).telegramChannelId,
            post.text,
            post.imageUrl
          );

          await db.update(posts).set({
            status: 'published',
            publishedAt: new Date(),
            telegramMessageId: messageId,
            errorMessage: null,
          } as any).where(eq(posts.id, post.id));

          console.log(`[Scheduler] Опубликован пост ${post.id} в канал ${(channel as any).name}`);
        } catch (error: any) {
          const retries = (post.retryCount || 0) + 1;
          console.error(`[Scheduler] Ошибка публикации поста ${post.id} (попытка ${retries}):`, error.message);

          if (retries >= MAX_RETRIES) {
            await db.update(posts).set({
              status: 'failed',
              errorMessage: error.message,
              retryCount: retries,
            } as any).where(eq(posts.id, post.id));

            await notifyAdmin(
              `❌ Пост не опубликован после ${MAX_RETRIES} попыток.\n` +
              `ID: ${post.id}\n` +
              `Ошибка: ${error.message}`
            );
          } else {
            await db.update(posts).set({
              retryCount: retries,
              errorMessage: error.message,
            } as any).where(eq(posts.id, post.id));
          }
        }
      }
    } catch (error) {
      console.error('[Scheduler] Критическая ошибка:', error);
    }
  });

  console.log('[Scheduler] Планировщик запущен');
}
