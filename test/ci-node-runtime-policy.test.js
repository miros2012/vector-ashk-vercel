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

test('all Node-based GitHub Actions workflows use Node 24 and Node-24-native action majors', () => {
  for (const name of ['test.yml', 'hourly-project-continuation.yml']) {
    const source = workflow(name);
    assert.match(source, /uses:\s*actions\/checkout@v7\b/, `${name} must use checkout v7`);
    assert.match(source, /uses:\s*actions\/setup-node@v7\b/, `${name} must use setup-node v7`);
    assert.match(source, /node-version:\s*24\b/, `${name} must use Node 24`);
    assert.doesNotMatch(source, /actions\/(?:checkout|setup-node)@v4\b/, `${name} must not use Node-20-runtime action majors`);
    assert.doesNotMatch(source, /node-version:\s*20\b/, `${name} must not stay on Node 20`);
  }
});

test('hourly continuation keeps checkout credentials disabled after action upgrades', () => {
  const source = workflow('hourly-project-continuation.yml');
  assert.match(source, /persist-credentials:\s*false\b/);
});
