const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme, net, protocol } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { uniqueDestination, transfer } = require('./file-ops');

const execFileAsync = promisify(execFile);
let window;
const diagnostic = message => { if (process.env.SLATE_DIAGNOSTIC) fs.appendFileSync(process.env.SLATE_DIAGNOSTIC, `${new Date().toISOString()} ${message}\n`); };
diagnostic('main started');
app.setName('Files');
app.setPath('userData', process.env.SLATE_USER_DATA || path.join(app.getPath('appData'), 'Files Independent'));
if (process.platform === 'win32') app.commandLine.appendSwitch('disable-gpu-sandbox');
if (process.env.SLATE_USER_DATA) {
  fs.mkdirSync(process.env.SLATE_USER_DATA, { recursive: true });
  app.setPath('sessionData', process.env.SLATE_USER_DATA);
}
process.on('uncaughtException', error => diagnostic(`uncaught: ${error.stack}`));
process.on('unhandledRejection', error => diagnostic(`rejection: ${error && error.stack || error}`));

protocol.registerSchemesAsPrivileged([{ scheme: 'slate-thumb', privileges: { secure: true, standard: true, supportFetchAPI: true } }]);

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function itemKind(name, directory) {
  if (directory) return 'folder';
  const extension = path.extname(name).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'].includes(extension)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(extension)) return 'video';
  if (['.mp3', '.wav', '.flac', '.aac'].includes(extension)) return 'audio';
  if (['.zip', '.7z', '.rar', '.tar', '.gz'].includes(extension)) return 'archive';
  if (['.pdf'].includes(extension)) return 'pdf';
  if (['.doc', '.docx', '.odt'].includes(extension)) return 'word';
  if (['.xls', '.xlsx', '.csv'].includes(extension)) return 'sheet';
  if (['.ppt', '.pptx'].includes(extension)) return 'slide';
  if (['.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.cs', '.py', '.md', '.xml', '.yml', '.yaml'].includes(extension)) return 'code';
  return 'file';
}

async function listDirectory(folder) {
  const resolved = path.resolve(folder || os.homedir());
  const folderStat = await fsp.stat(resolved);
  if (!folderStat.isDirectory()) throw new Error('This path is not a folder.');
  const dirents = await fsp.readdir(resolved, { withFileTypes: true });
  const items = await Promise.all(dirents.map(async (entry) => {
    const fullPath = path.join(resolved, entry.name);
    try {
      const stat = await fsp.stat(fullPath);
      const directory = stat.isDirectory();
      return { name: entry.name, path: fullPath, directory, kind: itemKind(entry.name, directory), size: directory ? null : stat.size, modified: stat.mtimeMs };
    } catch {
      return { name: entry.name, path: fullPath, directory: entry.isDirectory(), kind: itemKind(entry.name, entry.isDirectory()), size: null, modified: 0 };
    }
  }));
  items.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { path: resolved, items };
}

async function drives() {
  if (process.platform !== 'win32') return [{ name: 'Home', path: os.homedir() }];
  try {
    const script = 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 });
    const parsed = JSON.parse(stdout);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(x => x && x.DeviceID).map(x => ({
      name: x.VolumeName || (x.DriveType === 4 ? 'Network drive' : x.DeviceID === 'C:' ? 'Windows' : 'Local drive'),
      path: `${x.DeviceID}\\`, network: x.DriveType === 4
    }));
  } catch {
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(letter => fs.existsSync(`${letter}:\\`)).map(letter => ({ name: letter === 'C' ? 'Windows' : 'Drive', path: `${letter}:\\` }));
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1400, height: 900, minWidth: 880, minHeight: 580,
    backgroundColor: '#252525', show: false, frame: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  if (process.env.SLATE_DIAGNOSTIC) {
    const log = message => fs.appendFileSync(process.env.SLATE_DIAGNOSTIC, `${new Date().toISOString()} ${message}\n`);
    window.webContents.on('console-message', (_event, details) => log(`console: ${JSON.stringify(details)}`));
    window.webContents.on('did-fail-load', (_event, code, desc) => log(`load failed: ${code} ${desc}`));
    window.webContents.on('render-process-gone', (_event, details) => log(`renderer gone: ${JSON.stringify(details)}`));
    window.on('closed', () => log('window closed'));
  }
  // Mouse back/forward buttons on Windows can arrive as app commands; the renderer de-duplicates them.
  window.on('app-command', (_event, command) => {
    if (command === 'browser-backward') window.webContents.send('nav', -1);
    if (command === 'browser-forward') window.webContents.send('nav', 1);
  });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.webContents.once('did-finish-load', async () => {
    window.show();
    if (process.env.SLATE_CAPTURE) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      const shot = await window.webContents.capturePage();
      await fsp.writeFile(process.env.SLATE_CAPTURE, shot.toPNG());
      if (process.env.SLATE_CAPTURE_EXIT === '1') app.quit();
    }
  });
}

app.whenReady().then(() => {
  diagnostic('app ready');
  nativeTheme.themeSource = 'dark';
  // The default menu's Edit accelerators (Ctrl+A/C/X/V) compete with the app's own shortcuts.
  Menu.setApplicationMenu(null);
  protocol.handle('slate-thumb', request => {
    try {
      const file = decodeURIComponent(new URL(request.url).pathname.slice(1));
      if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'].includes(path.extname(file).toLowerCase())) return new Response('', { status: 403 });
      return net.fetch(require('node:url').pathToFileURL(file).toString());
    } catch { return new Response('', { status: 404 }); }
  });
  createWindow();
  diagnostic('window created');
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('home', () => {
  const root = process.env.SLATE_TEST_HOME || os.homedir();
  const folders = ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Videos'].map(name => ({ name, path: path.join(root, name) })).filter(x => fs.existsSync(x.path));
  return { root, folders };
});
ipcMain.handle('drives', drives);
ipcMain.handle('list', (_, folder) => listDirectory(folder));
ipcMain.handle('open', async (_, file) => shell.openPath(file));
ipcMain.handle('transfer', (_, paths, destination, move) => transfer(paths, destination, move));
ipcMain.handle('mkdir', async (_, parent, name) => {
  const clean = String(name || '').trim();
  if (!clean || /[<>:"/\\|?*]/.test(clean)) throw new Error('Enter a valid folder name.');
  const target = await uniqueDestination(parent, clean);
  await fsp.mkdir(target);
  return target;
});
ipcMain.handle('rename', async (_, source, name) => {
  const clean = String(name || '').trim();
  if (!clean || /[<>:"/\\|?*]/.test(clean)) throw new Error('Enter a valid file name.');
  const target = path.join(path.dirname(source), clean);
  if (fs.existsSync(target)) throw new Error('That name already exists.');
  await fsp.rename(source, target);
  return target;
});
ipcMain.handle('trash', async (_, paths) => {
  const results = [];
  for (const file of paths) {
    try { await shell.trashItem(file); results.push({ file, ok: true }); }
    catch (error) { results.push({ file, ok: false, error: errorMessage(error) }); }
  }
  return results;
});
ipcMain.handle('remove', async (_, paths) => {
  const results = [];
  for (const file of paths) {
    try { await fsp.rm(file, { recursive: true, force: false, maxRetries: 2 }); results.push({ file, ok: true }); }
    catch (error) { results.push({ file, ok: false, error: errorMessage(error) }); }
  }
  return results;
});
ipcMain.handle('window', (_, action) => {
  if (!window) return;
  if (action === 'minimize') window.minimize();
  if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
  if (action === 'close') window.close();
});
