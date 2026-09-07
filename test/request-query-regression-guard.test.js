import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLegacyRequestQueryAccesses } from '../lib/request-query-regression-guard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function findings(source) {
  return findLegacyRequestQueryAccesses(source).map(({ kind }) => kind);
}

test('detects direct Vercel request query access forms that can trigger the legacy lazy parser', () => {
  assert.deepEqual(findings('const value = req.query.ownerRoute;'), ['member']);
  assert.deepEqual(findings('const value = req?.query?.ownerRoute;'), ['member']);
  assert.deepEqual(findings("const value = req['query'].ownerRoute;"), ['bracket']);
  assert.deepEqual(findings("const value = request?.['query']?.token;"), ['bracket']);
  assert.deepEqual(findings('const { query } = req;'), ['destructure']);
});

test('does not flag the dedicated WHATWG helper or unrelated query data', () => {
  assert.deepEqual(findings("const ownerRoute = firstRequestQueryValue(req, 'ownerRoute');"), []);
  assert.deepEqual(findings('const query = new URL(url).searchParams;'), []);
  assert.deepEqual(findings('const result = database.query(statement);'), []);
});

test('all production API entrypoints avoid direct req.query/request.query access', () => {
  const apiDir = path.join(root, 'api');
  const violations = [];

  for (const name of fs.readdirSync(apiDir).filter(name => name.endsWith('.js')).sort()) {
    const source = fs.readFileSync(path.join(apiDir, name), 'utf8');
    for (const finding of findLegacyRequestQueryAccesses(source)) {
      violations.push(`${name}:${finding.line}:${finding.column}:${finding.kind}`);
    }
  }

  assert.deepEqual(violations, []);
});
