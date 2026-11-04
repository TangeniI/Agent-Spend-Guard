export type Access = 'public' | 'admin';

interface Rule {
  method: string;
  pattern: RegExp;
  access: Access;
}

const ID = '[0-9a-fA-F-]{36}';

/**
 * The only API routes the browser can reach. Reads are public so visitors can see the demo.
 * Anything that changes state, or spends model quota, needs the admin session.
 * POST /payments is deliberately absent: only the agent, inside the API, can propose a payment.
 */
const RULES: Rule[] = [
  { method: 'GET', pattern: /^mandates$/, access: 'public' },
  { method: 'GET', pattern: new RegExp(`^mandates/${ID}$`), access: 'public' },
  { method: 'GET', pattern: /^approvals$/, access: 'public' },
  { method: 'GET', pattern: /^audit$/, access: 'public' },
  { method: 'GET', pattern: /^runs$/, access: 'public' },
  { method: 'GET', pattern: new RegExp(`^runs/${ID}$`), access: 'public' },
  { method: 'GET', pattern: /^merchants$/, access: 'public' },
  { method: 'GET', pattern: /^catalogue$/, access: 'public' },
  { method: 'POST', pattern: /^mandates$/, access: 'admin' },
  { method: 'PATCH', pattern: new RegExp(`^mandates/${ID}$`), access: 'admin' },
  { method: 'POST', pattern: /^runs$/, access: 'admin' },
  { method: 'POST', pattern: new RegExp(`^approvals/${ID}/(approve|reject)$`), access: 'admin' },
];

export function accessFor(method: string, segments: string[]): Access | null {
  if (segments.some((s) => !/^[A-Za-z0-9-]+$/.test(s))) return null;
  const path = segments.join('/');
  return RULES.find((r) => r.method === method && r.pattern.test(path))?.access ?? null;
}
