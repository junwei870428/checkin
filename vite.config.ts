import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // 字型不內嵌成 data: URL，CSP 的 font-src 'self' 才不會擋掉較小的 Noto Sans TC 子集
    assetsInlineLimit: file => (/\.woff2?$/.test(file) ? false : undefined),
  },
  // 開發時前端跑在 Vite（5173），API 轉給 `wrangler dev`（8787）
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { include: ['tests/**/*.test.ts'] },
});
