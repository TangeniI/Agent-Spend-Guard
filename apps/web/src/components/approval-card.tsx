'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdmin } from './session';
import { Button, Card, ErrorText, Reasons } from './ui';
import { api, type PaymentResult, type Pending } from '@/lib/api';
import { formatMinor } from '@/lib/money';

export function ApprovalCard({ pending }: { pending: Pending }) {
  const admin = useAdmin();
  const client = useQueryClient();
  const money = (minor: number) => formatMinor(minor, pending.currency);
  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject') =>
      api.post<PaymentResult>(`approvals/${pending.paymentId}/${action}`),
    onSuccess: () => client.invalidateQueries(),
  });

  const { budgetMinor, spentMinor, heldMinor } = pending.balance;
  const afterApproval = budgetMinor - spentMinor - heldMinor;
  const blocked = decide.data?.status === 'held';

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{pending.merchant}</span>
        <span className="font-mono text-lg">{money(pending.amountMinor)}</span>
      </div>
      <ul className="mt-2 space-y-0.5 text-sm text-stone-600 dark:text-stone-400">
        {pending.items.map((item, index) => (
          <li key={index} className="font-mono text-xs">
            {item.quantity} × {item.sku} at{' '}
            {typeof item.unitPriceMinor === 'number' ? money(item.unitPriceMinor) : '?'}
          </li>
        ))}
      </ul>
      <div className="mt-3 text-sm">
        <span className="text-stone-500">Flagged by: </span>
        <Reasons reasons={pending.reasons} />
      </div>
      <p className="mt-2 text-sm">
        <span className="text-stone-500">Budget left if approved: </span>
        <span className="font-mono">{money(afterApproval)}</span>
        <span className="text-stone-500"> of {money(budgetMinor)}</span>
      </p>
      {pending.agentReason && (
        <p className="mt-2 rounded-lg bg-stone-50 p-2 text-xs text-stone-600 dark:bg-stone-800/50 dark:text-stone-400">
          <span className="font-medium">Agent&apos;s reason</span> (logged, never read by policy): {pending.agentReason}
        </p>
      )}
      {admin && (
        <div className="mt-4 flex gap-2">
          <Button disabled={decide.isPending} onClick={() => decide.mutate('approve')}>
            Approve
          </Button>
          <Button variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate('reject')}>
            Reject
          </Button>
        </div>
      )}
      {blocked && (
        <p className="mt-2 text-sm text-red-600">
          Re-check failed, still held: <Reasons reasons={decide.data!.reasons} />
        </p>
      )}
      <ErrorText error={decide.error} />
    </Card>
  );
}
