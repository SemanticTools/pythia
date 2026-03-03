// ── State ──────────────────────────────────────────────────────────────
let history           = [];
let currentTab        = 'discussion';
let _snippetMarker    = '%%';   // overwritten from server settings on load
let _currentDisc      = null;   // { id, title, pinned } or null
let _logos            = {};     // { dark, light, terminal }
const THEMES          = ['dark', 'light', 'terminal'];

// ── Theme ──────────────────────────────────────────────────────────────

async function loadTheme() {
  try {
    const res = await fetch('/settings');
    if (res.ok) {
      const data = await res.json();
      applyTheme(data.theme);
      if (data.snippetMarker) _snippetMarker = data.snippetMarker;
      if (data.smartButtons?.length) renderSmartButtons(data.smartButtons);
      if (data.logos) { _logos = data.logos; applyTheme(data.theme || 'dark'); }
    }
  } catch { /* ignore */ }
}

function renderSmartButtons(buttons) {
  const container = document.getElementById('smart-buttons');
  for (const { label, prefix } of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'smart-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      const ta = document.getElementById('question');
      ta.value = prefix;
      ta.focus();
      ta.setSelectionRange(prefix.length, prefix.length);
    });
    container.appendChild(btn);
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const logo = document.getElementById('logo');
  if (logo && _logos[theme]) logo.src = `/${_logos[theme]}`;
}

async function cycleTheme() {
  const current = document.documentElement.dataset.theme || 'dark';
  const next    = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  applyTheme(next);
  try {
    await fetch('/settings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ theme: next }),
    });
  } catch { /* ignore */ }
}

// ── Tabs ───────────────────────────────────────────────────────────────

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.hidden = panel.id !== `tab-${name}`;
    if (!panel.hidden) panel.style.display = '';
  });
  if (name === 'buckets') loadBuckets();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ── Chat ───────────────────────────────────────────────────────────────

function formatSource(s) {
  // "file.txt::snippetA" → "file.txt › snippetA"
  return s.replace('::', ' › ');
}

function appendMsg(role, content, sources = [], extraClass = '') {
  const chat = document.getElementById('chat');
  const msg  = document.createElement('div');
  msg.className = `msg msg-${role}${extraClass ? ' ' + extraClass : ''}`;

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = role === 'user' ? 'You' : 'Pythia';

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = content;

  msg.appendChild(label);
  msg.appendChild(body);

  if (sources.length) {
    const src = document.createElement('div');
    src.className = 'msg-sources';
    src.innerHTML = sources.map(s => `<span>${formatSource(s)}</span>`).join('');
    msg.appendChild(src);
  }

  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
  return msg;
}

// ── Ask ────────────────────────────────────────────────────────────────

document.getElementById('ask-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = document.getElementById('question').value.trim();
  if (!question) return;

  const btn      = document.getElementById('ask-btn');
  const errorBox = document.getElementById('ask-error');

  document.getElementById('question').value = '';
  errorBox.hidden = true;
  document.getElementById('memories-panel').removeAttribute('open');
  appendMsg('user', question);

  const thinking = appendMsg('ai', 'Thinking…', [], 'msg-thinking');
  btn.disabled    = true;
  btn.textContent = '…';

  try {
    const res  = await fetch('/ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question, history }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Unknown error');

    thinking.remove();
    const sources = data.sources ?? [];
    if (data.memoryWritten) sources.push('written to memory');
    appendMsg('ai', data.answer, sources);

    history.push({ role: 'user',      content: question    });
    history.push({ role: 'assistant', content: data.answer });
    saveDiscussion();
  } catch (err) {
    thinking.remove();
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Ask';
  }
});

document.getElementById('question').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.ctrlKey) {
    e.preventDefault();
    document.getElementById('ask-form').requestSubmit();
  }
});

document.getElementById('clear-btn').addEventListener('click', () => {
  history = [];
  _currentDisc = null;
  document.getElementById('chat').innerHTML = '';
  document.getElementById('ask-error').hidden = true;
});

// ── Quick Memories ─────────────────────────────────────────────────────

// ── Manage Quick Memories ──────────────────────────────────────────────

document.getElementById('snippets-refresh-quick').addEventListener('click',  () => loadSnippetGroup('quick',  'snippet-list-quick'));
document.getElementById('snippets-refresh-events').addEventListener('click', () => loadSnippetGroup('events', 'snippet-list-events'));

async function loadSnippetGroup(file, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '<div style="color:var(--muted);font-size:.78rem">Loading…</div>';
  try {
    const res      = await fetch(`/memory/snippets?file=${file}`);
    const sections = await res.json();
    container.innerHTML = '';
    for (const s of sections) container.appendChild(makeSnippetRow(s, file));
  } catch {
    container.innerHTML = '<div class="error">Failed to load.</div>';
  }
}

