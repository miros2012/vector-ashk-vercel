export async function invokeDecisionHandler(handler, configuredKey, command) {
  if (typeof handler !== 'function') throw new Error('handler is required');
  let status = 500;
  let body = null;
  const res = {
    setHeader() {},
    status(code) { status = Number(code); return this; },
    json(value) { body = value; return this; }
  };
  await handler({ method:'POST', headers:{ 'x-vector-key':configuredKey }, body:command }, res);
  return { status, body };
}

export function createOwnerActionRequestProcessor({
  readPending,
  markSent,
  executeCommand,
  markSuccess,
  markError
}) {
  for (const [name, fn] of Object.entries({ readPending, markSent, executeCommand, markSuccess, markError })) {
    if (typeof fn !== 'function') throw new Error(`${name} is required`);
  }

  return async function processOwnerActionRequest() {
    let pending;
    try {
      pending = await readPending();
    } catch (error) {
      const message = String(error?.message || error);
      await markError('', message, { consume:false });
      return { processed:true, ok:false, status:400, error:message };
    }
    if (!pending?.command) return { processed:false, ok:true };
    const id = String(pending.command.requestId || '').trim();
    await markSent(id);
    try {
      const response = await executeCommand(pending.command);
      const status = Number(response?.status || 500);
      const body = response?.body || {};
      if (status >= 200 && status < 300 && body.ok !== false) {
        await markSuccess(id, body);
        return { processed:true, ok:true, status, body };
      }
      const message = String(body.error || `decision event HTTP ${status}`);
      const consume = status >= 400 && status < 500;
      await markError(id, message, { consume });
      return { processed:true, ok:false, status, error:message };
    } catch (error) {
      const message = String(error?.message || error);
      await markError(id, message, { consume:false });
      return { processed:true, ok:false, status:500, error:message };
    }
  };
}
