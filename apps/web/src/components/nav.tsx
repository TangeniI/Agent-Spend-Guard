'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAdmin, useSignOut } from './session';

const LINKS = [
  { href: '/', label: 'Mandates' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/audit', label: 'Audit log' },
  { href: '/redteam', label: 'Red-team' },
];

export function Nav() {
  const pathname = usePathname();
  const admin = useAdmin();
  const signOut = useSignOut();

  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur dark:border-stone-800 dark:bg-stone-950/80">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          Agent Spend Guard
        </Link>
        <nav className="flex flex-wrap gap-4 text-sm">
          {LINKS.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? 'font-medium' : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-100'}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto text-sm">
          {admin ? (
            <button onClick={signOut} className="text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
              Admin · sign out
            </button>
          ) : (
            <Link href="/login" className="text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
              Admin sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
