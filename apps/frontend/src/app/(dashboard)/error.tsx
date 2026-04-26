'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to the browser console with the full error shape so we can see the
    // property/line that crashed. Remove this file once the bug is fixed.
    // eslint-disable-next-line no-console
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-mono text-xs">
      <h1 className="text-lg font-semibold text-red-400 mb-3">
        Client error
      </h1>
      <p className="text-amber-300 mb-2">{error.name}: {error.message}</p>
      {error.digest && (
        <p className="text-slate-400 mb-2">digest: {error.digest}</p>
      )}
      <pre className="bg-slate-900 border border-slate-700 rounded p-3 overflow-auto whitespace-pre-wrap">
        {error.stack}
      </pre>
      <button
        onClick={() => reset()}
        className="mt-4 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-white"
      >
        Try again
      </button>
    </div>
  );
}
