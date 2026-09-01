import syncHours from './sync-hours.js';
import reconcileDecisions from './decision-reconcile-daily.js';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';

const handler = createNightlyFinanceOrchestrator({
  cronSecret: process.env.CRON_SECRET || '',
  runHours: syncHours,
  runDecisions: reconcileDecisions
});

export default handler;
