import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateVerifiedGross,
  MASTER_PAYROLL_RATE_MODEL
} from '../lib/master-payroll-gross.js';

test('internal exam is paid by event count, not academic hours', () => {
  const rows = [
    {
      employeeId: '1',
      masterName: 'Master A',
      sessionTypeName: 'Внутренний экзамен город',
      academicHours: 2,
      eventKey: 'e1'
    }
  ];

  const result = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  assert.equal(result.totals.gross, 200);
});

test('moto, extra moto and trainer use confirmed per-lesson rates', () => {
  const rows = [
    {
      employeeId: '1',
      masterName: 'Master A',
      sessionTypeName: 'Мото',
      academicHours: 2,
      eventKey: 'm1'
    },
    {
      employeeId: '1',
      masterName: 'Master A',
      sessionTypeName: 'Дополнительное вождение МОТО',
      academicHours: 2,
      eventKey: 'm2'
    },
    {
      employeeId: '1',
      masterName: 'Master A',
      sessionTypeName: 'Тренажер',
      academicHours: 3,
      eventKey: 't1'
    }
  ];

  const result = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  assert.equal(result.totals.gross, 1250);
});

test('main driving is paid by academic hour', () => {
  const rows = [
    {
      employeeId: '1',
      masterName: 'Master A',
      sessionTypeName: 'Основное вождение (120 минут)',
      academicHours: 4260,
      eventKey: 'main-control'
    }
  ];

  const result = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  assert.equal(result.totals.gross, 1631580);
});

test('extra B 120 is paid by event count, not by dividing aggregate hours', () => {
  const rows = Array.from({ length: 521 }, (_, index) => ({
    employeeId: '1',
    masterName: 'Master A',
    sessionTypeName: 'Доп. часы кат В (120 минут)',
    academicHours: index === 520 ? 1 : 3,
    eventKey: `extra-${index + 1}`
  }));

  const result = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  assert.equal(rows.reduce((sum, row) => sum + row.academicHours, 0), 1561);
  assert.equal(result.totals.gross, 521 * 1500);
});

test('188 internal-exam events with 189 hours pay 188 events', () => {
  const rows = Array.from({ length: 188 }, (_, index) => ({
    employeeId: '1',
    masterName: 'Master A',
    sessionTypeName: 'Внутренний экзамен город',
    academicHours: index === 0 ? 2 : 1,
    eventKey: `exam-${index + 1}`
  }));

  const result = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  assert.equal(rows.reduce((sum, row) => sum + row.academicHours, 0), 189);
  assert.equal(result.totals.gross, 37600);
});

test('unknown session type creates blocker and contributes no gross', () => {
  const rows = [
    {
      employeeId: '1',
      masterName: 'Master A',
      sessionTypeName: 'Неизвестный тип',
      academicHours: 3,
      eventKey: 'unknown-1'
    }
  ];

  const result = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  assert.equal(result.totals.gross, 0);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].sessionTypeName, 'Неизвестный тип');
});

test('gross is aggregated by employee and preserves per-type event/hour counts', () => {
  const rows = [
    {
      employeeId: 'a', masterName: 'Master A', sessionTypeName: 'Мото', academicHours: 2, eventKey: 'a1'
    },
    {
      employeeId: 'a', masterName: 'Master A', sessionTypeName: 'Мото', academicHours: 2, eventKey: 'a2'
    },
    {
      employeeId: 'b', masterName: 'Master B', sessionTypeName: 'Тренажер', academicHours: 3, eventKey: 'b1'
    }
  ];

  const result = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  assert.equal(result.masters.length, 2);
  const masterA = result.masters.find((master) => master.masterKey === 'a');
  assert.equal(masterA.gross, 900);
  assert.equal(masterA.components['Мото'].events, 2);
  assert.equal(masterA.components['Мото'].academicHours, 4);
});
