import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectInstalledDependenciesForLegacyUrlParse } from '../lib/legacy-url-parse-dependency-inspector.js';

test('installed dependency inspector reports concrete legacy Node url.parse call-sites', async () => {
  const report = await inspectInstalledDependenciesForLegacyUrlParse({ rootDir: process.cwd() });
  assert.equal(report.nodeModulesPresent, true);
  assert.ok(Array.isArray(report.matches));
  assert.ok(report.matches.every(match => (
    typeof match.packageName === 'string'
    && typeof match.packageVersion === 'string'
    && typeof match.path === 'string'
    && Number.isInteger(match.line)
    && typeof match.excerpt === 'string'
  )));
  console.log(`DEP0169_STATIC_DEPENDENCY_REPORT=${JSON.stringify(report)}`);
});
