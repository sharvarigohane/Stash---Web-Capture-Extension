// Stash popup. All data lives in chrome.storage.local under three keys:
//   tasks : { id, text, status('todo'|'done'), due('YYYY-MM-DD'), created }
//   notes : { id, title, bodyHtml, tags[], source, updated }
//   inbox : { id, type('page'|'snippet'), title, body, url, created }

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dateKey(new Date());
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = k => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtDateTime = v => new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });


// Turns note HTML into plain text (used for search and snippets).
function htmlToText(html) {
  const spaced = (html || '').replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, ' $&');
  const doc = new DOMParser().parseFromString(spaced, 'text/html');
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
}

// Keeps note HTML safe: only basic formatting and http(s) links survive.
function sanitize(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,img,form,input').forEach(e => e.remove());
  doc.body.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      const keep = el.tagName === 'A' && a.name === 'href' && /^https?:/i.test(a.value);
      if (!keep) el.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ================= state + storage ================= */
let tasks = [], notes = [], inbox = [];
let taskFilter = 'all', inboxFilter = 'all', selectedTag = '';
let editingId = null, editingSource = '', editorOpen = false;

const saveTasks = () => chrome.storage.local.set({ tasks });
const saveNotes = () => chrome.storage.local.set({ notes });
const saveInbox = () => chrome.storage.local.set({ inbox });

// Older versions stored slightly different shapes; normalise them on load.
const migrateTask = t => ({
  id: t.id, text: t.text || '', created: t.created || Date.now(),
  status: t.done || t.status === 'done' ? 'done' : (t.status || 'todo'),
  due: t.due ? String(t.due).slice(0, 10) : ''
});
const migrateNote = n => ({
  id: n.id, title: n.title || '', updated: n.updated || Date.now(), source: n.source || '',
  sourceTitle: n.sourceTitle || '', captureType: n.captureType || '',
  bodyHtml: n.bodyHtml || '<p>' + esc(n.body || '') + '</p>',
  tags: (n.tags || []).map(x => String(x).replace(/^#/, ''))
});
const migrateInbox = x => ({ ...x, type: x.type === 'page' || x.type === 'web' ? 'page' : 'snippet' });

/* ================= navigation ================= */
function switchTab(name) {
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === name));
}
document.querySelectorAll('.nav').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

function renderCounts() {
  $('taskCount').textContent = tasks.filter(t => t.status !== 'done').length;
  $('noteCount').textContent = notes.length;
  $('inboxCount').textContent = inbox.length;
}

/* ================= tasks ================= */
function addTask() {
  const text = $('taskInput').value.trim();
  if (!text) return;
  tasks.unshift({ id: uid(), text, status: 'todo', due: $('taskDue').value, created: Date.now() });
  $('taskInput').value = '';
  $('taskDue').value = '';
  document.querySelector('.due-control').classList.remove('open');
  $('dueToggle').setAttribute('aria-expanded', 'false');
  saveTasks();
  renderTasks();
}

// Single place where a task changes status (the checkbox uses it).
function setStatus(task, status) {
  task.status = status;
  saveTasks();
  renderTasks();
}

function sortedTasks(list) {
  const rank = t => (t.status === 'done' ? 2 : t.due ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || (a.due || '').localeCompare(b.due || ''));
}

function taskRow(t) {
  const done = t.status === 'done';
  const today = todayKey();
  const chips = [];
  if (t.due) {
    const cls = !done && t.due < today ? 'overdue' : t.due === today ? 'today' : '';
    chips.push(`<span class="chip ${cls}">${t.due === today ? 'Today' : fmtDate(t.due)}</span>`);
  }

  const li = document.createElement('li');
  li.className = 'task' + (done ? ' done' : '');
  li.innerHTML = `<button class="check" aria-label="Toggle complete">${done ? '✓' : ''}</button>
    <div class="task-main"><span class="task-text"></span><div class="chips">${chips.join('')}</div></div>
    <button class="icon edit" aria-label="Edit task">Edit</button>
    <button class="icon del" aria-label="Delete task">×</button>`;
  li.querySelector('.task-text').textContent = t.text;
  li.querySelector('.check').onclick = () => setStatus(t, done ? 'todo' : 'done');
  li.querySelector('.edit').onclick = () => editTask(t);
  li.querySelector('.del').onclick = () => { tasks = tasks.filter(x => x.id !== t.id); saveTasks(); renderTasks(); };
  return li;
}

function renderTasks() {
  const visible = tasks.filter(t => taskFilter === 'all' || (taskFilter === 'done' ? t.status === 'done' : t.status !== 'done'));
  const list = $('taskList');
  list.innerHTML = '';
  sortedTasks(visible).forEach(t => list.appendChild(taskRow(t)));
  $('taskEmpty').classList.toggle('hidden', visible.length > 0);
  $('taskEmpty').innerHTML = taskFilter === 'done'
    ? '<div class="empty-mark">✓</div><strong>Nothing completed yet</strong><span>Finish a task and it will settle here.</span>'
    : '<div class="empty-mark">→</div><strong>Your task list is ready.</strong><span>Add your next step above, or capture a selection from any page.</span><div class="empty-points"><span>Quick to add</span><span>Easy to finish</span><span>Always actionable</span></div>';
  renderCounts();
}

function editTask(t) {
  openModal(`<h2>Edit task</h2>
    <label>Task<input id="mText" type="text" maxlength="200" value="${esc(t.text)}"></label>
    <label>Due date<input id="mDue" type="date" value="${t.due}"></label>
    <button id="mSave" class="primary wide">Save task</button>`);
  $('mSave').onclick = () => {
    t.text = $('mText').value.trim() || t.text;
    t.due = $('mDue').value;
    saveTasks();
    closeModal();
    renderTasks();
  };
}

function closeDueControl() {
  const wrap = document.querySelector('.due-control');
  if (!wrap) return;
  wrap.classList.remove('open');
  $('dueToggle').setAttribute('aria-expanded', 'false');
}

$('addTask').onclick = addTask;
$('dueToggle').onclick = () => {
  const wrap = document.querySelector('.due-control');
  const open = wrap.classList.toggle('open');
  $('dueToggle').setAttribute('aria-expanded', String(open));
  if (open) $('taskDue').focus();
};
$('taskDue').onchange = () => {
  document.querySelector('.due-control').classList.add('open');
};
$('taskDue').addEventListener('blur', () => setTimeout(closeDueControl, 0));
document.addEventListener('pointerdown', e => {
  const wrap = document.querySelector('.due-control');
  if (wrap?.classList.contains('open') && !wrap.contains(e.target)) closeDueControl();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDueControl();
});
$('taskInput').onkeydown = e => { if (e.key === 'Enter') addTask(); };
$('clearDone').onclick = () => { tasks = tasks.filter(t => t.status !== 'done'); saveTasks(); renderTasks(); };
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
  taskFilter = b.dataset.filter;
  renderTasks();
});

