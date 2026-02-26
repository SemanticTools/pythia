import { embed } from './embedder.mjs';
import { search } from './vectors.mjs';
import { logger } from './lib/log.mjs';

const log = logger('retrieval');

// history: [{role, content}, ...]
// For follow-up questions we expand the query with the last user turn
export async function retrieve(question, history = [], topK = 5) {
  const lastUser = [...history].reverse().find(m => m.role === 'user');
  const query = lastUser ? `${lastUser.content} ${question}` : question;

  log.info(`Query: "${question.slice(0, 120)}"${query !== question ? ` [expanded with: "${lastUser.content.slice(0, 60)}"]` : ''}`);

  const t0 = Date.now();
  const vector = await embed(query, 'query');
  const results = await search(vector, topK);
  const sources = [...new Set(results.map(r => r.source))];
  log.info(`Retrieved ${results.length} chunk(s) from [${sources.join(', ')}] in ${Date.now() - t0}ms`);
  return results;
}
