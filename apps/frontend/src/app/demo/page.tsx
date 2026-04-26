import Link from 'next/link';
import { Logo } from '@/components/Logo';

export const metadata = {
  title: 'See Eavesight in action — Eavesight',
};

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 flex flex-col">
      <nav className="border-b border-slate-800/50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7"><Logo className="w-full h-full" /></div>
            <span className="font-semibold text-white">Eavesight</span>
          </Link>
          <Link href="/signup" className="text-sm text-blue-400 hover:text-blue-300">Start free →</Link>
        </div>
      </nav>
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-xl text-center">
          <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Live demo coming soon
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            See Eavesight on a real Huntsville storm
          </h1>
          <p className="text-slate-400 mb-8">
            We&apos;re recording a guided walkthrough of the storm map, lead scoring, and
            mobile field-capture flow on a recent North Alabama hail event. While that&apos;s
            in production you can spin up the live product on the Scout (free) tier — no
            credit card required.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/signup?plan=scout" className="px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm">
              Try Scout (Free)
            </Link>
            <a href="mailto:hello@eavesight.io?subject=Eavesight%20live%20demo" className="px-6 py-3 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white font-semibold text-sm">
              Schedule a 1-on-1 demo
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
