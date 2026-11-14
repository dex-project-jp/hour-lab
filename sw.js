const CACHE = 'hour-lab-1.2.1';
const files = ['./', './index.html', './style.css', './core.js', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(files))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys =>
  Promise.all(keys.filter(key => key.startsWith('hour-lab-') && key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !files.some(path => new URL(path, self.registration.scope).href === event.request.url)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
