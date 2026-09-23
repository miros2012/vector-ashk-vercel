import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTochkaDdsCoverage } from '../lib/tochka-dds-health.js';

const day = 46269;
test('missing-operation fingerprint is order independent and includes keys beyond log limit',()=>{
 const rows=Array.from({length:25},(_,i)=>op(`key-${i}`));
 const evaluate=tochkaRows=>evaluateTochkaDdsCoverage({tochkaRows,businessDateSerial:day});
 assert.equal(evaluate(rows).missingFingerprint,evaluate([...rows].reverse()).missingFingerprint);
 assert.notEqual(evaluate(rows).missingFingerprint,evaluate(rows.slice(0,24)).missingFingerprint);
});

function op(key, { internal = 'Нет', signed = -100, date = day } = {}) {
  const row = Array(16).fill('');
  row[0] = date;
  row[5] = signed;
  row[6] = internal;
  row[14] = key;
  return row;
}

function control(key, readiness) {
  const row = Array(16).fill('');
  row[10] = key;
  row[15] = readiness;
  return row;
}

test('blocks when a current-day external Tochka operation has not propagated to DDS', () => {
  const result = evaluateTochkaDdsCoverage({
    tochkaRows: [op('key-a', { signed: -854277 }), op('key-b', { signed: 500 })],
    ddsSourceRows: [['Точка API | key-b']],
    businessDateSerial: day
  });

  assert.equal(result.ok, false);
  assert.equal(result.eligibleCount, 2);
  assert.equal(result.coveredCount, 1);
  assert.equal(result.missingCount, 1);
  assert.equal(result.missingOutflow, 854277);
  assert.deepEqual(result.missingKeys, ['key-a']);
});

test('ignores internal transfers because they are intentionally excluded from DDS', () => {
  const result = evaluateTochkaDdsCoverage({
    tochkaRows: [op('internal-key', { internal: 'Да', signed: -79200 }), op('external-key')],
    ddsSourceRows: [['Точка API | external-key']],
    businessDateSerial: day
  });

  assert.equal(result.ok, true);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.missingCount, 0);
});

test('only requires propagation for the selected business date', () => {
  const result = evaluateTochkaDdsCoverage({
    tochkaRows: [op('old-key', { date: day - 1 }), op('today-key')],
    ddsSourceRows: [['Точка API | today-key']],
    businessDateSerial: day
  });

  assert.equal(result.ok, true);
  assert.equal(result.eligibleCount, 1);
});

test('does not block on an operation explicitly awaiting manual classification', () => {
  const result = evaluateTochkaDdsCoverage({
    tochkaRows: [op('classified-key', { signed: 2700 }), op('manual-key', { signed: 3.01 })],
    controlRows: [
      control('classified-key', 'Импортировано ранее'),
      control('manual-key', 'Ручная классификация')
    ],
    ddsSourceRows: [['Точка API | classified-key']],
    businessDateSerial: day
  });

  assert.equal(result.ok, true);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.missingCount, 0);
});
