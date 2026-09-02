import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePayrollEvidence } from '../lib/master-payroll-evidence.js';

const aliases = {
  козлов: 'kozlov-ivan',
  'козлов иван викторович': 'kozlov-ivan',
  ходаков: 'khodakov-oleg',
  'ходаков олег александрович': 'khodakov-oleg',
  толстоухов: 'tolstoukhov-sergey',
  'толстоухов сергей николаевич': 'tolstoukhov-sergey',
  аталыков: 'atalykov-sergey',
  'аталыков сергей сергеевич': 'atalykov-sergey',
  жданова: 'zhdanova-svetlana',
  'жданова светлана фанисовна': 'zhdanova-svetlana'
};

test('confirmed individual advance reduces only named master', () => {
  const rows = [{
    sourceId: 'dds-13372',
    date: '2026-08-06',
    amount: 30000,
    counterparty: 'Козлов',
    description: 'Выплата аванса по заработной плате сотруднику (Козлов)',
    article: 'Зарплата мастеров'
  }];
  const result = normalizePayrollEvidence(rows, aliases);
  assert.deepEqual(result.confirmed[0], {
    masterKey: 'kozlov-ivan',
    type: 'ADVANCE',
    amount: 30000,
    sourceId: 'dds-13372',
    status: 'CONFIRMED'
  });
});

test('generic fuel payment remains blocked', () => {
  const rows = [{ sourceId: 'fuel-1', amount: 50000, counterparty: 'Газпромнефть', description: 'ГСМ', article: 'Топливо' }];
  const result = normalizePayrollEvidence(rows, aliases);
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.blocked[0].reason, 'NO_MASTER_ALLOCATION');
  assert.equal(result.blocked[0].type, 'FUEL');
});

test('advance through another beneficiary is attributed from description', () => {
  const rows = [{
    sourceId: 'dds-16544',
    date: '2026-08-15',
    amount: 13166,
    counterparty: 'Гасанов Артур Рамазанович',
    description: 'Аванс по заработной плате Козлову Ивану Викторовичу',
    article: 'Зарплата мастеров'
  }];
  const result = normalizePayrollEvidence(rows, aliases);
  assert.equal(result.confirmed[0].masterKey, 'kozlov-ivan');
  assert.equal(result.confirmed[0].type, 'ADVANCE');
});

test('statutory deductions are recognized for individually named master', () => {
  const rows = [
    {
      sourceId: 'dds-17899', amount: 13583.35, counterparty: 'УФК по Тюменской области',
      description: 'Взыскание задолженности по исполнительному производству Козлов Иван Викторович', article: 'Зарплата мастеров'
    },
    {
      sourceId: 'dds-17900', amount: 6790.65, counterparty: 'УФК по Тюменской области',
      description: 'Депозит службы судебных приставов Козлов Иван Викторович', article: 'Зарплата мастеров'
    }
  ];
  const result = normalizePayrollEvidence(rows, aliases);
  assert.equal(result.confirmed.length, 2);
  assert.ok(result.confirmed.every((item) => item.type === 'STATUTORY_DEDUCTION'));
  assert.equal(result.confirmed.reduce((sum, item) => sum + item.amount, 0), 20374);
});

test('current August Atalykov evidence is separated by type', () => {
  const rows = [
    { sourceId: 'a1', amount: 7825.68, counterparty: 'Аталыкова Диана Андреевна', description: 'Аванс Аталыков Сергей Сергеевич', article: 'Зарплата мастеров' },
    { sourceId: 'a2', amount: 8017.92, counterparty: 'Аталыкова Диана Андреевна', description: 'Заработная плата за август Аталыков Сергей Сергеевич', article: 'Зарплата мастеров' },
    { sourceId: 'a3', amount: 13496.40, counterparty: 'УФК', description: 'Алименты Аталыков Сергей Сергеевич', article: 'Зарплата мастеров' }
  ];
  const result = normalizePayrollEvidence(rows, aliases);
  assert.deepEqual(result.confirmed.map((item) => item.type), ['ADVANCE', 'OFFICIAL_PAYMENT', 'STATUTORY_DEDUCTION']);
});

test('Hodakov and Tolstoukhov advance plus official salary are individually confirmed', () => {
  const rows = [
    { sourceId: 'h1', amount: 13167, counterparty: 'ХОДАКОВ ОЛЕГ АЛЕКСАНДРОВИЧ', description: 'Аванс за август', article: 'Зарплата мастеров' },
    { sourceId: 'h2', amount: 14847, counterparty: 'ХОДАКОВ ОЛЕГ АЛЕКСАНДРОВИЧ', description: 'Заработная плата за август', article: 'Зарплата мастеров' },
    { sourceId: 't1', amount: 12931.75, counterparty: 'ТОЛСТОУХОВ СЕРГЕЙ НИКОЛАЕВИЧ', description: 'Аванс за август', article: 'Зарплата мастеров' },
    { sourceId: 't2', amount: 14582.25, counterparty: 'ТОЛСТОУХОВ СЕРГЕЙ НИКОЛАЕВИЧ', description: 'Заработная плата за август', article: 'Зарплата мастеров' }
  ];
  const result = normalizePayrollEvidence(rows, aliases);
  assert.equal(result.confirmed.length, 4);
  assert.deepEqual(result.confirmed.map((item) => item.type), ['ADVANCE', 'OFFICIAL_PAYMENT', 'ADVANCE', 'OFFICIAL_PAYMENT']);
});

test('pooled master payment remains blocked without registry-backed individual allocation', () => {
  const rows = [{
    sourceId: 'dds-17555', amount: 32600, counterparty: 'ИП Егорова', description: 'Зарплата мастеров', article: 'Зарплата мастеров'
  }];
  const result = normalizePayrollEvidence(rows, aliases);
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.blocked[0].reason, 'NO_MASTER_ALLOCATION');
});

test('explicit settlementGroup survives normalization for official gross reconciliation', () => {
  const rows = [{
    sourceId: 'official-advance',
    amount: 13166,
    counterparty: 'Гасанов Артур Рамазанович',
    description: 'Аванс по заработной плате Козлову Ивану Викторовичу',
    article: 'Зарплата мастеров',
    settlementGroup: 'OFFICIAL_GROSS'
  }];
  const result = normalizePayrollEvidence(rows, aliases);
  assert.equal(result.confirmed[0].masterKey, 'kozlov-ivan');
  assert.equal(result.confirmed[0].settlementGroup, 'OFFICIAL_GROSS');
});
