// 第 3 階段（P3）：/api/events/:id/staff、/api/staff/*

import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const staffRoutes = new Hono<AppEnv>();
