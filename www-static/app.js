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

// ── Init ───────────────────────────────────────────────────────────────

document.getElementById('theme-btn').addEventListener('click', cycleTheme);

loadTheme();
