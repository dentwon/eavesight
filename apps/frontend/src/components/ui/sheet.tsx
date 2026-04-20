'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sheet — mobile-first bottom sheet.
 *
 * - Slides up from the bottom on mobile
 * - Renders as a centered dialog on desktop (md+)
 * - Tap backdrop OR Esc to close
 * - Respects safe-area-inset-bottom (notch)
 *
 * Use for: More-menu overflow, Quick Capture form, property detail,
 * canvass-log form, settings subpanes. Anything that needs a focused
 * overlay without a full page transition.
 */
interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Optional small subtitle/description under the title */
  description?: string;
  /** Override max height (default 85vh) */
  maxHeight?: string;
  /** Tight layout when used as a dense menu (no large padding) */
  dense?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  maxHeight = '85vh',
  dense = false,
  children,
  className,
}: SheetProps) {
  // Close on Esc
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Prevent body scroll while open
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <button
        aria-label="Close sheet"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
      />

      {/* Panel */}
      <div
        className={cn(
          'relative w-full md:w-[520px] md:max-w-[92vw]',
          'bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]',
          'rounded-t-2xl md:rounded-2xl shadow-2xl border border-[hsl(var(--border))]',
          'flex flex-col animate-fade-in',
          className,
        )}
        style={{
          maxHeight,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Drag handle (mobile only) */}
        <div className="md:hidden pt-2 flex justify-center">
          <span className="block w-10 h-1 rounded-full bg-[hsl(var(--muted-foreground))]/40" />
        </div>

        {(title || description) && (
          <div className={cn('flex items-start justify-between gap-2', dense ? 'px-4 py-3' : 'px-5 py-4')}>
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold">{title}</h2>}
              {description && (
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 -mr-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className={cn('overflow-y-auto', dense ? 'px-2 pb-2' : 'px-5 pb-5')}>{children}</div>
      </div>
    </div>
  );
}

/** Thin divider used inside sheets to group rows */
export function SheetDivider() {
  return <div className="my-2 h-px bg-[hsl(var(--border))]" />;
}

/**
 * SheetAction — a tappable row used inside a Sheet menu.
 * Large tap target (56px) suitable for a finger on a phone.
 */
export function SheetAction({
  icon: Icon,
  label,
  description,
  onClick,
  danger,
  trailing,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 rounded-lg px-3 py-3 text-left',
        'hover:bg-[hsl(var(--muted))] transition-colors min-h-[56px]',
        danger && 'text-[hsl(var(--destructive))]',
      )}
    >
      {Icon && (
        <span
          className={cn(
            'w-9 h-9 shrink-0 grid place-items-center rounded-lg',
            danger
              ? 'bg-[hsl(var(--destructive))]/10'
              : 'bg-[hsl(var(--muted))]',
          )}
        >
          <Icon className="w-4 h-4" />
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground truncate">{description}</span>
        )}
      </span>
      {trailing}
    </button>
  );
}
