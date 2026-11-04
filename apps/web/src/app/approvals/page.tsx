'use client';

import { useQuery } from '@tanstack/react-query';
import { ApprovalCard } from '@/components/approval-card';
import { Empty, ErrorText, Heading } from '@/components/ui';
import { api, type Pending } from '@/lib/api';

export default function ApprovalsPage() {
  const pending = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api.get<Pending[]>('approvals'),
    refetchInterval: 5_000,
  });

  return (
    <>
      <Heading sub="Payments policy held for a human. Approving re-checks the kill switch, status and expiry first.">
        Approval queue
      </Heading>
      <ErrorText error={pending.error} />
      {pending.data?.length === 0 && <Empty>Nothing is waiting for approval.</Empty>}
      <div className="grid gap-4 md:grid-cols-2">
        {pending.data?.map((p) => (
          <ApprovalCard key={p.paymentId} pending={p} />
        ))}
      </div>
    </>
  );
}
