import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'asg_admin';

const digest = (value: string) => createHmac('sha256', 'asg-compare').update(value).digest();

export function equalSecrets(a: string, b: string) {
  return timingSafeEqual(digest(a), digest(b));
}

/** The cookie value is derived from the password, so changing the password ends every session. */
export function sessionToken(password: string) {
  return createHmac('sha256', password).update('asg-admin-session-v1').digest('hex');
}

/** Fails closed: with no ADMIN_PASSWORD configured, nobody is an admin. */
export function isAdmin(cookie: string | undefined, password = process.env.ADMIN_PASSWORD) {
  if (!password || !cookie) return false;
  return equalSecrets(cookie, sessionToken(password));
}
