// 猪宝本地版 Service Worker v15
// 策略：同源文件 cache-first / 跨域CDN network-first（只缓存成功响应）
// v15: 默认不选模型(手动选本地/云端保存后才生效) + 修复云端API历史消息 role 'ai'→'assistant'
const CACHE = "zhubao-local-v15";
const PRECACHE = ["./", "index.html", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 同源资源：cache-first（保证离线可用）
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match("index.html"))));
    return;
  }

  // 跨域 CDN 资源（transformers.js / HF 模型）：network-first
  // 只缓存成功响应(2xx)，绝不缓存 error/opaque
  e.respondWith(
    fetch(req).then(res => {
      // 只缓存明确的成功响应
      if (res && res.status >= 200 && res.status < 300 && res.type !== "opaque") {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(async () => {
      // 网络失败 → 尝试从缓存取
      const cached = await caches.match(req);
      if (cached) return cached;
      // 彻底没辙：返回空 JS stub（让 import 不报错）
      if (req.url.includes("transformers")) {
        return new Response(
          "export const pipeline=async()=>{throw new Error('[SW]离线：模型库不可用，请联网后刷新')};export class TextStreamer{constructor(){}}export const env={};",
          { headers: { "Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*" } }
        );
      }
      return new Response("", { status: 503, statusText: "ServiceWorker: offline and not cached" });
    })
  );
});
