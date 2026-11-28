// 讓報到頁在斷網時重新整理也打得開：只快取網頁本身（index.html 與 /assets/ 下的程式、字型），不快取任何 /api/ 回應。
// 網頁一律先連網路（拿到最新版），連不上才用快取；/assets/ 的檔名含雜湊，內容不會變，先用快取。
const CACHE = 'ck-shell-v1';
const SHELL = '/';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// 第一次開啟時，Service Worker 啟動前已載入的程式與字型不會經過它，由頁面把網址傳過來補存
self.addEventListener('message', e => {
  const urls = e.data?.type === 'cache-assets' && Array.isArray(e.data.urls) ? e.data.urls : [];
  const mine = urls.filter(u => typeof u === 'string' && new URL(u, self.location.origin).origin === self.location.origin
    && new URL(u, self.location.origin).pathname.startsWith('/assets/'));
  if (mine.length) e.waitUntil(caches.open(CACHE).then(c => Promise.all(mine.map(u => c.match(u).then(hit => hit || c.add(u)))).catch(() => {})));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) await cache.put(SHELL, res.clone());
        return res;
      } catch {
        return (await cache.match(SHELL)) ?? Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        await cache.put(req, res.clone());
        await prune(cache);
      }
      return res;
    })());
  }
});

// 每次部署都會多出新檔名的檔案，超過上限就從最早存的開始刪
const MAX_ASSETS = 120;
async function prune(cache) {
  const assets = (await cache.keys()).filter(r => new URL(r.url).pathname.startsWith('/assets/'));
  for (const r of assets.slice(0, Math.max(0, assets.length - MAX_ASSETS))) await cache.delete(r);
}
