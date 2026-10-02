const MONTH_NAMES = Object.freeze([
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]);

export function ropPlanSheetForMonth(month) {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  const monthNumber = Number(match?.[2]);
  if (!match || monthNumber < 1 || monthNumber > 12) {
    throw new Error('ROP report month must be a valid YYYY-MM value');
  }
  return `РОП_План_${MONTH_NAMES[monthNumber - 1]}`;
}

export function assertRopPlanApproved(values, month) {
  ropPlanSheetForMonth(month);
  const activeRows = (Array.isArray(values) ? values.slice(1) : [])
    .filter(row => String(row?.[0] || '').trim())
    .filter(row => !/^нет$/i.test(String(row?.[6] || '').trim()));
  if (!activeRows.length) {
    throw Object.assign(new Error(`ROP plan is not approved for ${month}`), {
      errorClass: 'ROP_PLAN_NOT_APPROVED',
      statusCode: 409
    });
  }
  return values;
}

export function cityPlanFromValues(values) {
  const cityRows = (Array.isArray(values) ? values.slice(1) : [])
    .filter(row => String(row?.[0] || '').trim().toLocaleUpperCase('ru-RU') === 'ИТОГО ГОРОД');
  if (!cityRows.length) return null;
  if (cityRows.length !== 1) throw new Error('ROP city plan must have exactly one row');
  const amount = Number(String(cityRows[0]?.[3] ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('ROP city plan must be positive');
  return amount;
}
