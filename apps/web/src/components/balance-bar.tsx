import { formatMinor } from '@/lib/money';
import type { Balance } from '@/lib/api';

export function BalanceBar({ balance }: { balance: Balance }) {
  const { budgetMinor, spentMinor, heldMinor, currency } = balance;
  const remaining = budgetMinor - spentMinor - heldMinor;
  const percent = (part: number) => `${budgetMinor === 0 ? 0 : (part * 100) / budgetMinor}%`;

  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
        <div className="bg-stone-900 dark:bg-stone-100" style={{ width: percent(spentMinor) }} />
        <div className="bg-amber-400" style={{ width: percent(heldMinor) }} />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-stone-500">Spent</dt>
          <dd className="font-mono">{formatMinor(spentMinor, currency)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Held for approval</dt>
          <dd className="font-mono">{formatMinor(heldMinor, currency)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Remaining of {formatMinor(budgetMinor, currency)}</dt>
          <dd className="font-mono">{formatMinor(remaining, currency)}</dd>
        </div>
      </dl>
    </div>
  );
}
