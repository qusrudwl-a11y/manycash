/* MY MONEY — Service Worker
 * 앱 파일은 버전별 캐시(cache-first)로 오프라인 동작을 보장합니다.
 * 업데이트 배포 시 VERSION만 올리면 새 버전이 설치되고, 사용자 데이터(IndexedDB)는 그대로 유지됩니다.
 */
const VERSION = '1.0.0';
const APP_CACHE = 'mymoney-app-' + VERSION;
const OCR_CACHE = 'mymoney-ocr-v1'; // OCR 엔진(약 9MB)은 앱 업데이트와 별도로 유지

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('mymoney-app-') && k !== APP_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 요청은 관여하지 않음

  // OCR 엔진 파일: cache-first, 없으면 받아서 저장
  if (url.pathname.includes('/vendor/ocr/')) {
    event.respondWith((async () => {
      const cache = await caches.open(OCR_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // 페이지 이동: 캐시된 index.html 우선(오프라인 실행)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      const hit = await cache.match('./index.html');
      if (hit) return hit;
      try { return await fetch(req); } catch (e) { return new Response('오프라인입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    })());
    return;
  }

  // 앱 파일: cache-first
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
