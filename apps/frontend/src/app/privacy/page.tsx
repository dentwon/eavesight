import Link from 'next/link';
import { Logo } from '@/components/Logo';

export const metadata = {
  title: 'Privacy Policy — Eavesight',
};

export default function PrivacyPage() {
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
        <h1>Privacy Policy</h1>
        <p className="text-sm text-slate-500">Effective date: 2026-04-26</p>

        <h2>What we collect from you</h2>
        <p>
          When you create an account we store your name, email, organization name, and a
          hash of your password (or your Google account identifier if you signed in with
          Google). We log session activity for security and product analytics.
        </p>

        <h2>What we collect about properties</h2>
        <p>
          Eavesight aggregates publicly-available parcel records, county assessor data,
          USGS / NOAA / NWS storm telemetry, and FEMA flood maps. Property owner contact
          information surfaced in the dashboard comes from third-party data providers and
          public records. Owner phone numbers are checked against the National Do Not Call
          Registry before they are surfaced.
        </p>

        <h2>How we use it</h2>
        <p>
          To run the Service, communicate with you about your account, and improve the
          quality of our scoring models. We do not sell your account data. We do not share
          property reveal activity between organizations.
        </p>

        <h2>Your rights</h2>
        <p>
          You may export your leads at any time and may request account deletion by emailing
          <a href="mailto:privacy@eavesight.io" className="text-blue-400"> privacy@eavesight.io</a>.
          California (CCPA) and EU (GDPR) data-subject requests are honored on the same
          channel.
        </p>

        <p className="text-sm text-slate-500 mt-12">
          This is a working draft while we are in beta — a finalized policy will be issued
          before any paid plan is charged.
        </p>
      </main>
    </div>
  );
}
