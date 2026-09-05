#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ensureOnlyAllowedChanges,
  markIssueInProgressTitle,
  parseAgentIssueConfiguration,
  sanitizeVerificationOutput,
  selectReadyIssue
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

async function fetchAllowedFiles(paths) {
  const files = [];
  for (const filePath of paths) {
    const payload = await github(`/contents/${repoPath(filePath)}?ref=main`, { allow404: true });
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

function writeProposal(proposal, allowedFiles) {
  const changedPaths = verifyProposalChangeSet(proposal.changes, allowedFiles);
  for (const change of proposal.changes) {
    const filePath = String(change.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(change.content ?? ''), 'utf8');
  }
  return changedPaths;
}

function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024,
    env: process.env
  });
  const output = sanitizeVerificationOutput(`${result.stdout || ''}${result.stderr || ''}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} failed\n${output}`);
  }
  return { ok: result.status === 0, output, status: result.status };
}

function changedWorkingTreeFiles() {
  const result = runCommand('git', ['status', '--porcelain'], { allowFailure: false });
  return result.output
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((name) => name.includes(' -> ') ? name.split(' -> ').pop() : name);
}

function verifyWorkingTree(allowedFiles) {
  const changed = changedWorkingTreeFiles();
  return ensureOnlyAllowedChanges(changed, allowedFiles);
}

function runVerification(changedPaths) {
  const outputs = [];
  for (const filePath of changedPaths.filter((name) => name.endsWith('.js') || name.endsWith('.mjs'))) {
    const syntax = runCommand('node', ['--check', filePath], { allowFailure: true });
    outputs.push(syntax.output);
    if (!syntax.ok) return { ok: false, output: sanitizeVerificationOutput(outputs.join('\n')) };
  }
  const tests = runCommand('npm', ['test'], { allowFailure: true });
  outputs.push(tests.output);
  return { ok: tests.ok, output: sanitizeVerificationOutput(outputs.join('\n')).slice(-MAX_COMMAND_OUTPUT) };
}

function currentAllowedFiles(allowedFiles) {
  return allowedFiles.map((filePath) => ({
    path: filePath,
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '',
    exists: fs.existsSync(filePath)
  }));
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
    '- syntax checks for changed JavaScript files',
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

  const [issues, pulls] = await Promise.all([listOpenIssues(), listOpenPulls()]);
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
  const baseFiles = await fetchAllowedFiles(allowedFiles);
  await updateIssue(issue.number, { title: markIssueInProgressTitle(issue.title) });

  try {
    let generation = await generateProposal({ issue, files: baseFiles, attempt: 1 });
    if (generation.proposal.needsHumanReview) {
      await markForReview(issue, generation.proposal.reviewReason || 'The proposal requested review.');
      return;
    }

    let changedPaths = writeProposal(generation.proposal, allowedFiles);
    verifyWorkingTree(allowedFiles);
    let verification = runVerification(changedPaths);

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
      changedPaths = writeProposal(generation.proposal, allowedFiles);
      verifyWorkingTree(allowedFiles);
      verification = runVerification(changedPaths);
    }

    if (!verification.ok) {
      await markForReview(issue, verification.output || 'Verification failed twice.');
      process.exitCode = 1;
      return;
    }

    const finalChangedPaths = verifyWorkingTree(allowedFiles);
    const branch = buildAgentBranchName(issue.number, RUN_ID);
    runCommand('git', ['switch', '-c', branch]);
    runCommand('git', ['config', 'user.name', 'vector-hourly-agent']);
    runCommand('git', ['config', 'user.email', '46207692+miros2012@users.noreply.github.com']);
    runCommand('git', ['add', '--', ...finalChangedPaths]);
    const staged = runCommand('git', ['diff', '--cached', '--name-only']).output.split('\n').map((x) => x.trim()).filter(Boolean);
    ensureOnlyAllowedChanges(staged, allowedFiles);
    runCommand('git', ['commit', '-m', `agent: issue #${issue.number} ${titleWithoutPrefix(issue.title)}`]);
    runCommand('git', ['push', 'origin', `HEAD:refs/heads/${branch}`]);

    const pull = await createPullRequest({
      issue,
      branch,
      proposal: generation.proposal,
      model: generation.model,
      changedPaths: finalChangedPaths
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
