import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDebtorPriorityFormatRequests } from '../lib/rop-debtor-format.js';

test('debtor queue formatting adds status dropdown and red-yellow-green rules', () => {
  const requests = buildDebtorPriorityFormatRequests({ sheetId: 123, rowCount: 500, existingConditionalRuleCount: 2 });
  const deletes = requests.filter(request => request.deleteConditionalFormatRule);
  assert.deepEqual(deletes.map(request => request.deleteConditionalFormatRule.index), [1, 0]);

  const validation = requests.find(request => request.setDataValidation);
  assert.equal(validation.setDataValidation.range.startColumnIndex, 18);
  assert.equal(validation.setDataValidation.range.endColumnIndex, 19);
  assert.deepEqual(
    validation.setDataValidation.rule.condition.values.map(item => item.userEnteredValue),
    ['НЕ СВЯЗАЛИСЬ','ДОЗВОНИЛИСЬ','ОБЕЩАНИЕ','ЧАСТИЧНАЯ ОПЛАТА','ОПЛАЧЕНО','ОТКАЗ/ЭСКАЛАЦИЯ']
  );

  const rules = requests.filter(request => request.addConditionalFormatRule);
  assert.equal(rules.length, 3);
  const formulas = rules.map(request => request.addConditionalFormatRule.rule.booleanRule.condition.values[0].userEnteredValue).join(' ');
  assert.match(formulas, /ОПЛАЧЕНО/);
  assert.match(formulas, /ОБЕЩАНИЕ/);
  assert.match(formulas, /НЕ СВЯЗАЛИСЬ/);
});
