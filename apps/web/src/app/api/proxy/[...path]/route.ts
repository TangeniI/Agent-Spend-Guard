import { cookies } from 'next/headers';
import { accessFor } from '@/lib/proxy-rules';
import { isAdmin, SESSION_COOKIE } from '@/lib/session';

const apiUrl = () => process.env.API_URL ?? 'http://localhost:3001';

async function forward(request: Request, segments: string[]) {
  const access = accessFor(request.method, segments);
  if (!access) return Response.json({ message: 'Not found' }, { status: 404 });

  if (access === 'admin') {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!isAdmin(session)) {
      return Response.json({ message: 'Sign in as admin to do this.' }, { status: 401 });
    }
  }

  const token = process.env.API_SERVICE_TOKEN;
  if (!token) return Response.json({ message: 'The web app has no API token.' }, { status: 503 });

  const { search } = new URL(request.url);
  const response = await fetch(`${apiUrl()}/${segments.join('/')}${search}`, {
    method: request.method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: request.method === 'GET' ? undefined : await request.text(),
    cache: 'no-store',
  });
  return new Response(response.body, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return forward(request, (await params).path);
}

export async function POST(request: Request, { params }: Context) {
  return forward(request, (await params).path);
}

export async function PATCH(request: Request, { params }: Context) {
  return forward(request, (await params).path);
}