function makeSnippetRow(s, file) {
  const row = document.createElement('div');
  row.className = 'snippet-row';

  const name = document.createElement('span');
  name.className = 'snippet-row-name';
  name.textContent = s.name ?? 'main';

  const actions = document.createElement('div');
  actions.className = 'snippet-row-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'bucket-btn primary';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => openSnippetModal(s, file));

  const delBtn = document.createElement('button');
  delBtn.className = 'bucket-btn danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => deleteSnippet(s.name, file));

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  row.appendChild(name);
  row.appendChild(actions);
  return row;
}

async function deleteSnippet(name, file) {
  const label = name ?? 'main';
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
  try {
    const res = await fetch('/memory/snippet', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ file, name }),
    });
    if (!res.ok) throw new Error();
    await loadSnippetGroup(file, `snippet-list-${file}`);
  } catch {
    alert('Delete failed.');
  }
}

// ── Snippet edit modal ─────────────────────────────────────────────────

let _editingSnippet = null; // { file, name }

function openSnippetModal(snippet, file) {
  _editingSnippet = { file, name: snippet.name };
  document.getElementById('snippet-modal-name').textContent = snippet.name ?? 'main';
  document.getElementById('snippet-modal-text').value = snippet.text;
  document.getElementById('snippet-modal').hidden = false;
  document.getElementById('snippet-modal-text').focus();
}

function closeSnippetModal() {
  document.getElementById('snippet-modal').hidden = true;
  _editingSnippet = null;
}

document.getElementById('snippet-modal-cancel').addEventListener('click', closeSnippetModal);
document.getElementById('snippet-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('snippet-modal')) closeSnippetModal();
});

document.getElementById('snippet-modal-save').addEventListener('click', async () => {
  const text = document.getElementById('snippet-modal-text').value;
  const btn  = document.getElementById('snippet-modal-save');
  btn.disabled    = true;
  btn.textContent = 'Saving…';
  try {
    const res = await fetch('/memory/snippet/edit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ file: _editingSnippet.file, name: _editingSnippet.name ?? null, text }),
    });
    if (!res.ok) throw new Error('Failed');
    closeSnippetModal();
    await loadSnippetGroup(_editingSnippet.file, `snippet-list-${_editingSnippet.file}`);
  } catch {
    btn.textContent = 'Error';
    setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
    return;
  }
  btn.disabled    = false;
  btn.textContent = 'Save';
});

// ── Buckets ────────────────────────────────────────────────────────────

async function loadBuckets() {
  const container = document.getElementById('bucket-list');
  container.innerHTML = '<div style="color:var(--muted);font-size:.82rem">Loading…</div>';
  try {
    const res = await fetch('/buckets');
    const buckets = await res.json();
    renderBuckets(buckets);
  } catch {
    container.innerHTML = '<div class="error">Failed to load buckets.</div>';
  }
}

function renderBuckets(buckets) {
  const container = document.getElementById('bucket-list');
  if (!buckets.length) {
    container.innerHTML = '<div style="color:var(--muted);font-size:.82rem">No files yet.</div>';
    return;
  }
  container.innerHTML = '';
  for (const b of buckets) {
    container.appendChild(makeBucketRow(b));
  }
}

function makeBucketRow(b) {
  const row = document.createElement('div');
  row.className = `bucket-item${b.status === 'disabled' ? ' disabled' : ''}`;

  const nameEl = document.createElement('span');
  nameEl.className = 'bucket-name';
  nameEl.textContent = b.name;
  nameEl.title = 'Click to rename';
  nameEl.style.cursor = 'pointer';
  nameEl.addEventListener('click', () => startRename(nameEl, b.name));

  const statusEl = document.createElement('span');
  statusEl.className = `bucket-status ${b.status}`;
  statusEl.textContent = b.status;

  const actions = document.createElement('div');
  actions.className = 'bucket-actions';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'bucket-btn primary';
  toggleBtn.textContent = b.status === 'active' ? 'Disable' : 'Enable';
  toggleBtn.addEventListener('click', () => toggleBucket(b.name, b.status));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'bucket-btn danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => deleteBucket(b.name));

  actions.appendChild(toggleBtn);
  actions.appendChild(deleteBtn);

  row.appendChild(nameEl);
  row.appendChild(statusEl);
  row.appendChild(actions);
  return row;
}

function startRename(nameEl, oldName) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.className = 'bucket-name editing';

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    const newName = input.value.trim();
    if (!newName || newName === oldName) { input.replaceWith(nameEl); return; }
    input.disabled = true;
    try {
      const res = await fetch('/buckets/rename', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ from: oldName, to: newName }),
      });
      if (!res.ok) throw new Error('Rename failed');
      await loadBuckets();
    } catch {
      alert('Rename failed.');
      input.replaceWith(nameEl);
    }
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.replaceWith(nameEl); }
  });
}

async function toggleBucket(name, currentStatus) {
  const endpoint = currentStatus === 'active' ? '/buckets/disable' : '/buckets/enable';
  try {
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error();
    await loadBuckets();
  } catch {
    alert(`Failed to ${currentStatus === 'active' ? 'disable' : 'enable'} bucket.`);
  }
}

