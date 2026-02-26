import { readdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, renameSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import config from './config.mjs';
import { ingestText, deleteSource } from './ingest.mjs';
import { loadIndex, saveIndex } from './sync.mjs';

const DOCSOURCE       = config.ingest.docsource_dir;
const DISABLED_PREFIX = config.personal?.disabled_prefix ?? '_d_';

export function list() {
  return readdirSync(DOCSOURCE)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const stat = statSync(join(DOCSOURCE, f));
      const isDisabled = f.startsWith(DISABLED_PREFIX);
      return {
        name: isDisabled ? f.slice(DISABLED_PREFIX.length) : f,
        file: f,
        status: isDisabled ? 'disabled' : 'active',
        size: stat.size,
        mtime: stat.mtimeMs,
      };
    });
}

export function read(name) {
  const activePath   = join(DOCSOURCE, name);
  const disabledPath = join(DOCSOURCE, DISABLED_PREFIX + name);
  if (existsSync(activePath))   return readFileSync(activePath, 'utf8');
  if (existsSync(disabledPath)) return readFileSync(disabledPath, 'utf8');
  return '';
}

export async function upload(name, text) {
  writeFileSync(join(DOCSOURCE, name), text, 'utf8');
  await ingestText(name, text);
  const index = loadIndex();
  index[name] = { mtime: statSync(join(DOCSOURCE, name)).mtimeMs, ingested_at: new Date().toISOString() };
  saveIndex(index);
}

export async function append(name, text) {
  const path = join(DOCSOURCE, name);
  if (!existsSync(path)) writeFileSync(path, '', 'utf8');
  appendFileSync(path, '\n' + text, 'utf8');
  const fullText = readFileSync(path, 'utf8');
  await ingestText(name, fullText);
  const index = loadIndex();
  index[name] = { mtime: statSync(path).mtimeMs, ingested_at: new Date().toISOString() };
  saveIndex(index);
}

export async function rename(oldName, newName) {
  const oldPath = join(DOCSOURCE, oldName);
  const newPath = join(DOCSOURCE, newName);
  await deleteSource(oldName);
  renameSync(oldPath, newPath);
  const text = readFileSync(newPath, 'utf8');
  await ingestText(newName, text);
  const index = loadIndex();
  delete index[oldName];
  index[newName] = { mtime: statSync(newPath).mtimeMs, ingested_at: new Date().toISOString() };
  saveIndex(index);
}

export async function disable(name) {
  const oldPath = join(DOCSOURCE, name);
  const newPath = join(DOCSOURCE, DISABLED_PREFIX + name);
  await deleteSource(name);
  renameSync(oldPath, newPath);
  const index = loadIndex();
  delete index[name];
  saveIndex(index);
}

export async function enable(name) {
  const oldPath = join(DOCSOURCE, DISABLED_PREFIX + name);
  const newPath = join(DOCSOURCE, name);
  renameSync(oldPath, newPath);
  const text = readFileSync(newPath, 'utf8');
  await ingestText(name, text);
  const index = loadIndex();
  index[name] = { mtime: statSync(newPath).mtimeMs, ingested_at: new Date().toISOString() };
  saveIndex(index);
}

export async function remove(name) {
  const path = join(DOCSOURCE, name);
  await deleteSource(name);
  if (existsSync(path)) unlinkSync(path);
  const index = loadIndex();
  delete index[name];
  saveIndex(index);
}
