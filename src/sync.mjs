import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'fs';
import { join, relative, extname, sep } from 'path';
import config from './config.mjs';
import { ingestText, deleteSource } from './ingest.mjs';
import { deleteBySourceAndSnippet } from './vectors.mjs';
import { logger } from './lib/log.mjs';

const log = logger('ingest');

const DOCSOURCE       = config.ingest.docsource_dir;
const INDEX_PATH      = config.ingest.index_path;
const DISABLED_PREFIX = config.personal?.disabled_prefix ?? '_d_';
const EXTENSIONS      = new Set((config.ingest.extensions ?? ['txt', 'md', 'js', 'mjs', 'java']).map(e => e.toLowerCase()));

export function loadIndex() {
  if (!existsSync(INDEX_PATH)) return {};
  return JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
}

export function saveIndex(index) {
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

function hasAllowedExtension(filename) {
  const ext = extname(filename).slice(1).toLowerCase();
  return EXTENSIONS.has(ext);
}

// Recursively collect all files under a directory.
// Returns [{ absPath, relPath }] where relPath is relative to DOCSOURCE.
function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry.startsWith(DISABLED_PREFIX)) continue;
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      results.push(...collectFiles(abs));
    } else if (hasAllowedExtension(entry)) {
      results.push({ absPath: abs, relPath: relative(DOCSOURCE, abs) });
    }
  }
  return results;
}

// docsource/myfolder1/myfolder2/file.txt
//   → source    = "myfolder1"
//   → snippetName = "myfolder2-file.txt"  (sub-path with sep replaced by -)
// docsource/file.txt
//   → source    = "file.txt"
//   → snippetName = null  (top-level: use %% markers from file content)
function parsePath(relPath) {
  const parts = relPath.split(sep);
  if (parts.length === 1) {
    return { source: parts[0], snippetName: null, storageKey: parts[0] };
  }
  const source      = parts[0];
  const snippetName = parts.slice(1).join('-');
  const storageKey  = relPath.replace(/[\\/]/g, '_');
  return { source, snippetName, storageKey };
}

export async function syncDocsource() {
  if (!existsSync(DOCSOURCE)) {
    log.warn(`Docsource dir "${DOCSOURCE}" not found, skipping sync`);
    return { ingested: [], skipped: [] };
  }

  const index    = loadIndex();
  const files    = collectFiles(DOCSOURCE);
  const ingested = [];
  const skipped  = [];

  for (const { absPath, relPath } of files) {
    const mtime = statSync(absPath).mtimeMs;

    if (index[relPath]?.mtime === mtime) {
      log.info(`Skipping "${relPath}" — unchanged`);
      skipped.push(relPath);
      continue;
    }

    const { source, snippetName, storageKey } = parsePath(relPath);
    const text = readFileSync(absPath, 'utf8');
    await ingestText(source, text, { snippetName, storageKey });
    index[relPath] = { mtime, ingested_at: new Date().toISOString() };
    saveIndex(index);
    ingested.push(relPath);
  }

  // Remove vectors for files that no longer exist on disk
  const currentFiles = new Set(files.map(f => f.relPath));
  const removed = [];
  for (const relPath of Object.keys(index)) {
    if (!currentFiles.has(relPath)) {
      const { source, snippetName } = parsePath(relPath);
      if (snippetName) {
        await deleteBySourceAndSnippet(source, snippetName);
      } else {
        await deleteSource(source);
      }
      delete index[relPath];
      saveIndex(index);
      removed.push(relPath);
      log.info(`Uningested deleted file "${relPath}"`);
    }
  }

  log.info(`Sync complete — ingested: [${ingested.join(', ') || 'none'}]  skipped: [${skipped.join(', ') || 'none'}]  removed: [${removed.join(', ') || 'none'}]`);
  return { ingested, skipped, removed };
}
