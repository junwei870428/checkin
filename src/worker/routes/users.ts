// 第 2 階段（P2）：/api/users*

import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const userRoutes = new Hono<AppEnv>();
