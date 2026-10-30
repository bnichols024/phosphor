// Tiny HTTP toolkit: a router with :params, JSON helpers, and a static file sender with
// ETag, Range and HEAD support (ROMs, emulator cores and box art all go through sendFile).
import fs from "node:fs";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".m3u": "text/plain; charset=utf-8", ".cue": "text/plain; charset=utf-8",
};

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/\/:(\w+)(\*)?/g, (_, k, star) => { keys.push(k); return star ? "/(.*)" : "/([^/]+)"; }) + "/?$");
    this.routes.push({ method, re, keys, handler });
  }
  get(p, h) { this.add("GET", p, h); }
  post(p, h) { this.add("POST", p, h); }
  put(p, h) { this.add("PUT", p, h); }
  patch(p, h) { this.add("PATCH", p, h); }
  delete(p, h) { this.add("DELETE", p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === "HEAD" && r.method === "GET")) continue;
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": TYPES[".json"], "cache-control": "no-store", "content-length": Buffer.byteLength(data), ...headers });
  res.end(data);
}

export async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, "That's too big.");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const buf = await readBody(req, 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON."); }
}

export function sendFile(req, res, file, { immutable = false, type, headers = {}, downloadName } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
  if (!st.isFile()) { res.writeHead(404); return res.end(); }
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const base = {
    "content-type": type || TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "accept-ranges": "bytes",
    etag,
    "last-modified": st.mtime.toUTCString(),
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    ...headers,
  };
  if (downloadName) base["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, base); return res.end(); }
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    let start = range[1] === "" ? st.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : st.size - 1;
    if (range[1] === "") end = st.size - 1;
    if (start > end || end >= st.size || start < 0) {
      res.writeHead(416, { "content-range": `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...base, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, "content-length": st.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

export function safeJoin(root, rel) {
  const p = path.resolve(root, "." + path.sep + rel);
  if (p !== path.resolve(root) && !p.startsWith(path.resolve(root) + path.sep)) return null;
  return p;
}
