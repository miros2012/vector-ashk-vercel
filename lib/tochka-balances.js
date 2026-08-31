export const FUND_BY_ACCOUNT = Object.freeze({
  '40702810212500010112': 'Общий',
  '40702810020000282959': 'Вождение',
  '40702810720000282958': 'Роялти',
  '40702810420000308886': 'Налоги',
  '40702810420000289507': 'Прибыль'
});

export function accountNumber(accountId = '') {
  return String(accountId).split('/')[0].trim();
}

export function normalizeBalances(payload) {
  const raw = Array.isArray(payload?.Data?.Balance) ? payload.Data.Balance : [];
  const byAccount = new Map();

  for (const item of raw) {
    const accountId = String(item?.accountId ?? '').trim();
    const number = accountNumber(accountId);
    const fund = FUND_BY_ACCOUNT[number];
    if (!fund) continue;

    if (!byAccount.has(number)) {
      byAccount.set(number, {
        fund,
        accountNumber: number,
        accountId,
        currency: item?.Amount?.currency || 'RUB',
        closingAvailable: null,
        expected: null,
        openingAvailable: null,
        overdraftAvailable: null,
        dateTime: item?.dateTime || null
      });
    }

    const row = byAccount.get(number);
    const amount = Number(item?.Amount?.amount);
    const value = Number.isFinite(amount) ? amount : null;

    if (item?.type === 'ClosingAvailable') row.closingAvailable = value;
    if (item?.type === 'Expected') row.expected = value;
    if (item?.type === 'OpeningAvailable') row.openingAvailable = value;
    if (item?.type === 'OverdraftAvailable') row.overdraftAvailable = value;
    if (item?.dateTime && (!row.dateTime || item.dateTime > row.dateTime)) row.dateTime = item.dateTime;
  }

  const funds = Object.entries(FUND_BY_ACCOUNT).map(([number, fund]) => (
    byAccount.get(number) || {
      fund,
      accountNumber: number,
      accountId: null,
      currency: 'RUB',
      closingAvailable: null,
      expected: null,
      openingAvailable: null,
      overdraftAvailable: null,
      dateTime: null
    }
  ));

  const liveCount = funds.filter(x => Number.isFinite(x.closingAvailable)).length;
  const totalAvailable = funds.reduce((sum, x) => sum + (Number.isFinite(x.closingAvailable) ? x.closingAvailable : 0), 0);
  const totalExpected = funds.reduce((sum, x) => sum + (Number.isFinite(x.expected) ? x.expected : 0), 0);

  return {
    funds,
    summary: {
      liveCount,
      totalAccounts: funds.length,
      complete: liveCount === funds.length,
      totalAvailable: Math.round(totalAvailable * 100) / 100,
      totalExpected: Math.round(totalExpected * 100) / 100
    }
  };
}