async function deleteBucket(name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    const res = await fetch('/buckets', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error();
    await loadBuckets();
  } catch {
    alert('Delete failed.');
  }
}

document.getElementById('upload-file-btn').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async () => {
  const file   = document.getElementById('file-input').files[0];
  const btn    = document.getElementById('upload-file-btn');
  const status = document.getElementById('upload-status');
  const err    = document.getElementById('upload-error');
  if (!file) return;

  btn.disabled    = true;
  status.textContent = `Uploading ${file.name}…`;
  status.hidden   = false;
  err.hidden      = true;

  try {
    const buf = await file.arrayBuffer();
    const res = await fetch(`/memfile/upload?name=${encodeURIComponent(file.name)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body:    buf,
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
    status.textContent = `${file.name} uploaded`;
    setTimeout(() => { status.hidden = true; }, 2500);
    await loadBuckets();
  } catch (error) {
    status.hidden   = true;
    err.textContent = error.message;
    err.hidden      = false;
  } finally {
    btn.disabled = false;
    document.getElementById('file-input').value = '';
  }
});

// ── Help overlay ───────────────────────────────────────────────────────

function toggleHelp() {
  const overlay = document.getElementById('help-overlay');
  overlay.hidden = !overlay.hidden;
}

document.getElementById('help-btn').addEventListener('click', toggleHelp);
document.getElementById('help-close-btn').addEventListener('click', toggleHelp);
document.getElementById('help-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('help-overlay')) toggleHelp();
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Link mode intercepts everything
  if (_linkMode) {
    handleLinkModeKey(e);
    return;
  }

  // ? → help (only when not in an input)
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
    const tag = document.activeElement?.tagName;
    if (tag !== 'TEXTAREA' && tag !== 'INPUT') {
      toggleHelp();
      return;
    }
  }

  if (!e.ctrlKey && !e.metaKey) return;

  switch (e.key) {
    case '1':
      e.preventDefault();
      showTab('discussion');
      break;
    case '2':
      e.preventDefault();
      showTab('buckets');
      break;
    case 'k':
    case 'K':
      e.preventDefault();
      history = [];
      document.getElementById('chat').innerHTML = '';
      document.getElementById('ask-error').hidden = true;
      break;
    case 'l':
    case 'L':
      e.preventDefault();
      toggleLinkMode();
      break;
    case 'm':
    case 'M': {
      e.preventDefault();
      const mem = document.getElementById('memories-panel');
      if (mem.open) {
        mem.removeAttribute('open');
      } else {
        mem.setAttribute('open', '');
      }
      break;
    }
    case 't':
    case 'T':
      e.preventDefault();
      cycleTheme();
      break;
  }
});

// ── Memories internal tabs ─────────────────────────────────────────────

function showMemTab(name) {
  document.querySelectorAll('.mem-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.memtab === name));
  document.querySelectorAll('.mem-tab-panel').forEach(p => {
    p.hidden = p.id !== `mem-tab-${name}`;
  });
  if (name === 'quick')  loadSnippetGroup('quick',  'snippet-list-quick');
  if (name === 'events') loadSnippetGroup('events', 'snippet-list-events');
}

document.getElementById('memories-panel').addEventListener('toggle', (e) => {
  if (!e.target.open) return;
  // Load whichever tab is currently active
  const active = document.querySelector('.mem-tab-btn.active')?.dataset.memtab;
  if (active === 'quick')  loadSnippetGroup('quick',  'snippet-list-quick');
  if (active === 'events') loadSnippetGroup('events', 'snippet-list-events');
});

document.querySelectorAll('.mem-tab-btn').forEach(btn =>
  btn.addEventListener('click', () => showMemTab(btn.dataset.memtab)));


// ── Discussions ────────────────────────────────────────────────────────

async function saveDiscussion() {
  if (!history.length) return;
  try {
    const title = _currentDisc?.title || history[0]?.content?.slice(0, 60) || 'Discussion';
    const res   = await fetch('/discussions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        id:       _currentDisc?.id ?? undefined,
        title,
        messages: history,
        pinned:   _currentDisc?.pinned ?? false,
      }),
    });
    if (!res.ok) return;
    const disc = await res.json();
    _currentDisc = { id: disc.id, title: disc.title, pinned: disc.pinned };
  } catch { /* silent */ }
}

function formatDiscDate(iso) {
  const d     = new Date(iso);
  const now   = new Date();
  const today = now.toDateString();
  const yest  = new Date(now - 86400000).toDateString();
  if (d.toDateString() === today) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === yest)  return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function openDiscussionsPanel() {
  loadDiscussionList();
  document.getElementById('disc-overlay').hidden = false;
}

function closeDiscussionsPanel() {
  document.getElementById('disc-overlay').hidden = true;
}

async function loadDiscussionList() {
  const list = document.getElementById('disc-list');
  list.innerHTML = '<div id="disc-list-empty">Loading…</div>';
  try {
    const res   = await fetch('/discussions');
    const discs = await res.json();
    list.innerHTML = '';
    if (!discs.length) {
      list.innerHTML = '<div id="disc-list-empty">No saved discussions yet.</div>';
      return;
    }
    for (const d of discs) list.appendChild(makeDiscRow(d));
  } catch {
    list.innerHTML = '<div id="disc-list-empty">Failed to load.</div>';
  }
}

function makeDiscRow(d) {
  const row = document.createElement('div');
  row.className = `disc-row${d.pinned ? ' pinned' : ''}`;

  const title = document.createElement('span');
  title.className = 'disc-title';
  title.textContent = d.title;
  title.title = d.title;

  const date = document.createElement('span');
  date.className = 'disc-date';
  date.textContent = formatDiscDate(d.updatedAt);

  const actions = document.createElement('div');
  actions.className = 'disc-actions';

  const pinBtn = document.createElement('button');
  pinBtn.className = 'bucket-btn primary';
  pinBtn.textContent = d.pinned ? 'Unpin' : 'Pin';
  pinBtn.addEventListener('click', async () => {
    await fetch('/discussions/pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: d.id, pinned: !d.pinned }),
    });
    if (_currentDisc?.id === d.id) _currentDisc.pinned = !d.pinned;
    loadDiscussionList();
  });

  const loadBtn = document.createElement('button');
  loadBtn.className = 'bucket-btn primary';
  loadBtn.textContent = 'Load';
  loadBtn.addEventListener('click', () => loadDiscussion(d));

  const delBtn = document.createElement('button');
  delBtn.className = 'bucket-btn danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Delete "${d.title}"?`)) return;
    await fetch('/discussions', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: d.id }),
    });
    if (_currentDisc?.id === d.id) _currentDisc = null;
    loadDiscussionList();
  });

  actions.appendChild(pinBtn);
  actions.appendChild(loadBtn);
  actions.appendChild(delBtn);

  row.appendChild(title);
  row.appendChild(date);
  row.appendChild(actions);
  return row;
}

