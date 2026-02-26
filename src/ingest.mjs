import { randomUUID } from 'crypto';
import config from './config.mjs';
import * as storage from './storage.mjs';
import { chunk } from './chunker.mjs';
import { embed } from './embedder.mjs';
import { batchUpsert, deleteBySource, deleteBySourceAndSnippet } from './vectors.mjs';
import { logger } from './lib/log.mjs';

const log   = logger('ingest');
const stats = logger('stats');

function buildEmbedText(source, snippetName, chunkText) {
  const prettify = s => s.replace(/[-_]/g, ' ').replace(/\.[a-z]+$/i, '').trim();
  const label = [source, snippetName].filter(Boolean).map(prettify).join(', file: ');
  return label ? `${label}\n${chunkText}` : chunkText;
}

// snippetName: if set, bypasses %% parsing and tags all chunks with this snippet name
// storageKey:  if set, used instead of source for storage (needed when multiple files share a source)
export async function ingestText(source, text, { snippetName = null, storageKey = null } = {}) {
  const t0  = Date.now();
  const key = storageKey ?? source;
  const isUpdate = storage.exists(key);

  if (isUpdate) {
    log.info(`Re-ingesting source="${source}"${snippetName ? ` snippet="${snippetName}"` : ''} — removing old vectors and doc`);
    if (snippetName) {
      await deleteBySourceAndSnippet(source, snippetName);
    } else {
      await deleteBySource(source);
    }
  }
  log.info(`${isUpdate ? 'Update' : 'New'} ingest source="${source}"${snippetName ? ` snippet="${snippetName}"` : ''} chars=${text.length}`);

  storage.save(key, text);

  const chunks = chunk(text, snippetName ?? undefined);
  log.info(`Chunked into ${chunks.length} piece(s)`);

  const BATCH_SIZE = 50;
  const points = [];
  for (let i = 0; i < chunks.length; i++) {
    const { text: chunkText, snippet } = chunks[i];
    log.debug(`Embedding chunk ${i + 1}/${chunks.length} (${chunkText.length} chars)`);
    const embedText = buildEmbedText(source, snippet ?? null, chunkText);
    const vector = await embed(embedText, 'document');
    points.push({ id: randomUUID(), vector, payload: { source, chunk_index: i, text: embedText, snippet: snippet ?? null } });

    if (points.length === BATCH_SIZE || i === chunks.length - 1) {
      await batchUpsert(points);
      log.info(`Stored chunks up to ${i + 1}/${chunks.length} source="${source}"`);
      points.length = 0;
    }
  }

  const duration = Date.now() - t0;
  log.info(`Ingest complete source="${source}"${snippetName ? ` snippet="${snippetName}"` : ''} chunks=${chunks.length} duration_ms=${duration}`);
  stats.info(`ingest`, { source, chars: text.length, chunks: chunks.length, duration_ms: duration });
}

export async function deleteSource(source) {
  log.info(`Deleting source="${source}"`);
  await deleteBySource(source);
  if (storage.exists(source)) storage.remove(source);
  log.info(`Deleted source="${source}"`);
}