/* ================= notes ================= */
const noteText = n => htmlToText(n.bodyHtml);
function renderTagBar() {
  const counts = {};
  notes.forEach(n => n.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  $('tagBar').innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([t, c]) => `<button class="tag ${selectedTag === t ? 'active' : ''}" data-tag="${esc(t)}">#${esc(t)} ${c}</button>`).join('');
  document.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => {
    selectedTag = selectedTag === b.dataset.tag ? '' : b.dataset.tag;
    renderNotes();
  });
}

function renderNotes() {
  renderTagBar();
  const visible = notes.filter(n => !selectedTag || n.tags.includes(selectedTag));
  const grid = $('noteGrid');
  grid.innerHTML = '';
  visible.forEach(n => {
    const card = document.createElement('article');
    card.className = 'note-card';
    card.innerHTML = `<div class="note-card-kicker">NOTE</div>
      <div class="note-card-head"><h3>${esc(n.title || 'Untitled')}</h3><button class="icon del" aria-label="Delete note">×</button></div>
      <p>${esc(noteText(n).slice(0, 180))}</p>
      <div class="note-meta"><span>${fmtDate(dateKey(new Date(n.updated)))}</span>
        ${n.source ? `<span class="note-source">↗ ${esc(host(n.source))}</span>` : ''}
        ${n.tags.slice(0, 3).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>`;
    card.onclick = () => openEditor(n);
    card.querySelector('.del').onclick = e => {
      e.stopPropagation();
      notes = notes.filter(x => x.id !== n.id);
      saveNotes();
      renderNotes();
    };
    grid.appendChild(card);
  });
  $('noteEmpty').classList.toggle('hidden', visible.length > 0);
  $('noteEmpty').innerHTML = selectedTag
    ? '<div class="empty-mark">#</div><strong>No notes with this tag</strong><span>Pick another tag to keep browsing.</span>'
    : '<div class="empty-mark">✦</div><strong>Nothing stashed yet.</strong><span>Save a thought here, or capture only the useful part of a web page.</span><div class="empty-points"><span>Capture a passage</span><span>Keep the source</span><span>Turn it into a task</span></div>';
  renderCounts();
}

