import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageUrl = new URL('../public/cash-upload.html', import.meta.url);

test('mobile upload page keeps token in URL hash, compresses large photos and uses Vercel APIs', async () => {
  const html = await readFile(pageUrl, 'utf8');
  assert.match(html, /location\.hash/);
  assert.match(html, /\/api\/health\?cashPhotoRoute=config/);
  assert.match(html, /\/api\/health\?cashPhotoRoute=upload/);
  assert.match(html, /cashPhotoRoute=retry/);
  assert.match(html, /x-cash-photo-token/);
  assert.match(html, /canvas/i);
  assert.match(html, /202/);
  assert.doesNotMatch(html, /error\.message/);
});
