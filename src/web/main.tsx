import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import '@fontsource/noto-sans-tc/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

// 斷網時重新整理報到頁也打得開（public/sw.js）；開發模式不註冊，避免快取干擾 Vite 熱更新
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    // 啟動前已經載入的檔案沒有經過 Service Worker，告訴它補存
    void navigator.serviceWorker.ready.then(reg => {
      const urls = performance.getEntriesByType('resource').map(r => r.name).filter(u => u.startsWith(`${location.origin}/assets/`));
      reg.active?.postMessage({ type: 'cache-assets', urls });
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
