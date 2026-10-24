const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { transfer } = require('../file-ops');

test('copy, unique names, move, and guard against copying a folder into itself', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'slate-files-test-'));
  try {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    await fsp.mkdir(source); await fsp.mkdir(destination);
    await fsp.writeFile(path.join(source, 'note.txt'), 'hello');
    const first = await transfer([path.join(source, 'note.txt')], destination, false);
    assert.equal(first[0].ok, true);
    assert.equal(await fsp.readFile(path.join(destination, 'note.txt'), 'utf8'), 'hello');
    const second = await transfer([path.join(source, 'note.txt')], destination, false);
    assert.equal(second[0].ok, true);
    assert.equal(await fsp.readFile(path.join(destination, 'note (2).txt'), 'utf8'), 'hello');
    const moved = await transfer([path.join(source, 'note.txt')], destination, true);
    assert.equal(moved[0].ok, true);
    assert.equal(fs.existsSync(path.join(source, 'note.txt')), false);
    assert.equal(fs.existsSync(path.join(destination, 'note (3).txt')), true);
    const skipped = await transfer([path.join(destination, 'note.txt')], destination, true);
    assert.equal(skipped[0].skipped, true);
    const child = path.join(source, 'child'); await fsp.mkdir(child);
    const refused = await transfer([source], child, false);
    assert.equal(refused[0].ok, false);
    assert.equal(fs.existsSync(path.join(child, 'source')), false);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});
