import { evaluateDecisionRule } from './decision-rule-evaluators.js';

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function isoDate(value) {
  const text = String(value || '').slice(0, 10);
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? text : null;
}

function addDays(date, days) {
  const base = isoDate(date);
  if (!base) return null;
  const timestamp = Date.parse(`${base}T00:00:00.000Z`) + days * 86400000;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function applySlaDeadline(result, rule, snapshot, now) {
  if (!result.active || result.dueDate) return result;
  const rawSla = Number(rule?.slaDays);
  if (!Number.isFinite(rawSla) || rawSla < 0) return result;
  const slaDays = Math.trunc(rawSla);
  const baseDate = isoDate(snapshot?.asOfDate) || now.toISOString().slice(0, 10);
  return { ...result, dueDate: addDays(baseDate, slaDays) };
}

export function evaluateDecisionCatalog(catalog = [], snapshot = {}, now = new Date()) {
  if (!Array.isArray(catalog)) throw new Error('catalog must be an array');
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now must be a valid Date');
  const seen = new Set();

  return catalog.map((rule) => {
    const ruleId = required(rule?.ruleId, 'ruleId');
    if (seen.has(ruleId)) throw new Error(`duplicate ruleId: ${ruleId}`);
    seen.add(ruleId);

    const evaluatorKey = required(rule?.evaluatorKey, 'evaluatorKey');
    const enabled = rule?.enabled !== false;
    const version = Number.isFinite(Number(rule?.version)) ? Number(rule.version) : 1;

    if (!enabled) {
      return {
        ruleId,
        evaluatorKey,
        enabled: false,
        version,
        active: false,
        amount: 0,
        dueDate: null,
        linkedObjects: [],
        facts: { disabled: true }
      };
    }

    const evaluated = evaluateDecisionRule(evaluatorKey, snapshot, now);
    const withDeadline = applySlaDeadline(evaluated, rule, snapshot, now);
    return {
      ruleId,
      evaluatorKey,
      enabled: true,
      version,
      ...withDeadline
    };
  });
}
