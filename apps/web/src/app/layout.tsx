import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Spend Guard',
  description: 'A safety layer between an AI shopping agent and a payment. The AI suggests, the rules decide.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-stone-500">
            Payments are simulated. No real money moves, and this does not use Visa&apos;s APIs.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
