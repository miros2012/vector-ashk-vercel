const HEADER = Object.freeze([
  'Мастер',
  'Verified gross',
  'Подтверждено удержаний/выплат',
  'Outstanding net',
  'Статус',
  'B gross',
  'Moto gross',
  'Extra moto gross',
  'Trainer gross',
  'Авансы',
  'Офиц. выплаты',
  'Исп. удержания',
  'Прочие подтвержденные',
  'Топливо unresolved',
  'Лизинг unresolved',
  'Master key'
]);

function componentGroupGross(master, group) {
  return Object.values(master.components ?? {})
    .filter((component) => component?.group === group)
    .reduce((total, component) => total + Number(component.gross || 0), 0);
}

function blockedByType(blocked, type) {
  return (blocked ?? [])
    .filter((item) => item?.type === type)
    .reduce((total, item) => total + Number(item.amount || 0), 0);
}

export function buildMasterPayrollSheetValues(result) {
  const masters = Array.isArray(result?.masters) ? result.masters : [];
  const blocked = Array.isArray(result?.blocked) ? result.blocked : [];
  const fuelBlocked = blockedByType(blocked, 'FUEL');
  const leasingBlocked = blockedByType(blocked, 'LEASING');

  const rows = [HEADER.slice()];

  for (const master of masters) {
    rows.push([
      master.masterName ?? master.masterKey ?? '',
      Number(master.gross || 0),
      Number(master.confirmedDeductions || 0),
      Number(master.outstandingNet || 0),
      master.status ?? 'INTERIM',
      componentGroupGross(master, 'B'),
      componentGroupGross(master, 'MOTO'),
      componentGroupGross(master, 'EXTRA_MOTO'),
      componentGroupGross(master, 'TRAINER'),
      Number(master.advances || 0),
      Number(master.officialPayments || 0),
      Number(master.statutoryDeductions || 0),
      Number(master.otherConfirmedDeductions || 0),
      fuelBlocked > 0 ? 'не распределено' : 0,
      leasingBlocked > 0 ? 'не распределено' : 0,
      master.masterKey ?? ''
    ]);
  }

  const totals = result?.totals ?? {};
  rows.push([
    'ИТОГО',
    Number(totals.gross || 0),
    Number(totals.confirmedDeductions || 0),
    Number(totals.outstandingNet || 0),
    result?.promotionStatus ?? 'BLOCKED',
    masters.reduce((sum, master) => sum + componentGroupGross(master, 'B'), 0),
    masters.reduce((sum, master) => sum + componentGroupGross(master, 'MOTO'), 0),
    masters.reduce((sum, master) => sum + componentGroupGross(master, 'EXTRA_MOTO'), 0),
    masters.reduce((sum, master) => sum + componentGroupGross(master, 'TRAINER'), 0),
    masters.reduce((sum, master) => sum + Number(master.advances || 0), 0),
    masters.reduce((sum, master) => sum + Number(master.officialPayments || 0), 0),
    masters.reduce((sum, master) => sum + Number(master.statutoryDeductions || 0), 0),
    masters.reduce((sum, master) => sum + Number(master.otherConfirmedDeductions || 0), 0),
    fuelBlocked,
    leasingBlocked,
    ''
  ]);

  rows.push([]);
  rows.push(['PROMOTION_STATUS', result?.promotionStatus ?? 'BLOCKED']);
  for (const [gate, value] of Object.entries(result?.gates ?? {})) {
    rows.push([gate, value]);
  }

  return rows;
}
