import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 ${className}`}
    >
      {children}
    </section>
  );
}

export function Heading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {sub && <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{sub}</p>}
    </div>
  );
}

const TONES = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
  red: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  grey: 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900',
};

export type Tone = keyof typeof TONES;

export function Badge({ children, tone = 'grey' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  if (status === 'executed' || status === 'completed' || status === 'active') return 'green';
  if (status === 'rejected' || status === 'failed' || status === 'revoked') return 'red';
  if (status === 'held' || status === 'paused' || status === 'running') return 'amber';
  return 'grey';
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-stone-900 text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300',
    secondary:
      'bg-white text-stone-900 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
    danger: 'bg-red-600 text-white hover:bg-red-500',
  };
  return (
    <button
      {...props}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-600 dark:text-stone-400">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950';

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-stone-500">{children}</p>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-600">{(error as Error).message}</p>;
}

export function Reasons({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <code
          key={reason}
          className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-700 dark:bg-stone-800 dark:text-stone-300"
        >
          {reason}
        </code>
      ))}
    </span>
  );
}
