function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cents(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number * 100);
}

function money(valueCents) {
  const value = valueCents / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

function appendIssue(issues, message) {
  if (!issues.includes(message)) issues.push(message);
}

export function evaluateCashPhotoQuality(data = {}) {
  const operations = Array.isArray(data?.operations) ? data.operations : [];
  const issues = [];

  const visibleMoneyRowCount = Number(data?.visibleMoneyRowCount);
  if (Number.isInteger(visibleMoneyRowCount)
      && visibleMoneyRowCount >= 0
      && visibleMoneyRowCount !== operations.length) {
    appendIssue(
      issues,
      `Количество видимых денежных строк ${visibleMoneyRowCount}, извлечено операций ${operations.length}.`
    );
  }

  const flaggedRows = operations.filter(operation => operation?.needsReview === true).length;
  if (flaggedRows > 0) {
    appendIssue(issues, `OCR: ${flaggedRows} строк(и) требует проверки.`);
  }

  const initial = cents(data?.initialBalance);
  let runningBalance = initial !== null && initial >= 0 ? initial : null;
  let lastReadableBalance = null;

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index] || {};
    const expense = cents(operation.expense);
    const income = cents(operation.income);
    const readableBalance = operation.balanceReadable === true ? cents(operation.balance) : null;

    const expected = runningBalance !== null && expense !== null && income !== null
      ? runningBalance - expense + income
      : null;

    if (readableBalance !== null) {
      if (expected !== null && expected !== readableBalance) {
        appendIssue(
          issues,
          `Арифметика строки ${index + 1}: ожидаемый остаток ${money(expected)}, распознано ${money(readableBalance)}.`
        );
      }
      // Continue from the journal's explicitly written balance so one OCR mismatch
      // does not create a cascade of false positives on every following row.
      runningBalance = readableBalance;
      lastReadableBalance = readableBalance;
    } else if (expected !== null) {
      runningBalance = expected;
    }
  }

  if (data?.finalBalanceReadable === true) {
    const finalBalance = cents(data?.finalBalance);
    if (finalBalance !== null && lastReadableBalance !== null && finalBalance !== lastReadableBalance) {
      appendIssue(
        issues,
        `Итоговый остаток страницы ${money(finalBalance)} не совпадает с последним читаемым остатком ${money(lastReadableBalance)}.`
      );
    }
  }

  return Object.freeze({
    requiresReview: issues.length > 0,
    issues: Object.freeze([...issues])
  });
}

export function cashPhotoQualityNote(pageNote, quality) {
  const original = String(pageNote || '').trim();
  const issues = Array.isArray(quality?.issues) ? quality.issues : [];
  if (!issues.length) return original;
  const suffix = `[QUALITY] ${issues.join(' | ')}`;
  return `${original}${original ? '\n' : ''}${suffix}`.slice(0, 45000);
}
