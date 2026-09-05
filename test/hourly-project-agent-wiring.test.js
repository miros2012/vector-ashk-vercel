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

test('existing health function dispatches authenticated hourly agent modes without a new API route', () => {
  const source = read('api/health.js');
  assert.match(source, /getVercelOidcToken/);
  assert.match(source, /verifyGitHubActionsOidcToken/);
  assert.match(source, /createHourlyProjectAgentService/);
  assert.match(source, /hourly_agent_probe/);
  assert.match(source, /hourly_agent_patch/);

  const config = JSON.parse(read('vercel.json'));
  assert.ok(!Object.keys(config.functions || {}).some((name) => name.includes('hourly')));
  assert.ok(!config.crons.some((cron) => String(cron.path || '').includes('hourly')));
});

test('hourly continuation workflow runs the guarded runner on schedule without persisted checkout credentials', () => {
  const workflow = read('.github/workflows/hourly-project-continuation.yml');
  assert.match(workflow, /cron:\s*['"]23 \* \* \* \*['"]/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /pull-requests:\s*write/);
  assert.match(workflow, /statuses:\s*write/);
  assert.match(workflow, /node scripts\/hourly-project-agent\.mjs/);
  assert.match(workflow, /ref:\s*main/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.doesNotMatch(workflow, /\/api\/balances/);
  assert.doesNotMatch(workflow, /nightly-finance-orchestrator/);
  assert.doesNotMatch(workflow, /decision-event/);
});

test('runner verifies generated code in a no-network container and publishes through Git Data API only', () => {
  const source = read('scripts/hourly-project-agent.mjs');
  assert.match(source, /selectReadyIssue/);
  assert.match(source, /parseAgentIssueConfiguration/);
  assert.match(source, /ensureOnlyAllowedChanges/);
  assert.match(source, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.match(source, /GITHUB_RUN_ATTEMPT/);
  assert.match(source, /\/api\/health/);
  assert.match(source, /npm test/);
  assert.match(source, /--network/);
  assert.match(source, /['"]none['"]/);
  assert.match(source, /--cap-drop/);
  assert.match(source, /--security-opt/);
  assert.match(source, /\/git\/blobs/);
  assert.match(source, /\/git\/trees/);
  assert.match(source, /\/git\/commits/);
  assert.match(source, /\/git\/refs/);
  assert.match(source, /\/statuses\//);
  assert.match(source, /hourly-agent\/isolated-verification/);
  assert.match(source, /\/pulls/);
  assert.doesNotMatch(source, /git[^\n]*push/);
  assert.doesNotMatch(source, /persist-credentials/);
  assert.doesNotMatch(source, /\/api\/balances/);
  assert.doesNotMatch(source, /ДДС|payment classification|transaction classification/i);
});
