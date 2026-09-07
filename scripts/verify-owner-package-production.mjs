#!/usr/bin/env node

import { executeOwnerPackageProductionSmoke } from '../lib/owner-package-production-smoke-command.js';

function redactSecret(message, secret) {
  if (!secret) return message;
  return message.split(secret).join('[REDACTED]');
}

try {
  await executeOwnerPackageProductionSmoke({
    env: process.env,
    fetchImpl: globalThis.fetch,
    now: new Date().toISOString(),
    writeOutput(line) {
      process.stdout.write(`${line}\n`);
    }
  });
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown error';
  const redacted = redactSecret(message, process.env.VECTOR_OWNER_API_KEY || '');
  process.stderr.write(`owner package production smoke failed: ${redacted}\n`);
  process.exitCode = 1;
}
