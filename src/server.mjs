import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import * as links from './links.mjs';
import { PDFParse } from 'pdf-parse';
import config from './config.mjs';
import { ingestText, deleteSource } from './ingest.mjs';
import { syncDocsource } from './sync.mjs';
import { retrieve } from './retriever.mjs';
import { ask, quickLabel } from './llm.mjs';
import { logger } from './lib/log.mjs';
import { serveStatic } from './web/static.mjs';
import * as filestore from './filestore.mjs';
import { parseSnippets, serializeSnippets } from './snippets.mjs';

const log   = logger('http');
const stats = logger('stats');

const USERNAME        = config.personal?.username ?? 'user';
const QUICKMEM_FILE   = `${USERNAME}-quickmem.txt`;
const EVENTS_FILE     = `${USERNAME}-events.txt`;
const UI_SETTINGS     = join('./data', 'ui-settings.json');
const DEFAULT_THEME   = config.personal?.theme ?? 'dark';
const DISCUSSIONS_DIR = join('./data', 'discussions');
if (!existsSync(DISCUSSIONS_DIR)) mkdirSync(DISCUSSIONS_DIR, { recursive: true });

// ── Discussion helpers ──────────────────────────────────────────────────

function listDiscussions() {
  return readdirSync(DISCUSSIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(DISCUSSIONS_DIR, f), 'utf8')))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

function saveDiscussionFile({ id, title, messages, pinned }) {
  const now  = new Date().toISOString();
  const path = id ? join(DISCUSSIONS_DIR, `${id}.json`) : null;
  let disc   = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  if (disc) {
    disc.title    = title ?? disc.title;
    disc.messages = messages;
    disc.updatedAt = now;
    if (pinned !== undefined) disc.pinned = pinned;
  } else {
    disc = { id: randomUUID(), title: title || 'Discussion', createdAt: now, updatedAt: now, pinned: false, messages };
  }
  writeFileSync(join(DISCUSSIONS_DIR, `${disc.id}.json`), JSON.stringify(disc, null, 2), 'utf8');
  return disc;
}

function pruneRecents() {
  const unpinned = listDiscussions().filter(d => !d.pinned);
  for (const d of unpinned.slice(5)) unlinkSync(join(DISCUSSIONS_DIR, `${d.id}.json`));
}

function setPinned(id, pinned) {
  const path = join(DISCUSSIONS_DIR, `${id}.json`);
  if (!existsSync(path)) throw new Error('Not found');
  const disc = JSON.parse(readFileSync(path, 'utf8'));
  disc.pinned = pinned;
  writeFileSync(path, JSON.stringify(disc, null, 2), 'utf8');
  if (!pinned) pruneRecents();
  return disc;
}

function resolveMemFile(file) {
  return file === 'events' ? EVENTS_FILE : QUICKMEM_FILE;
}

