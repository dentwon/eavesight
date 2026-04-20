import * as React from 'react';
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card } from './card';
import { cn } from '@/lib/utils';

/**
 * StatCard — KPI tile. Every dashboard header uses 3-5 of these.
 * Consolidates the dozen one-off "big number + label" implementations scattered
 * across the app into one consistent primitive.
 */
export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  /** Percent change vs prior period. Positive=good, negative=bad visually. */
  delta?: number;
  /** Flip the "good direction" for metrics where lower = better (latency, errors). */
  invertDelta?: boolean;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'accent';
  className?: string;
}

const toneRing: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'before:bg-[hsl(var(--primary))]',
  success: 'before:bg-[hsl(var(--success))]',
  warning: 'before:bg-[hsl(var(--warning))]',
  destructive: 'before:bg-[hsl(var(--destructive))]',
  info: 'before:bg-[hsl(var(--info))]',
  accent: 'before:bg-[hsl(var(--accent))]',
};

const toneIconBg: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]',
  success: 'bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]',
  warning: 'bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]',
  destructive: 'bg-[hsl(var(--destructive)/0.1)] text-[hsl(var(--destructive))]',
  info: 'bg-[hsl(var(--info)/0.1)] text-[hsl(var(--info))]',
  accent: 'bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))]',
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
  invertDelta,
  tone = 'default',
  className,
}: StatCardProps) {
  const hasDelta = typeof delta === 'number' && isFinite(delta);
  const up = hasDelta && delta! > 0;
  const flat = hasDelta && Math.abs(delta!) < 0.05;
  const isGood = hasDelta && (invertDelta ? !up : up) && !flat;
  const isBad = hasDelta && (invertDelta ? up : !up) && !flat;
  const DeltaIcon = flat ? Minus : up ? TrendingUp : TrendingDown;

  return (
    <Card
      className={cn(
        'relative p-5 overflow-hidden',
        'before:absolute before:inset-y-0 before:left-0 before:w-1',
        toneRing[tone],
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[hsl(var(--foreground))]">
            {value}
          </p>
          {(hint || hasDelta) && (
            <div className="mt-1 flex items-center gap-2 text-xs">
              {hasDelta && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 font-medium',
                    flat && 'text-[hsl(var(--muted-foreground))]',
                    isGood && 'text-[hsl(var(--success))]',
                    isBad && 'text-[hsl(var(--destructive))]'
                  )}
                >
                  <DeltaIcon className="h-3 w-3" />
                  {flat ? '~' : `${delta! > 0 ? '+' : ''}${delta!.toFixed(1)}%`}
                </span>
              )}
              {hint && (
                <span className="text-[hsl(var(--muted-foreground))] truncate">{hint}</span>
              )}
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-lg', toneIconBg[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </Card>
  );
}
