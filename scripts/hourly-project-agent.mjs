#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ensureOnlyAllowedChanges,
  markIssueInProgressTitle,
  parseAgentIssueConfiguration,
  sanitizeVerificationOutput,
  selectReadyIssue,
  validateSafePath
} from '../lib/hourly-agent-runner-policy.js';
import {
  buildAgentBranchName,
  buildAgentRequestBody,
  hasOpenAgentPull,
  verifyProposalChangeSet
} from '../lib/hourly-project-agent-runner.js';

const REPOSITORY = String(process.env.GITHUB_REPOSITORY || '').trim();
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const RUN_ID = String(process.env.GITHUB_RUN_ID || '').trim();
const ENDPOINT = String(
  process.env.HOURLY_AGENT_ENDPOINT
    || 'https://vector-ashk-backend.vercel.app/api/health'
).trim();
const OWNER_ID = 46207692;
const API_ROOT = 'https://api.github.com';
const MAX_COMMAND_OUTPUT = 12_000;
const VERIFY_IMAGE = 'node:24-bookworm-slim';

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function repoPath(value) {
  return String(value).split('/').map(encodeURIComponent).join('/');
}

function titleWithoutPrefix(title) {
  return String(title || '').replace(/^\[agent-(?:ready|in-progress|review|pr-open)\]\s*/i, '').trim();
}

function titleWithPrefix(prefix, title) {
  return `[agent-${prefix}] ${titleWithoutPrefix(title)}`;
}

async function github(pathname, { method = 'GET', body, allow404 = false } = {}) {
  const response = await fetch(`${API_ROOT}/repos/${REPOSITORY}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${method} ${pathname} failed with ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

async function listOpenIssues() {
  return github('/issues?state=open&per_page=100&sort=created&direction=asc');
}

async function listOpenPulls() {
  return github('/pulls?state=open&per_page=100');
}

async function readMainBase() {
  const reference = await github('/git/ref/heads/main');
  const baseSha = required(reference?.object?.sha, 'main commit sha');
  const commit = await github(`/git/commits/${baseSha}`);
  return {
    baseSha,
    baseTreeSha: required(commit?.tree?.sha, 'main tree sha')
  };
}

async function fetchAllowedFiles(paths, baseSha) {
  const files = [];
  for (const filePath of paths) {
    const payload = await github(`/contents/${repoPath(filePath)}?ref=${encodeURIComponent(baseSha)}`, { allow404: true });
    if (!payload) {
      files.push({ path: filePath, content: '', exists: false });
      continue;
    }
    if (payload.type !== 'file' || payload.encoding !== 'base64') {
      throw new Error(`unsupported repository object: ${filePath}`);
    }
    files.push({
      path: filePath,
      content: Buffer.from(String(payload.content || '').replace(/\n/g, ''), 'base64').toString('utf8'),
      exists: true
    });
  }
  return files;
}

async function githubOidcToken() {
  const requestUrl = required(process.env.ACTIONS_ID_TOKEN_REQUEST_URL, 'ACTIONS_ID_TOKEN_REQUEST_URL');
  const requestToken = required(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN');
  const url = new URL(requestUrl);
  url.searchParams.set('audience', 'vector-hourly-agent-v1');
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${requestToken}` }
  });
  if (!response.ok) throw new Error(`GitHub OIDC request failed with ${response.status}`);
  const payload = await response.json();
  return required(payload?.value, 'GitHub OIDC token');
}

