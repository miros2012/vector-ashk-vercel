function allowedActions(decision) {
  if (!decision?.active) return [];
  const execution = String(decision.executionStatus || '');
  const verification = String(decision.verificationStatus || 'Не проверено');
  if (execution === 'Не начато') return ['start'];
  if (execution === 'В работе') return ['complete'];
  if (execution === 'Готово' && verification === 'Не проверено') {
    return ['verify_confirmed', 'verify_no_effect', 'verify_na'];
  }
  return [];
}

function sortKey(decision) {
  const rank = Number.isFinite(Number(decision.rank)) ? Number(decision.rank) : Number.MAX_SAFE_INTEGER;
  const deadline = decision.deadline ? String(decision.deadline) : '9999-12-31';
  const ruleId = String(decision.ruleId || '');
  return { rank, deadline, ruleId };
}

function compare(a, b) {
  const ak = sortKey(a);
  const bk = sortKey(b);
  if (ak.rank !== bk.rank) return ak.rank - bk.rank;
  if (ak.deadline !== bk.deadline) return ak.deadline.localeCompare(bk.deadline);
  return ak.ruleId.localeCompare(bk.ruleId);
}

function publicDecision(decision) {
  return {
    ruleId: decision.ruleId ?? null,
    title: decision.title ?? null,
    deviation: decision.deviation ?? null,
    recommendation: decision.recommendation ?? null,
    task: decision.task ?? null,
    assignee: decision.assignee ?? null,
    deadline: decision.deadline ?? null,
    priority: decision.priority ?? null,
    executionStatus: decision.executionStatus ?? null,
    verificationStatus: decision.verificationStatus ?? null,
    plannedEffect: decision.plannedEffect ?? null,
    actualEffect: decision.actualEffect ?? null,
    linkedObject: decision.linkedObject ?? null,
    lastResult: decision.lastResult ?? null,
    lastChecked: decision.lastChecked ?? null,
    allowedActions: allowedActions(decision)
  };
}

export function buildOwnerActionView(decisions = []) {
  const active = decisions.filter((row) => row?.active === true).sort(compare);
  return {
    top: active.length ? publicDecision(active[0]) : null,
    activeCount: active.length
  };
}
