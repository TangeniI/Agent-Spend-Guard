'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AuditTable } from '@/components/audit-table';
import { ErrorText, Field, Heading, inputClass } from '@/components/ui';
import { api, type AuditEvent } from '@/lib/api';

const TYPES = [
  'PROPOSAL_RECEIVED',
  'DECISION_MADE',
  'PROPOSAL_REPLAYED',
  'IDEMPOTENCY_CONFLICT',
  'PROPOSAL_UNKNOWN_MANDATE',
  'APPROVAL_GRANTED',
  'APPROVAL_BLOCKED',
  'APPROVAL_REJECTED',
  'MANDATE_CREATED',
  'MANDATE_UPDATED',
  'MERCHANT_REGISTERED',
  'CATALOGUE_UPDATED',
  'RUN_STARTED',
  'RUN_FINISHED',
];

export default function AuditPage() {
  const [type, setType] = useState('');
  const [actor, setActor] = useState('');
  const query = new URLSearchParams({ limit: '200', ...(type && { type }), ...(actor && { actor }) });
  const events = useQuery({
    queryKey: ['audit', type, actor],
    queryFn: () => api.get<AuditEvent[]>(`audit?${query}`),
  });

  return (
    <>
      <Heading sub="Every proposal, decision and human action, newest first. The table is append-only in the database.">
        Audit log
      </Heading>
      <div className="mb-4 grid max-w-md grid-cols-2 gap-3">
        <Field label="Event">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Actor">
          <select className={inputClass} value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">All</option>
            {['agent', 'policy', 'human', 'system'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorText error={events.error} />
      <AuditTable events={events.data ?? []} />
    </>
  );
}
