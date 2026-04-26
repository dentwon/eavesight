'use client';
/**
 * DormantLeadsList — top N dormant-flagged properties for a metro.
 *
 * Renders each property as an AutoPitchCard so the rep sees the exact opener
 * at a glance. Amber accent makes the list instantly readable as "these are
 * the silent money leaks."
 */
import { useEffect, useState } from 'react';
import { metrosApi, type PinCardPayloadFree } from '@/lib/metros';
import { AutoPitchCard } from './AutoPitchCard';

interface Row {
  propertyId: string;
  score: number | null;
  dormantFlag: boolean;
  payloadFree: PinCardPayloadFree;
}

interface Props {
  metroCode: string;
  limit?: number;
  minScore?: number;
  dormantOnly?: boolean;
  /** 'call' vs 'door' pitch mode */
  mode?: 'call' | 'door';
  title?: string;
}

export function DormantLeadsList({
  metroCode,
  limit = 10,
  minScore,
  dormantOnly = true,
  mode = 'door',
  title,
}: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancel = false;
    setRows(null);
    setError(null);
    metrosApi
      .top(metroCode, { limit, minScore, dormantOnly })
      .then((r: unknown) => {
        if (!cancel) setRows(r as Row[]);
      })
      .catch((e) => !cancel && setError(e));
    return () => {
      cancel = true;
    };
  }, [metroCode, limit, minScore, dormantOnly]);

  if (error) return <div className="text-sm text-red-600">Error: {error.message}</div>;
  if (rows === null) return <div className="text-sm text-slate-500">Loading leads…</div>;
  if (rows.length === 0)
    return (
      <div className="text-sm text-slate-500 border rounded-lg p-4 bg-white">
        No {dormantOnly ? 'dormant' : 'qualifying'} leads yet for this market. The pipeline
        rebuilds this list nightly after fresh storm + permit data lands.
      </div>
    );

  return (
    <div className="space-y-3">
      {title ? <h3 className="text-sm font-semibold text-slate-700">{title}</h3> : null}
      {rows.map((row) => (
        <LeadRow key={row.propertyId} row={row} mode={mode} />
      ))}
    </div>
  );
}

function LeadRow({ row, mode }: { row: Row; mode: 'call' | 'door' }) {
  const p = row.payloadFree;
  return (
    <div className="border rounded-xl p-3 bg-white space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {p.address ?? 'Address withheld'}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {[p.city, p.state, p.zip].filter(Boolean).join(', ')}
          </div>
        </div>
        <ScoreBadge score={row.score} dormant={row.dormantFlag} />
      </div>
      <AutoPitchCard payload={p} mode={mode} compact />
    </div>
  );
}

function ScoreBadge({ score, dormant }: { score: number | null; dormant: boolean }) {
  if (score === null) return null;
  const bucket =
    score >= 80 ? 'hot' : score >= 60 ? 'warm' : score >= 40 ? 'cool' : 'cold';
  const cls =
    dormant
      ? 'bg-amber-100 text-amber-900 border-amber-200'
      : bucket === 'hot'
        ? 'bg-red-100 text-red-900 border-red-200'
        : bucket === 'warm'
          ? 'bg-orange-100 text-orange-900 border-orange-200'
          : bucket === 'cool'
            ? 'bg-sky-100 text-sky-900 border-sky-200'
            : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}
      title={dormant ? 'Dormant lead — insurance window still open' : `${bucket} lead`}
    >
      {Math.round(score)}
    </span>
  );
}