function showEditor(open) {
  editorOpen = open;
  $('noteEditor').classList.toggle('hidden', !open);
  $('notesList').classList.toggle('hidden', open);
}

function openEditor(note) {
  editingId = note ? note.id : null;
  editingSource = note ? note.source : '';
  $('noteTitle').value = note ? note.title : '';
  $('noteBody').innerHTML = note ? note.bodyHtml : '';
  $('noteTags').value = note ? note.tags.map(t => '#' + t).join(', ') : '';
  $('sourceWrap').classList.toggle('hidden', !editingSource);
  $('sourceWrap').innerHTML = editingSource
    ? `<a href="${esc(editingSource)}" target="_blank" rel="noopener noreferrer">Saved from ${esc(host(editingSource))}</a>` : '';
  showEditor(true);
  switchTab('notes');
  $('noteTitle').focus();
}

function closeEditor() {
  editingId = null;
  editingSource = '';
  showEditor(false);
  renderNotes();
}

// Saves the draft. Returns the note, or null if there was nothing to save.
function saveNote() {
  const bodyHtml = sanitize($('noteBody').innerHTML);
  const text = htmlToText(bodyHtml);
  let title = $('noteTitle').value.trim();
  if (!title && !text) return null;
  if (!title) title = text.slice(0, 40);
  const tags = $('noteTags').value.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean);

  let note = editingId && notes.find(n => n.id === editingId);
  if (note) Object.assign(note, { title, bodyHtml, tags, updated: Date.now() });
  else {
    note = { id: uid(), title, bodyHtml, tags, source: editingSource, updated: Date.now() };
    notes.unshift(note);
    editingId = note.id;
  }
  saveNotes();
  return note;
}

// ---- editor events ----
$('noteTags').onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); };
$('noteEditor').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('saveNote').click(); });

// Keep the editor intentionally simple: the title is styled as the note heading,
// while the body stays normal text with one lightweight bullet-list option.
$('toolbar').addEventListener('mousedown', e => {
  const b = e.target.closest('button[data-cmd]');
  if (!b) return;
  e.preventDefault();
  document.execCommand(b.dataset.cmd, false, null);
  $('noteBody').focus();
});

$('newNote').onclick = () => openEditor(null);
$('cancelNote').onclick = closeEditor;
$('saveNote').onclick = () => {
  const note = saveNote();
  closeEditor();
  if (note) toast('Note saved');
};

/* ================= inbox (web capture lands here) ================= */
function addInbox(item) {
  inbox.unshift({ id: uid(), created: Date.now(), body: '', url: '', ...item });
  saveInbox();
  renderInbox();
}

function renderInbox() {
  const items = inbox.filter(x => inboxFilter === 'all' || x.type === inboxFilter);
  $('inboxList').innerHTML = items.map(x => `
    <article class="inbox-item" data-id="${x.id}">
      <div class="inbox-icon">${x.type === 'page' ? '↗' : '❝'}</div>
      <div class="inbox-body">
        <strong>${esc(x.title || 'Untitled')}</strong>
        ${x.body ? `<p>${esc(x.body)}</p>` : ''}
        <small>${esc(fmtDateTime(x.created))}${x.url ? ' · ' + esc(host(x.url)) : ''}</small>
      </div>
      <div class="inbox-actions">
        <button data-act="note">To note</button><button data-act="task">To task</button><button data-act="dismiss">Dismiss</button>
      </div>
    </article>`).join('');
  $('inboxEmpty').classList.toggle('hidden', items.length > 0);
  $('inboxEmpty').innerHTML = '<div class="empty-mark inbox-empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v11.5H3.5V7A1.5 1.5 0 0 1 5 5.5Z"/><path d="M8 5.5V4h8v1.5M8 10h8M8 14h5M12 18.5v-4M10.3 16.7 12 18.4l1.7-1.7"/></svg></div><strong>Inbox is clear</strong><span>Right-click any page, link or selected text and choose Stash.</span>';
  renderCounts();
}

