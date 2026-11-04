'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApprovalCard } from '@/components/approval-card';
import { AuditTable } from '@/components/audit-table';
import { BalanceBar } from '@/components/balance-bar';
import { useAdmin } from '@/components/session';
import { Badge, Button, Card, Empty, ErrorText, Heading, inputClass, statusTone } from '@/components/ui';
import { api, type AuditEvent, type Mandate, type Pending, type Run } from '@/lib/api';
import { formatMinor } from '@/lib/money';

export default function MandatePage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const router = useRouter();
  const client = useQueryClient();
  const [task, setTask] = useState('Buy a phone case under £15.');

  const mandate = useQuery({ queryKey: ['mandate', id], queryFn: () => api.get<Mandate>(`mandates/${id}`) });
  const runs = useQuery({ queryKey: ['runs', id], queryFn: () => api.get<Run[]>(`runs?mandateId=${id}`) });
  const pending = useQuery({
    queryKey: ['approvals', id],
    queryFn: () => api.get<Pending[]>(`approvals?mandateId=${id}`),
  });
  const audit = useQuery({
    queryKey: ['audit', id],
    queryFn: () => api.get<AuditEvent[]>(`audit?mandateId=${id}&limit=15`),
  });

  const update = useMutation({
    mutationFn: (change: Partial<Pick<Mandate, 'killSwitch' | 'status'>>) => api.patch(`mandates/${id}`, change),
    onSuccess: () => client.invalidateQueries(),
  });
  const start = useMutation({
    mutationFn: () => api.post<{ id: string }>('runs', { mandateId: id, task }),
    onSuccess: ({ id: runId }) => router.push(`/runs/${runId}`),
  });

  const m = mandate.data;
  if (mandate.error) return <ErrorText error={mandate.error} />;
  if (!m) return null;
  const money = (minor: number) => formatMinor(minor, m.balance.currency);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start.mutate();
  };

  return (
    <>
      <Heading sub={<span className="font-mono">{m.id}</span>}>
        <span className="flex flex-wrap items-center gap-2">
          Mandate <Badge tone={statusTone(m.status)}>{m.status}</Badge>
          {m.killSwitch && <Badge tone="red">kill switch on</Badge>}
        </span>
      </Heading>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <BalanceBar balance={m.balance} />
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-stone-500">Limit per item</dt>
              <dd>{money(m.perItemLimitMinor)}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Needs approval at</dt>
              <dd>{money(m.approvalThresholdMinor)}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Max quantity</dt>
              <dd>{m.maxQuantityPerItem}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Categories</dt>
              <dd>{m.allowedMerchantCategories.join(', ')}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Split window</dt>
              <dd>{m.splitWindowMinutes} min</dd>
            </div>
            <div>
              <dt className="text-stone-500">Expires</dt>
              <dd>{new Date(m.expiresAt).toLocaleString('en-GB')}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 font-medium">Controls</h2>
          {admin ? (
            <div className="space-y-3">
              <Button
                variant={m.killSwitch ? 'secondary' : 'danger'}
                className="w-full"
                disabled={update.isPending}
                onClick={() => update.mutate({ killSwitch: !m.killSwitch })}
              >
                {m.killSwitch ? 'Turn kill switch off' : 'Kill switch: stop all spending'}
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                disabled={update.isPending || m.status === 'revoked'}
                onClick={() => update.mutate({ status: m.status === 'active' ? 'paused' : 'active' })}
              >
                {m.status === 'active' ? 'Pause mandate' : 'Resume mandate'}
              </Button>
              <ErrorText error={update.error} />
              <p className="text-xs text-stone-500">
                The kill switch takes the mandate&apos;s lock, so once it is on, nothing in flight can still pay.
              </p>
            </div>
          ) : (
            <p className="text-sm text-stone-500">
              <Link href="/login" className="underline">
                Sign in as admin
              </Link>{' '}
              to use the kill switch or run the agent.
            </p>
          )}
        </Card>
      </div>

      {admin && (
        <Card className="mt-4">
          <h2 className="mb-3 font-medium">Run the agent</h2>
          <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
            <input className={inputClass} value={task} onChange={(e) => setTask(e.target.value)} maxLength={2000} />
            <Button type="submit" disabled={start.isPending || !task.trim()}>
              Start run
            </Button>
          </form>
          <ErrorText error={start.error} />
        </Card>
      )}

      {(pending.data?.length ?? 0) > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 font-medium">Waiting for approval</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {pending.data!.map((p) => (
              <ApprovalCard key={p.paymentId} pending={p} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-medium">Agent runs</h2>
          <Card className="p-0">
            {runs.data?.length === 0 && <Empty>No runs yet.</Empty>}
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {runs.data?.map((run) => (
                <li key={run.id}>
                  <Link href={`/runs/${run.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-stone-50 dark:hover:bg-stone-800/50">
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                    <span className="truncate">{run.task}</span>
                    <span className="ml-auto shrink-0 text-xs text-stone-500">
                      {new Date(run.createdAt).toLocaleTimeString('en-GB')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div>
          <h2 className="mb-3 font-medium">Recent audit events</h2>
          <AuditTable events={audit.data ?? []} compact />
        </div>
      </div>
    </>
  );
}
