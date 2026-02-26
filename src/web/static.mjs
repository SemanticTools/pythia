import { readFileSync, existsSync } from 'fs';
import { join, extname, resolve } from 'path';
import { logger } from '../lib/log.mjs';

const log = logger('http');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const WWW = resolve('./www-static');

export function serveStatic(req, res) {
  if (req.method !== 'GET') return false;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;

  // Prevent directory traversal
  const filepath = resolve(join(WWW, pathname));
  if (!filepath.startsWith(WWW)) return false;
  if (!existsSync(filepath)) return false;

  const mime = MIME[extname(filepath)] ?? 'application/octet-stream';
  const content = readFileSync(filepath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
  log.debug(`GET ${pathname} 200 static`);
  return true;
}