async function loadDiscussion(d) {
  // Fetch full discussion (list response has all fields already)
  const res  = await fetch('/discussions');
  const all  = await res.json();
  const full = all.find(x => x.id === d.id) ?? d;

  history = full.messages ?? [];
  _currentDisc = { id: full.id, title: full.title, pinned: full.pinned };

  const chat = document.getElementById('chat');
  chat.innerHTML = '';
  document.getElementById('ask-error').hidden = true;
  for (const msg of history) {
    appendMsg(msg.role === 'user' ? 'user' : 'ai', msg.content, []);
  }
  closeDiscussionsPanel();
}

document.getElementById('disc-btn').addEventListener('click', openDiscussionsPanel);
document.getElementById('disc-close-btn').addEventListener('click', closeDiscussionsPanel);
document.getElementById('disc-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('disc-overlay')) closeDiscussionsPanel();
});
document.getElementById('disc-new-btn').addEventListener('click', () => {
  history = [];
  _currentDisc = null;
  document.getElementById('chat').innerHTML = '';
  document.getElementById('ask-error').hidden = true;
  closeDiscussionsPanel();
});

// ── Link Mode ──────────────────────────────────────────────────────────

let _linkMode      = false;
let _links         = [];
let _filtered      = [];
let _linkSel       = 0;
let _linkForm      = null;   // null | 'add' | 'edit' | 'delete' | 'tag' | 'cmdlist'
let _linkFormLink  = null;
let _cmdTarget     = null;   // link captured when '.' is pressed, used by commands
let _openedTabs    = [];     // window refs from opened links, for .k close command
let _tagDraft      = [];
let _tagDropSel    = -1;

// ── Helpers ──

