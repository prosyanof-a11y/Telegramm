import { z } from 'zod';
import { router, adminProcedure } from '../../_core/trpc.js';
import { channels } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export const channelsRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(channels).where(eq(channels.userId, ctx.user.id));
  }),
  
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, input.id));
      return channel;
    }),

  create: adminProcedure
    .input(z.object({
      telegramChannelId: z.string(),
      name: z.string(),
      niche: z.string().optional(),
      tone: z.string().optional(),
      targetAudience: z.string().optional(),
      productDescription: z.string().optional(),
      exampleGoodPost: z.string().optional(),
      postFrequency: z.number().optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [newChannel] = await ctx.db.insert(channels).values({
        telegramChannelId: input.telegramChannelId,
        name: input.name,
        userId: ctx.user.id,
        niche: input.niche,
        tone: input.tone,
        targetAudience: input.targetAudience,
        productDescription: input.productDescription,
        exampleGoodPost: input.exampleGoodPost,
        postFrequency: input.postFrequency,
        active: input.active,
      } as any).returning();
      return newChannel;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      telegramChannelId: z.string().optional(),
      name: z.string().optional(),
      niche: z.string().optional(),
      tone: z.string().optional(),
      targetAudience: z.string().optional(),
      productDescription: z.string().optional(),
      exampleGoodPost: z.string().optional(),
      postFrequency: z.number().optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [updatedChannel] = await ctx.db.update(channels)
        .set(data as any)
        .where(eq(channels.id, id))
        .returning();
      return updatedChannel;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(channels).where(eq(channels.id, input.id));
      return { success: true };
    }),
});
