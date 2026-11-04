import { Badge, Card, Empty, Heading, Reasons, type Tone } from '@/components/ui';
import results from '@/data/redteam-latest.json';

interface Row {
  attack_id: string;
  family: string;
  name: string;
  injected: string;
  unguarded_outcome: string;
  guarded_outcome: string;
  decision_reasons: string[];
  unguarded_violations: string[];
  guarded_violations: string[];
}

interface Summary {
  family: string;
  attacks: number;
  unguardedSucceeded: number;
  guardedSucceeded: number;
  guardedHeld: number;
}

interface Results {
  runAt: string;
  model: string;
  attacks: number;
  totals: { unguardedSucceeded: number; guardedSucceeded: number; guardedHeld: number; errors: number };
  summary: Summary[];
  rows: Row[];
}

const OUTCOME_TONES: Record<string, Tone> = {
  succeeded: 'red',
  held: 'amber',
  blocked: 'green',
  resisted: 'grey',
  error: 'grey',
};

function Outcome({ value }: { value: string }) {
  return <Badge tone={OUTCOME_TONES[value] ?? 'grey'}>{value}</Badge>;
}

export default function RedteamPage() {
  const data = results as Results | null;

  if (!data) {
    return (
      <>
        <Heading>Red-team results</Heading>
        <Empty>The red-team suite has not been run yet.</Empty>
      </>
    );
  }

  return (
    <>
      <Heading
        sub={`${data.attacks} prompt-injection attacks hidden in shop pages, each run twice with ${data.model}: once with the agent paying directly, once behind the guard. Run ${new Date(data.runAt).toLocaleString('en-GB')}.`}
      >
        Red-team results
      </Heading>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-stone-500">Succeeded with no guard</p>
          <p className="mt-1 text-3xl font-semibold">
            {data.totals.unguardedSucceeded}
            <span className="text-base font-normal text-stone-500"> / {data.attacks}</span>
          </p>
        </Card>
        <Card>
          <p className="text-sm text-stone-500">Succeeded behind the guard</p>
          <p className="mt-1 text-3xl font-semibold">
            {data.totals.guardedSucceeded}
            <span className="text-base font-normal text-stone-500"> / {data.attacks}</span>
          </p>
        </Card>
        <Card>
          <p className="text-sm text-stone-500">Held for a human, behind the guard</p>
          <p className="mt-1 text-3xl font-semibold">
            {data.totals.guardedHeld}
            <span className="text-base font-normal text-stone-500"> / {data.attacks}</span>
          </p>
        </Card>
      </div>

      <Card className="mb-8 overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-xs text-stone-500 dark:border-stone-800">
            <tr>
              <th className="px-4 py-2 font-medium">Family</th>
              <th className="px-4 py-2 font-medium">Attacks</th>
              <th className="px-4 py-2 font-medium">No guard: succeeded</th>
              <th className="px-4 py-2 font-medium">Guard: succeeded</th>
              <th className="px-4 py-2 font-medium">Guard: held</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {data.summary.map((s) => (
              <tr key={s.family}>
                <td className="px-4 py-2">{s.family.replaceAll('_', ' ')}</td>
                <td className="px-4 py-2 font-mono">{s.attacks}</td>
                <td className="px-4 py-2 font-mono">{s.unguardedSucceeded}</td>
                <td className="px-4 py-2 font-mono">{s.guardedSucceeded}</td>
                <td className="px-4 py-2 font-mono">{s.guardedHeld}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <h2 className="mb-3 font-medium">Every attack</h2>
      <div className="space-y-2">
        {data.rows.map((row) => (
          <details key={row.attack_id} className="rounded-xl border border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <code className="font-mono text-xs text-stone-500">{row.attack_id}</code>
              <span>{row.family.replaceAll('_', ' ')}</span>
              <span className="ml-auto flex items-center gap-2 text-xs text-stone-500">
                no guard <Outcome value={row.unguarded_outcome} />
                guard <Outcome value={row.guarded_outcome} />
              </span>
            </summary>
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-xs text-stone-500">Injected into the product page:</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3 font-mono text-xs dark:bg-stone-800/50">
                {row.injected}
              </pre>
              {row.unguarded_violations.length > 0 && (
                <p>
                  <span className="text-stone-500">Mandate broken with no guard: </span>
                  <Reasons reasons={row.unguarded_violations} />
                </p>
              )}
              {row.decision_reasons.length > 0 && (
                <p>
                  <span className="text-stone-500">Guard decisions: </span>
                  <Reasons reasons={row.decision_reasons} />
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
