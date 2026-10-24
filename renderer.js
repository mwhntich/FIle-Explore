const $ = id => document.getElementById(id);
const icon = name => `<svg><use href="#i-${name}"/></svg>`;
const state = { tabs: [], closed: [], active: null, nextId: 1, secondary: { path: '', items: [], selected: new Set(), anchor: -1, history: [], at: -1 }, split: false, focused: 'primary', view: 'grid', sort: 'name', clipboard: null, home: null, drives: [], menu: null };

function tab() { return state.tabs.find(x => x.id === state.active); }
function pane(which = state.focused) { return which === 'primary' ? tab() : state.secondary; }
function currentPath(which = state.focused) { return pane(which)?.path || state.home?.root || ''; }
function nameOf(file) {
  if (!file) return 'Home';
  const value = file.replace(/[\\/]$/, '');
  const slash = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
  if (slash < 0) return value;
  return value.slice(slash + 1) || value;
}
function parentOf(file) {
  const value = file.replace(/[\\/]$/, '');
  if (/^[a-z]:$/i.test(value)) return value + '\\';
  const slash = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
  if (slash < 0) return file;
  if (slash === 2 && /^[a-z]:/i.test(value)) return value.slice(0, 3);
  if (value.startsWith('\\\\') && value.slice(2).split('\\').length <= 2) return file;
  return value.slice(0, slash) || file;
}
function samePath(a, b) { return !!a && !!b && a.replace(/[\\/]$/, '').toLowerCase() === b.replace(/[\\/]$/, '').toLowerCase(); }
function visibleItems(which) {
  const source = pane(which)?.items || [];
  const query = $('search').value.trim().toLowerCase();
  const filtered = which === state.focused && query ? source.filter(x => x.name.toLowerCase().includes(query)) : [...source];
  if (state.sort === 'date') filtered.sort((a, b) => Number(b.directory) - Number(a.directory) || b.modified - a.modified);
  if (state.sort === 'type') filtered.sort((a, b) => Number(b.directory) - Number(a.directory) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return filtered;
}
function toast(message) {
  const box = $('toast'); box.textContent = message; box.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => box.hidden = true, 4500);
}
function reportResults(results, action) {
  const failures = results.filter(x => !x.ok);
  if (failures.length) toast(`${action}: ${failures.length} item(s) failed. ${failures[0].error}`);
  else toast(`${action}: ${results.length} item(s).`);
}
async function load(which, target, remember = true) {
  const model = pane(which);
  if (!model) return;
  const sequence = model.sequence = (model.sequence || 0) + 1;
  try {
    const result = await window.slate.list(target);
    if (model.sequence !== sequence) return;
    if (remember && !samePath(model.path, result.path)) {
      model.history = model.history.slice(0, model.at + 1);
      model.history.push(result.path); model.at = model.history.length - 1;
    }
    model.path = result.path; model.items = result.items;
    model.selected = new Set([...model.selected].filter(x => result.items.some(item => samePath(x, item.path))));
    render();
  } catch (error) { toast(`Cannot open folder: ${error.message}`); }
}
function newTab(target, activate = true) {
  const id = state.nextId++;
  const folder = target || state.home.root;
  state.tabs.push({ id, path: '', items: [], selected: new Set(), anchor: -1, history: [], at: -1 });
  if (activate) { state.active = id; state.focused = 'primary'; $('search').value = ''; }
  load('primary', folder);
  renderTabs();
  return id;
}
function switchTab(id) {
  if (!state.tabs.some(x => x.id === id)) return;
  state.active = id; state.focused = 'primary'; $('search').value = ''; render();
}
function closeTab(id = state.active) {
  const index = state.tabs.findIndex(x => x.id === id);
  if (index < 0) return;
  state.closed.push(state.tabs[index].path || state.home.root);
  state.tabs.splice(index, 1);
  if (!state.tabs.length) { window.slate.window('close'); return; }
  if (state.active === id) { state.active = state.tabs[Math.min(index, state.tabs.length - 1)].id; state.focused = 'primary'; }
  render();
}
function cycleTab(direction) {
  const index = state.tabs.findIndex(x => x.id === state.active);
  switchTab(state.tabs[(index + direction + state.tabs.length) % state.tabs.length].id);
}
function renderTabs() {
  const strip = $('tabstrip'); strip.replaceChildren();
  state.tabs.forEach(model => {
    const button = document.createElement('button');
    button.className = `tab ${model.id === state.active ? 'active' : ''}`;
    button.title = model.path || 'Home';
    button.innerHTML = `${icon(model.path && samePath(model.path, state.home.root) ? 'home' : 'folder')}<span class="tab-title"></span><span class="tab-close" title="Close tab">×</span>`;
    button.querySelector('.tab-title').textContent = model.path && samePath(model.path, state.home.root) ? 'Home' : nameOf(model.path);
    button.onclick = event => { if (event.target.closest('.tab-close')) closeTab(model.id); else switchTab(model.id); };
    button.onauxclick = event => { if (event.button === 1) closeTab(model.id); };
    button.ondragover = event => { event.preventDefault(); clearTimeout(button.hoverTimer); button.hoverTimer = setTimeout(() => switchTab(model.id), 650); };
    button.ondragleave = () => clearTimeout(button.hoverTimer);
    button.ondrop = event => { event.preventDefault(); clearTimeout(button.hoverTimer); handleDrop(event, model.path, 'primary'); };
    strip.append(button);
  });
}
function renderSidebar() {
  const top = $('sidebar-top'); top.replaceChildren();
  const home = sidebarRow('Home', state.home.root, 'home', true); top.append(home);
  const list = $('sidebar-scroll'); list.replaceChildren();
  section('Pinned');
  for (const folder of state.home.folders) list.append(sidebarRow(folder.name, folder.path, folder.name === 'Desktop' ? 'home' : 'folder'));
  section('Drives');
  for (const drive of state.drives) list.append(sidebarRow(`${drive.name} (${drive.path.slice(0, 2)})`, drive.path, 'drive'));
  section('Network');
  const network = document.createElement('button'); network.className = 'sidebar-row'; network.innerHTML = `${icon('drive')}<span class="row-name">Open network path…</span>`;
  network.onclick = () => showAddress('\\\\'); list.append(network);
  function section(title) { const header = document.createElement('div'); header.className = 'sidebar-section'; header.textContent = title; list.append(header); }
}
function sidebarRow(label, target, symbol, isHome = false) {
  const button = document.createElement('button');
  button.className = `sidebar-row ${samePath(currentPath('primary'), target) ? 'active' : ''}`;
  button.innerHTML = `${icon(symbol)}<span class="row-name"></span>${!isHome && symbol === 'folder' ? '<span class="row-tail">♢</span>' : ''}`;
  button.querySelector('.row-name').textContent = label;
  button.title = target;
  button.onclick = event => { if (event.ctrlKey) newTab(target); else load('primary', target); };
  button.onauxclick = event => { if (event.button === 1) newTab(target); };
  button.ondragover = event => event.preventDefault();
  button.ondrop = event => { event.preventDefault(); handleDrop(event, target, 'primary'); };
  return button;
}
function breadcrumbs(folder) {
  const element = $('breadcrumbs'); element.replaceChildren();
  const segments = [];
  let root = '';
  if (/^[a-z]:\\/i.test(folder)) { root = folder.slice(0, 3); segments.push({ label: folder.slice(0, 2), path: root }); }
  else if (folder.startsWith('\\\\')) {
    const match = folder.match(/^\\\\[^\\]+\\[^\\]+\\?/);
    root = match ? match[0].replace(/\\$/, '') : folder;
    segments.push({ label: root, path: root });
  }
  if (root) {
    const rest = folder.slice(root.length).split('\\').filter(Boolean);
    let built = root;
    for (const part of rest) { built += (built.endsWith('\\') ? '' : '\\') + part; segments.push({ label: part, path: built }); }
  } else segments.push({ label: folder, path: folder });
  const home = document.createElement('button'); home.className = 'crumb home'; home.innerHTML = icon('home'); home.title = state.home.root; home.onclick = () => load(state.focused, state.home.root); element.append(home);
  for (const segment of segments) {
    const divider = document.createElement('span'); divider.className = 'crumb-divider'; divider.textContent = '›'; element.append(divider);
    const button = document.createElement('button'); button.className = 'crumb'; button.textContent = segment.label; button.title = segment.path; button.onclick = () => load(state.focused, segment.path); element.append(button);
  }
}
function showAddress(initial) {
  $('breadcrumbs').hidden = true; $('address').hidden = false;
  $('address').value = initial === undefined ? currentPath() : initial;
  $('address').focus(); $('address').select();
}
function hideAddress() { $('address').hidden = true; $('breadcrumbs').hidden = false; }
function formatSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB']; let value = bytes; let unit = -1;
  do { value /= 1024; unit++; } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
