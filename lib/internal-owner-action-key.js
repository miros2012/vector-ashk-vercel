import { randomUUID } from 'node:crypto';

export function createInternalOwnerActionKey() {
  return `internal-owner-action:${randomUUID()}`;
}
