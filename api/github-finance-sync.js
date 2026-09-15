import financeHandler from './nightly-finance-orchestrator.js';
import { verifyGitHubActionsOidcToken } from '../lib/github-actions-oidc.js';
import { createGitHubFinanceSyncHandler } from '../lib/github-finance-sync.js';

export default createGitHubFinanceSyncHandler({
  verifyToken: verifyGitHubActionsOidcToken,
  cronSecret: process.env.CRON_SECRET || '',
  runIntraday: financeHandler,
  runFull: financeHandler
});
