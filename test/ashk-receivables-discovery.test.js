import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECEIVABLE_CANDIDATES,
  classifyAshkProbe,
  safeProbeResult
} from '../lib/ashk-receivables-discovery.js';

test('receivables discovery uses a small read-only candidate set', () => {
  assert.ok(RECEIVABLE_CANDIDATES.length >= 8);
  assert.ok(RECEIVABLE_CANDIDATES.length <= 20);
  assert.ok(RECEIVABLE_CANDIDATES.includes('DebtorList'));
  assert.ok(RECEIVABLE_CANDIDATES.includes('EmployeeActivityReport'));
});

test('Invalid command name is classified as unrecognized', () => {
  assert.equal(classifyAshkProbe(500, '{"success":false,"data":{"Message":"Invalid command name"}}'), 'unrecognized');
});

test('required parameter error is classified as recognized', () => {
  assert.equal(classifyAshkProbe(500, '{"success":false,"data":{"Message":"StartDate is required"}}'), 'recognized');
});

test('safe probe result never returns payload rows or secrets', () => {
  const result = safeProbeResult('DebtorList', 200, JSON.stringify({data:[{Student:'Иванов', Debt:1000}], api_key:'secret'}));
  assert.equal(result.name, 'DebtorList');
  assert.equal(result.status, 200);
  assert.equal(result.classification, 'recognized');
  assert.equal('payload' in result, false);
  assert.equal(JSON.stringify(result).includes('Иванов'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
