const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

async function uniqueDestination(parent, name) {
  const extension = path.extname(name);
  const base = name.slice(0, name.length - extension.length);
  let destination = path.join(parent, name);
  for (let i = 2; fs.existsSync(destination); i++) destination = path.join(parent, `${base} (${i})${extension}`);
  return destination;
}

async function transfer(paths, destinationFolder, move) {
  const destination = path.resolve(destinationFolder);
  if (!(await fsp.stat(destination)).isDirectory()) throw new Error('Drop target is not a folder.');
  const results = [];
  for (const sourcePath of paths) {
    try {
      const source = path.resolve(sourcePath);
      const stat = await fsp.stat(source);
      const relative = path.relative(source, destination);
      if (source.toLowerCase() === destination.toLowerCase() || (stat.isDirectory() && relative && !relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('A folder cannot be placed inside itself.');
      if (move && path.dirname(source).toLowerCase() === destination.toLowerCase()) {
        results.push({ source, destination: source, ok: true, skipped: true });
        continue;
      }
      const target = await uniqueDestination(destination, path.basename(source));
      if (move) {
        try { await fsp.rename(source, target); }
        catch (error) {
          if (error.code !== 'EXDEV') throw error;
          await fsp.cp(source, target, { recursive: true, errorOnExist: true, force: false });
          await fsp.rm(source, { recursive: true });
        }
      } else {
        await fsp.cp(source, target, { recursive: true, errorOnExist: true, force: false });
      }
      results.push({ source, destination: target, ok: true });
    } catch (error) { results.push({ source: sourcePath, ok: false, error: error && error.message ? error.message : String(error) }); }
  }
  return results;
}

module.exports = { uniqueDestination, transfer };
