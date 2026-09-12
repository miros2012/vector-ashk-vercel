import { createHash, timingSafeEqual } from 'node:crypto';
import { CASH_PHOTO_SHARED_TOKEN_SHA256 } from './cash-photo-shared-key.js';

function parseRegistry(value) {
  try {
    if (typeof value !== 'string' || value.length > 50000) return [];
    const rows = JSON.parse(value);
    if (!Array.isArray(rows) || !rows.length || rows.length > 100) return [];
    const hashes = new Set();
    const identities = new Set();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
      if (Object.keys(row).some(key => !['accessId', 'branch', 'label', 'active', 'tokenSha256'].includes(key))) return [];
      if (typeof row.active !== 'boolean' || !/^[a-f0-9]{64}$/.test(row.tokenSha256 || '')) return [];
      if (['accessId', 'branch'].some(key => typeof row[key] !== 'string' || !row[key].trim() || row[key].length > 120)) return [];
      if (row.label !== undefined && (typeof row.label !== 'string' || row.label.length > 120)) return [];
      if (hashes.has(row.tokenSha256) || identities.has(row.accessId.trim())) return [];
      hashes.add(row.tokenSha256);
      identities.add(row.accessId.trim());
    }
    return rows;
  } catch { return []; }
}

export function createCashPhotoAccessStore({
  registryJson = process.env.CASH_PHOTO_ACCESS_JSON,
  sharedTokenSha256 = process.env.CASH_PHOTO_SHARED_TOKEN_SHA256 ?? CASH_PHOTO_SHARED_TOKEN_SHA256
} = {}) {
  const rows = parseRegistry(registryJson);
  const branches = [...new Map(rows.filter(row => row.active).map(row => [row.branch.trim(), {
    branch: row.branch.trim(), label: (row.label || row.branch).trim()
  }])).values()];
  const sharedHash = typeof sharedTokenSha256 === 'string' && /^[a-f0-9]{64}$/.test(sharedTokenSha256)
    ? Buffer.from(sharedTokenSha256, 'hex') : null;
  return {
    configured: rows.some(row => row.active),
    async authorize(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const hash = createHash('sha256').update(token).digest();
      if (sharedHash && branches.length && timingSafeEqual(hash, sharedHash)) {
        return { accessId: 'STAFF:SHARED', role: 'Сотрудники', branches: branches.map(branch => ({ ...branch })) };
      }
      const row = rows.find(row => timingSafeEqual(hash, Buffer.from(row.tokenSha256, 'hex')));
      if (!row?.active) return null;
      return { accessId: row.accessId.trim(), role: 'Филиал', branch: row.branch.trim(), label: (row.label || row.branch).trim() };
    }
  };
}
