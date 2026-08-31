import { evaluateDecisionRule } from './decision-rule-evaluators.js';

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

export function evaluateDecisionCatalog(catalog = [], snapshot = {}, now = new Date()) {
  if (!Array.isArray(catalog)) throw new Error('catalog must be an array');
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

    return {
      ruleId,
      evaluatorKey,
      enabled: true,
      version,
      ...evaluateDecisionRule(evaluatorKey, snapshot, now)
    };
  });
}
