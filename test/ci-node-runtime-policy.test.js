import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function workflow(name) {
  return fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8');
}

test('all Node-based GitHub Actions workflows use the same Node 24 major as production', () => {
  for (const name of ['test.yml', 'hourly-project-continuation.yml']) {
    const source = workflow(name);
    assert.match(source, /uses:\s*actions\/setup-node@v4/);
    assert.match(source, /node-version:\s*24\b/, `${name} must use Node 24`);
    assert.doesNotMatch(source, /node-version:\s*20\b/, `${name} must not stay on Node 20`);
  }
});