// One-time migration: rename old -notes.txt → -quickmem.txt
export async function migrateFiles() {
  const oldFile = `${USERNAME}-notes.txt`;
  const oldPath = join(config.ingest.docsource_dir, oldFile);
  const newPath = join(config.ingest.docsource_dir, QUICKMEM_FILE);
  if (existsSync(oldPath) && !existsSync(newPath)) {
    const syslog = logger('system');
    syslog.info(`Migrating ${oldFile} → ${QUICKMEM_FILE}`);
    await filestore.rename(oldFile, QUICKMEM_FILE);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function readBodyRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function loadUiSettings() {
  if (!existsSync(UI_SETTINGS)) return { theme: DEFAULT_THEME };
  try { return JSON.parse(readFileSync(UI_SETTINGS, 'utf8')); }
  catch { return { theme: DEFAULT_THEME }; }
}

async function handle(req, res) {
  const t0 = Date.now();
  const url = new URL(req.url, `http://${req.headers.host}`);
  log.info(`${req.method} ${url.pathname}`);

  // --- Health ---
  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { status: 'ok' });
    return;
  }

  // --- Legacy ingest endpoints ---
  if (req.method === 'POST' && url.pathname === '/ingest') {
    const { source, text } = await readBody(req);
    if (!source || !text) { send(res, 400, { error: 'source and text required' }); return; }
    await ingestText(source, text);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/update') {
    const result = await syncDocsource();
    send(res, 200, result);
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/ingest') {
    const { source } = await readBody(req);
    if (!source) { send(res, 400, { error: 'source required' }); return; }
    await deleteSource(source);
    send(res, 200, { ok: true });
    return;
  }

  // --- Ask ---
  if (req.method === 'POST' && url.pathname === '/ask') {
    const { question, history = [] } = await readBody(req);
    if (!question) { send(res, 400, { error: 'question required' }); return; }
    const results           = await retrieve(question, history);
    const { text, syscallCount } = await ask(question, results.map(r => r.text), history);
    const sources = [...new Set(results.map(r =>
      r.snippet ? `${r.source}::${r.snippet}` : r.source
    ))];
    const duration = Date.now() - t0;
    send(res, 200, { answer: text, sources, memoryWritten: syscallCount > 0 });
    log.info(`POST /ask 200 sources=[${sources.join(', ')}] ${duration}ms`);
    stats.info('query', { question: question.slice(0, 100), results: results.length, sources, duration_ms: duration });
    return;
  }

  // --- Buckets ---
  if (req.method === 'GET' && url.pathname === '/buckets') {
    send(res, 200, filestore.list());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/buckets') {
    const { name, text } = await readBody(req);
    if (!name || text == null) { send(res, 400, { error: 'name and text required' }); return; }
    await filestore.upload(name, text);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/buckets/rename') {
    const { from, to } = await readBody(req);
    if (!from || !to) { send(res, 400, { error: 'from and to required' }); return; }
    await filestore.rename(from, to);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/buckets/disable') {
    const { name } = await readBody(req);
    if (!name) { send(res, 400, { error: 'name required' }); return; }
    await filestore.disable(name);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/buckets/enable') {
    const { name } = await readBody(req);
    if (!name) { send(res, 400, { error: 'name required' }); return; }
    await filestore.enable(name);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/buckets') {
    const { name } = await readBody(req);
    if (!name) { send(res, 400, { error: 'name required' }); return; }
    await filestore.remove(name);
    send(res, 200, { ok: true });
    return;
  }

  // --- Memory ---
  if (req.method === 'GET' && url.pathname === '/memory') {
    send(res, 200, { text: filestore.read(QUICKMEM_FILE) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/memory/note') {
    const { text } = await readBody(req);
    if (!text) { send(res, 400, { error: 'text required' }); return; }
    const label = await quickLabel(text, 'note');
    await filestore.append(QUICKMEM_FILE, `\n%%${label}\n${text}\n%%end`);
    send(res, 200, { ok: true, label });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/memory/event') {
    const { text } = await readBody(req);
    if (!text) { send(res, 400, { error: 'text required' }); return; }
    const label = await quickLabel(text, 'event');
    await filestore.append(EVENTS_FILE, `\n%%${label}\n${text}\n%%end`);
    send(res, 200, { ok: true, label });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/memory/append') {
    const { text } = await readBody(req);
    if (!text) { send(res, 400, { error: 'text required' }); return; }
    await filestore.append(QUICKMEM_FILE, text);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/memory/save') {
    const { text } = await readBody(req);
    if (text == null) { send(res, 400, { error: 'text required' }); return; }
    await filestore.upload(QUICKMEM_FILE, text);
    send(res, 200, { ok: true });
    return;
  }

  // --- Snippet management ---
  if (req.method === 'GET' && url.pathname === '/memory/snippets') {
    const memFile  = resolveMemFile(url.searchParams.get('file'));
    const marker   = config.personal?.snippet_marker ?? '%%';
    const sections = parseSnippets(filestore.read(memFile), marker);
    const hasMain  = sections.some(s => s.name === null);
    const result   = hasMain ? sections : [{ name: null, text: '' }, ...sections];
    send(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/memory/snippet/edit') {
    const { file, name, text } = await readBody(req);
    if (text == null) { send(res, 400, { error: 'text required' }); return; }
    const memFile  = resolveMemFile(file);
    const marker   = config.personal?.snippet_marker ?? '%%';
    const sections = parseSnippets(filestore.read(memFile), marker);
    const nameKey  = name ?? null;
    const idx      = sections.findIndex(s => s.name === nameKey);
    if (idx >= 0) {
      sections[idx] = { name: nameKey, text };
    } else if (nameKey === null) {
      sections.unshift({ name: null, text });
    } else {
      sections.push({ name: nameKey, text });
    }
    await filestore.upload(memFile, serializeSnippets(sections));
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/memory/snippet') {
    const { file, name } = await readBody(req);
    const memFile  = resolveMemFile(file);
    const marker   = config.personal?.snippet_marker ?? '%%';
    const sections = parseSnippets(filestore.read(memFile), marker);
    const nameKey  = name ?? null;
    const filtered = sections.filter(s => s.name !== nameKey);
    await filestore.upload(memFile, serializeSnippets(filtered));
    send(res, 200, { ok: true });
    return;
  }

  // --- Discussions ---
  if (req.method === 'GET' && url.pathname === '/discussions') {
    send(res, 200, listDiscussions());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/discussions') {
    const { id, title, messages, pinned } = await readBody(req);
    if (!messages) { send(res, 400, { error: 'messages required' }); return; }
    const disc = saveDiscussionFile({ id, title, messages, pinned });
    pruneRecents();
    send(res, 200, disc);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/discussions/pin') {
    const { id, pinned } = await readBody(req);
    if (!id) { send(res, 400, { error: 'id required' }); return; }
    send(res, 200, setPinned(id, !!pinned));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/discussions') {
    const { id } = await readBody(req);
    if (!id) { send(res, 400, { error: 'id required' }); return; }
    const path = join(DISCUSSIONS_DIR, `${id}.json`);
    if (existsSync(path)) unlinkSync(path);
    send(res, 200, { ok: true });
    return;
  }

  // --- Memory file upload (txt / pdf) ---
  if (req.method === 'POST' && url.pathname === '/memfile/upload') {
    const name = url.searchParams.get('name');
    if (!name) { send(res, 400, { error: 'name required' }); return; }
    const lname = name.toLowerCase();
    if (!lname.endsWith('.txt') && !lname.endsWith('.pdf')) {
      send(res, 400, { error: 'Only .txt and .pdf files are supported' });
      return;
    }
    const buf = await readBodyRaw(req);
    if (lname.endsWith('.pdf')) {
      let text;
      try {
        const parser = new PDFParse({ data: buf });
        const result = await parser.getText();
        text = result.text;
        await parser.destroy();
      } catch (err) {
        send(res, 400, { error: `PDF parse failed: ${err.message}` });
        return;
      }
      const txtName = name.replace(/\.pdf$/i, '.txt');
      await filestore.upload(txtName, text);
      send(res, 200, { ok: true, storedAs: txtName });
    } else {
      const text  = buf.toString('utf8');
      const alnum = (text.match(/[a-zA-Z0-9]/g) ?? []).length;
      const ratio = text.length > 0 ? alnum / text.length : 0;
      if (ratio <= 0.8) {
        send(res, 400, { error: `File looks binary (${Math.round(ratio * 100)}% alphanumeric). Only plain text allowed.` });
        return;
      }
      await filestore.upload(name, text);
      send(res, 200, { ok: true, storedAs: name });
    }
    return;
  }

  // --- Settings ---
  if (req.method === 'GET' && url.pathname === '/settings') {
    const rawButtons = config.personal?.smart_buttons ?? [];
    const smartButtons = rawButtons.map(s => {
      const sep = s.indexOf('::');
      return sep >= 0
        ? { label: s.slice(0, sep), prefix: s.slice(sep + 2) }
        : { label: s, prefix: '' };
    });
    send(res, 200, {
      ...loadUiSettings(),
      snippetMarker: config.personal?.snippet_marker ?? '%%',
      smartButtons,
      logos: (() => {
        const def = config.personal?.logo ?? 'logo-large-personal.png';
        const map = config.personal?.logos ?? {};
        return { dark: map.dark ?? def, light: map.light ?? def, terminal: map.terminal ?? def };
      })(),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/settings') {
    const { theme } = await readBody(req);
    if (!theme) { send(res, 400, { error: 'theme required' }); return; }
    writeFileSync(UI_SETTINGS, JSON.stringify({ theme }, null, 2), 'utf8');
    send(res, 200, { ok: true });
    return;
  }

  // --- Links ---

  if (req.method === 'GET' && url.pathname === '/links/fetch-title') {
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) { send(res, 400, { error: 'url required' }); return; }
    try {
      if (typeof fetch === 'undefined') { send(res, 200, { title: '' }); return; }
      const ac    = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      try {
        const r   = await fetch(targetUrl, {
          signal:  ac.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Pythia/1.0)' },
        });
        const raw     = await r.text();
        const snippet = raw.slice(0, 16384);
        const m       = snippet.match(/<title[^>]*>([^<]+)<\/title>/i);
        let title     = m ? m[1] : '';
        title = title
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
        send(res, 200, { title });
      } finally {
        clearTimeout(timer);
      }
    } catch { send(res, 200, { title: '' }); }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/links') {
    send(res, 200, { links: links.loadLinks() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/links') {
    const { url: linkUrl, title, tags, note } = await readBody(req);
    if (!linkUrl) { send(res, 400, { error: 'url required' }); return; }
    const link = links.addLink({ url: linkUrl, title: title || '', tags: tags || [], note: note || '' });
    send(res, 201, { link });
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/links/') && url.pathname.endsWith('/visit')) {
    const id = url.pathname.slice(7, -6);
    links.bumpVisit(id);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/links/')) {
    const id   = url.pathname.slice(7);
    const patch = await readBody(req);
    const link  = links.updateLink(id, patch);
    if (!link) { send(res, 404, { error: 'not found' }); return; }
    send(res, 200, { link });
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/links/')) {
    const id = url.pathname.slice(7);
    links.deleteLink(id);
    send(res, 200, { ok: true });
    return;
  }

  if (serveStatic(req, res)) return;

  send(res, 404, { error: 'not found' });
  log.warn(`${req.method} ${url.pathname} 404`);
}

export function startServer() {
  const { port, host } = config.server;
  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      log.error(`Request error: ${err.message}`);
      send(res, 500, { error: err.message });
    }
  });
  const syslog = logger('system');
  server.listen(port, host, () => syslog.info(`Pythia listening on ${host}:${port}`));
  return server;
}
