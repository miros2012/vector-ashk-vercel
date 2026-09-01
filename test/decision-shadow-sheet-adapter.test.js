import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionShadowSheetAdapter } from '../lib/decision-shadow-sheet-adapter.js';

function catalogRows() {
  return [
    ['DEC-CASH-GAP', 'Кассовый разрыв 30 дней', 'cash_gap_30d', '', '', '', '', '', '', '', 0, '', true, 1],
    ['DEC-EST-ADJ', 'Оценочные корректировки', 'estimated_obligation_adjustments', '', '', '', '', '', '', '', 1, '', true, 1],
    ['DEC-UNCONF-OBL', 'Неподтверждённые обязательства', 'unconfirmed_obligations', '', '', '', '', '', '', '', 1, '', true, 1],
    ['DEC-CRIT-DUE', 'Критический платёж', 'critical_payment_due_3d', '', '', '', '', '', '', '', 0, '', true, 1]
  ];
}

function decisionRow(ruleId, dueDate, status, amount, linked) {
  const row = Array(17).fill('');
  row[0] = ruleId;
  row[7] = dueDate;
  row[9] = status;
  row[12] = amount;
  row[15] = linked;
  return row;
}

test('sheet adapter builds a live financial snapshot and returns 4/4 shadow agreement using one read batch', async () => {
  const requests = [];
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async (request) => {
          requests.push(request);
          return {
            data: {
              valueRanges: [
                { values: [[46266, 46271, 0]] },
                { values: [
                  ['MASTERS-2026-08', 'Выкуп / лизинг авто', 'Уменьшение', 500000, 'Оценка'],
                  ['MASTERS-2026-08', 'Топливо', 'Уменьшение', 357000, 'Оценка']
                ] },
                { values: [
                  [46268, 'Роялти', '', '', '', 1179607.46625, 'Критический', 'План', '', '', '', '', '', 'ROYALTY-2026-08'],
                  [46270, 'Мастера', '', '', '', 1477773.5, 'Критический', 'Оценка net', '', '', '', '', '', 'MASTERS-2026-08'],
                  [46270, 'Админ', '', '', '', 500000, 'Критический', 'Оценка', '', '', '', '', '', 'ADMIN-2026-08'],
                  [46270, 'Налоги', '', '', '', 0, 'Высокий', 'Требует расчёта', '', '', '', '', '', 'TAX-RESERVE']
                ] },
                { values: catalogRows() },
                { values: [
                  decisionRow('DEC-CASH-GAP', '', 'Неактивно', 0, ''),
                  decisionRow('DEC-EST-ADJ', 46266, 'Активно', 857000, 'MASTERS-2026-08'),
                  decisionRow('DEC-UNCONF-OBL', 46266, 'Активно', '', 'TAX-RESERVE'),
                  decisionRow('DEC-CRIT-DUE', 46268, 'Активно', 1179607.46625, 'ROYALTY-2026-08')
                ] }
              ]
            }
          };
        }
      }
    }
  };

  const adapter = createDecisionShadowSheetAdapter({
    sheets,
    spreadsheetId: 'sheet-1',
    now: () => new Date('2026-08-31T17:00:00.000Z')
  });

  const result = await adapter.run();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].valueRenderOption, 'UNFORMATTED_VALUE');
  assert.deepEqual(requests[0].ranges, [
    "'Прогноз 30 дней'!D1:H2",
    "'Корректировки обязательств'!B2:F500",
    "'Обязательства'!A2:N500",
    "'Каталог правил'!A2:N200",
    "'Решения'!A2:Q200"
  ]);
  assert.equal(result.comparison.matches, 4);
  assert.equal(result.comparison.total, 4);
  assert.deepEqual(result.comparison.mismatches, []);
  assert.equal(result.snapshot.asOfDate, '2026-08-31');
  assert.equal(result.snapshot.obligations.criticalPayments[0].dueDate, '2026-09-03');
  assert.equal(result.catalog.length, 4);
  assert.deepEqual(result.currentDecisions.map((row) => row._row), [2, 3, 4, 5]);
  assert.deepEqual(result.comparison.results.map((row) => row.current?._row), [2, 3, 4, 5]);
});
