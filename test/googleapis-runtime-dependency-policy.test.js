import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { google } from 'googleapis';

function installedVersions(tree, dependencyName, versions = []) {
  if (!tree || typeof tree !== 'object') return versions;
  const dependency = tree.dependencies?.[dependencyName];
  if (dependency?.version) versions.push(String(dependency.version));
  for (const child of Object.values(tree.dependencies || {})) {
    installedVersions(child, dependencyName, versions);
  }
  return versions;
}

test('Google API runtime preserves the JWT and Sheets client surfaces used by production', () => {
  assert.equal(typeof google.auth?.JWT, 'function');
  assert.equal(typeof google.sheets, 'function');
});

test('installed runtime dependency tree has no unsupported uuid major 10 or below', () => {
  const output = execFileSync('npm', ['ls', 'uuid', '--json', '--all'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const tree = JSON.parse(output);
  const versions = installedVersions(tree, 'uuid');
  const unsupported = versions.filter(version => {
    const major = Number(version.split('.')[0]);
    return Number.isFinite(major) && major <= 10;
  });
  assert.deepEqual(unsupported, [], `unsupported uuid versions found: ${unsupported.join(', ')}`);
});