function isUrl(str) {
  return /^https?:\/\/\S+$/.test(str);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseTags(str) {
  return str.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
}

function allTags() {
  const set = new Set();
  for (const l of _links) (l.tags || []).forEach(t => set.add(t));
  return [...set].sort();
}

function tagSuggestions(partial) {
  const q = partial.toLowerCase();
  return allTags().filter(t => t.startsWith(q) && !_tagDraft.includes(t)).slice(0, 6);
}

// ── Scoring / filtering ──

function scoreLink(link, q) {
  let score = 0;
  const title = (link.title || link.url).toLowerCase();
  const urlL  = link.url.toLowerCase();
  const note  = (link.note || '').toLowerCase();
  const tags  = link.tags || [];
  if (tags.some(t => t === q))           score += 50;
  if (tags.some(t => t.startsWith(q)))   score += 40;
  if (tags.some(t => t.includes(q)))     score += 30;
  if (title.startsWith(q))               score += 25;
  if (title.includes(q))                 score += 15;
  if (urlL.includes(q))                  score += 15;
  if (note.includes(q))                  score +=  5;
  if (score > 0) score += Math.min(link.visits || 0, 10);  // visits only as tiebreaker
  return score;
}

function filterLinks(query) {
  const q = (query || '').trim();
  if (q.startsWith('#')) {
    const tagQ = q.slice(1).toLowerCase();
    _filtered = _links.filter(l => {
      if (!tagQ) return (l.tags || []).length > 0;
      return (l.tags || []).some(t => t.startsWith(tagQ) || t.includes(tagQ));
    });
  } else if (!q) {
    _filtered = [..._links].sort((a, b) => (b.visits || 0) - (a.visits || 0));
  } else {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    _filtered = _links
      .map(l => {
        const scores = words.map(w => scoreLink(l, w));
        if (scores.some(s => s === 0)) return null;
        return { l, s: scores.reduce((a, b) => a + b, 0) };
      })
      .filter(Boolean)
      .sort((a, b) => b.s - a.s)
      .map(x => x.l);
  }
  _linkSel = 0;
  renderLinkList();
}

// ── Render ──

function renderLinkList() {
  const ul = document.getElementById('link-list');
  ul.innerHTML = '';
  for (let i = 0; i < _filtered.length; i++) {
    const l  = _filtered[i];
    const li = document.createElement('li');
    li.className = 'link-row' + (i === _linkSel ? ' selected' : '');

    const title = document.createElement('span');
    title.className = 'link-title';
    title.textContent = l.title || l.url;

    const urlEl = document.createElement('span');
    urlEl.className = 'link-url';
    try { urlEl.textContent = new URL(l.url).hostname; } catch { urlEl.textContent = l.url; }

    li.appendChild(title);
    li.appendChild(urlEl);

    if ((l.tags || []).length) {
      const wrap = document.createElement('span');
      wrap.className = 'link-tags';
      for (const t of l.tags) {
        const chip = document.createElement('span');
        chip.className = 'link-tag';
        chip.textContent = t;
        wrap.appendChild(chip);
      }
      li.appendChild(wrap);
    }

    li.addEventListener('click', () => { _linkSel = i; openSelectedLink(); });
    ul.appendChild(li);
  }

  const sel = ul.querySelector('.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });

  const count = document.getElementById('link-count');
  if (count) count.textContent = _filtered.length
    ? `${_filtered.length} link${_filtered.length === 1 ? '' : 's'}`
    : 'no links';
}

function selectLink(delta) {
  _linkSel = Math.max(0, Math.min(_filtered.length - 1, _linkSel + delta));
  renderLinkList();
}

// ── Open / close ──

async function openLinkMode() {
  if (_linkMode) return;
  _linkMode = true;
  if (!_links.length) {
    try {
      const res = await fetch('/links');
      const data = await res.json();
      _links = data.links || [];
    } catch { _links = []; }
  }
  document.getElementById('link-mode-overlay').hidden = false;
  clearLinkStatus();
  document.getElementById('link-search').value = '';
  filterLinks('');
  document.getElementById('link-search').focus();
}

function closeLinkMode() {
  if (!_linkMode) return;
  _linkMode = false;
  _linkForm = null;
  _linkFormLink = null;
  document.getElementById('link-mode-overlay').hidden = true;
}

function toggleLinkMode() {
  if (_linkMode) closeLinkMode(); else openLinkMode();
}

async function openSelectedLink() {
  const link = _filtered[_linkSel];
  if (!link) return;
  fetch(`/links/${link.id}/visit`, { method: 'POST' }).catch(() => {});
  link.visits = (link.visits || 0) + 1;
  const tab = window.open(link.url, '_blank');
  if (tab) _openedTabs.push(tab);
  closeLinkMode();
}

// ── Status area ──

function clearLinkStatus() {
  const el = document.getElementById('link-status');
  el.innerHTML = '';
  el.hidden = true;
  _linkForm = null;
  _linkFormLink = null;
}

function showLinkStatus(html) {
  const el = document.getElementById('link-status');
  el.innerHTML = html;
  el.hidden = false;
}

// ── Add form ──

async function showAddForm(prefillUrl = '') {
  _linkForm = 'add';
  showLinkStatus(`
    <div class="lf-row">
      <input id="lf-url"   class="lf-input" type="text" placeholder="URL"   value="${escHtml(prefillUrl)}" autocomplete="off">
      <input id="lf-title" class="lf-input" type="text" placeholder="Title (auto-fetched)" autocomplete="off">
    </div>
    <div class="lf-row">
      <input id="lf-tags" class="lf-input" type="text" placeholder="Tags (space or comma)" autocomplete="off">
      <span class="lf-hint">Enter to save  Esc to cancel</span>
    </div>`);

  const urlEl   = document.getElementById('lf-url');
  const titleEl = document.getElementById('lf-title');
  const tagsEl  = document.getElementById('lf-tags');

  [urlEl, titleEl, tagsEl].forEach(inp => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); submitAddForm(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clearLinkStatus(); document.getElementById('link-search').focus(); }
  }));

  if (prefillUrl) {
    titleEl.placeholder = 'Fetching title…';
    titleEl.focus();
    try {
      const r = await fetch(`/links/fetch-title?url=${encodeURIComponent(prefillUrl)}`);
      const d = await r.json();
      titleEl.value = d.title || '';
    } catch { /* ignore */ }
    titleEl.placeholder = 'Title';
    titleEl.focus();
    titleEl.select();
  } else {
    urlEl.focus();
    urlEl.addEventListener('blur', async () => {
      const u = urlEl.value.trim();
      if (!u || titleEl.value.trim() || !isUrl(u)) return;
      titleEl.placeholder = 'Fetching title…';
      try {
        const r = await fetch(`/links/fetch-title?url=${encodeURIComponent(u)}`);
        const d = await r.json();
        titleEl.value = d.title || '';
      } catch { /* ignore */ }
      titleEl.placeholder = 'Title';
    });
  }
}

