import { z } from 'zod';
import { router, adminProcedure } from '../../_core/trpc.js';
import { posts, channels } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { generatePost, generateImagePrompt, regeneratePost } from '../../services/claude.js';
import { generateImage } from '../../services/flux.js';
export const postsRouter = router({
    list: adminProcedure
        .input(z.object({ channelId: z.string().uuid().optional() }))
        .query(async ({ ctx, input }) => {
        let query = ctx.db.select().from(posts).orderBy(desc(posts.createdAt));
        if (input.channelId) {
            query = query.where(eq(posts.channelId, input.channelId));
        }
        return query;
    }),
    generate: adminProcedure
        .input(z.object({
        channelId: z.string().uuid(),
        sourceContent: z.string(),
        withImage: z.boolean().default(true),
    }))
        .mutation(async ({ ctx, input }) => {
        const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, input.channelId));
        if (!channel)
            throw new Error('Channel not found');
        const text = await generatePost(channel, input.sourceContent);
        let imageUrl = null;
        if (input.withImage) {
            const imagePrompt = await generateImagePrompt(text);
            imageUrl = await generateImage(imagePrompt);
        }
        const [post] = await ctx.db.insert(posts).values({
            channelId: input.channelId,
            text,
            imageUrl,
            status: 'pending_approval',
            sourceType: 'text',
        }).returning();
        return post;
    }),
    approve: adminProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
        const [post] = await ctx.db.update(posts)
            .set({ status: 'approved' })
            .where(eq(posts.id, input.id))
            .returning();
        return post;
    }),
    reject: adminProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
        const [post] = await ctx.db.update(posts)
            .set({ status: 'rejected' })
            .where(eq(posts.id, input.id))
            .returning();
        return post;
    }),
    regenerate: adminProcedure
        .input(z.object({
        id: z.string().uuid(),
        feedback: z.string(),
    }))
        .mutation(async ({ ctx, input }) => {
        const [post] = await ctx.db.select().from(posts).where(eq(posts.id, input.id));
        if (!post)
            throw new Error('Post not found');
        const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, post.channelId));
        const newText = await regeneratePost(channel, post.text, input.feedback);
        const [updatedPost] = await ctx.db.update(posts)
            .set({ text: newText, status: 'pending_approval' })
            .where(eq(posts.id, input.id))
            .returning();
        return updatedPost;
    }),
});
