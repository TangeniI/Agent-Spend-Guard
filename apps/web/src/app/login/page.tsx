'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Card, Field, Heading, inputClass } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const client = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) return setError('Wrong password.');
    await client.invalidateQueries({ queryKey: ['session'] });
    router.push('/');
  };

  return (
    <div className="mx-auto max-w-sm">
      <Heading sub="Anyone can look around. Spending actions need the admin password.">Admin sign in</Heading>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Password">
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </Card>
    </div>
  );
}
