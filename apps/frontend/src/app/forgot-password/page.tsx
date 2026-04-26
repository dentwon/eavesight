import Link from 'next/link';
import { Logo } from '@/components/Logo';

export const metadata = {
  title: 'Reset your password — Eavesight',
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link href="/" className="flex items-center justify-center space-x-2 mb-8">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white">
            <Logo className="w-full h-full" />
          </div>
          <span className="text-2xl font-bold text-white">Eavesight</span>
        </Link>

        <div className="bg-slate-800 border border-slate-700/50 py-8 px-4 shadow-xl sm:rounded-xl sm:px-10 text-slate-200">
          <h2 className="text-2xl font-bold text-white mb-3">Reset your password</h2>
          <p className="text-sm text-slate-400 mb-6">
            Self-serve password reset is being wired up alongside our transactional-email
            provider. While we get that live, email{' '}
            <a href="mailto:support@eavesight.io" className="text-blue-400 hover:text-blue-300">support@eavesight.io</a>{' '}
            from the address on your account and we&apos;ll reset it manually within one
            business day.
          </p>
          <p className="text-sm text-slate-400">
            If you signed up with Google, you can sign in directly via the{' '}
            <Link href="/login" className="text-blue-400 hover:text-blue-300">Continue with Google</Link>{' '}
            button — there is no separate password to reset.
          </p>

          <div className="mt-6 text-center">
            <Link href="/login" className="text-sm text-blue-400 hover:text-blue-300 font-medium">
              ← Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
