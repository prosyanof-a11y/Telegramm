import express from 'express';
import cors from 'cors';
import * as trpcExpress from '@trpc/server/adapters/express';
import { router, createContext } from './trpc.js';
import { channelsRouter } from '../api/routers/channels.js';
import { postsRouter } from '../api/routers/posts.js';
import { analyticsRouter } from '../api/routers/analytics.js';
import { documentsRouter } from '../api/routers/documents.js';
import { startBot, setupWebhook } from '../bot/index.js';
import { startScheduler } from '../bot/scheduler.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appRouter = router({
  channels: channelsRouter,
  posts: postsRouter,
  analytics: analyticsRouter,
  documents: documentsRouter,
});

export type AppRouter = typeof appRouter;

const app = express();
app.use(cors());
app.use(express.json());

app.use(
  '/trpc',
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../../client/dist')));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`[Server] Сервер запущен на порту ${port}`);
  
  // Setup webhook if RAILWAY_PUBLIC_DOMAIN is available, otherwise use polling
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain) {
    setupWebhook(app, railwayDomain);
  } else {
    startBot();
  }
  
  startScheduler();
});
