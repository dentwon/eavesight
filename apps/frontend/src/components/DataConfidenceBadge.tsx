'use client';

import { CheckCircle2, HelpCircle, Sparkles, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * DataConfidenceBadge — honest labeling for imputed property data.
 *
 * The data pipeline tracks where each year-built value came from
 * (VERIFIED deed, ENRICHED listing scrape, NEIGHBOR_KNN spatial
 * estimate, ACS_MEDIAN block-group median, etc.). Reps in the field
 * need to know: "is this house actually from 1987, or is 1987 a
 * neighborhood guess?"
 *
 * Rule of thumb: VERIFIED/ENRICHED are pitch-worthy; the rest are
 * directional only.
 */
export type DataConfidence =
  | 'VERIFIED'
  | 'ENRICHED'
  | 'DEED_FLOOR'
  | 'SUBDIV_PLAT'
  | 'NEIGHBOR_KNN'
  | 'ACS_MEDIAN'
  | 'RATIO_GUESS'
  | 'NONE';

interface Props {
  confidence: DataConfidence | string | null | undefined;
  variant?: 'short' | 'full';
  className?: string;
}

const meta: Record<DataConfidence, { label: string; hint: string; tone: string; Icon: any }> = {
  VERIFIED:     { label: 'Verified',    hint: 'From county records',                tone: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20', Icon: CheckCircle2 },
  ENRICHED:     { label: 'Enriched',    hint: 'From listing/tax enrichment',        tone: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20', Icon: CheckCircle2 },
  DEED_FLOOR:   { label: 'Deed >=',     hint: 'Year the deed was first recorded',   tone: 'bg-sky-500/15 text-sky-500 border-sky-500/20',             Icon: Sparkles },
  SUBDIV_PLAT:  { label: 'Subdivision', hint: 'Year the subdivision was platted',   tone: 'bg-sky-500/15 text-sky-500 border-sky-500/20',             Icon: Sparkles },
  NEIGHBOR_KNN: { label: 'Estimated',   hint: 'Inferred from nearby homes (KNN)',   tone: 'bg-amber-500/15 text-amber-500 border-amber-500/20',       Icon: TrendingUp },
  ACS_MEDIAN:   { label: 'Block-group', hint: 'Census ACS median for this tract',   tone: 'bg-amber-500/15 text-amber-500 border-amber-500/20',       Icon: TrendingUp },
  RATIO_GUESS:  { label: 'Rough guess', hint: 'Statistical ratio - use with care',  tone: 'bg-orange-500/15 text-orange-500 border-orange-500/20',    Icon: HelpCircle },
  NONE:         { label: 'Unknown',     hint: 'No source for this value',           tone: 'bg-neutral-500/15 text-neutral-500 border-neutral-500/20', Icon: HelpCircle },
};

export function DataConfidenceBadge({ confidence, variant = 'short', className }: Props) {
  const key = (confidence || 'NONE') as DataConfidence;
  const m = meta[key] ?? meta.NONE;
  const Icon = m.Icon;

  return (
    <span
      title={m.hint}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
        m.tone,
        className,
      )}
    >
      <Icon className="w-3 h-3" />
      <span>{m.label}</span>
      {variant === 'full' && (
        <span className="text-[10px] opacity-75 font-normal ml-1">- {m.hint}</span>
      )}
    </span>
  );
}

export default DataConfidenceBadge;
