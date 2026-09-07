import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

test('package.json pins the production Node runtime to the approved Node 24 major', () => {
  assert.equal(packageJson.engines?.node, '24.x');
});
