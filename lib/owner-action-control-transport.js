export async function stageOwnerActionControl({
  control = {},
  appendCommand,
  setControlState,
  requestId,
  now = () => new Date()
}) {
  const action = String(control.requestedAction || '').trim();
  const currentRequestId = String(control.currentRequestId || '').trim();
  if (!action) return { staged: 0, requestId: null };
  if (currentRequestId) return { staged: 0, requestId: currentRequestId };

  const id = String(requestId()).trim();
  if (!id) throw new Error('requestId generator returned an empty value');
  const createdAt = now().toISOString();
  const command = {
    requestId: id,
    ruleId: String(control.ruleId || '').trim(),
    action,
    expectedExecutionStatus: String(control.expectedExecutionStatus || '').trim(),
    actor: 'Собственник',
    result: String(control.result || '').trim(),
    verificationStatus: '',
    actualEffect: control.actualEffect ?? null,
    evidence: String(control.evidence || '').trim(),
    commandStatus: 'READY',
    response: '',
    createdAt,
    processedAt: ''
  };

  await appendCommand(command);
  await setControlState({
    currentRequestId: id,
    processedRequestId: '',
    transportStatus: 'READY',
    lastError: '',
    updatedAt: createdAt
  });
  return { staged: 1, requestId: id };
}

export async function finalizeOwnerActionControl({
  result,
  setControlState,
  clearDashboardInputs
}) {
  const success = result.commandStatus === 'SUCCESS';
  await setControlState({
    currentRequestId: success ? '' : String(result.requestId || ''),
    processedRequestId: success ? String(result.requestId || '') : '',
    transportStatus: String(result.commandStatus || ''),
    lastError: success ? '' : String(result.response || ''),
    updatedAt: String(result.processedAt || '')
  });
  if (success) await clearDashboardInputs();
}
