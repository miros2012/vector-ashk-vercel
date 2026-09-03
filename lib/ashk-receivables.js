function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '')
    .replace(/\u00A0/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function buildReceivableRows(groups, contractsByGroup) {
  const branchByGroup = new Map(
    (Array.isArray(groups) ? groups : [])
      .map(group => [Number(group?.Id), String(group?.TrainingRoomName ?? '').trim()])
      .filter(([id]) => Number.isFinite(id))
  );

  const rows = [];
  const entries = contractsByGroup instanceof Map
    ? contractsByGroup.entries()
    : Object.entries(contractsByGroup || {}).map(([key, value]) => [Number(key), value]);

  for (const [groupIdRaw, contracts] of entries) {
    const groupId = Number(groupIdRaw);
    const branch = branchByGroup.get(groupId) || '';
    for (const contract of Array.isArray(contracts) ? contracts : []) {
      const debt = roundMoney(toNumber(contract?.Debt));
      if (!(debt > 0)) continue;
      rows.push({
        studentId: Number(contract?.Id),
        studentName: String(contract?.PersonName ?? contract?.Name ?? '').trim(),
        groupId: Number(contract?.StudyGroupId ?? groupId),
        branch,
        manager: String(contract?.OwnerName ?? '').trim(),
        contractName: String(contract?.ContractName ?? '').trim(),
        contractDate: contract?.ContractDate ?? '',
        state: String(contract?.State ?? '').trim(),
        salesSum: roundMoney(toNumber(contract?.SalesSum)),
        debitSum: roundMoney(toNumber(contract?.DebitSum)),
        debt,
        mainProductDebt: roundMoney(toNumber(contract?.MainProductDebt)),
        mainProductName: String(contract?.MainProductName ?? '').trim(),
        lastPaymentDate: contract?.LastPaymentDate ?? ''
      });
    }
  }

  rows.sort((a, b) => b.debt - a.debt || a.studentId - b.studentId);
  return rows;
}

function aggregate(rows, key, label) {
  const map = new Map();
  for (const row of rows) {
    const value = String(row?.[key] ?? '').trim() || 'Не назначено';
    const current = map.get(value) || {
      [label]: value,
      contracts: 0,
      debt: 0,
      salesSum: 0,
      debitSum: 0
    };
    current.contracts += 1;
    current.debt += toNumber(row?.debt);
    current.salesSum += toNumber(row?.salesSum);
    current.debitSum += toNumber(row?.debitSum);
    map.set(value, current);
  }
  return [...map.values()]
    .map(item => ({
      ...item,
      debt: roundMoney(item.debt),
      salesSum: roundMoney(item.salesSum),
      debitSum: roundMoney(item.debitSum)
    }))
    .sort((a, b) => b.debt - a.debt || String(a[label]).localeCompare(String(b[label]), 'ru'));
}

export function buildReceivableSummary(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const total = safeRows.reduce((acc, row) => {
    acc.contracts += 1;
    acc.debt += toNumber(row?.debt);
    acc.salesSum += toNumber(row?.salesSum);
    acc.debitSum += toNumber(row?.debitSum);
    return acc;
  }, { contracts: 0, debt: 0, salesSum: 0, debitSum: 0 });

  return {
    total: {
      contracts: total.contracts,
      debt: roundMoney(total.debt),
      salesSum: roundMoney(total.salesSum),
      debitSum: roundMoney(total.debitSum)
    },
    byManager: aggregate(safeRows, 'manager', 'manager'),
    byBranch: aggregate(safeRows, 'branch', 'branch')
  };
}