$('inboxList').onclick = e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const item = inbox.find(x => x.id === b.closest('.inbox-item').dataset.id);
  if (!item) return;
  if (b.dataset.act === 'note') {
    const raw = String(item.body || item.title || '').trim();
    const firstLine = raw.split(/\n+/).map(x => x.trim()).filter(Boolean)[0] || '';
    const firstSentence = raw.match(/^.{1,100}?(?:[.!?](?:\s|$)|$)/)?.[0]?.trim() || firstLine;
    const title = firstSentence
      ? firstSentence.replace(/[.!?]+$/, '').slice(0, 90).trim()
      : (item.sourceTitle || item.title || 'Web note');
    const paragraphs = raw.split(/\n{2,}/).map(p => p.split('\n').map(x => x.trim()).filter(Boolean).join(' ')).filter(Boolean);
    notes.unshift({
      id: uid(), title, tags: item.url ? ['web'] : [], source: item.url || '', updated: Date.now(),
      bodyHtml: paragraphs.map(p => '<p>' + esc(p) + '</p>').join('')
    });
    saveNotes();
    toast('Saved as a focused note');
  } else if (b.dataset.act === 'task') {
    tasks.unshift({ id: uid(), text: item.title.slice(0, 200), status: 'todo', due: '', created: Date.now() });
    saveTasks();
    renderTasks();
    toast('Added as task');
  }
  inbox = inbox.filter(x => x.id !== item.id);
  saveInbox();
  renderInbox();
  renderNotes();
};

function addInboxFromInput() {
  const text = $('inboxInput').value.trim();
  if (!text) return;
  const isUrl = /^https?:\/\/\S+$/i.test(text);
  addInbox(isUrl ? { type: 'page', title: host(text) || text, url: text } : { type: 'snippet', title: text.slice(0, 70), body: text });
  $('inboxInput').value = '';
}
$('addInbox').onclick = addInboxFromInput;
$('inboxInput').onkeydown = e => { if (e.key === 'Enter') addInboxFromInput(); };

async function captureCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.url.startsWith(chrome.runtime.getURL(''))) return toast("Can't read this page");
  addInbox({ type: 'page', title: tab.title || tab.url, url: tab.url });
  toast('Page saved to Inbox');
}
$('savePage').onclick = captureCurrentPage;

document.querySelectorAll('[data-inbox-filter]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-inbox-filter]').forEach(x => x.classList.toggle('active', x === b));
  inboxFilter = b.dataset.inboxFilter;
  renderInbox();
});

/* ================= global search (Ctrl+K) ================= */
let searchHits = [];

function runSearch(query) {
  const q = query.toLowerCase().trim();
  searchHits = [];
  if (q) {
    notes.forEach(n => {
      if ((n.title + ' ' + noteText(n) + ' ' + n.tags.join(' ')).toLowerCase().includes(q))
        searchHits.push({ type: 'Note', title: n.title || 'Untitled', sub: noteText(n).slice(0, 90), open: () => openEditor(n) });
    });
    tasks.forEach(t => {
      if (t.text.toLowerCase().includes(q))
        searchHits.push({ type: 'Task', title: t.text, sub: t.status === 'done' ? 'Completed' : t.due ? 'Due ' + fmtDate(t.due) : 'Open', open: () => { taskFilter = 'all'; switchTab('tasks'); renderTasks(); } });
    });
    inbox.forEach(x => {
      if ((x.title + ' ' + x.body + ' ' + x.url).toLowerCase().includes(q))
        searchHits.push({ type: 'Inbox', title: x.title, sub: x.body || host(x.url), open: () => switchTab('inbox') });
    });
  }
  $('searchResults').innerHTML = searchHits.slice(0, 20).map((h, i) =>
    `<button class="result" data-hit="${i}"><span>${h.type}</span><strong>${esc(h.title)}</strong><small>${esc(h.sub)}</small></button>`).join('')
    || (q ? '<p class="muted">No results.</p>' : '');
}