async function generateProposal({ issue, files, attempt, testFailure = '' }) {
  const oidcToken = await githubOidcToken();
  const request = buildAgentRequestBody({ issue, files, runId: RUN_ID, attempt, testFailure });
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${oidcToken}`,
      'x-vercel-trusted-oidc-idp-token': oidcToken,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(request)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true || !payload?.proposal) {
    throw new Error(`agent endpoint failed with ${response.status}`);
  }
  return { proposal: payload.proposal, model: String(payload.model || ''), usage: payload.usage || {} };
}

function assertNoSymlinkPath(filePath) {
  const segments = validateSafePath(filePath).split('/');
  let current = '';
  for (const segment of segments) {
    current = current ? path.join(current, segment) : segment;
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`symbolic-link path is not allowed: ${filePath}`);
    }
  }
}

function writeProposal(proposal, allowedFiles) {
  const changedPaths = verifyProposalChangeSet(proposal.changes, allowedFiles);
  for (const change of proposal.changes) {
    const filePath = validateSafePath(change.path);
    assertNoSymlinkPath(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(change.content ?? ''), 'utf8');
  }
  return changedPaths;
}

function currentAllowedFiles(allowedFiles) {
  return allowedFiles.map((filePath) => ({
    path: filePath,
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '',
    exists: fs.existsSync(filePath)
  }));
}

function actualChangedPaths(baseFiles, allowedFiles) {
  const baseByPath = new Map(baseFiles.map((file) => [file.path, String(file.content ?? '')]));
  const changed = allowedFiles.filter((filePath) => {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    return current !== (baseByPath.get(filePath) ?? '');
  });
  return ensureOnlyAllowedChanges(changed, allowedFiles);
}

function runCommand(command, args, { allowFailure = false, timeout = 60_000 } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024,
    env: process.env,
    timeout
  });
  const output = sanitizeVerificationOutput(`${result.stdout || ''}${result.stderr || ''}`);
  const ok = result.status === 0 && !result.error;
  if (!allowFailure && !ok) {
    throw new Error(`${command} failed\n${output || result.error?.message || ''}`);
  }
  return { ok, output, status: result.status, error: result.error || null };
}

function assertCleanCheckout() {
  const result = runCommand('git', ['status', '--porcelain']);
  if (result.output.trim()) throw new Error('checkout is not clean before agent changes');
}

function copyVerificationWorkspace(destination) {
  const root = process.cwd();
  fs.cpSync(root, destination, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return first !== '.git' && first !== 'node_modules';
    }
  });
}

function runVerification() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-hourly-agent-'));
  try {
    copyVerificationWorkspace(sandbox);
    const command = "find api lib test scripts -type f \\( -name '*.js' -o -name '*.mjs' \\) -print0 | xargs -0 -r -n1 node --check && npm test";
    const result = runCommand('docker', [
      'run',
      '--rm',
      '--network', 'none',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--pids-limit', '256',
      '--memory', '2g',
      '--cpus', '2',
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--env', 'CI=true',
      '--env', 'HOME=/tmp',
      '--volume', `${sandbox}:/workspace:rw`,
      '--volume', `${path.join(process.cwd(), 'node_modules')}:/workspace/node_modules:ro`,
      '--workdir', '/workspace',
      VERIFY_IMAGE,
      'sh', '-lc', command
    ], { allowFailure: true, timeout: 8 * 60_000 });
    return {
      ok: result.ok,
      output: sanitizeVerificationOutput(result.output || result.error?.message || '').slice(-MAX_COMMAND_OUTPUT)
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function updateIssue(number, fields) {
  return github(`/issues/${number}`, { method: 'PATCH', body: fields });
}

async function commentIssue(number, body) {
  return github(`/issues/${number}/comments`, { method: 'POST', body: { body } });
}

async function markForReview(issue, reason) {
  const safeReason = sanitizeVerificationOutput(reason).slice(0, 12_000);
  await updateIssue(issue.number, { title: titleWithPrefix('review', issue.title) });
  await commentIssue(issue.number, `Hourly agent stopped safely and requires human review.\n\n\`\`\`text\n${safeReason}\n\`\`\``);
}

async function createAgentCommit({ baseSha, baseTreeSha, branch, issue, changedPaths }) {
  const tree = [];
  for (const filePath of changedPaths) {
    const blob = await github('/git/blobs', {
      method: 'POST',
      body: {
        content: fs.readFileSync(filePath, 'utf8'),
        encoding: 'utf-8'
      }
    });
    tree.push({
      path: filePath,
      mode: '100644',
      type: 'blob',
      sha: required(blob?.sha, `blob sha for ${filePath}`)
    });
  }
  const createdTree = await github('/git/trees', {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree }
  });
  const commit = await github('/git/commits', {
    method: 'POST',
    body: {
      message: `agent: issue #${issue.number} ${titleWithoutPrefix(issue.title)}`,
      tree: required(createdTree?.sha, 'created tree sha'),
      parents: [baseSha]
    }
  });
  await github('/git/refs', {
    method: 'POST',
    body: {
      ref: `refs/heads/${branch}`,
      sha: required(commit?.sha, 'created commit sha')
    }
  });
  return commit;
}

