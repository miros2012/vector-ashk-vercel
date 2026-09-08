import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGoogleapisCommonDiscoveryCallSite } from '../lib/legacy-url-parse-runtime-trace.js';

const match = Object.freeze({
  packageName: 'googleapis-common',
  packageVersion: '8.0.3',
  path: 'node_modules/googleapis-common/build/src/discovery.js',
  line: 111,
  excerpt: 'resolve.parse(apiDiscoveryUrl)'
});

test('DEP0169 discovery selector treats an absent legacy call-site as remediated', () => {
  const selected = selectGoogleapisCommonDiscoveryCallSite({ matches: [] });
  assert.equal(selected, null);
});

test('DEP0169 discovery selector preserves the single historical call-site when present', () => {
  const selected = selectGoogleapisCommonDiscoveryCallSite({ matches: [match] });
  assert.equal(selected, match);
});

test('DEP0169 discovery selector fails closed on ambiguous duplicate discovery call-sites', () => {
  assert.throws(
    () => selectGoogleapisCommonDiscoveryCallSite({ matches: [match, { ...match, line: 112 }] }),
    /expected at most one googleapis-common discovery url\.parse call-site, found 2/
  );
});
