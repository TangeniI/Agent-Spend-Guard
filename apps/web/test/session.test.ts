import { describe, expect, it } from 'vitest';
import { isAdmin, sessionToken } from '@/lib/session';

describe('admin session', () => {
  it('accepts the token derived from the password', () => {
    expect(isAdmin(sessionToken('pw'), 'pw')).toBe(true);
  });

  it('rejects a wrong or missing cookie', () => {
    expect(isAdmin(sessionToken('other'), 'pw')).toBe(false);
    expect(isAdmin(undefined, 'pw')).toBe(false);
    expect(isAdmin('', 'pw')).toBe(false);
  });

  it('fails closed when no password is configured', () => {
    expect(isAdmin(sessionToken(''), '')).toBe(false);
    expect(isAdmin('anything', undefined)).toBe(false);
  });
});
