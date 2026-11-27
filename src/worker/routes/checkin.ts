// 第 4 階段（P4）：/api/checkin/*

import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const checkinRoutes = new Hono<AppEnv>();
