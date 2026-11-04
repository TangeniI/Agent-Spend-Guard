import { describe, expect, it } from 'vitest';
import { accessFor } from '@/lib/proxy-rules';

const id = '1f0e9c1a-2b3c-4d5e-8f90-123456789abc';

describe('accessFor', () => {
  it.each([
    ['GET', ['mandates']],
    ['GET', ['mandates', id]],
    ['GET', ['approvals']],
    ['GET', ['audit']],
    ['GET', ['runs', id]],
  ])('lets anyone read %s %s', (method, path) => {
    expect(accessFor(method, path)).toBe('public');
  });

  it.each([
    ['POST', ['mandates']],
    ['PATCH', ['mandates', id]],
    ['POST', ['runs']],
    ['POST', ['approvals', id, 'approve']],
    ['POST', ['approvals', id, 'reject']],
  ])('requires admin for %s %s', (method, path) => {
    expect(accessFor(method, path)).toBe('admin');
  });

  it.each([
    ['POST', ['payments']],
    ['POST', ['merchants']],
    ['POST', ['catalogue']],
    ['DELETE', ['mandates', id]],
    ['GET', ['health']],
    ['GET', ['mandates', '..', 'payments']],
    ['GET', ['mandates', 'not-a-uuid']],
    ['POST', ['approvals', id, 'delete']],
    ['GET', ['audit%2F..']],
  ])('refuses %s %s entirely', (method, path) => {
    expect(accessFor(method, path)).toBeNull();
  });
});
