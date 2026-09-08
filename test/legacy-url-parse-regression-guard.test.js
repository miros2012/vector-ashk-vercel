import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  detectLegacyNodeUrlParse,
  scanLegacyNodeUrlParse
} from '../lib/legacy-url-parse-regression-guard.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

test('legacy Node URL parser detector catches direct, named-import, namespace and require aliases', () => {
  const legacySources = [
    "import { parse } from 'node:url';\nparse(value);",
    "import { parse as parseUrl } from 'url';\nparseUrl(value);",
    "import * as url from 'node:url';\nurl.parse(value);",
    "import nodeUrl from 'url';\nnodeUrl.parse(value);",
    "const nodeUrl = require('node:url');\nnodeUrl.parse(value);",
    "const { parse: parseUrl } = require('url');\nparseUrl(value);",
    "require('node:url').parse(value);",
    "(await import('node:url')).parse(value);"
  ];

  for (const source of legacySources) {
    assert.equal(detectLegacyNodeUrlParse(source), true, source);
  }
});

test('legacy Node URL parser detector allows WHATWG URL and non-parse node:url utilities', () => {
  const allowedSources = [
    "const parsed = new URL(value, 'https://example.test');",
    "const parsed = URL.parse(value, 'https://example.test');",
    "import { fileURLToPath } from 'node:url';\nfileURLToPath(import.meta.url);",
    "import * as nodeUrl from 'node:url';\nnodeUrl.fileURLToPath(import.meta.url);",
    "const parser = { parse() {} };\nparser.parse(value);"
  ];

  for (const source of allowedSources) {
    assert.equal(detectLegacyNodeUrlParse(source), false, source);
  }
});

test('runtime api and lib sources contain no legacy Node url.parse usage', async () => {
  const violations = await scanLegacyNodeUrlParse({ rootDir: REPOSITORY_ROOT });
  assert.deepEqual(violations, []);
});
