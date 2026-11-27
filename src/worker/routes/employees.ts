// 第 2 階段（P2）：/api/employees*

import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const employeeRoutes = new Hono<AppEnv>();
