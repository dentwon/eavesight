import Link from 'next/link';
import { Logo } from '@/components/Logo';

export const metadata = {
  title: 'Terms of Service — Eavesight',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-200">
      <nav className="border-b border-slate-800/50">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7"><Logo className="w-full h-full" /></div>
            <span className="font-semibold text-white">Eavesight</span>
          </Link>
        </div>
      </nav>
      <main className="max-w-3xl mx-auto px-6 py-16 prose prose-invert prose-slate">
        <h1>Terms of Service</h1>
        <p className="text-sm text-slate-500">Effective date: 2026-04-26</p>
        <p>
          Eavesight provides storm intelligence, property data, and lead-management tooling
          for residential roofing contractors. By creating an account you agree to these
          terms. This page is a working draft while we are in beta — a finalized version
          will be issued before any paid plan is charged.
        </p>
        <h2>Use of the Service</h2>
        <p>
          You will use the Service only for lawful business purposes and will not (a) attempt
          to access another organization&apos;s data, (b) scrape, mirror, or otherwise extract
          property or owner data in bulk outside the published reveal flow, or (c) use owner
          contact data for any purpose that would violate the federal Telephone Consumer
          Protection Act, the Federal Trade Commission&apos;s Telemarketing Sales Rule, or any
          applicable state Do Not Call rule.
        </p>
        <h2>Reveals and Quotas</h2>
        <p>
          Each subscription tier includes a monthly allotment of property reveals. Revealing
          the same property twice within a billing period consumes one reveal. Quotas reset
          on the first day of each calendar month while we are operating monthly billing
          locally; this will move to Stripe-managed billing periods at general availability.
        </p>
        <h2>Cancellation</h2>
        <p>
          You may cancel your subscription at any time from the dashboard. Cancellations
          take effect at the end of the current billing period; we do not pro-rate refunds.
        </p>
        <p className="text-sm text-slate-500 mt-12">
          Questions: <a href="mailto:hello@eavesight.io" className="text-blue-400">hello@eavesight.io</a>
        </p>
      </main>
    </div>
  );
}
