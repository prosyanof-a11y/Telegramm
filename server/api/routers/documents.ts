import { z } from 'zod';
import { router, adminProcedure } from '../../_core/trpc.js';
import { documents, channels, posts } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { generatePost, generateImagePrompt } from '../../services/claude.js';
import { generateImage } from '../../services/flux.js';

export const documentsRouter = router({
  upload: adminProcedure
    .input(z.object({
      channelId: z.string().uuid(),
      filename: z.string(),
      content: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db.insert(documents).values({
        channelId: input.channelId,
        filename: input.filename,
        content: input.content,
      } as any).returning();
      return doc;
    }),

  list: adminProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.select().from(documents).where(eq(documents.channelId, input.channelId));
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(documents).where(eq(documents.id, input.id));
      return { success: true };
    }),

  createPost: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db.select().from(documents).where(eq(documents.id, input.id));
      if (!doc) throw new Error('Document not found');

      const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, doc.channelId));
      if (!channel) throw new Error('Channel not found');

      const text = await generatePost(channel, doc.content || '');
      const imagePrompt = await generateImagePrompt(text);
      const imageUrl = await generateImage(imagePrompt);

      const [post] = await ctx.db.insert(posts).values({
        channelId: channel.id,
        text,
        imageUrl,
        status: 'pending_approval',
        sourceType: 'document',
      } as any).returning();

      await ctx.db.update(documents).set({ processed: true } as any).where(eq(documents.id, input.id));

      return post;
    }),
});
