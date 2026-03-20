import { initTRPC, TRPCError } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function createContext({ req, res }: CreateExpressContextOptions) {
  // In a real app, you'd verify a token here.
  // For this example, we'll assume the user is authenticated via Telegram ID
  // passed in headers or a mock user for development.
  const telegramId = req.headers['x-telegram-id'] as string;
  
  let user = null;
  if (telegramId) {
    const [existingUser] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    if (existingUser) {
      user = existingUser;
    } else {
      const [newUser] = await db.insert(users).values({ telegramId }).returning();
      user = newUser;
    }
  }

  return {
    req,
    res,
    user,
    db,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      user: ctx.user,
    },
  });
});
