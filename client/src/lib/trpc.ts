import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../server/_core/index.js';

export const trpc = createTRPCReact<AppRouter>();
