import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function page({ config, uploadStatus = 200 } = {}) {
  const html = await readFile(new URL('../public/cash-upload.html', import.meta.url), 'utf8');
  const elements = new Map();
  function element(id = '') {
    const classes = new Set(id === 'app' || id === 'invalid' || id === 'branch-choice' ? ['hidden'] : []);
    return { id, value: '', textContent: '', files: [], disabled: false, children: [], listeners: {},
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; }
    };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element(match[1]));
  const calls = [], timers = [];
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement: () => element() },
    location: { hash: '#token=' + 's'.repeat(43) }, URLSearchParams,
    setTimeout: fn => { timers.push(fn); },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const status = url.endsWith('upload') ? uploadStatus : 200;
      const data = url.endsWith('config') ? config : url.endsWith('retry') ? { recognized: 1 } : {
        ok: true, saved: true, photoId: 'PHOTO-TEST', message: 'Фото сохранено'
      };
      return { ok: status < 400, status, json: async () => data };
    }
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await new Promise(setImmediate);
  return { elements, calls, timers };
}
const sharedConfig = { ok: true, branches: [
  { branch: 'Ямская', label: 'Ямская' }, { branch: 'Герцена', label: 'Герцена' }
], year: 2026, maxBytes: 4194304 };

test('shared mobile page requires branch selection before sending a photo', async () => {
  const { elements, calls } = await page({ config: sharedConfig });
  assert.ok(elements.has('branch-select'), 'shared entry needs a branch selector');
  assert.equal(elements.get('branch-choice').classList.contains('hidden'), false);
  assert.deepEqual(elements.get('branch-select').children.filter(item => item.value).map(item => item.value), ['Ямская', 'Герцена']);
  elements.get('photo').files = [{ size: 10, type: 'image/png', name: 'test.png' }];
  await elements.get('send').listeners.click();
  assert.equal(calls.filter(call => call.url.endsWith('upload')).length, 0);
  assert.match(elements.get('status').textContent, /филиал/i);
});

test('upload and delayed recognition use the branch selected at submission', async () => {
  const { elements, calls, timers } = await page({ config: sharedConfig, uploadStatus: 202 });
  assert.ok(elements.has('branch-select'), 'shared entry needs a branch selector');
  elements.get('branch-select').value = 'Ямская';
  elements.get('photo').files = [{ size: 10, type: 'image/png', name: 'test.png' }];
  await elements.get('send').listeners.click();
  const upload = calls.find(call => call.url.endsWith('upload'));
  assert.equal(decodeURIComponent(upload.options.headers['x-cash-branch']), 'Ямская');
  assert.equal(upload.options.headers['x-cash-photo-token'], 's'.repeat(43));
  elements.get('branch-select').value = 'Герцена';
  const previousMessage = elements.get('status').textContent;
  for (const callback of [...timers]) await callback();
  const retry = calls.find(call => call.url.endsWith('retry'));
  assert.equal(decodeURIComponent(retry.options.headers['x-cash-branch']), 'Ямская');
  assert.equal(retry.options.headers['x-cash-photo-id'], 'PHOTO-TEST');
  assert.equal(elements.get('status').textContent, previousMessage, 'old branch retry must not replace the current branch status');
});

test('existing branch entry still shows its fixed branch', async () => {
  const { elements } = await page({ config: { ok: true, branch: 'Ямская', label: 'Ямская', year: 2026, maxBytes: 4194304 } });
  assert.equal(elements.get('app').classList.contains('hidden'), false);
  assert.equal(elements.get('branch').textContent, 'Ямская');
});
