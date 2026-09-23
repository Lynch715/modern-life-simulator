/* 现代生活模拟器 · 离线 */
const VER = 'mls-v7';
const SHELL = ['./', './index.html', './site.webmanifest', './favicon.ico',
  './icon/icon-192.png', './icon/icon-512.png', './icon/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // 大模型接口不碰

  const isCode = /\.(html|js|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isCode) {
    // 代码走网络优先：一 push 上线，联网打开就是新版
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(VER).then(c => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }
  // 图片这类走缓存优先，后台悄悄更新
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(r => { caches.open(VER).then(c => c.put(req, r.clone())); return r; }).catch(() => hit);
      return hit || net;
    })
  );
});
