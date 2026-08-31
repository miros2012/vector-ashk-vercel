import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'api', 'balances.js'), 'utf8');

test('balance mirror status reads unformatted numeric values from ru_RU Google Sheets', () => {
  assert.match(
    source,
    /spreadsheets\.values\.get\([\s\S]*?valueRenderOption:\s*['\"]UNFORMATTED_VALUE['\"]/,
    'readMirrorStatus must request UNFORMATTED_VALUE so comma-formatted RUB values do not break liveCount/cache'
  );
});
