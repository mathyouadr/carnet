/* Carnet offline service worker (CARNET_OFFLINE=1), rendered by carnet/offline.py.
   - App shell (index + every file of this build) cached at install; a new build = a new worker = old files dropped.
   - Reads (bootstrap, pages) go to the network first; after 4 s or with no answer, the last copy, marked
     X-Cached-At so the app switches to read-only offline mode. Search runs here on the cached pages.
   - {type: "warm"} (sent by the app, at most every 15 min): downloads every page that changed since last time,
     with its images and attachments (10 MB per file, 100 MB in all).
   Writes are never cached or queued: offline, Carnet is read-only. */
const BASE = {{BASE}}, VERSION = {{VERSION}}, ASSETS = {{ASSETS}};
importScripts(BASE + "/sw-lib.js?v=" + VERSION);
const L = self.CarnetOffline;
const SHELL = "carnet-" + VERSION, DATA = "carnet-data", FILES = "carnet-files";
const TIMEOUT = 4000, WARM_EVERY = 15 * 60 * 1000, FILE_MAX = 10 * 1024 * 1024, FILES_MAX = 100 * 1024 * 1024;
const K = { boot: BASE + "/api/bootstrap", known: BASE + "/__known", index: BASE + "/__index", files: BASE + "/__files", warm: BASE + "/__warm" };
const pageKey = id => BASE + "/api/pages/" + id;
let slowUntil = 0, warming = false;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.allSettled([BASE + "/", ...ASSETS.map(a => BASE + "/" + a)].map(u =>
    fetch(u, { credentials: "same-origin" }).then(res => { if (res.ok) return c.put(u, res); }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("carnet-") && ![SHELL, DATA, FILES].includes(k))
    .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const stamp = res => { const h = new Headers(res.headers); h.set("X-Cached-At", String(Date.now()));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h }); };
const getJSON = async (cache, key) => { const r = await (await caches.open(cache)).match(key); return r ? r.json() : null; };
const putJSON = async (cache, key, v) => (await caches.open(cache)).put(key, new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } }));

/* Network first; the cached copy after TIMEOUT, on no answer, or when the proxy says the app is down. */
function netOrCache(e, cache, key, store) {
  const net = fetch(e.request).then(async res => { if (res.ok && store) await (await caches.open(cache)).put(key, stamp(res.clone())); return res; });
  e.waitUntil(net.catch(() => {}));
  return new Promise(resolve => {
    let done = false;
    const fallback = async () => {
      if (done) return false;
      const hit = await (await caches.open(cache)).match(key) || await caches.match(key);   // any cache of this site
      if (done || !hit) return false;
      done = true; resolve(hit); return true;
    };
    if (Date.now() < slowUntil) fallback();
    const timer = setTimeout(() => { slowUntil = Date.now() + 30000; fallback(); }, TIMEOUT);
    net.then(async res => {
      clearTimeout(timer);
      if (res.status >= 502 && await fallback()) return;
      if (res.ok && !done) slowUntil = 0;
      if (!done) { done = true; resolve(res); }
    }, async () => { clearTimeout(timer); if (await fallback() || done) return; done = true; resolve(Response.error()); });
  });
}

async function offlineSearch(url) {
  const [index, boot] = await Promise.all([getJSON(DATA, K.index), caches.open(DATA).then(c => c.match(K.boot)).then(r => r ? r.json() : null)]);
  const pages = Object.values(index || {}), tree = (boot && boot.tree) || [];
  const results = L.searchPages(pages, tree, url.searchParams.get("q") || "", Math.min(100, +url.searchParams.get("limit") || 25));
  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json", "X-Cached-At": String(Date.now()) } });
}

