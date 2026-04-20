'use client';

import { useState } from 'react';
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface EarmarkButtonProps {
  propertyId: string;
  initialEarmarked?: boolean;
  /** Optional free-form reason — e.g. "active hail core" */
  defaultReason?: string;
  /** Size variant */
  size?: 'sm' | 'md';
  /** If true, renders as an icon-only pill (useful for dense map popups) */
  iconOnly?: boolean;
  onChange?: (next: boolean) => void;
}

/**
 * EarmarkButton — toggles a property's earmark flag via the alerts API.
 *
 * Used on property cards, map popups, and the active-alert worklist.
 * Optimistic UI: flips immediately; rolls back on error.
 */
export function EarmarkButton({
  propertyId,
  initialEarmarked = false,
  defaultReason,
  size = 'md',
  iconOnly = false,
  onChange,
}: EarmarkButtonProps) {
  const [earmarked, setEarmarked] = useState(initialEarmarked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    const next = !earmarked;
    setBusy(true);
    setError(null);
    setEarmarked(next); // optimistic
    try {
      if (next) {
        await api.post(`/alerts/properties/${propertyId}/earmark`, {
          reason: defaultReason ?? 'user-earmarked',
        });
      } else {
        await api.delete(`/alerts/properties/${propertyId}/earmark`);
      }
      onChange?.(next);
    } catch (e: any) {
      // rollback
      setEarmarked(!next);
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const padX = size === 'sm' ? 'px-2' : 'px-3';
  const padY = size === 'sm' ? 'py-1' : 'py-1.5';
  const text = size === 'sm' ? 'text-xs' : 'text-sm';
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  const Icon = busy ? Loader2 : earmarked ? BookmarkCheck : Bookmark;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={earmarked}
      title={
        error
          ? `Error: ${error}`
          : earmarked
            ? 'Earmarked — click to remove'
            : 'Earmark this property'
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
        padX,
        padY,
        text,
        earmarked
          ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:brightness-110'
          : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/80 border border-[hsl(var(--border))]',
        busy && 'opacity-70 cursor-wait',
        error && !earmarked && 'ring-1 ring-[hsl(var(--destructive))]',
      )}
    >
      <Icon className={cn(iconSize, busy && 'animate-spin')} />
      {!iconOnly && (
        <span>{earmarked ? 'Earmarked' : 'Earmark'}</span>
      )}
    </button>
  );
}

export default EarmarkButton;
