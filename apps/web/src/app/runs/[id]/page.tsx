'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, ErrorText, Heading, Reasons, statusTone } from '@/components/ui';
import { api, type Run, type Step } from '@/lib/api';
import { formatMinor } from '@/lib/money';

function Proposal({ args }: { args: Record<string, unknown> }) {
  const amount = typeof args.amount_minor === 'number' ? args.amount_minor : null;
  const currency = typeof args.currency === 'string' && /^[A-Z]{3}$/.test(args.currency) ? args.currency : 'GBP';
  return (
    <span>
      {String(args.merchant)} · {amount === null ? String(args.amount_minor) : formatMinor(amount, currency)}
      {currency !== 'GBP' && ` (${String(args.currency)})`}
    </span>
  );
}

function StepRow({ step }: { step: Step }) {
  const { payload } = step;
  if (step.type === 'model') {
    if (!payload.text) return null;
    return (
      <li className="rounded-lg bg-stone-100 px-4 py-3 text-sm dark:bg-stone-800/60">
        <span className="mb-1 block text-xs font-medium text-stone-500">Model</span>
        {payload.text}
      </li>
    );
  }

  const output = payload.output ?? {};
  const isPayment = payload.name === 'propose_payment';
  return (
    <li className="rounded-lg border border-stone-200 px-4 py-3 text-sm dark:border-stone-800">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-xs">{payload.name}</code>
        {isPayment ? (
          <Proposal args={payload.args ?? {}} />
        ) : (
          <span className="truncate font-mono text-xs text-stone-500">{String(payload.args?.url ?? '')}</span>
        )}
        {output.status && <Badge tone={statusTone(output.status)}>{output.status}</Badge>}
        {output.error && <Badge tone="red">error</Badge>}
      </div>
      {output.reasons && output.reasons.length > 0 && (
        <div className="mt-2">
          <Reasons reasons={output.reasons} />
        </div>
      )}
      {output.error && <p className="mt-1 text-xs text-red-600">{output.error}</p>}
      {isPayment && typeof payload.args?.reason === 'string' && (
        <p className="mt-1 text-xs text-stone-500">Agent&apos;s reason (not used by policy): {payload.args.reason}</p>
      )}
    </li>
  );
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const run = useQuery({
    queryKey: ['run', id],
    queryFn: () => api.get<Run & { steps: Step[] }>(`runs/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1_000 : false),
  });

  const data = run.data;
  if (run.error) return <ErrorText error={run.error} />;
  if (!data) return null;

  return (
    <>
      <Heading
        sub={
          <Link href={`/mandates/${data.mandateId}`} className="underline">
            Mandate {data.mandateId.slice(0, 8)}
          </Link>
        }
      >
        <span className="flex flex-wrap items-center gap-2">
          {data.task} <Badge tone={statusTone(data.status)}>{data.status}</Badge>
        </span>
      </Heading>

      <ol className="space-y-2">
        {data.steps.map((step) => (
          <StepRow key={step.seq} step={step} />
        ))}
        {data.status === 'running' && <li className="animate-pulse text-sm text-stone-500">Thinking…</li>}
      </ol>

      {data.status !== 'running' && (
        <Card className="mt-6">
          <p className="text-sm">{data.result ?? data.error}</p>
        </Card>
      )}
    </>
  );
}