self.addEventListener("fetch", e => {
  const r = e.request, url = new URL(r.url);
  if (r.method !== "GET" || url.origin !== location.origin) return;
  if (!url.pathname.startsWith(BASE + "/")) {
    // files the host page injects (CARNET_EXTRA_HEAD/BODY: its menu script, styles, fonts): network, else a copy
    if (["script", "style", "font", "image"].includes(r.destination)) e.respondWith(netOrCache(e, DATA, url.pathname + url.search, true));
    return;
  }
  const rel = url.pathname.slice(BASE.length);
  if (rel.startsWith("/assets/")) {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(async res => {
      if (res.ok) await (await caches.open(SHELL)).put(r, res.clone()); return res; })));
  } else if (r.mode === "navigate") {
    e.respondWith(netOrCache(e, SHELL, BASE + "/", true));
  } else if (rel === "/api/bootstrap") {
    e.respondWith(netOrCache(e, DATA, K.boot, true));
  } else if (/^\/api\/pages\/[A-Za-z0-9_-]+$/.test(rel)) {
    e.respondWith(netOrCache(e, DATA, BASE + rel, true));
  } else if (rel === "/api/search") {
    e.respondWith(new Promise(resolve => {
      let done = false;
      const off = () => { if (!done) { done = true; resolve(offlineSearch(url)); } };
      const timer = setTimeout(off, Date.now() < slowUntil ? 0 : TIMEOUT);
      fetch(r).then(res => { clearTimeout(timer); if (res.status >= 502) return off(); if (!done) { done = true; resolve(res); } }, () => { clearTimeout(timer); off(); });
    }));
  } else if (rel.startsWith("/files/")) {
    e.respondWith(caches.open(FILES).then(c => c.match(url.pathname)).then(hit => hit || fetch(r)));
  }
});

async function cacheFile(u, sizes) {
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  if (u in sizes || total >= FILES_MAX) return;
  const res = await fetch(BASE + u, { credentials: "same-origin" }).catch(() => null);
  if (!res || !res.ok) return;
  const len = +res.headers.get("Content-Length") || 0;
  if (len > FILE_MAX || total + len > FILES_MAX) return;
  const blob = await res.blob();
  if (blob.size > FILE_MAX || total + blob.size > FILES_MAX) return;
  await (await caches.open(FILES)).put(BASE + u, new Response(blob, { headers: res.headers }));
  sizes[u] = blob.size;
}

async function warm() {
  if (warming) return;
  const last = await (await caches.open(DATA)).match(K.warm);
  if (last && Date.now() - +(await last.text()) < WARM_EVERY) return;
  warming = true;
  try {
    const res = await fetch(K.boot, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return;
    const data = DATA, c = await caches.open(data);
    await c.put(K.boot, stamp(res.clone()));
    const tree = (await res.json()).tree || [];
    const sig = L.signatures(tree);
    const known = (await getJSON(data, K.known)) || {}, index = (await getJSON(data, K.index)) || {}, sizes = (await getJSON(data, K.files)) || {};
    const { fetch: todo, drop } = L.stalePages(tree, known);
    for (const id of drop) { delete known[id]; delete index[id]; await c.delete(pageKey(id)); }
    let n = 0;
    for (const id of todo) {
      const pr = await fetch(pageKey(id), { cache: "no-store", credentials: "same-origin" }).catch(() => null);
      if (!pr) break;                                   // the network went away: next time
      if (!pr.ok) continue;
      await c.put(pageKey(id), stamp(pr.clone()));
      const page = await pr.json();
      const t = tree.find(p => p.id === id) || page;
      index[id] = Object.assign({}, t, { text: L.pageText(page) });
      for (const u of L.fileUrls(page)) await cacheFile(u, sizes);
      known[id] = sig[id];
      if (++n % 20 === 0) await Promise.all([putJSON(data, K.known, known), putJSON(data, K.index, index), putJSON(data, K.files, sizes)]);
    }
    await Promise.all([putJSON(data, K.known, known), putJSON(data, K.index, index), putJSON(data, K.files, sizes)]);
    if (todo.every(id => known[id] === sig[id])) await c.put(K.warm, new Response(String(Date.now())));
  } finally { warming = false; }
}

self.addEventListener("message", e => {
  const m = e.data || {};
  if (m.type === "warm") e.waitUntil(warm().catch(() => {}));
  if (m.type === "forget") e.waitUntil(Promise.all([caches.delete(DATA), caches.delete(FILES)]));   // logout
});
