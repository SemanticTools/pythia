import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const LINKS_FILE = join('./data', 'links.json');

export function loadLinks() {
  if (!existsSync(LINKS_FILE)) return [];
  try { return JSON.parse(readFileSync(LINKS_FILE, 'utf8')); }
  catch { return []; }
}

function saveLinks(arr) {
  writeFileSync(LINKS_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

export function addLink({ url, title = '', tags = [], note = '' }) {
  const links = loadLinks();
  const existing = links.find(l => l.url === url);
  if (existing) return existing;
  const link = { id: randomUUID(), url, title, tags, note, addedAt: new Date().toISOString(), visits: 0 };
  links.unshift(link);
  saveLinks(links);
  return link;
}

export function updateLink(id, patch) {
  const links = loadLinks();
  const idx = links.findIndex(l => l.id === id);
  if (idx < 0) return null;
  Object.assign(links[idx], patch);
  saveLinks(links);
  return links[idx];
}

export function deleteLink(id) {
  saveLinks(loadLinks().filter(l => l.id !== id));
}

export function bumpVisit(id) {
  const links = loadLinks();
  const link  = links.find(l => l.id === id);
  if (link) { link.visits = (link.visits || 0) + 1; saveLinks(links); }
}
