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

function workflowJobBlock(workflow, jobName) {
  const jobsStart = workflow.indexOf('\njobs:\n');
  assert.notEqual(jobsStart, -1, 'workflow jobs block must exist');
  const jobs = workflow.slice(jobsStart + 1);
  const marker = `  ${jobName}:\n`;
  const start = jobs.indexOf(marker);
  assert.notEqual(start, -1, `${jobName} job must exist`);
  const afterStart = start + marker.length;
  const nextJob = jobs.slice(afterStart).search(/^  [A-Za-z0-9_-]+:\s*$/m);
  const end = nextJob === -1 ? jobs.length : afterStart + nextJob;
  return jobs.slice(start, end);
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

test('manual workflow_dispatch requests a dedicated Owner smoke OIDC audience and never exposes owner secrets', () => {
  const workflow = read('.github/workflows/hourly-project-continuation.yml');
  assert.match(workflow, /owner-package-smoke/);
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.match(
    workflow,
    /requestUrl\.searchParams\.set\(['"]audience['"],\s*['"]vector-owner-package-smoke-v1['"]\)/
  );
  assert.match(workflow, /OWNER_PACKAGE_SMOKE_ENDPOINT:\s*https:\/\/vector-ashk-backend\.vercel\.app\/api\/health/);
  assert.match(workflow, /x-vercel-trusted-oidc-idp-token/);
  assert.match(workflow, /owner_package_smoke/);
  assert.match(workflow, /inputs\.action\s*!=\s*['"]owner-package-smoke['"]/);
  assert.doesNotMatch(workflow, /\/api\/owner-package/);
  assert.doesNotMatch(workflow, /VECTOR_SYNC_KEY|TOCHKA_BRIDGE_KEY|VECTOR_OWNER_API_KEY/);
});

// Issue #148 TDD contract: the smoke must not inherit repository write permissions.
test('Owner package smoke runs in a dedicated least-privilege job', () => {
  const workflow = read('.github/workflows/hourly-project-continuation.yml');
  const preJobs = workflow.slice(0, workflow.indexOf('\njobs:\n'));
  const continuation = workflowJobBlock(workflow, 'continue-project');
  const ownerSmoke = workflowJobBlock(workflow, 'owner-package-smoke');

  assert.doesNotMatch(preJobs, /\b(contents|issues|pull-requests|statuses):\s*write\b/);

  assert.match(continuation, /contents:\s*write/);
  assert.match(continuation, /issues:\s*write/);
  assert.match(continuation, /pull-requests:\s*write/);
  assert.match(continuation, /statuses:\s*write/);
  assert.match(continuation, /id-token:\s*write/);
  assert.match(continuation, /inputs\.action\s*!=\s*['"]owner-package-smoke['"]/);
  assert.doesNotMatch(continuation, /Verify production owner package/);
  assert.doesNotMatch(continuation, /vector-owner-package-smoke-v1/);
  assert.doesNotMatch(continuation, /OWNER_PACKAGE_SMOKE_ENDPOINT/);

  assert.match(ownerSmoke, /github\.actor_id\s*==\s*46207692/);
  assert.match(ownerSmoke, /github\.event_name\s*==\s*['"]workflow_dispatch['"]/);
  assert.match(ownerSmoke, /inputs\.action\s*==\s*['"]owner-package-smoke['"]/);
  assert.match(ownerSmoke, /contents:\s*read/);
  assert.match(ownerSmoke, /id-token:\s*write/);
  assert.doesNotMatch(ownerSmoke, /\bcontents:\s*write\b/);
  assert.doesNotMatch(ownerSmoke, /\bissues:\s*write\b/);
  assert.doesNotMatch(ownerSmoke, /\bpull-requests:\s*write\b/);
  assert.doesNotMatch(ownerSmoke, /\bstatuses:\s*write\b/);
  assert.match(ownerSmoke, /vector-owner-package-smoke-v1/);
  assert.match(ownerSmoke, /OWNER_PACKAGE_SMOKE_ENDPOINT/);
  assert.doesNotMatch(ownerSmoke, /GITHUB_TOKEN|VECTOR_SYNC_KEY|TOCHKA_BRIDGE_KEY|VECTOR_OWNER_API_KEY/);
});
