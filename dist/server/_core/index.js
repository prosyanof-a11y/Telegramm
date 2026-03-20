import express from 'express';
import cors from 'cors';
import * as trpcExpress from '@trpc/server/adapters/express';
import { router, createContext } from './trpc.js';
import { channelsRouter } from '../api/routers/channels.js';
import { postsRouter } from '../api/routers/posts.js';
import { analyticsRouter } from '../api/routers/analytics.js';
import { documentsRouter } from '../api/routers/documents.js';
import { startBot } from '../bot/index.js';
import { startScheduler } from '../bot/scheduler.js';
import dotenv from 'dotenv';
dotenv.config();
const appRouter = router({
    channels: channelsRouter,
    posts: postsRouter,
    analytics: analyticsRouter,
    documents: documentsRouter,
});
const app = express();
app.use(cors());
app.use(express.json());
app.use('/trpc', trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
}));
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`[Server] Сервер запущен на порту ${port}`);
    startBot();
    startScheduler();
});
