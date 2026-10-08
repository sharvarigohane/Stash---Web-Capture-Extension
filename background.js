// Stash background service worker.
// One focused job:
//   Web capture - right-click menu + keyboard shortcut -> Inbox / Notes / Tasks

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Writes go through a queue so two quick captures can't overwrite each other.
let queue = Promise.resolve();
const enqueue = fn => (queue = queue.then(fn).catch(console.error));

async function addToList(key, item) {
  const data = await chrome.storage.local.get(key);
  const list = data[key] || [];
  list.unshift(item);
  await chrome.storage.local.set({ [key]: list });
}

// Small green tick on the toolbar icon so the user knows the capture worked.
function flashBadge() {
  chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
  chrome.action.setBadgeText({ text: '✓' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

// ---------- 1. Web capture ----------

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'root', title: 'Stash', contexts: ['page', 'selection', 'link'] });
    const add = (id, title, contexts) => chrome.contextMenus.create({ id, parentId: 'root', title, contexts });
    add('inbox-page', 'Save page to Inbox', ['page']);
    add('inbox-link', 'Save link to Inbox', ['link']);
    add('inbox-selection', 'Save selection to Inbox', ['selection']);
    add('note-selection', 'Save selection as smart note', ['selection']);
    add('task-selection', 'Create task from selection', ['selection']);
  });
}
chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

const pageItem = (title, url) => ({ id: uid(), type: 'page', title: title || url, body: '', url, created: Date.now() });

// Turn a selected passage into a useful note instead of using the page title
// blindly. This stays local and deterministic: the first meaningful line or
// sentence becomes the note title, while the selected passage remains the body.
function smartSelectionTitle(selection, pageTitle) {
  const cleaned = String(selection || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (!cleaned.length) return pageTitle || 'Web note';

  const firstLine = cleaned[0].replace(/^[#>*\-\s]+/, '').trim();
  const looksLikeHeading = firstLine && firstLine.length <= 90 &&
    firstLine.split(/\s+/).length <= 12 && !/[.!?]$/.test(firstLine);
  if (looksLikeHeading) return firstLine;

  const sentence = cleaned.join(' ').match(/^.{1,100}?(?:[.!?](?:\s|$)|$)/)?.[0]?.trim();
  if (sentence) {
    const title = sentence.replace(/[.!?]+$/, '').trim();
    if (title.length <= 90) return title;
    return title.slice(0, 87).replace(/\s+\S*$/, '') + '…';
  }

  return firstLine.length <= 90
    ? firstLine
    : firstLine.slice(0, 87).replace(/\s+\S*$/, '') + '…';
}

function smartSelectionNote(selection, pageTitle, pageUrl) {
  const text = String(selection || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split(/\n{2,}/)
    .map(p => p.split('\n').map(line => line.trim()).filter(Boolean).join(' '))
    .filter(Boolean);
  const body = text.length ? text.map(p => '<p>' + escapeHtml(p) + '</p>').join('') : '<p></p>';
  return {
    id: uid(),
    title: smartSelectionTitle(selection, pageTitle),
    bodyHtml: body,
    tags: ['web'],
    source: pageUrl,
    sourceTitle: pageTitle || '',
    captureType: 'selection',
    updated: Date.now()
  };
}

chrome.contextMenus.onClicked.addListener((info, tab) => enqueue(async () => {
  const selection = (info.selectionText || '').trim();
  const pageUrl = info.pageUrl || tab?.url || '';
  const pageTitle = tab?.title || 'Saved from web';

  switch (info.menuItemId) {
    case 'inbox-page':
      await addToList('inbox', pageItem(pageTitle, pageUrl));
      break;
    case 'inbox-link':
      await addToList('inbox', pageItem(info.linkText || info.linkUrl, info.linkUrl));
      break;
    case 'inbox-selection':
      await addToList('inbox', { id: uid(), type: 'snippet', title: selection.slice(0, 70), body: selection, url: pageUrl, sourceTitle: pageTitle, created: Date.now() });
      break;
    case 'note-selection':
      if (!selection) return;
      await addToList('notes', smartSelectionNote(selection, pageTitle, pageUrl));
      break;
    case 'task-selection':
      await addToList('tasks', { id: uid(), text: selection.slice(0, 200), status: 'todo', due: '', created: Date.now() });
      break;
    default:
      return;
  }
  flashBadge();
}));

// Keyboard shortcut (Alt+Shift+S): save the current tab to the Inbox.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'capture-page') return;
  enqueue(async () => {
    const t = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!t?.url) return;
    await addToList('inbox', pageItem(t.title, t.url));
    flashBadge();
  });
});