async function submitAddForm() {
  const url   = document.getElementById('lf-url')?.value.trim();
  const title = document.getElementById('lf-title')?.value.trim() || '';
  const tags  = parseTags(document.getElementById('lf-tags')?.value || '');
  if (!url) return;
  try {
    const res  = await fetch('/links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, tags }),
    });
    const data = await res.json();
    if (data.link && !_links.some(l => l.id === data.link.id)) _links.unshift(data.link);
    clearLinkStatus();
    filterLinks(document.getElementById('link-search').value);
    document.getElementById('link-search').focus();
  } catch { /* ignore */ }
}

// ── Edit form ──

function showEditForm(link) {
  if (!link) return;
  _linkForm = 'edit';
  _linkFormLink = link;
  showLinkStatus(`
    <div class="lf-row">
      <input id="lf-title" class="lf-input" type="text" placeholder="Title" value="${escHtml(link.title || '')}" autocomplete="off">
      <input id="lf-url"   class="lf-input" type="text" placeholder="URL"   value="${escHtml(link.url)}"   autocomplete="off">
    </div>
    <div class="lf-row">
      <input id="lf-tags" class="lf-input" type="text" placeholder="Tags" value="${escHtml((link.tags || []).join(', '))}" autocomplete="off">
      <input id="lf-note" class="lf-input" type="text" placeholder="Note" value="${escHtml(link.note || '')}" autocomplete="off">
      <span class="lf-hint">Enter to save  Esc to cancel</span>
    </div>`);

  ['lf-title', 'lf-url', 'lf-tags', 'lf-note'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); submitEditForm(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clearLinkStatus(); document.getElementById('link-search').focus(); }
    });
  });
  document.getElementById('lf-title').focus();
  document.getElementById('lf-title').select();
}

