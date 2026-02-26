import config from './config.mjs';
import { logger } from './lib/log.mjs';

const log = logger('system');
let _pipeline = null;

async function getPipeline() {
  if (_pipeline) return _pipeline;
  log.info(`Loading embedding model: ${config.embeddings.model}`);
  const t0 = Date.now();
  const { pipeline } = await import('@xenova/transformers');
  _pipeline = await pipeline('feature-extraction', config.embeddings.model);
  log.info(`Embedding model ready in ${Date.now() - t0}ms`);
  return _pipeline;
}

// type: 'document' | 'query'
// BGE models use a query prefix; documents need no prefix
export async function embed(text, type = 'document') {
  const pipe = await getPipeline();
  const input = type === 'query'
    ? 'Represent this sentence for searching relevant passages: ' + text
    : text;
  const out = await pipe(input, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}
