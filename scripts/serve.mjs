// Serves the static export the way GitHub Pages does: under /<repo>/, with
// directory index.html files and 404.html. Used by the Playwright tests.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = new URL("../out/", import.meta.url).pathname;
const base = process.env.PAGES_BASE_PATH ?? "";
const port = Number(process.env.PORT ?? 4176);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".woff2": "font/woff2", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".png": "image/png", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".csv": "text/csv" };

const file = (p) => {
  try {
    const s = statSync(p);
    if (s.isDirectory()) return file(join(p, "index.html"));
    return p;
  } catch {
    return null;
  }
};

createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (base && !url.startsWith(base)) {
    res.writeHead(302, { location: base + "/" }).end();
    return;
  }
  const rel = normalize(url.slice(base.length)).replace(/^(\.\.[/\\])+/, "");
  const hit = file(join(root, rel));
  if (hit && !hit.startsWith(root)) return res.writeHead(403).end();
  // Like Pages: /users -> /users/
  if (hit && !url.endsWith("/") && hit.endsWith("index.html") && !rel.endsWith("index.html")) {
    res.writeHead(301, { location: url + "/" }).end();
    return;
  }
  const target = hit ?? join(root, "404.html");
  res.writeHead(hit ? 200 : 404, { "content-type": types[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
}).listen(port, () => console.log(`Serving out/ at http://localhost:${port}${base}/`));
