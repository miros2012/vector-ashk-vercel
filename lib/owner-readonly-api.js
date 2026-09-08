import { timingSafeSecretEqual } from './secret-compare.js';
import { ownerPackageFailureStage } from './owner-package-stage.js';

function requestKey(req) {
  const direct = String(req?.headers?.['x-vector-key'] || '').trim();
  const authorization = String(req?.headers?.authorization || '').trim();
  if (direct && authorization) return '';
  if (direct) return direct;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function createOwnerReadonlyApi({ configuredKey = '', readOwnerPackage } = {}) {
  if (typeof readOwnerPackage !== 'function') {
    throw new Error('readOwnerPackage is required');
  }

  const expectedKey = String(configuredKey || '').trim();

  return async function ownerReadonlyApi(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req?.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }

    const key = requestKey(req);
    if (!expectedKey || !timingSafeSecretEqual(key, expectedKey)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    try {
      const ownerPackage = await readOwnerPackage();
      return res.status(200).json({ ok: true, package: ownerPackage });
    } catch (error) {
      console.error(`owner-package-stage:${ownerPackageFailureStage(error)}`);
      return res.status(500).json({ ok: false, error: 'owner package unavailable' });
    }
  };
}
