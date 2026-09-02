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

test('personal rate card overrides universal planning rate and pays driving by event', () => {
  const rows = [
    { employeeId: '2859064', masterName: 'Аталыков Сергей Сергеевич', sessionTypeName: 'Основное вождение (120 минут)', academicHours: 3, factDate: '2026-08-06', eventKey: 'a1' },
    { employeeId: '2859064', masterName: 'Аталыков Сергей Сергеевич', sessionTypeName: 'Основное вождение (120 минут)', academicHours: 3, factDate: '2026-08-13', eventKey: 'a2' },
    { employeeId: '2859064', masterName: 'Аталыков Сергей Сергеевич', sessionTypeName: 'Доп. часы кат В (120 минут)', academicHours: 3, factDate: '2026-08-18', eventKey: 'a3' }
  ];
  const rateModel = {
    shared: {
      'Внутренний экзамен город': { mode: 'event', rate: 200, group: 'B' }
    },
    employees: {
      '2859064': {
        rates: {
          'Основное вождение (120 минут)': { mode: 'event', rate: 1000, group: 'B' },
          'Доп. часы кат В (120 минут)': { mode: 'event', rate: 1500, group: 'B' }
        }
      }
    }
  };

  const result = calculateVerifiedGross(rows, rateModel);
  assert.equal(result.totals.gross, 3500);
  assert.equal(result.blockers.length, 0);
});

test('dated rate segments support a mid-month switch for the same master', () => {
  const rows = [
    { employeeId: '3540779', masterName: 'Захаров Никита Викторович', sessionTypeName: 'Основное вождение (120 минут)', academicHours: 3, factDate: '2026-08-24', eventKey: 'before' },
    { employeeId: '3540779', masterName: 'Захаров Никита Викторович', sessionTypeName: 'Основное вождение (120 минут)', academicHours: 3, factDate: '2026-08-25', eventKey: 'after' }
  ];
  const rateModel = {
    shared: {},
    employees: {
      '3540779': {
        rates: {
          'Основное вождение (120 минут)': [
            { from: '2026-08-01', to: '2026-08-24', mode: 'event', rate: 670, group: 'B' },
            { from: '2026-08-25', to: '2026-08-31', mode: 'event', rate: 1200, group: 'B' }
          ]
        }
      }
    }
  };

  const result = calculateVerifiedGross(rows, rateModel);
  assert.equal(result.totals.gross, 1870);
  assert.equal(result.blockers.length, 0);
});

test('missing personal rate blocks payroll gross instead of falling back to planning rate', () => {
  const rows = [
    { employeeId: 'x', masterName: 'Master X', sessionTypeName: 'Основное вождение (120 минут)', academicHours: 3, factDate: '2026-08-10', eventKey: 'x1' }
  ];
  const rateModel = { shared: {}, employees: {} };

  const result = calculateVerifiedGross(rows, rateModel);
  assert.equal(result.totals.gross, 0);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].reason, 'MISSING_MASTER_RATE');
});
