import { Hono } from 'hono';
import { apiError, type AppEnv, type Bindings } from './env';
import { runRetention } from './retention';
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { checkinRoutes } from './routes/checkin';
import { employeeRoutes } from './routes/employees';
import { eventRoutes } from './routes/events';
import { reportRoutes } from './routes/reports';
import { staffRoutes } from './routes/staff';
import { userRoutes } from './routes/users';

const app = new Hono<AppEnv>().basePath('/api');

// 寫入類 API 要求 JSON，搭配 SameSite=Strict 防止 CSRF
app.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const ct = c.req.header('content-type') ?? '';
    if (!ct.toLowerCase().startsWith('application/json')) return apiError(c, 400, 'bad_content_type', '請以 JSON 格式送出');
  }
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Cache-Control', 'no-store');
});

// 路由模組都掛在 '/'，各自寫完整路徑（例如 /events/:id）。
// 模組內的 middleware 只能掛在各路由上，不可用 use('*')：掛在 '/' 的 use('*') 會擋到之後掛上的所有模組。
app.route('/', authRoutes);
app.route('/', employeeRoutes);
app.route('/', userRoutes);
app.route('/', eventRoutes);
app.route('/', staffRoutes);
app.route('/', checkinRoutes);
app.route('/', reportRoutes);
app.route('/', auditRoutes);

app.notFound(c => apiError(c, 404, 'not_found', '找不到這個 API'));
app.onError((err, c) => {
  console.error(err);
  return apiError(c, 500, 'internal', '系統發生錯誤，請稍後再試');
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, _ctx: ExecutionContext) {
    await runRetention(env, Date.now());
  },
} satisfies ExportedHandler<Bindings>;
