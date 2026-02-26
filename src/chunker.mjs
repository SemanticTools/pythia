import config from './config.mjs';
import { parseSnippets } from './snippets.mjs';

const MAX = config.chunker.max_chars;

function chunkText(text) {
  const rawParagraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const paragraphs = rawParagraphs.flatMap(p =>
    p.length > MAX ? p.split(/\n/).map(l => l.trim()).filter(Boolean) : [p]
  );

  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current && (current.length + para.length + 2) > MAX) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + '\n' + para : para;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

export function chunk(text, snippetName = undefined) {
  if (snippetName !== undefined) {
    return chunkText(text).map(t => ({ text: t, snippet: snippetName }));
  }
  const snippetMarker = config.personal?.snippet_marker ?? '%%';
  const sections = parseSnippets(text, snippetMarker);
  const result = [];
  for (const section of sections) {
    for (const t of chunkText(section.text)) {
      result.push({ text: t, snippet: section.name });
    }
  }
  return result;
}
