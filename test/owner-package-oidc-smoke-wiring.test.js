import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('existing health endpoint dispatches the OIDC owner package smoke without a new serverless function or cron', () => {
  const source = read('api/health.js');
  assert.match(source, /createOwnerPackageOidcSmokeService/);
  assert.match(source, /owner_package_smoke/);
  assert.match(source, /verifyGitHubActionsOidcToken/);

  const config = JSON.parse(read('vercel.json'));
  assert.ok(!Object.keys(config.functions || {}).some((name) => /owner.*smoke|smoke.*owner/i.test(name)));
  assert.ok(!config.crons.some((cron) => /owner.*smoke|smoke.*owner/i.test(String(cron.path || ''))));
});

test('manual workflow_dispatch can run owner package smoke through health with GitHub OIDC only', () => {
  const workflow = read('.github/workflows/hourly-project-continuation.yml');
  assert.match(workflow, /owner-package-smoke/);
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.match(workflow, /vector-hourly-agent-v1/);
  assert.match(workflow, /OWNER_PACKAGE_SMOKE_ENDPOINT:\s*https:\/\/vector-ashk-backend\.vercel\.app\/api\/health/);
  assert.match(workflow, /x-vercel-trusted-oidc-idp-token/);
  assert.match(workflow, /owner_package_smoke/);
  assert.match(workflow, /inputs\.action\s*!=\s*['"]owner-package-smoke['"]/);
  assert.doesNotMatch(workflow, /\/api\/owner-package/);
  assert.doesNotMatch(workflow, /VECTOR_SYNC_KEY|TOCHKA_BRIDGE_KEY|VECTOR_OWNER_API_KEY/);
});