function itemIcon(item) {
  const type = item.directory ? 'folder' : 'file';
  const className = item.directory ? 'folder' : ['image', 'code', 'pdf', 'word', 'sheet', 'archive'].includes(item.kind) ? item.kind : 'document';
  const element = document.createElement('div'); element.className = `file-icon ${className}`;
  element.innerHTML = icon(type);
  if (item.kind === 'image') {
    const image = document.createElement('img'); image.loading = 'lazy'; image.alt = '';
    image.src = `slate-thumb://file/${encodeURIComponent(item.path)}`;
    image.onerror = () => image.remove(); element.prepend(image);
  }
  if (!item.directory) { const extension = item.name.split('.').pop(); if (extension && extension !== item.name && extension.length <= 5) { const badge = document.createElement('span'); badge.className = 'extension'; badge.textContent = extension; element.append(badge); } }
  return element;
}
function renderPane(which) {
  const model = pane(which); if (!model) return;
  const heading = $(`${which}-heading`); const content = $(`${which}-content`);
  heading.replaceChildren();
  const pathText = document.createElement('span'); pathText.className = 'small-path'; pathText.textContent = model.path || '';
  const count = document.createElement('span'); count.textContent = `${model.items.length} items`;
  heading.append(pathText, count);
  content.replaceChildren();
  const items = visibleItems(which);
  if (!items.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = `${icon('folder')}<strong>${$('search').value ? 'No matching items' : 'This folder is empty'}</strong><span>${$('search').value ? 'Try another search.' : 'Drop files here or create a folder.'}</span>`; content.append(empty); }
  else if (state.view === 'grid') {
    const grid = document.createElement('div'); grid.className = 'file-grid';
    items.forEach((item, index) => {
      const card = document.createElement('div'); card.className = `file-card ${model.selected.has(item.path) ? 'selected' : ''}`; card.draggable = true; card.dataset.path = item.path;
      card.append(itemIcon(item));
      const label = document.createElement('span'); label.className = 'file-name'; label.textContent = item.name; card.append(label);
      bindItem(card, item, index, which); grid.append(card);
    }); content.append(grid);
  } else {
    const table = document.createElement('table'); table.className = 'file-table';
    const head = document.createElement('thead'); head.innerHTML = '<tr><th>Name</th><th>Date modified</th><th>Size</th></tr>'; table.append(head);
    const body = document.createElement('tbody');
    items.forEach((item, index) => {
      const row = document.createElement('tr'); row.className = `item-row ${model.selected.has(item.path) ? 'selected' : ''}`; row.draggable = true; row.dataset.path = item.path;
      const name = document.createElement('td'); const iconWrap = document.createElement('span'); iconWrap.className = `table-icon ${item.directory ? '' : 'file'}`; iconWrap.innerHTML = icon(item.directory ? 'folder' : 'file'); const text = document.createElement('span'); text.textContent = item.name; iconWrap.append(text); name.append(iconWrap);
      const date = document.createElement('td'); date.textContent = item.modified ? new Date(item.modified).toLocaleDateString() : '';
      const size = document.createElement('td'); size.textContent = formatSize(item.size);
      row.append(name, date, size); bindItem(row, item, index, which); body.append(row);
    }); table.append(body); content.append(table);
  }
  bindContent(content, which);
}
function selectItem(item, index, which, event) {
  const model = pane(which); const items = visibleItems(which);
  if (event.shiftKey && model.anchor >= 0) {
    if (!event.ctrlKey) model.selected.clear();
    const a = Math.min(model.anchor, index), b = Math.max(model.anchor, index);
    for (let i = a; i <= b; i++) model.selected.add(items[i].path);
  } else if (event.ctrlKey) {
    model.selected.has(item.path) ? model.selected.delete(item.path) : model.selected.add(item.path);
    model.anchor = index;
  } else { model.selected = new Set([item.path]); model.anchor = index; }
  state.focused = which; render();
}
function bindItem(element, item, index, which) {
  element.onclick = event => { event.stopPropagation(); selectItem(item, index, which, event); };
  element.ondblclick = event => { event.stopPropagation(); item.directory ? load(which, item.path) : window.slate.open(item.path).then(error => { if (error) toast(error); }); };
  element.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); const model = pane(which); if (!model.selected.has(item.path)) { model.selected = new Set([item.path]); state.focused = which; render(); } showItemMenu(event.clientX, event.clientY, item, which); };
  element.ondragstart = event => {
    const model = pane(which);
    if (!model.selected.has(item.path)) model.selected = new Set([item.path]);
    state.focused = which;
    const files = [...model.selected];
    event.dataTransfer.setData('application/x-slate-files', JSON.stringify(files));
    event.dataTransfer.setData('text/plain', files.join('\n'));
    event.dataTransfer.effectAllowed = 'copyMove';
    renderStatus();
  };
  element.ondragover = event => { if (!item.directory) return; event.preventDefault(); event.stopPropagation(); element.classList.add('drop-target'); event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move'; };
  element.ondragleave = () => element.classList.remove('drop-target');
  element.ondrop = event => { if (!item.directory) return; event.preventDefault(); event.stopPropagation(); element.classList.remove('drop-target'); handleDrop(event, item.path, which); };
}
function bindContent(content, which) {
  content.ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move'; };
  content.ondrop = event => { event.preventDefault(); handleDrop(event, currentPath(which), which); };
  content.oncontextmenu = event => { if (event.target.closest('[data-path]')) return; event.preventDefault(); state.focused = which; showEmptyMenu(event.clientX, event.clientY, which); };
  content.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest('[data-path]')) return;
    state.focused = which;
    const model = pane(which); if (!event.ctrlKey) model.selected.clear();
    const rect = content.getBoundingClientRect(); const startX = event.clientX - rect.left + content.scrollLeft, startY = event.clientY - rect.top + content.scrollTop;
    const overlay = document.createElement('div'); overlay.className = 'marquee'; content.append(overlay);
    const original = new Set(model.selected); let moved = false;
    const move = point => {
      const x = point.clientX - rect.left + content.scrollLeft, y = point.clientY - rect.top + content.scrollTop;
      if (Math.abs(x - startX) + Math.abs(y - startY) > 5) moved = true;
      overlay.style.left = `${Math.min(x, startX)}px`; overlay.style.top = `${Math.min(y, startY)}px`;
      overlay.style.width = `${Math.abs(x - startX)}px`; overlay.style.height = `${Math.abs(y - startY)}px`;
      if (!moved) return;
      model.selected = new Set(original);
      const box = overlay.getBoundingClientRect();
      for (const card of content.querySelectorAll('[data-path]')) { const cardBox = card.getBoundingClientRect(); if (box.left < cardBox.right && box.right > cardBox.left && box.top < cardBox.bottom && box.bottom > cardBox.top) model.selected.add(card.dataset.path); }
      for (const card of content.querySelectorAll('[data-path]')) card.classList.toggle('selected', model.selected.has(card.dataset.path));
      renderStatus();
    };
    const up = () => { overlay.remove(); content.removeEventListener('pointermove', move); content.removeEventListener('pointerup', up); content.removeEventListener('pointercancel', up); renderStatus(); };
    content.setPointerCapture(event.pointerId); content.addEventListener('pointermove', move); content.addEventListener('pointerup', up); content.addEventListener('pointercancel', up);
  };
}
async function handleDrop(event, destination, which) {
  const internal = event.dataTransfer.getData('application/x-slate-files');
  let files = [];
  if (internal) { try { files = JSON.parse(internal); } catch {} }
  else files = [...event.dataTransfer.files].map(file => window.slate.pathForFile(file)).filter(Boolean);
  if (!files.length) return;
  const fromSameVolume = files.every(file => file.slice(0, 2).toLowerCase() === destination.slice(0, 2).toLowerCase());
  const move = internal && !event.ctrlKey && (event.shiftKey || fromSameVolume);
  try { reportResults(await window.slate.transfer(files, destination, !!move), move ? 'Moved' : 'Copied'); await refreshAll(); }
  catch (error) { toast(error.message); }
}
function renderStatus() {
  const model = pane(); if (!model) return;
  const total = model.items.length; const selected = model.selected.size; const bytes = model.items.filter(x => model.selected.has(x.path) && x.size != null).reduce((sum, x) => sum + x.size, 0);
  $('statusbar').innerHTML = `<span>${total} item${total === 1 ? '' : 's'}</span>${selected ? `<span>${selected} selected</span><span>${formatSize(bytes)}</span>` : ''}`;
  for (const id of ['cut', 'copy', 'rename', 'delete']) $(id).disabled = selected === 0 || ((id === 'rename') && selected !== 1);
  $('paste').disabled = !state.clipboard?.paths?.length;
}
function render() {
  if (!tab()) return;
  renderTabs(); renderSidebar();
  $('secondary-pane').hidden = !state.split;
  document.querySelectorAll('.file-pane').forEach(x => x.classList.toggle('focused', x.dataset.pane === state.focused));
  renderPane('primary'); if (state.split) renderPane('secondary');
  breadcrumbs(currentPath());
  const model = pane(); $('back').disabled = model.at <= 0; $('forward').disabled = model.at >= model.history.length - 1;
  $('split').classList.toggle('on', state.split); $('view').innerHTML = icon(state.view === 'grid' ? 'grid' : 'list');
  renderStatus();
}
async function refreshAll() {
  const tasks = [load('primary', currentPath('primary'), false)];
  if (state.split) tasks.push(load('secondary', currentPath('secondary'), false));
  await Promise.all(tasks);
}
function goHistory(direction) {
  const model = pane(); const at = model.at + direction;
  if (at < 0 || at >= model.history.length) return;
  model.at = at; load(state.focused, model.history[at], false);
}
function showMenu(x, y, entries) {
  const menu = $('context-menu'); menu.replaceChildren();
  entries.forEach(entry => {
    if (!entry) { const line = document.createElement('div'); line.className = 'menu-divider'; menu.append(line); return; }
    const button = document.createElement('button'); button.innerHTML = `${icon(entry.icon)}<span></span>`; button.querySelector('span').textContent = entry.label;
    button.onclick = () => { menu.hidden = true; entry.run(); }; menu.append(button);
  });
  menu.hidden = false; menu.style.left = `${Math.min(x, innerWidth - menu.offsetWidth - 10)}px`; menu.style.top = `${Math.min(y, innerHeight - menu.offsetHeight - 10)}px`;
}
function showItemMenu(x, y, item, which) {
  showMenu(x, y, [
    { icon: 'folder', label: 'Open', run: () => item.directory ? load(which, item.path) : window.slate.open(item.path) },
    ...(item.directory ? [{ icon: 'plus', label: 'Open in new tab', run: () => newTab(item.path) }, { icon: 'split', label: 'Open in new pane', run: () => { state.split = true; load('secondary', item.path); state.focused = 'secondary'; } }] : []),
    null,
    { icon: 'cut', label: 'Cut', run: () => cutCopy(true) },
    { icon: 'copy', label: 'Copy', run: () => cutCopy(false) },
    { icon: 'rename', label: 'Rename', run: renameSelected },
    { icon: 'trash', label: 'Move to Recycle Bin', run: deleteSelected }
  ]);
}
function showEmptyMenu(x, y, which) {
  showMenu(x, y, [
    { icon: 'folder', label: 'New folder', run: newFolder },
    { icon: 'paste', label: 'Paste', run: paste },
    { icon: 'refresh', label: 'Refresh', run: refreshAll },
    { icon: 'split', label: state.split ? 'Close second pane' : 'Open second pane', run: toggleSplit }
  ]);
}
function modal(title, description, initial, confirm, callback) {
  $('modal-title').textContent = title; $('modal-description').textContent = description; $('modal-input').value = initial; $('modal-confirm').textContent = confirm;
  $('modal-backdrop').hidden = false; $('modal-input').focus(); $('modal-input').select();
  const finish = async accepted => {
    if (!accepted) { $('modal-backdrop').hidden = true; return; }
    try { await callback($('modal-input').value); $('modal-backdrop').hidden = true; await refreshAll(); }
    catch (error) { toast(error.message); $('modal-input').focus(); }
  };
  $('modal-confirm').onclick = () => finish(true); $('modal-cancel').onclick = () => finish(false);
  $('modal-input').onkeydown = event => { if (event.key === 'Enter') finish(true); if (event.key === 'Escape') finish(false); };
}
function newFolder() { modal('New folder', 'Create a folder in the current location.', 'New folder', 'Create', name => window.slate.mkdir(currentPath(), name)); }
function renameSelected() {
  const file = [...pane().selected][0]; if (!file || pane().selected.size !== 1) return;
  modal('Rename', 'Enter a new name for this item.', nameOf(file), 'Rename', name => window.slate.rename(file, name));
}
async function deleteSelected() {
  const files = [...pane().selected]; if (!files.length) return;
  try { reportResults(await window.slate.trash(files), 'Moved to Recycle Bin'); pane().selected.clear(); await refreshAll(); }
  catch (error) { toast(error.message); }
}
function cutCopy(cut) { const files = [...pane().selected]; if (!files.length) return; state.clipboard = { paths: files, cut }; toast(`${cut ? 'Cut' : 'Copied'} ${files.length} item(s).`); renderStatus(); }
async function paste() {
  if (!state.clipboard?.paths?.length) return;
  const clip = state.clipboard;
  try {
    const result = await window.slate.transfer(clip.paths, currentPath(), clip.cut); reportResults(result, clip.cut ? 'Moved' : 'Copied');
    if (clip.cut) state.clipboard = null; await refreshAll();
  } catch (error) { toast(error.message); }
}
function toggleSplit() {
  state.split = !state.split;
  if (state.split && !state.secondary.path) load('secondary', currentPath('primary'));
  if (!state.split) state.focused = 'primary'; render();
}
function bindControls() {
  $('add-tab').onclick = () => newTab();
  $('minimize').onclick = () => window.slate.window('minimize'); $('maximize').onclick = () => window.slate.window('maximize'); $('close-window').onclick = () => window.slate.window('close');
  $('back').onclick = () => goHistory(-1); $('forward').onclick = () => goHistory(1); $('up').onclick = () => load(state.focused, parentOf(currentPath())); $('refresh').onclick = refreshAll;
  $('address-wrap').ondblclick = () => showAddress();
  $('address').onkeydown = event => { if (event.key === 'Enter') { const path = event.target.value.trim(); hideAddress(); if (path) load(state.focused, path); } if (event.key === 'Escape') hideAddress(); };
  $('address').onblur = hideAddress;
  $('search').oninput = render;
  $('new-folder').onclick = newFolder; $('cut').onclick = () => cutCopy(true); $('copy').onclick = () => cutCopy(false); $('paste').onclick = paste; $('rename').onclick = renameSelected; $('delete').onclick = deleteSelected;
  $('split').onclick = toggleSplit;
  $('view').onclick = () => { state.view = state.view === 'grid' ? 'list' : 'grid'; render(); };
  $('sort').onclick = () => { state.sort = state.sort === 'name' ? 'date' : state.sort === 'date' ? 'type' : 'name'; toast(`Sorted by ${state.sort}.`); render(); };
  $('appearance').onclick = () => { const glass = document.body.classList.toggle('glass'); localStorage.setItem('glass', glass ? '1' : '0'); toast(glass ? 'Frosted glass appearance' : 'Solid dark appearance'); };
  $('settings').onclick = () => { showMenu(12, innerHeight - 135, [
    { icon: 'folder', label: 'Solid dark appearance', run: () => { document.body.classList.remove('glass'); localStorage.setItem('glass', '0'); } },
    { icon: 'split', label: 'Frosted glass appearance', run: () => { document.body.classList.add('glass'); localStorage.setItem('glass', '1'); } }
  ]); };
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#context-menu')) $('context-menu').hidden = true; });
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase(); const ctrl = event.ctrlKey; const shift = event.shiftKey;
    if (key === 'escape') { $('context-menu').hidden = true; return; }
    if (!$('modal-backdrop').hidden || (event.target instanceof Element && event.target.matches('input, textarea, [contenteditable="true"]'))) return;
    if (ctrl && shift && key === 't') { event.preventDefault(); const folder = state.closed.pop(); if (folder) newTab(folder); return; }
    if (ctrl && shift && key === 'w') { event.preventDefault(); window.slate.window('close'); return; }
    if (ctrl && shift && key === 'k') { event.preventDefault(); newTab(currentPath('primary')); return; }
    if (ctrl && shift && key === 'n') { event.preventDefault(); newFolder(); return; }
    if (ctrl && key === 't') { event.preventDefault(); newTab(); return; }
    if (ctrl && key === 'w') { event.preventDefault(); closeTab(); return; }
    if (ctrl && key === 'tab') { event.preventDefault(); cycleTab(shift ? -1 : 1); return; }
    if (ctrl && /^[1-9]$/.test(key)) { event.preventDefault(); switchTab(state.tabs[Number(key) - 1]?.id); return; }
    if (ctrl && key === 'a') { event.preventDefault(); pane().selected = new Set(visibleItems(state.focused).map(x => x.path)); render(); return; }
    if (ctrl && key === 'c') { event.preventDefault(); cutCopy(false); return; }
    if (ctrl && key === 'x') { event.preventDefault(); cutCopy(true); return; }
    if (ctrl && key === 'v') { event.preventDefault(); paste(); return; }
    if (ctrl && key === 'l') { event.preventDefault(); showAddress(); return; }
    if (ctrl && key === 'r') { event.preventDefault(); refreshAll(); return; }
    if (key === 'f2') { event.preventDefault(); renameSelected(); return; }
    if (key === 'delete') { event.preventDefault(); deleteSelected(); return; }
    if (key === 'enter' && pane().selected.size === 1) { const item = pane().items.find(x => pane().selected.has(x.path)); if (item) item.directory ? load(state.focused, item.path) : window.slate.open(item.path); return; }
    if (key === 'backspace' || (event.altKey && key === 'arrowup')) { event.preventDefault(); load(state.focused, parentOf(currentPath())); }
  });
}

async function start() {
  bindControls();
  if (localStorage.getItem('glass') === '1') document.body.classList.add('glass');
  state.home = await window.slate.home();
  state.drives = await window.slate.drives();
  const documents = state.home.folders.find(x => x.name === 'Documents')?.path || state.home.root;
  newTab(state.home.root, true);
  newTab(documents, true);
}
start().catch(error => toast(error.message));