function openHit(i) {
  const hit = searchHits[i];
  if (!hit) return;
  closeSearch();
  hit.open();
}
function openSearch() {
  $('searchOverlay').classList.remove('hidden');
  $('globalSearch').value = '';
  runSearch('');
  $('globalSearch').focus();
}
function closeSearch() { $('searchOverlay').classList.add('hidden'); }

$('searchBtn').onclick = openSearch;
$('globalSearch').oninput = e => runSearch(e.target.value);
$('globalSearch').onkeydown = e => { if (e.key === 'Enter') openHit(0); };
$('searchResults').onclick = e => { const b = e.target.closest('[data-hit]'); if (b) openHit(+b.dataset.hit); };
$('searchOverlay').onclick = e => { if (e.target === e.currentTarget) closeSearch(); };
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
  if (e.key === 'Escape') { closeSearch(); closeModal(); }
});

/* ================= export (backup) ================= */
// Downloads all tasks, notes and inbox items as one JSON file. No extra permission needed:
// we build a Blob in memory and click a temporary download link.
function exportData() {
  const payload = { app: 'Stash', exportedAt: new Date().toISOString(), tasks, notes, inbox };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stash-backup-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup exported');
}
$('exportBtn').onclick = exportData;

/* ================= theme + expand ================= */
const root = document.documentElement;
function syncThemeButton() {
  const dark = root.dataset.theme === 'dark';
  $('themeBtn').textContent = dark ? '☀' : '☾';
  $('themeBtn').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
}
$('themeBtn').onclick = () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch (e) {}
  syncThemeButton();
};
syncThemeButton();

// Expand stays inside the popup: it simply gives the workspace more writing room.
function syncSizeButton() {
  const expanded = root.dataset.size === 'expanded';
  $('expandBtn').setAttribute('aria-label', expanded ? 'Use compact workspace' : 'Make workspace larger');
  $('expandBtn').title = expanded ? 'Use compact workspace' : 'Make workspace larger';
  $('expandBtn').innerHTML = expanded
    ? '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 4H4v4M16 20h4v-4M4 16v4h4M20 8V4h-4"/></svg>'
    : '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4H4v3M17 4h3v3M4 17v3h3M20 17v3h-3"/></svg>';
}
$('expandBtn').onclick = () => {
  root.dataset.size = root.dataset.size === 'expanded' ? 'normal' : 'expanded';
  syncSizeButton();
};
syncSizeButton();

/* ================= modal ================= */
function openModal(html) { $('modalContent').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
$('modalClose').onclick = closeModal;
$('modal').onclick = e => { if (e.target === e.currentTarget) closeModal(); };

/* ================= start-up + live sync ================= */
// If a note/task/inbox item is added by the background script (right-click capture),
// the popup updates immediately.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.tasks) { tasks = (changes.tasks.newValue || []).map(migrateTask); renderTasks(); }
  if (changes.notes) { notes = (changes.notes.newValue || []).map(migrateNote); if (!editorOpen) renderNotes(); else renderCounts(); }
  if (changes.inbox) { inbox = (changes.inbox.newValue || []).map(migrateInbox); renderInbox(); }
});

(async function init() {
  const data = await chrome.storage.local.get(['tasks', 'notes', 'inbox']);
  tasks = (data.tasks || []).map(migrateTask);
  // Rewrite legacy task records once so removed recurrence/reminder fields are no longer stored.
  if ((data.tasks || []).some(t => 'recurrence' in t || 'reminder' in t || 'done' in t)) saveTasks();
  notes = (data.notes || []).map(migrateNote);
  inbox = (data.inbox || []).map(migrateInbox);
  renderTasks();
  renderNotes();
  renderInbox();
})();
