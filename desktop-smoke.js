const fs = require('node:fs');
const assert = require('node:assert/strict');

async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
  const target = targets.find(x => x.type === 'page' && x.title === 'Files');
  assert.ok(target, 'Files window is open');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  };
  return {
    async call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    },
    close() { socket.close(); }
  };
}

async function main() {
  const client = await connect();
  async function evaluate(expression) {
    const result = await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function shortcut(key, ctrl = true, shift = false) {
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},ctrlKey:${ctrl},shiftKey:${shift},bubbles:true,cancelable:true})); true`);
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  try {
    let result = await evaluate(`({tabs:document.querySelectorAll('.tab').length, title:document.querySelector('.tab.active .tab-title').textContent, cards:document.querySelectorAll('.file-card').length})`);
    assert.deepEqual(result, { tabs: 2, title: 'Documents', cards: 4 });
    await shortcut('t');
    result = await evaluate(`({tabs:document.querySelectorAll('.tab').length,title:document.querySelector('.tab.active .tab-title').textContent})`);
    assert.deepEqual(result, { tabs: 3, title: 'Home' });
    await shortcut('k', true, true);
    assert.equal(await evaluate(`document.querySelectorAll('.tab').length`), 4);
    await shortcut('2');
    assert.equal(await evaluate(`document.querySelector('.tab.active .tab-title').textContent`), 'Documents');
    await shortcut('a');
    assert.equal(await evaluate(`document.querySelectorAll('.file-card.selected').length`), 4);
    await shortcut('w');
    assert.equal(await evaluate(`document.querySelectorAll('.tab').length`), 3);
    await shortcut('t', true, true);
    assert.equal(await evaluate(`document.querySelectorAll('.tab').length`), 4);
    await shortcut('Tab');
    const cycled = await evaluate(`document.querySelector('.tab.active .tab-title').textContent`);
    await shortcut('Tab', true, true);
    assert.equal(await evaluate(`document.querySelector('.tab.active .tab-title').textContent`), 'Documents');
    assert.equal(typeof cycled, 'string');
    await evaluate(`document.getElementById('split').click(); true`);
    assert.equal(await evaluate(`document.getElementById('secondary-pane').hidden`), false);
    await evaluate(`document.getElementById('appearance').click(); true`);
    assert.equal(await evaluate(`document.body.classList.contains('glass')`), true);
    await evaluate(`document.getElementById('appearance').click(); true`);
    await evaluate(`document.getElementById('split').click(); true`);
    await evaluate(`(() => { const card=[...document.querySelectorAll('.file-card')].find(x=>x.querySelector('.file-name').textContent==='Budget.csv'); card.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; })()`);
    await evaluate(`(() => { const card=[...document.querySelectorAll('.file-card')].find(x=>x.querySelector('.file-name').textContent==='Project notes.txt'); card.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true})); return true; })()`);
    assert.equal(await evaluate(`document.querySelectorAll('.file-card.selected').length`), 2);
    await evaluate(`(() => { const transfer=new DataTransfer(); const source=[...document.querySelectorAll('.file-card')].find(x=>x.querySelector('.file-name').textContent==='Budget.csv'); source.dispatchEvent(new DragEvent('dragstart',{dataTransfer:transfer,bubbles:true,cancelable:true})); const target=[...document.querySelectorAll('.file-card')].find(x=>x.querySelector('.file-name').textContent==='Archives'); target.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,ctrlKey:true,bubbles:true,cancelable:true})); return transfer.getData('application/x-slate-files'); })()`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const documents = 'C:\\Users\\Public\\Documents\\SlateFilesValidation\\sample-home\\Documents';
    assert.equal(fs.existsSync(require('node:path').join(documents, 'Archives', 'Budget.csv')), true);
    assert.equal(fs.existsSync(require('node:path').join(documents, 'Archives', 'Project notes.txt')), true);
    const screenshot = await client.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.FILES_SMOKE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    console.log('Desktop smoke test passed: tabs, restore, shortcuts, select all, multi-file drag and drop, split pane, appearance.');
  } finally { client.close(); }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
