// Service worker: permite abrir o app sem internet e mostrar notificações no celular.
// Arquivos do app: rede primeiro (sempre a versão nova quando online), cache como reserva offline.
// Bibliotecas externas (CDN): cache primeiro. APIs (Supabase, Google): nunca passam pelo cache.
const VERSAO = 'assistente-v9';
const ARQUIVOS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/vendor/capacitor-core.js', 'js/config.js', 'js/icones.js', 'js/core.js', 'js/sync.js', 'js/inicio.js', 'js/tarefas.js', 'js/financas.js', 'js/agenda.js',
  'js/trajetos.js', 'js/treinos.js', 'js/nutricao.js', 'js/alarmes.js', 'js/google.js', 'js/nativo.js', 'js/jarvis.js', 'js/geral.js', 'js/main.js',
  'icons/icone-192.png', 'icons/favicon.png',
];
const CDN = 'https://cdn.jsdelivr.net/';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.href.startsWith(CDN)) {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => {
      const copia = r.clone();
      caches.open(VERSAO).then(cache => cache.put(req, copia));
      return r;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;

  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(cache => cache.put(req, copia)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(c => c || caches.match('index.html'))));
});

// Clicar na notificação abre (ou traz para frente) o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(janelas => {
    const aberta = janelas.find(j => j.url.startsWith(self.registration.scope));
    return aberta ? aberta.focus() : self.clients.openWindow('./#inicio');
  }));
});