async function submitEditForm() {
  const link  = _linkFormLink;
  if (!link) return;
  const title = document.getElementById('lf-title')?.value.trim() || '';
  const url   = document.getElementById('lf-url')?.value.trim() || link.url;
  const tags  = parseTags(document.getElementById('lf-tags')?.value || '');
  const note  = document.getElementById('lf-note')?.value.trim() || '';
  try {
    const res  = await fetch(`/links/${link.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, url, tags, note }),
    });
    const data = await res.json();
    const idx  = _links.findIndex(l => l.id === link.id);
    if (idx >= 0 && data.link) _links[idx] = data.link;
    clearLinkStatus();
    filterLinks(document.getElementById('link-search').value);
    document.getElementById('link-search').focus();
  } catch { /* ignore */ }
}

// ── Delete confirm ──

function confirmDelete(link) {
  link = link || _filtered[_linkSel];
  if (!link) return;
  _linkForm = 'delete';
  _linkFormLink = link;
  const label = (link.title || link.url).slice(0, 60);
  showLinkStatus(`<div class="lf-row"><span class="lf-confirm">Delete "${escHtml(label)}"?</span><span class="lf-hint">[y] yes  [n] no</span></div>`);
}

async function executeDelete() {
  const link = _linkFormLink;
  if (!link) return;
  try {
    await fetch(`/links/${link.id}`, { method: 'DELETE' });
    _links = _links.filter(l => l.id !== link.id);
    clearLinkStatus();
    filterLinks(document.getElementById('link-search').value);
    document.getElementById('link-search').focus();
  } catch { clearLinkStatus(); }
}

// ── Tag editor ──

function openTagEditor(link) {
  if (!link) return;
  _linkForm = 'tag';
  _linkFormLink = link;
  _tagDraft = [...(link.tags || [])];
  _tagDropSel = -1;
  renderTagEditor();
}

function renderTagEditor() {
  const chips = _tagDraft.map(t =>
    `<span class="tag-chip">${escHtml(t)}<button class="tag-chip-x" data-tag="${escHtml(t)}" tabindex="-1">×</button></span>`
  ).join('');
  showLinkStatus(`
    <div class="tag-editor">
      <div class="tag-chip-area">${chips}</div>
      <div class="tag-input-wrap">
        <input id="tag-inp" class="lf-input" type="text" placeholder="add tag…" autocomplete="off">
        <ul id="tag-autocomplete" hidden></ul>
      </div>
      <span class="lf-hint">Space/comma/Enter to add  Backspace to remove last  Esc to save &amp; close</span>
    </div>`);

  document.querySelectorAll('.tag-chip-x').forEach(btn =>
    btn.addEventListener('click', () => removeTagChip(btn.dataset.tag))
  );

  const inp = document.getElementById('tag-inp');
  inp.addEventListener('input',   () => renderTagSuggestions(inp.value));
  inp.addEventListener('keydown', tagEditorKeydown);
  inp.focus();
}

function tagEditorKeydown(e) {
  const inp  = document.getElementById('tag-inp');
  const drop = document.getElementById('tag-autocomplete');
  const dropOpen = drop && !drop.hidden;

  if (e.key === ' ' || e.key === ',') {
    e.preventDefault(); e.stopPropagation();
    const v = inp.value.trim();
    if (v) commitTag(v);
    return;
  }
  if (e.key === 'Backspace' && !inp.value) {
    e.preventDefault(); e.stopPropagation();
    if (_tagDraft.length) removeTagChip(_tagDraft[_tagDraft.length - 1]);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    if (dropOpen && _tagDropSel >= 0) {
      const items = drop.querySelectorAll('li');
      if (items[_tagDropSel]) { commitTag(items[_tagDropSel].textContent); return; }
    }
    const v = inp.value.trim();
    if (v) { commitTag(v); return; }
    closeTagEditor(true);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault(); e.stopPropagation();
    if (dropOpen) {
      _tagDropSel = Math.min(_tagDropSel + 1, drop.querySelectorAll('li').length - 1);
      renderTagDropHighlight();
    }
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    if (dropOpen) { _tagDropSel = Math.max(_tagDropSel - 1, -1); renderTagDropHighlight(); }
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault(); e.stopPropagation();
    if (dropOpen) {
      _tagDropSel = Math.min(_tagDropSel + 1, drop.querySelectorAll('li').length - 1);
      renderTagDropHighlight();
    }
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    if (dropOpen) { drop.hidden = true; _tagDropSel = -1; return; }
    closeTagEditor(true);
    return;
  }
}

function renderTagDropHighlight() {
  document.getElementById('tag-autocomplete')
    ?.querySelectorAll('li')
    .forEach((li, i) => li.classList.toggle('selected', i === _tagDropSel));
}

function renderTagSuggestions(partial) {
  const drop = document.getElementById('tag-autocomplete');
  if (!drop) return;
  const sugs = partial.trim() ? tagSuggestions(partial.trim()) : [];
  if (!sugs.length) { drop.hidden = true; drop.innerHTML = ''; _tagDropSel = -1; return; }
  drop.innerHTML = '';
  _tagDropSel = -1;
  for (const s of sugs) {
    const li = document.createElement('li');
    li.textContent = s;
    li.addEventListener('mousedown', (e) => { e.preventDefault(); commitTag(s); });
    drop.appendChild(li);
  }
  drop.hidden = false;
}

function commitTag(tag) {
  const t = tag.trim().toLowerCase();
  if (!t || _tagDraft.includes(t)) return;
  _tagDraft.push(t);
  renderTagEditor();
}

function removeTagChip(tag) {
  _tagDraft = _tagDraft.filter(t => t !== tag);
  renderTagEditor();
}

async function closeTagEditor(save) {
  const link = _linkFormLink;
  clearLinkStatus();
  if (save && link) {
    try {
      const res  = await fetch(`/links/${link.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: _tagDraft }),
      });
      const data = await res.json();
      const idx  = _links.findIndex(l => l.id === link.id);
      if (idx >= 0 && data.link) _links[idx] = data.link;
    } catch { /* ignore */ }
  }
  filterLinks(document.getElementById('link-search').value || '');
  document.getElementById('link-search').focus();
}

// ── Link mode keydown handler ──

function handleLinkModeKey(e) {
  const search   = document.getElementById('link-search');
  const statusEl = document.getElementById('link-status');
  const inStatus = statusEl && !statusEl.hidden && statusEl.contains(document.activeElement);
  const inSearch = document.activeElement === search;

  if (e.key === 'Escape') {
    e.preventDefault();
    if (_linkForm) { clearLinkStatus(); search.value = ''; filterLinks(''); _cmdTarget = null; search.focus(); }
    else closeLinkMode();
    return;
  }

  if (_linkForm === 'delete') {
    if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') { e.preventDefault(); executeDelete(); return; }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); clearLinkStatus(); search.focus(); return; }
    return;
  }

  // Form inputs handle their own keys via stopPropagation
  if (inStatus) return;

  // Navigation — handled here for all focus positions; form inputs use stopPropagation for their own Enter/Esc
  if (e.key === 'ArrowDown') { e.preventDefault(); selectLink(1);  return; }
  if (e.key === 'ArrowUp')   { e.preventDefault(); selectLink(-1); return; }
  if (e.key === 'Enter')     { e.preventDefault(); openSelectedLink(); return; }
}

