const $ = id => document.getElementById(id);
const icon = name => `<svg><use href="#i-${name}"/></svg>`;
const state = { tabs: [], closed: [], active: null, nextId: 1, secondary: { path: '', items: [], selected: new Set(), anchor: -1, history: [], at: -1 }, split: false, focused: 'primary', view: 'grid', sort: 'name', clipboard: null, home: null, drives: [], menu: null };

// Virtual "Home" location: quick folders and all drives, like This PC.
const HOME = '::home';
function tab() { return state.tabs.find(x => x.id === state.active); }
function pane(which = state.focused) { return which === 'primary' ? tab() : state.secondary; }
function currentPath(which = state.focused) { return pane(which)?.path || HOME; }
function isHome(file) { return file === HOME; }
function homeItems() {
  const folders = state.home.folders.map(x => ({ name: x.name, path: x.path, directory: true, kind: 'folder', section: 'folders' }));
  const drives = state.drives.map(x => ({ name: `${x.name} (${x.path.slice(0, 2)})`, path: x.path, directory: true, kind: 'drive', section: x.network ? 'network' : 'drives', size: x.size ?? null, free: x.free ?? null, network: !!x.network, provider: x.provider || '' }));
  return [...folders, ...drives];
}
function nameOf(file) {
  if (!file || isHome(file)) return 'Home';
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
  if (isHome(pane(which)?.path)) return filtered;
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
    const result = isHome(target) ? { path: HOME, items: homeItems() } : await window.slate.list(target);
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
  const folder = target || HOME;
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
  state.closed.push(state.tabs[index].path || HOME);
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
    button.className = `tab ${model.id === state.active ? 'active' : ''}`; button.dataset.tabId = model.id;
    button.title = model.path || 'Home';
    button.innerHTML = `${icon(isHome(model.path) ? 'home' : 'folder')}<span class="tab-title"></span><span class="tab-close" title="Close tab">×</span>`;
    button.querySelector('.tab-title').textContent = nameOf(model.path);
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
  const home = sidebarRow('Home', HOME, 'home', true); top.append(home);
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
function sidebarRow(label, target, symbol, homeRow = false) {
  const button = document.createElement('button');
  button.className = `sidebar-row ${samePath(currentPath('primary'), target) ? 'active' : ''}`;
  button.innerHTML = `${icon(symbol)}<span class="row-name"></span>${!homeRow && symbol === 'folder' ? '<span class="row-tail">♢</span>' : ''}`;
  button.querySelector('.row-name').textContent = label;
  button.title = isHome(target) ? 'Home' : target; if (!isHome(target)) button.dataset.dropPath = target;
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
  const home = document.createElement('button'); home.className = 'crumb home'; home.innerHTML = icon('home'); home.title = 'Home'; home.onclick = () => load(state.focused, HOME); element.append(home);
  if (isHome(folder)) { const divider = document.createElement('span'); divider.className = 'crumb-divider'; divider.textContent = '›'; const label = document.createElement('button'); label.className = 'crumb'; label.textContent = 'Home'; element.append(divider, label); return; }
  for (const segment of segments) {
    const divider = document.createElement('span'); divider.className = 'crumb-divider'; divider.textContent = '›'; element.append(divider);
    const button = document.createElement('button'); button.className = 'crumb'; button.textContent = segment.label; button.title = segment.path; button.onclick = () => load(state.focused, segment.path); element.append(button);
  }
}
function showAddress(initial) {
  $('breadcrumbs').hidden = true; $('address').hidden = false;
  $('address').value = initial === undefined ? (isHome(currentPath()) ? '' : currentPath()) : initial;
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
  const pathText = document.createElement('span'); pathText.className = 'small-path'; pathText.textContent = isHome(model.path) ? 'Home' : model.path || '';
  const count = document.createElement('span'); count.textContent = `${model.items.length} items`;
  heading.append(pathText, count);
  content.replaceChildren();
  const items = visibleItems(which);
  if (!items.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = `${icon('folder')}<strong>${$('search').value ? 'No matching items' : 'This folder is empty'}</strong><span>${$('search').value ? 'Try another search.' : 'Drop files here or create a folder.'}</span>`; content.append(empty); }
  else if (isHome(model.path)) renderHome(content, items, which);
  else if (state.view === 'grid') {
    const grid = document.createElement('div'); grid.className = 'file-grid';
    items.forEach((item, index) => {
      const card = document.createElement('div'); card.className = `file-card ${model.selected.has(item.path) ? 'selected' : ''}`; card.dataset.path = item.path; card.dataset.directory = item.directory ? '1' : '';
      card.append(itemIcon(item));
      const label = document.createElement('span'); label.className = 'file-name'; label.textContent = item.name; card.append(label);
      bindItem(card, item, index, which); grid.append(card);
    }); content.append(grid);
  } else {
    const table = document.createElement('table'); table.className = 'file-table';
    const head = document.createElement('thead'); head.innerHTML = '<tr><th>Name</th><th>Date modified</th><th>Size</th></tr>'; table.append(head);
    const body = document.createElement('tbody');
    items.forEach((item, index) => {
      const row = document.createElement('tr'); row.className = `item-row ${model.selected.has(item.path) ? 'selected' : ''}`; row.dataset.path = item.path; row.dataset.directory = item.directory ? '1' : '';
      const name = document.createElement('td'); const iconWrap = document.createElement('span'); iconWrap.className = `table-icon ${item.directory ? '' : 'file'}`; iconWrap.innerHTML = icon(item.directory ? 'folder' : 'file'); const text = document.createElement('span'); text.textContent = item.name; iconWrap.append(text); name.append(iconWrap);
      const date = document.createElement('td'); date.textContent = item.modified ? new Date(item.modified).toLocaleDateString() : '';
      const size = document.createElement('td'); size.textContent = formatSize(item.size);
      row.append(name, date, size); bindItem(row, item, index, which); body.append(row);
    }); table.append(body); content.append(table);
  }
  bindContent(content, which);
}
function renderHome(content, items, which) {
  const view = document.createElement('div'); view.className = 'home-view';
  for (const [section, title] of [['folders', 'Folders'], ['drives', 'Devices and drives'], ['network', 'Network locations']]) {
    const entries = items.map((item, index) => ({ item, index })).filter(x => x.item.section === section);
    if (!entries.length) continue;
    const heading = document.createElement('h3'); heading.className = 'home-heading'; heading.textContent = title; view.append(heading);
    const grid = document.createElement('div'); grid.className = section === 'folders' ? 'file-grid home-folders' : 'drive-grid';
    for (const { item, index } of entries) {
      const model = pane(which);
      const card = document.createElement('div'); card.dataset.path = item.path; card.dataset.directory = '1';
      if (section !== 'folders') {
        card.className = `drive-card ${model.selected.has(item.path) ? 'selected' : ''}`;
        const used = item.size ? Math.min(1, Math.max(0, (item.size - item.free) / item.size)) : 0;
        card.innerHTML = `<div class="drive-icon ${item.network ? 'network' : ''}">${icon('drive')}</div><div class="drive-info"><span class="drive-name"></span><div class="drive-bar"><span></span></div><span class="drive-space"></span></div>`;
        card.querySelector('.drive-name').textContent = item.name;
        card.querySelector('.drive-bar span').style.width = `${Math.round(used * 100)}%`;
        card.querySelector('.drive-bar').classList.toggle('full', used >= 0.9);
        card.querySelector('.drive-space').textContent = item.size ? `${formatSize(item.free)} free of ${formatSize(item.size)}` : item.provider || (item.network ? 'Network drive' : '');
        card.title = item.provider ? `${item.path}  —  ${item.provider}` : item.path;
      } else {
        card.className = `file-card ${model.selected.has(item.path) ? 'selected' : ''}`;
        card.append(itemIcon(item));
        const label = document.createElement('span'); label.className = 'file-name'; label.textContent = item.name; card.append(label);
      }
      bindItem(card, item, index, which); grid.append(card);
    }
    view.append(grid);
  }
  content.append(view);
}
function goUp() {
  const folder = currentPath(); if (isHome(folder)) return;
  const parent = parentOf(folder);
  load(state.focused, samePath(parent, folder) ? HOME : parent);
}
function inFolder(action) { if (isHome(currentPath())) { toast(`Open a folder or drive to ${action}.`); return false; } return true; }
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
  state.focused = which; paintSelection();
}
function bindItem(element, item, index, which) {
  element.onclick = event => { event.stopPropagation(); if (state.suppressClick) return; selectItem(item, index, which, event); };
  element.ondblclick = event => { event.stopPropagation(); item.directory ? load(which, item.path) : window.slate.open(item.path).then(error => { if (error) toast(error); }); };
  element.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); const model = pane(which); if (!model.selected.has(item.path)) { model.selected = new Set([item.path]); state.focused = which; paintSelection(); } showItemMenu(event.clientX, event.clientY, item, which); };
  element.onpointerdown = event => { if (event.button === 0) startItemDrag(event, item, index, which); };
  // Native drag events are only used for files dropped in from Windows Explorer.
  element.ondragover = event => { if (!item.directory) return; event.preventDefault(); event.stopPropagation(); element.classList.add('drop-target'); event.dataTransfer.dropEffect = 'copy'; };
  element.ondragleave = () => element.classList.remove('drop-target');
  element.ondrop = event => { if (!item.directory) return; event.preventDefault(); event.stopPropagation(); element.classList.remove('drop-target'); handleDrop(event, item.path, which); };
}
// Drag preview: a stack of the grabbed items that hangs under the cursor, swings with horizontal speed and squishes with velocity.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function createDragGhost(files, which, x, y) {
  const model = pane(which);
  const items = files.map(file => model.items.find(item => samePath(item.path, file))).filter(Boolean);
  const root = document.createElement('div'); root.className = 'drag-ghost';
  const stack = document.createElement('div'); stack.className = 'drag-stack'; root.append(stack);
  items.slice(0, 3).reverse().forEach((item, layer, list) => {
    const depth = list.length - 1 - layer;
    const card = document.createElement('div'); card.className = 'drag-card'; card.style.setProperty('--depth', depth);
    card.append(itemIcon(item));
    if (depth === 0) { const label = document.createElement('span'); label.className = 'drag-label'; label.textContent = item.name; card.append(label); }
    stack.append(card);
  });
  if (files.length > 1) { const badge = document.createElement('span'); badge.className = 'drag-count'; badge.textContent = files.length; root.append(badge); }
  const mode = document.createElement('span'); mode.className = 'drag-mode'; root.append(mode);
  document.body.append(root);
  const body = { x, y, tx: x, ty: y, vx: 0, vy: 0, rot: 0, rotV: 0, sx: 1, sy: 1, scale: 0.55, scaleV: 0, running: true, frame: 0 };
  const step = () => {
    if (!body.running) return;
    const px = body.x, py = body.y;
    body.x += (body.tx - body.x) * 0.38; body.y += (body.ty - body.y) * 0.38;
    body.vx = body.x - px; body.vy = body.y - py;
    const speed = Math.hypot(body.vx, body.vy);
    // Swing: a damped spring toward an angle that follows horizontal speed, so the stack lags and overshoots like a pendulum.
    const rotTarget = reduceMotion ? 0 : Math.max(-30, Math.min(30, body.vx * 1.7));
    body.rotV = (body.rotV + (rotTarget - body.rot) * 0.18) * 0.78; body.rot += body.rotV;
    // Squish: stretch along the direction of travel, compress across it, then spring back when the cursor stops.
    const stretch = reduceMotion ? 0 : Math.min(speed / 55, 0.22);
    const along = speed ? Math.abs(body.vx) / speed : 0, across = speed ? Math.abs(body.vy) / speed : 0;
    const sxTarget = 1 + stretch * along - stretch * 0.6 * across, syTarget = 1 + stretch * across - stretch * 0.6 * along;
    body.sx += (sxTarget - body.sx) * 0.3; body.sy += (syTarget - body.sy) * 0.3;
    // Pick-up pop: scale springs from small to full size with a little overshoot.
    body.scaleV = (body.scaleV + (1 - body.scale) * 0.22) * 0.72; body.scale += body.scaleV;
    root.style.transform = `translate(${body.x}px, ${body.y + 10}px) translateX(-50%) rotate(${body.rot}deg) scale(${body.scale * body.sx}, ${body.scale * body.sy})`;
    body.frame = requestAnimationFrame(step);
  };
  step();
  return {
    element: root,
    moveTo(nx, ny) { body.tx = nx; body.ty = ny; },
    setMode(text) { mode.textContent = text; root.classList.toggle('copy', text === 'Copy'); },
    // Shrink into the drop target, or fly back home when nothing accepted the drop.
    land(rect, back) {
      body.running = false; cancelAnimationFrame(body.frame);
      const x2 = rect ? rect.left + rect.width / 2 : back.x, y2 = rect ? rect.top + rect.height / 2 - 10 : back.y;
      root.classList.add('landing');
      root.style.transform = `translate(${x2}px, ${y2}px) translateX(-50%) rotate(0deg) scale(${rect ? 0.25 : 0.6})`;
      root.style.opacity = '0';
      setTimeout(() => root.remove(), 260);
    },
    remove() { body.running = false; cancelAnimationFrame(body.frame); root.remove(); },
    // Picture of the stack for Windows to show under the cursor once the drag leaves the window.
    snapshot() { return renderStackImage(items, files.length); }
  };
}
function renderStackImage(items, count) {
  const canvas = document.createElement('canvas'); const size = 96; canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d'); const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#4dbdf2';
  const layers = Math.min(3, items.length || 1);
  for (let i = layers - 1; i >= 0; i--) {
    g.save(); g.translate(48, 52); g.rotate((i * 7 - 3) * Math.PI / 180); g.translate(-30 + i * 4, -30 - i * 4);
    g.fillStyle = i === 0 ? '#3a3d41' : '#2c2f33'; g.strokeStyle = i === 0 ? accent : '#5a5f66'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(0, 0, 60, 60, 8); g.fill(); g.stroke();
    const item = items[i]; g.fillStyle = item?.directory ? '#ffc83d' : '#eef1f3';
    if (item?.directory) { g.beginPath(); g.roundRect(12, 18, 36, 26, 3); g.fill(); g.fillRect(12, 14, 15, 6); }
    else { g.beginPath(); g.roundRect(18, 12, 24, 34, 3); g.fill(); }
    g.restore();
  }
  if (count > 1) {
    g.fillStyle = accent; g.beginPath(); g.arc(78, 18, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#04121a'; g.font = 'bold 15px Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(count > 99 ? '99+' : String(count), 78, 19);
  }
  return canvas.toDataURL('image/png');
}
// Internal drag and drop runs on pointer events instead of HTML5 drag, which is unreliable in a frameless window on Windows.
function startItemDrag(event, item, index, which) {
  if (isHome(pane(which)?.path)) return; // Home shows shortcuts to folders and drives; they aren't moved by dragging.
  const startX = event.clientX, startY = event.clientY;
  let drag = null;
  const clearTarget = () => { document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target')); };
  const finish = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', cancelKey, true);
    if (!drag) return;
    clearTimeout(drag.tabTimer); clearTarget(); document.body.classList.remove('dragging'); state.dragging = null;
    document.querySelectorAll('.drag-source').forEach(x => x.classList.remove('drag-source'));
    state.suppressClick = true; setTimeout(() => { state.suppressClick = false; }, 0);
  };
  const move = point => {
    if (!drag) {
      if (Math.abs(point.clientX - startX) + Math.abs(point.clientY - startY) < 6) return;
      const model = pane(which);
      if (!model.selected.has(item.path)) { model.selected = new Set([item.path]); model.anchor = index; }
      state.focused = which;
      const files = [item.path, ...[...model.selected].filter(file => file !== item.path)];
      const ghost = createDragGhost(files, which, point.clientX, point.clientY);
      document.body.classList.add('dragging');
      drag = state.dragging = { files, which, ghost, target: null, tabTimer: null };
      paintSelection();
      document.querySelectorAll(`#${which}-content [data-path]`).forEach(x => { if (model.selected.has(x.dataset.path)) x.classList.add('drag-source'); });
    }
    if (point.clientX <= 0 || point.clientY <= 0 || point.clientX >= innerWidth - 1 || point.clientY >= innerHeight - 1) {
      // Leaving the window: hand the files to Windows so they can be dropped in Explorer, the desktop, or other apps.
      const files = drag.files; const image = drag.ghost.snapshot();
      const ghost = { symbols: document.querySelector('.symbols').outerHTML, html: drag.ghost.element.innerHTML };
      drag.ghost.remove(); finish(); state.outgoing = files;
      window.slate.startDrag(files, image, ghost).catch(error => toast(error.message)).finally(() => { setTimeout(() => { state.outgoing = null; refreshAll(); }, 400); });
      return;
    }
    drag.ghost.moveTo(point.clientX, point.clientY);
    const target = dropTargetAt(point.clientX, point.clientY);
    drag.ghost.setMode(target ? (dropMove(drag.files, target.path, point.ctrlKey, point.shiftKey) ? 'Move' : 'Copy') : '');
    if (target?.element !== drag.target?.element) {
      clearTarget(); clearTimeout(drag.tabTimer);
      if (target) target.element.classList.add('drop-target');
      if (target?.tabId && target.tabId !== state.active) drag.tabTimer = setTimeout(() => switchTab(target.tabId), 650);
    }
    drag.target = target;
  };
  const up = point => {
    const current = drag; const target = current && dropTargetAt(point.clientX, point.clientY);
    if (current) current.ghost.land(target ? target.element.getBoundingClientRect() : null, { x: startX, y: startY });
    finish();
    if (current && target) transferItems(current.files, target.path, dropMove(current.files, target.path, point.ctrlKey, point.shiftKey));
  };
  const cancelKey = key => { if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); if (drag) drag.ghost.land(null, { x: startX, y: startY }); finish(); } };
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('keydown', cancelKey, true);
}
function dropTargetAt(x, y) {
  const drag = state.dragging; const element = document.elementFromPoint(x, y);
  if (!drag || !element) return null;
  const item = element.closest('[data-path]');
  if (item && item.dataset.directory === '1' && !drag.files.some(file => samePath(file, item.dataset.path))) return { element: item, path: item.dataset.path };
  const tabButton = element.closest('.tab');
  if (tabButton) { const model = state.tabs.find(x => x.id === Number(tabButton.dataset.tabId)); return model?.path ? { element: tabButton, path: model.path, tabId: model.id } : null; }
  const sidebarRow = element.closest('.sidebar-row[data-drop-path]');
  if (sidebarRow) return { element: sidebarRow, path: sidebarRow.dataset.dropPath };
  const content = element.closest('.file-pane');
  if (content) { const which = content.dataset.pane; const folder = currentPath(which); return folder && !isHome(folder) ? { element: content, path: folder } : null; }
  return null;
}
function sameVolume(a, b) {
  const root = value => { const match = value.match(/^\\\\[^\\]+\\[^\\]+/); return (match ? match[0] : value.slice(0, 2)).toLowerCase(); };
  return root(a) === root(b);
}
function dropMove(files, destination, ctrl, shift) {
  if (!destination) return false;
  if (ctrl) return false;
  if (shift) return true;
  return files.every(file => sameVolume(file, destination));
}
async function transferItems(files, destination, move) {
  if (!destination || isHome(destination)) { toast('Drop onto a folder or drive.'); return; }
  try { reportResults(await window.slate.transfer(files, destination, move), move ? 'Moved' : 'Copied'); await refreshAll(); }
  catch (error) { toast(error.message); }
}
function clearSelection(which) {
  const model = pane(which); if (!model) return;
  model.selected.clear(); model.anchor = -1;
  document.querySelectorAll(`#${which}-content [data-path].selected`).forEach(x => x.classList.remove('selected'));
  renderStatus();
}
function bindContent(content, which) {
  content.ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; };
  content.ondrop = event => { event.preventDefault(); handleDrop(event, currentPath(which), which); };
  content.oncontextmenu = event => { if (event.target.closest('[data-path]')) return; event.preventDefault(); state.focused = which; showEmptyMenu(event.clientX, event.clientY, which); };
  content.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest('[data-path]')) return;
    state.focused = which;
    const model = pane(which); if (!event.ctrlKey) clearSelection(which);
    const rect = content.getBoundingClientRect(); const startX = event.clientX - rect.left + content.scrollLeft, startY = event.clientY - rect.top + content.scrollTop;
    // Place the selection box at the click point and keep it hidden until the mouse moves, so it never adds height and triggers a scrollbar.
    const overlay = document.createElement('div'); overlay.className = 'marquee'; overlay.hidden = true;
    overlay.style.left = `${startX}px`; overlay.style.top = `${startY}px`; content.append(overlay);
    const original = new Set(model.selected); let moved = false;
    const move = point => {
      const x = point.clientX - rect.left + content.scrollLeft, y = point.clientY - rect.top + content.scrollTop;
      if (Math.abs(x - startX) + Math.abs(y - startY) > 5) { moved = true; overlay.hidden = false; }
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
// Files dropped in from Windows Explorer are copied (hold Shift to move them).
async function handleDrop(event, destination) {
  const files = [...event.dataTransfer.files].map(file => window.slate.pathForFile(file)).filter(Boolean);
  if (!files.length || !destination) return;
  // Our own items dragged out of the window and back in keep the normal move/copy rules.
  const own = state.outgoing && files.every(file => state.outgoing.some(x => samePath(x, file)));
  await transferItems(files, destination, own ? dropMove(files, destination, event.ctrlKey, event.shiftKey) : event.shiftKey);
}
function renderStatus() {
  const model = pane(); if (!model) return;
  const total = model.items.length; const selected = model.selected.size; const bytes = model.items.filter(x => model.selected.has(x.path) && x.size != null).reduce((sum, x) => sum + x.size, 0);
  $('statusbar').innerHTML = `<span>${total} item${total === 1 ? '' : 's'}</span>${selected ? `<span>${selected} selected</span><span>${formatSize(bytes)}</span>` : ''}`;
  for (const id of ['cut', 'copy', 'rename', 'delete']) $(id).disabled = selected === 0 || ((id === 'rename') && selected !== 1);
  $('paste').disabled = !state.clipboard?.paths?.length;
}
// Repaint selection only, without rebuilding the file list (rebuilding reloads thumbnails, which is slow on network drives).
function paintSelection() {
  for (const which of ['primary', 'secondary']) {
    const model = pane(which); if (!model) continue;
    document.querySelectorAll(`#${which}-content [data-path]`).forEach(x => x.classList.toggle('selected', model.selected.has(x.dataset.path)));
  }
  document.querySelectorAll('.file-pane').forEach(x => x.classList.toggle('focused', x.dataset.pane === state.focused));
  breadcrumbs(currentPath());
  const model = pane(); $('back').disabled = model.at <= 0; $('forward').disabled = model.at >= model.history.length - 1;
  renderStatus();
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
  if (isHome(currentPath('primary')) || (state.split && isHome(currentPath('secondary')))) state.drives = await window.slate.drives();
  const tasks = [load('primary', currentPath('primary'), false)];
  if (state.split) tasks.push(load('secondary', currentPath('secondary'), false));
  await Promise.all(tasks);
}
let lastHistoryNav = 0;
function navigateHistory(direction) {
  // Mouse side buttons can arrive both as mouse events and as Windows app commands; act on the first one only.
  const now = Date.now(); if (now - lastHistoryNav < 350) return;
  lastHistoryNav = now; goHistory(direction);
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
    ...(isHome(pane(which)?.path) ? [] : [
      null,
      { icon: 'cut', label: 'Cut', run: () => cutCopy(true) },
      { icon: 'copy', label: 'Copy', run: () => cutCopy(false) },
      { icon: 'rename', label: 'Rename', run: renameSelected },
      { icon: 'trash', label: 'Move to Recycle Bin', run: () => deleteSelected(false) },
      { icon: 'trash', label: 'Delete permanently', run: () => deleteSelected(true) }
    ])
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
function newFolder() { if (!inFolder('create a folder')) return; modal('New folder', 'Create a folder in the current location.', 'New folder', 'Create', name => window.slate.mkdir(currentPath(), name)); }
function renameSelected() {
  if (isHome(currentPath())) return;
  const file = [...pane().selected][0]; if (!file || pane().selected.size !== 1) return;
  modal('Rename', 'Enter a new name for this item.', nameOf(file), 'Rename', name => window.slate.rename(file, name));
}
function confirmDialog(title, description, confirmLabel) {
  return new Promise(resolve => {
    $('modal-title').textContent = title; $('modal-description').textContent = description; $('modal-confirm').textContent = confirmLabel;
    $('modal-input').hidden = true; $('modal-backdrop').hidden = false; $('modal-confirm').focus();
    const done = accepted => { document.removeEventListener('keydown', onKey, true); $('modal-backdrop').hidden = true; $('modal-input').hidden = false; resolve(accepted); };
    const onKey = event => { if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); done(event.key === 'Enter'); } };
    document.addEventListener('keydown', onKey, true);
    $('modal-confirm').onclick = () => done(true); $('modal-cancel').onclick = () => done(false);
  });
}
function isNetworkPath(file) {
  if (file.startsWith('\\\\')) return true;
  return state.drives.some(drive => drive.network && drive.path.slice(0, 2).toLowerCase() === file.slice(0, 2).toLowerCase());
}
async function deleteSelected(permanent = false) {
  if (isHome(currentPath())) return;
  const model = pane(); const files = [...model.selected]; if (!files.length) return;
  try {
    let remaining = files; let trashed = [];
    if (!permanent && !files.some(isNetworkPath)) {
      trashed = await window.slate.trash(files);
      remaining = trashed.filter(x => !x.ok).map(x => x.file);
      trashed = trashed.filter(x => x.ok);
    }
    let removed = [];
    if (remaining.length) {
      const description = permanent
        ? `Permanently delete ${remaining.length === 1 ? `"${nameOf(remaining[0])}"` : `${remaining.length} items`}? This can't be undone.`
        : `${remaining.length === 1 ? `"${nameOf(remaining[0])}"` : `${remaining.length} items`} can't go to the Recycle Bin (shared and network folders don't have one). Delete permanently? This can't be undone.`;
      if (await confirmDialog('Delete permanently?', description, 'Delete')) removed = await window.slate.remove(remaining);
    }
    const results = [...trashed, ...removed];
    if (results.length) reportResults(results, removed.length ? 'Deleted' : 'Moved to Recycle Bin');
    model.selected.clear(); await refreshAll();
  } catch (error) { toast(error.message); }
}
function cutCopy(cut) { if (cut && isHome(currentPath())) return; const files = [...pane().selected]; if (!files.length) return; state.clipboard = { paths: files, cut }; toast(`${cut ? 'Cut' : 'Copied'} ${files.length} item(s).`); renderStatus(); }
async function paste() {
  if (!state.clipboard?.paths?.length || !inFolder('paste')) return;
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
  $('back').onclick = () => goHistory(-1); $('forward').onclick = () => goHistory(1);
  document.addEventListener('mousedown', event => { if (event.button === 3 || event.button === 4) event.preventDefault(); });
  document.addEventListener('mouseup', event => { if (event.button === 3 || event.button === 4) { event.preventDefault(); navigateHistory(event.button === 3 ? -1 : 1); } });
  window.slate.onNav(direction => navigateHistory(direction));
  for (const which of ['primary', 'secondary']) $(`${which}-heading`).onpointerdown = event => { if (event.button === 0 && !event.ctrlKey) { state.focused = which; clearSelection(which); } };
  $('statusbar').onpointerdown = event => { if (event.button === 0) clearSelection(state.focused); }; $('up').onclick = goUp; $('refresh').onclick = refreshAll;
  $('address-wrap').ondblclick = () => showAddress();
  $('address').onkeydown = event => { if (event.key === 'Enter') { const path = event.target.value.trim(); hideAddress(); if (path) load(state.focused, path); } if (event.key === 'Escape') hideAddress(); };
  $('address').onblur = hideAddress;
  $('search').oninput = render;
  $('new-folder').onclick = newFolder; $('cut').onclick = () => cutCopy(true); $('copy').onclick = () => cutCopy(false); $('paste').onclick = paste; $('rename').onclick = renameSelected; $('delete').onclick = () => deleteSelected(false);
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
    // Use the physical key (event.code) for letters and digits so shortcuts also work with Persian and other keyboard layouts.
    const code = event.code || '';
    const key = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit[0-9]$/.test(code) ? code.slice(5) : event.key.toLowerCase();
    const ctrl = event.ctrlKey; const shift = event.shiftKey;
    if (key === 'escape') { $('context-menu').hidden = true; if (!$('modal-backdrop').hidden) return; }
    if (!$('modal-backdrop').hidden || (event.target instanceof Element && event.target.matches('input, textarea, [contenteditable="true"]'))) return;
    if (ctrl && shift && key === 't') { event.preventDefault(); const folder = state.closed.pop(); if (folder) newTab(folder); return; }
    if (ctrl && shift && key === 'w') { event.preventDefault(); window.slate.window('close'); return; }
    if (ctrl && shift && key === 'k') { event.preventDefault(); newTab(currentPath('primary')); return; }
    if (ctrl && shift && key === 'n') { event.preventDefault(); newFolder(); return; }
    if (ctrl && key === 't') { event.preventDefault(); newTab(); return; }
    if (ctrl && key === 'w') { event.preventDefault(); closeTab(); return; }
    if (ctrl && key === 'tab') { event.preventDefault(); cycleTab(shift ? -1 : 1); return; }
    if (ctrl && /^[1-9]$/.test(key)) { event.preventDefault(); switchTab(state.tabs[Number(key) - 1]?.id); return; }
    if (ctrl && key === 'a') { event.preventDefault(); pane().selected = new Set(visibleItems(state.focused).map(x => x.path)); paintSelection(); return; }
    if (ctrl && key === 'c') { event.preventDefault(); cutCopy(false); return; }
    if (ctrl && key === 'x') { event.preventDefault(); cutCopy(true); return; }
    if (ctrl && key === 'v') { event.preventDefault(); paste(); return; }
    if (ctrl && key === 'l') { event.preventDefault(); showAddress(); return; }
    if (ctrl && key === 'r') { event.preventDefault(); refreshAll(); return; }
    if (key === 'f2') { event.preventDefault(); renameSelected(); return; }
    if (key === 'delete') { event.preventDefault(); deleteSelected(shift); return; }
    if (event.altKey && (key === 'arrowleft' || key === 'arrowright')) { event.preventDefault(); goHistory(key === 'arrowleft' ? -1 : 1); return; }
    if (key === 'enter' && pane().selected.size === 1) { const item = pane().items.find(x => pane().selected.has(x.path)); if (item) item.directory ? load(state.focused, item.path) : window.slate.open(item.path); return; }
    if (key === 'backspace' || (event.altKey && key === 'arrowup')) { event.preventDefault(); goUp(); }
  });
}

async function start() {
  bindControls();
  if (localStorage.getItem('glass') === '1') document.body.classList.add('glass');
  state.home = await window.slate.home();
  state.drives = await window.slate.drives();
  const documents = state.home.folders.find(x => x.name === 'Documents')?.path || state.home.root;
  newTab(HOME, true);
  newTab(documents, true);
}
start().catch(error => toast(error.message));
