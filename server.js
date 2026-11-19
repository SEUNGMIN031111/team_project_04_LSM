// 로컬 실행: node --env-file=.env server.js  →  http://localhost:3000
// public(화면) 과 /api(서버)를 한 곳에서 띄운다. 배포(Vercel)에서는 쓰지 않는다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(parts).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

async function runApi(name, req, res, url) {
  const file = path.join(ROOT, 'api', name + '.js');
  if (!/^[a-z]+$/i.test(name) || !fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: '없는 API 예요' }));
  }
  req.query = Object.fromEntries(url.searchParams);
  req.body = req.method === 'POST' ? await readBody(req) : {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  };
  try {
    const mod = await import(pathToFileURL(file).href);
    await mod.default(req, res);
  } catch (e) {
    console.error('[API 오류]', name, e.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: '서버 오류가 났어요' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return runApi(url.pathname.slice(5), req, res, url);

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('찾을 수 없어요');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`http://localhost:${PORT} 에서 열렸어요 (public + /api)`));
