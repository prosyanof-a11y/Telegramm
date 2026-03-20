import cron from 'node-cron';
import { db } from '../db/index.js';
import { posts, channels, schedules } from '../db/schema.js';
import { eq, and, lte } from 'drizzle-orm';
import { publishPost } from '../services/telegram.js';

export function startScheduler() {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      
      // Find approved posts that are scheduled for now or earlier
      const pendingPosts = await db.select()
        .from(posts)
        .where(and(
          eq(posts.status, 'approved'),
          lte(posts.scheduledAt, now)
        ));

      for (const post of pendingPosts) {
        try {
          const [channel] = await db.select().from(channels).where(eq(channels.id, post.channelId));
          if (!channel) continue;

          const messageId = await publishPost(channel.telegramChannelId, post.text, post.imageUrl);
          
          await db.update(posts).set({
            status: 'published',
            publishedAt: new Date(),
            telegramMessageId: messageId,
          }).where(eq(posts.id, post.id));
          
        } catch (error: any) {
          console.error(`Error publishing post ${post.id}:`, error);
          await db.update(posts).set({
            status: 'failed',
            errorMessage: error.message,
            retryCount: (post.retryCount || 0) + 1,
          }).where(eq(posts.id, post.id));
        }
      }
    } catch (error) {
      console.error('Scheduler error:', error);
    }
  });

  console.log('[Scheduler] Планировщик запущен');
}