// ── Command dispatch (.prefix) ──

const CMD_LIST_HTML = `
  <div class="cmd-list">
    <span class="cmd-item"><kbd>.a</kbd> add</span>
    <span class="cmd-item"><kbd>.e</kbd> edit</span>
    <span class="cmd-item"><kbd>.t</kbd> tag</span>
    <span class="cmd-item"><kbd>.d</kbd> delete</span>
    <span class="cmd-item"><kbd>.c</kbd> copy url</span>
    <span class="cmd-item"><kbd>.k</kbd> kill tabs</span>
  </div>`;

function handleCmdInput(val) {
  if (_linkForm && _linkForm !== 'cmdlist') return;
  const search = document.getElementById('link-search');

  const run = (fn) => {
    search.value = '';
    search.classList.remove('cmd-mode');
    clearLinkStatus();
    fn();
    _cmdTarget = null;
  };

  switch (val) {
    case '.a':
      run(() => navigator.clipboard.readText()
        .then(t => showAddForm(isUrl(t.trim()) ? t.trim() : ''))
        .catch(() => showAddForm('')));
      break;
    case '.e':
      run(() => showEditForm(_cmdTarget));
      break;
    case '.t':
      run(() => openTagEditor(_cmdTarget));
      break;
    case '.d':
      run(() => confirmDelete(_cmdTarget));
      break;
    case '.c':
      run(() => {
        if (_cmdTarget) navigator.clipboard.writeText(_cmdTarget.url).catch(() => {});
      });
      break;
    case '.k':
      run(() => {
        _openedTabs.forEach(w => { try { if (!w.closed) w.close(); } catch { } });
        _openedTabs = [];
      });
      break;
    default:
      // Partial command or just '.' — show list
      _linkForm = 'cmdlist';
      showLinkStatus(CMD_LIST_HTML);
      break;
  }
}

// ── Link search input ──

document.getElementById('link-search').addEventListener('input', (e) => {
  const val = e.target.value;
  if (val.startsWith('.')) {
    e.target.classList.add('cmd-mode');
    e.target.classList.remove('tag-mode');
    handleCmdInput(val);
  } else {
    e.target.classList.remove('cmd-mode');
    if (_linkForm === 'cmdlist') clearLinkStatus();
    filterLinks(val);
    e.target.classList.toggle('tag-mode', val.startsWith('#'));
  }
});

document.getElementById('link-search').addEventListener('keydown', (e) => {
  if (!_linkMode) return;

  // Intercept '.' to enter command mode, capturing the currently selected link
  if (e.key === '.' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _cmdTarget = _filtered[_linkSel] || null;
    const s = e.target;
    s.value = '.';
    s.classList.add('cmd-mode');
    s.classList.remove('tag-mode');
    _linkForm = 'cmdlist';
    showLinkStatus(CMD_LIST_HTML);
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    setTimeout(() => {
      const val = document.getElementById('link-search').value.trim();
      if (isUrl(val)) {
        document.getElementById('link-search').value = '';
        filterLinks('');
        showAddForm(val);
      }
    }, 0);
  }
});

// ── Ask-textarea silent auto-save ──

document.getElementById('question').addEventListener('paste', (e) => {
  const pasted = (e.clipboardData || window.clipboardData).getData('text').trim();
  if (!isUrl(pasted)) return;
  e.preventDefault();
  document.getElementById('question').value = '';
  openLinkMode();
  if (_links.some(l => l.url === pasted)) return;
  const savedMsg = appendMsg('ai', 'Link saved.');
  fetch('/links', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: pasted }),
  }).then(r => r.json()).then(data => {
    if (!data.link) return;
    if (!_links.some(l => l.id === data.link.id)) {
      _links.unshift(data.link);
      if (_linkMode) filterLinks(document.getElementById('link-search').value);
    }
    // Backfill title and update the message
    fetch(`/links/fetch-title?url=${encodeURIComponent(pasted)}`)
      .then(r => r.json())
      .then(d => {
        if (d.title) {
          savedMsg.querySelector('.msg-body').textContent = `Link saved: ${d.title}`;
        }
        if (!d.title) return;
        fetch(`/links/${data.link.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: d.title }),
        }).then(r2 => r2.json()).then(d2 => {
          if (!d2.link) return;
          const idx = _links.findIndex(l => l.id === d2.link.id);
          if (idx >= 0) _links[idx] = d2.link;
        }).catch(() => {});
      }).catch(() => {});
  }).catch(() => {});
});

// ── Init ───────────────────────────────────────────────────────────────

document.getElementById('theme-btn').addEventListener('click', cycleTheme);

document.getElementById('link-mode-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('link-mode-overlay')) closeLinkMode();
});

loadTheme();
