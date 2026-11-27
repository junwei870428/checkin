import { Hono } from 'hono';
import { apiError, type AppEnv, type Bindings } from './env';
import { authRoutes } from './routes/auth';

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

app.route('/', authRoutes);

app.notFound(c => apiError(c, 404, 'not_found', '找不到這個 API'));
app.onError((err, c) => {
  console.error(err);
  return apiError(c, 500, 'internal', '系統發生錯誤，請稍後再試');
});

export default {
  fetch: app.fetch,
  // 第 5 階段實作：刪除結束滿 10 天的活動
  async scheduled(_controller: ScheduledController, _env: Bindings, _ctx: ExecutionContext) {},
} satisfies ExportedHandler<Bindings>;
