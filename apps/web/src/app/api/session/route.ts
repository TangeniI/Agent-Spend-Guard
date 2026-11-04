import { cookies } from 'next/headers';
import { equalSecrets, isAdmin, SESSION_COOKIE, sessionToken } from '@/lib/session';

const FAILED_LOGIN_DELAY_MS = 500;

export async function GET() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return Response.json({ admin: isAdmin(session) });
}

export async function POST(request: Request) {
  const password = process.env.ADMIN_PASSWORD;
  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const supplied = typeof body.password === 'string' ? body.password : '';

  if (!password || !equalSecrets(supplied, password)) {
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    return Response.json({ message: 'Wrong password.' }, { status: 401 });
  }

  (await cookies()).set(SESSION_COOKIE, sessionToken(password), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return Response.json({ admin: true });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ admin: false });
}
