import { probeAshkReceivables } from './lib/ashk-receivables-discovery.js';

const results = await probeAshkReceivables({
  baseUrl: 'https://app.dscontrol.ru',
  apiKey: process.env.ASHK_API_KEY,
  delayMs: 400
});

const recognized = results.filter(row => row.classification === 'recognized');
const uncertain = results.filter(row => row.classification === 'uncertain');
console.log('ASHK_RECEIVABLES_DISCOVERY_OK', JSON.stringify({
  candidates: results.length,
  recognized,
  uncertain
}));
