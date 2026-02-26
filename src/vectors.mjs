import { QdrantClient } from '@qdrant/js-client-rest';
import config from './config.mjs';
import { logger } from './lib/log.mjs';

const syslog = logger('system');
const log    = logger('retrieval');

const client = new QdrantClient({ url: config.vectors.url, headers: { 'Connection': 'close' } });
const COLLECTION = config.vectors.collection;
const DIMS = config.embeddings.dims;

export async function init() {
  const { collections } = await client.getCollections();
  const exists = collections.some(c => c.name === COLLECTION);
  if (exists) {
    syslog.info(`Qdrant collection "${COLLECTION}" already exists`);
  } else {
    await client.createCollection(COLLECTION, {
      vectors: { size: DIMS, distance: 'Cosine' }
    });
    syslog.info(`Created Qdrant collection "${COLLECTION}" dims=${DIMS}`);
  }
}

export async function deleteBySource(source) {
  const result = await client.delete(COLLECTION, {
    filter: { must: [{ key: 'source', match: { value: source } }] }
  });
  syslog.info(`Deleted vectors for source="${source}" status=${result.status}`);
}

export async function deleteBySourceAndSnippet(source, snippet) {
  const result = await client.delete(COLLECTION, {
    filter: { must: [
      { key: 'source',  match: { value: source  } },
      { key: 'snippet', match: { value: snippet } }
    ]}
  });
  syslog.info(`Deleted vectors for source="${source}" snippet="${snippet}" status=${result.status}`);
}

export async function upsert(id, vector, payload) {
  await client.upsert(COLLECTION, {
    points: [{ id, vector, payload }]
  });
}

export async function batchUpsert(points) {
  await client.upsert(COLLECTION, { points });
}

export async function search(vector, topK = 5) {
  const result = await client.search(COLLECTION, {
    vector,
    limit: topK,
    with_payload: true
  });
  log.debug(`Search returned ${result.length} results`, result.map(r => ({
    source: r.payload.source,
    chunk: r.payload.chunk_index,
    score: r.score.toFixed(4)
  })));
  return result.map(r => r.payload);
}