async function createPullRequest({ issue, branch, proposal, model, changedPaths }) {
  const body = [
    `Closes #${issue.number}.`,
    '',
    'Automated bounded proposal created by the guarded hourly continuation runner.',
    '',
    `**Model:** ${model || 'not reported'}`,
    `**Summary:** ${proposal.summary}`,
    `**Changed files:** ${changedPaths.map((name) => `\`${name}\``).join(', ')}`,
    `**Confidence:** ${proposal.confidence || 'low'}`,
    '',
    '**Verification:**',
    '- no-network isolated container',
    '- syntax checks for repository JavaScript files',
    '- full `npm test` suite',
    '- exact changed-file allowlist check',
    '',
    'No automatic merge is requested.'
  ].join('\n');
  return github('/pulls', {
    method: 'POST',
    body: {
      title: `agent: ${titleWithoutPrefix(issue.title)}`,
      head: branch,
      base: 'main',
      body,
      draft: false
    }
  });
}

async function main() {
  required(REPOSITORY, 'GITHUB_REPOSITORY');
  required(GITHUB_TOKEN, 'GITHUB_TOKEN');
  required(RUN_ID, 'GITHUB_RUN_ID');
  if (REPOSITORY !== 'miros2012/vector-ashk-vercel') throw new Error('unexpected repository');
  if (!/^https:\/\/vector-ashk-backend\.vercel\.app\/api\/health$/.test(ENDPOINT)) {
    throw new Error('unexpected hourly agent endpoint');
  }
  assertCleanCheckout();

  const [issues, pulls, base] = await Promise.all([
    listOpenIssues(),
    listOpenPulls(),
    readMainBase()
  ]);
  if (hasOpenAgentPull(pulls)) {
    console.log('Hourly agent skipped: an agent pull request is already open.');
    return;
  }

  const issue = selectReadyIssue(issues, { ownerId: OWNER_ID });
  if (!issue) {
    console.log('Hourly agent idle: no owner-authored ready issue.');
    return;
  }

  const configuration = parseAgentIssueConfiguration(issue.body || '');
  const allowedFiles = configuration.allowedFiles;
  const baseFiles = await fetchAllowedFiles(allowedFiles, base.baseSha);
  await updateIssue(issue.number, { title: markIssueInProgressTitle(issue.title) });

  try {
    let generation = await generateProposal({ issue, files: baseFiles, attempt: 1 });
    if (generation.proposal.needsHumanReview) {
      await markForReview(issue, generation.proposal.reviewReason || 'The proposal requested review.');
      return;
    }

    writeProposal(generation.proposal, allowedFiles);
    let changedPaths = actualChangedPaths(baseFiles, allowedFiles);
    let verification = runVerification();

    if (!verification.ok) {
      generation = await generateProposal({
        issue,
        files: currentAllowedFiles(allowedFiles),
        attempt: 2,
        testFailure: verification.output
      });
      if (generation.proposal.needsHumanReview) {
        await markForReview(issue, generation.proposal.reviewReason || verification.output);
        return;
      }
      writeProposal(generation.proposal, allowedFiles);
      changedPaths = actualChangedPaths(baseFiles, allowedFiles);
      verification = runVerification();
    }

    if (!verification.ok) {
      await markForReview(issue, verification.output || 'Verification failed twice.');
      process.exitCode = 1;
      return;
    }

    changedPaths = actualChangedPaths(baseFiles, allowedFiles);
    const branch = buildAgentBranchName(issue.number, RUN_ID);
    await createAgentCommit({
      baseSha: base.baseSha,
      baseTreeSha: base.baseTreeSha,
      branch,
      issue,
      changedPaths
    });
    const pull = await createPullRequest({
      issue,
      branch,
      proposal: generation.proposal,
      model: generation.model,
      changedPaths
    });
    await updateIssue(issue.number, { title: titleWithPrefix('pr-open', issue.title) });
    await commentIssue(issue.number, `Guarded hourly agent opened ${pull.html_url}. Automatic merge is disabled.`);
    console.log(`Hourly agent opened ${pull.html_url}`);
  } catch (error) {
    await markForReview(issue, error?.message || 'Hourly agent failed safely.').catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(sanitizeVerificationOutput(error?.message || String(error)));
  process.exitCode = 1;
});
