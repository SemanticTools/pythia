// parseSnippets(text, marker = "%%")
// Returns: [{name: string|null, text: string}, ...]
// Rules:
//   - Text before first marker → name: null
//   - "%%end" or "%%/" → ends current snippet (no new snippet starts)
//   - Snippet name: extract alphanumeric chars only from marker line
//   - Next %% marker starts new snippet (closes previous)
//   - Empty sections are omitted

// serializeSnippets(sections)
// Reconstructs a file from [{name, text}] sections.
// "main" (name: null) goes first, unwrapped.
// Each named snippet: %%name\ncontent\n%%end
// Sections are joined with \n\n so there's always an empty line above snippet markers.
export function serializeSnippets(sections) {
  const parts = [];
  for (const section of sections) {
    if (section.name === null) {
      const t = section.text.trim();
      if (t) parts.push(t);
    } else {
      parts.push(`%%${section.name}\n${section.text.trim()}\n%%end`);
    }
  }
  return parts.join('\n\n');
}

export function parseSnippets(text, marker = '%%') {
  const lines = text.split('\n');
  const sections = [];
  let currentName = null;
  let currentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(marker)) {
      const after = trimmed.slice(marker.length).trim();
      const isEnd = after.toLowerCase() === 'end' || after === '/';

      // Close current section
      const sectionText = currentLines.join('\n').trim();
      if (sectionText) sections.push({ name: currentName, text: sectionText });
      currentLines = [];

      if (isEnd) {
        currentName = null;
      } else {
        currentName = after.replace(/[^a-zA-Z0-9]/g, '') || null;
      }
    } else {
      currentLines.push(line);
    }
  }

  // Final section
  const sectionText = currentLines.join('\n').trim();
  if (sectionText) sections.push({ name: currentName, text: sectionText });

  return sections;
}
