'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

export function useAdmin() {
  const { data } = useQuery({
    queryKey: ['session'],
    queryFn: async () => (await (await fetch('/api/session')).json()) as { admin: boolean },
  });
  return data?.admin ?? false;
}

export function useSignOut() {
  const client = useQueryClient();
  return async () => {
    await fetch('/api/session', { method: 'DELETE' });
    await client.invalidateQueries({ queryKey: ['session'] });
  };
}
