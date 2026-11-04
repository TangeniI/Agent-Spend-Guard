import Link from 'next/link';
import { Badge, Card, Empty, type Tone } from './ui';
import type { AuditEvent } from '@/lib/api';

const ACTOR_TONES: Record<AuditEvent['actor'], Tone> = {
  agent: 'blue',
  policy: 'amber',
  human: 'green',
  system: 'grey',
};

export function AuditTable({
  events,
  compact = false,
  loading = false,
}: {
  events: AuditEvent[];
  compact?: boolean;
  loading?: boolean;
}) {
  if (events.length === 0) {
    return (
      <Card>
        <Empty>{loading ? 'Loading…' : 'No events.'}</Empty>
      </Card>
    );
  }
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200 text-xs text-stone-500 dark:border-stone-800">
          <tr>
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-4 py-2 font-medium">Event</th>
            <th className="px-4 py-2 font-medium">Actor</th>
            {!compact && <th className="px-4 py-2 font-medium">Mandate</th>}
            {!compact && <th className="px-4 py-2 font-medium">Details</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {events.map((event) => (
            <tr key={event.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-stone-500">
                {new Date(event.createdAt).toLocaleTimeString('en-GB')}
              </td>
              <td className="px-4 py-2 font-mono text-xs">{event.type}</td>
              <td className="px-4 py-2">
                <Badge tone={ACTOR_TONES[event.actor]}>{event.actor}</Badge>
              </td>
              {!compact && (
                <td className="px-4 py-2 font-mono text-xs">
                  {event.mandateId ? (
                    <Link href={`/mandates/${event.mandateId}`} className="underline">
                      {event.mandateId.slice(0, 8)}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
              )}
              {!compact && (
                <td className="px-4 py-2">
                  <details>
                    <summary className="cursor-pointer text-xs text-stone-500">payload</summary>
                    <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </details>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
