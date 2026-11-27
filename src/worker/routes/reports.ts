// 第 5 階段（P5）：/api/events/:id/summary、breakdown、roster

import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const reportRoutes = new Hono<AppEnv>();
