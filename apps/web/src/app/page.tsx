'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { BalanceBar } from '@/components/balance-bar';
import { useAdmin } from '@/components/session';
import { Badge, Button, Card, Empty, ErrorText, Field, Heading, inputClass, statusTone } from '@/components/ui';
import { api, type Mandate } from '@/lib/api';
import { formatMinor } from '@/lib/money';

const PENCE = /^\d+(\.\d{1,2})?$/;

/** Turns "12.99" into 1299 with string arithmetic, never a float. */
function toMinor(value: string) {
  if (!PENCE.test(value.trim())) return Number.NaN;
  const [pounds, pence = ''] = value.trim().split('.');
  return Number(pounds) * 100 + Number(pence.padEnd(2, '0'));
}

function NewMandate() {
  const client = useQueryClient();
  const [form, setForm] = useState({
    budget: '50.00',
    perItem: '20.00',
    threshold: '25.00',
    quantity: '1',
    categories: 'accessories',
    days: '7',
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<Mandate>('mandates', {
        currency: 'GBP',
        budgetMinor: toMinor(form.budget),
        perItemLimitMinor: toMinor(form.perItem),
        approvalThresholdMinor: toMinor(form.threshold),
        maxQuantityPerItem: Number(form.quantity),
        allowedMerchantCategories: form.categories.split(',').map((c) => c.trim()).filter(Boolean),
        expiresAt: new Date(Date.now() + Number(form.days) * 86_400_000).toISOString(),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['mandates'] }),
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Card>
      <h2 className="mb-4 font-medium">New mandate</h2>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field label="Budget (£)">
          <input className={inputClass} value={form.budget} onChange={set('budget')} inputMode="decimal" />
        </Field>
        <Field label="Limit per item (£)">
          <input className={inputClass} value={form.perItem} onChange={set('perItem')} inputMode="decimal" />
        </Field>
        <Field label="Needs approval at (£)">
          <input className={inputClass} value={form.threshold} onChange={set('threshold')} inputMode="decimal" />
        </Field>
        <Field label="Max quantity per item">
          <input className={inputClass} value={form.quantity} onChange={set('quantity')} inputMode="numeric" />
        </Field>
        <Field label="Allowed categories">
          <input className={inputClass} value={form.categories} onChange={set('categories')} />
        </Field>
        <Field label="Expires in (days)">
          <input className={inputClass} value={form.days} onChange={set('days')} inputMode="numeric" />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={create.isPending}>
            Create mandate
          </Button>
          <ErrorText error={create.error} />
        </div>
      </form>
    </Card>
  );
}

export default function Home() {
  const admin = useAdmin();
  const mandates = useQuery({ queryKey: ['mandates'], queryFn: () => api.get<Mandate[]>('mandates') });

  return (
    <>
      <div className="mb-10 max-w-2xl">
        <p className="text-sm font-medium text-stone-500">Agent Spend Guard</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          The AI suggests, the rules decide.
        </h1>
        <p className="mt-3 text-stone-600 dark:text-stone-400">
          A shopping agent can browse and propose a payment, but it can never move money itself. Every proposal goes
          through deterministic policy, a human for anything large, and an idempotent double-entry ledger.
        </p>
      </div>

      <Heading sub="What each user has allowed the agent to spend.">Mandates</Heading>

      {admin && (
        <div className="mb-6">
          <NewMandate />
        </div>
      )}

      <ErrorText error={mandates.error} />
      {mandates.data?.length === 0 && <Empty>No mandates yet.</Empty>}
      <div className="grid gap-4 md:grid-cols-2">
        {mandates.data?.map((m) => (
          <Link key={m.id} href={`/mandates/${m.id}`} className="block">
            <Card className="transition hover:border-stone-400 dark:hover:border-stone-600">
              <div className="mb-3 flex items-center gap-2">
                <span className="font-mono text-xs text-stone-500">{m.id.slice(0, 8)}</span>
                <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                {m.killSwitch && <Badge tone="red">kill switch on</Badge>}
                <span className="ml-auto text-xs text-stone-500">
                  up to {formatMinor(m.perItemLimitMinor, m.balance.currency)} per item
                </span>
              </div>
              <BalanceBar balance={m.balance} />
              <p className="mt-3 text-xs text-stone-500">Allowed: {m.allowedMerchantCategories.join(', ')}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
