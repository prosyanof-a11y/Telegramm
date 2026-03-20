import { z } from 'zod';
import { router, adminProcedure } from '../../_core/trpc.js';
import { posts, channels } from '../../db/schema.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export const analyticsRouter = router({
  summary: adminProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const start = input.startDate || new Date(now.setDate(now.getDate() - 7));
      const end = input.endDate || new Date();

      const stats = await ctx.db.select({
        status: posts.status,
        count: sql<number>`count(*)`,
      })
      .from(posts)
      .where(and(gte(posts.createdAt, start), lte(posts.createdAt, end)))
      .groupBy(posts.status);

      return stats;
    }),

  history: adminProcedure
    .input(z.object({
      channelId: z.string().uuid().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      let conditions = [];
      if (input.channelId) conditions.push(eq(posts.channelId, input.channelId));
      if (input.startDate) conditions.push(gte(posts.createdAt, input.startDate));
      if (input.endDate) conditions.push(lte(posts.createdAt, input.endDate));

      const history = await ctx.db.select()
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(posts.createdAt);

      return history;
    }),
});
