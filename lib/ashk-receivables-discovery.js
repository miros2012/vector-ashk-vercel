export const RECEIVABLE_CANDIDATES = Object.freeze([
  'EmployeeActivityReport',
  'EmployeeActivity',
  'EmployeeActivityDetails',
  'ManagerActivityReport',
  'DebtorList',
  'DebtorsList',
  'StudentDebtorList',
  'StudentDebtList',
  'ContractDebtList',
  'DebtList',
  'PlannedPaymentList',
  'PaymentPlanList',
  'PaymentScheduleList',
  'ContractList',
  'StudentContractList',
  'ContractExternalList',
  'SaleList',
  'SaleExternalList'
]);

function messageFromBody(body) {
  try {
    const parsed = JSON.parse(String(body || ''));
    const message = parsed?.data?.Message ?? parsed?.Message ?? parsed?.message ?? parsed?.error;
    return typeof message === 'string' ? message.slice(0, 220) : '';
  } catch {
    return '';
  }
}

export function classifyAshkProbe(status, body) {
  const text = String(body || '');
  if (/Invalid command name/i.test(text) || /Unknown API call/i.test(text)) return 'unrecognized';
  if (status >= 200 && status < 300) return 'recognized';
  if (/missing|required|parameter|Object reference|permission|access|date|filter/i.test(text)) return 'recognized';
  return 'uncertain';
}

export function safeProbeResult(name, status, body) {
  return {
    name,
    status,
    classification: classifyAshkProbe(status, body),
    message: messageFromBody(body)
  };
}

export async function probeAshkReceivables({ baseUrl, apiKey, fetchImpl = fetch, delayMs = 450 }) {
  if (!apiKey) throw new Error('ASHK_API_KEY missing');
  const results = [];
  for (const name of RECEIVABLE_CANDIDATES) {
    const url = `${String(baseUrl).replace(/\/$/, '')}/api/${name}`;
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          api_key: apiKey,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json'
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000)
      });
      const body = await response.text();
      results.push(safeProbeResult(name, response.status, body));
    } catch (error) {
      results.push({
        name,
        status: null,
        classification: 'transport_error',
        message: String(error?.message || error).slice(0, 220)
      });
    }
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return results;
}
