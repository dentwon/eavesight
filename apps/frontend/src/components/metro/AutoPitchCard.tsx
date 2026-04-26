'use client';
/**
 * AutoPitchCard — turns a pin-card payload into a 1-line agent opener.
 *
 * This is the "killer feature": the rep taps a property, the card generates
 * the exact words to say at the door or on the phone, sourced from the
 * unified score's scoreReasons + dormant state + claim-window countdown.
 *
 * Rendered below a pin detail or inside the dormant-leads list.
 */
import { AlertTriangle, Clock3, Phone, MapPin, Copy, Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PinCardPayloadFree, PinCardPayloadPro } from '@/lib/metros';

type AnyPayload = PinCardPayloadFree | (PinCardPayloadPro & { tier: 'pro' });

export interface AutoPitchCardProps {
  payload: AnyPayload;
  /** 'call' = opener for phone, 'door' = opener for door knock */
  mode?: 'call' | 'door';
  compact?: boolean;
}

export function AutoPitchCard({ payload, mode = 'door', compact = false }: AutoPitchCardProps) {
  const [copied, setCopied] = useState(false);
  const pitch = useMemo(() => buildPitch(payload, mode), [payload, mode]);

  const amber = payload.dormantFlag;
  const daysLeft =
    'claimWindowEndsAt' in payload && payload.claimWindowEndsAt
      ? Math.max(0, Math.round((+new Date(payload.claimWindowEndsAt) - Date.now()) / 86400000))
      : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pitch);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className={[
        'rounded-lg border p-3 space-y-2',
        amber ? 'bg-amber-50/60 border-amber-200' : 'bg-slate-50 border-slate-200',
        compact ? 'text-sm' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
        {amber ? (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5" /> Dormant lead
          </span>
        ) : (
          <span className="text-slate-500">Auto pitch</span>
        )}
        {daysLeft !== null && (
          <span className="inline-flex items-center gap-1 ml-auto text-amber-700">
            <Clock3 className="w-3.5 h-3.5" /> {daysLeft}d claim window
          </span>
        )}
      </div>

      <p className="leading-snug">
        <span className="text-slate-900 font-medium">{pitch}</span>
      </p>

      {payload.scoreReasons?.length ? (
        <ul className="flex flex-wrap gap-1.5 text-[11px]">
          {payload.scoreReasons.slice(0, 3).map((r, i) => (
            <li
              key={i}
              className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600"
            >
              {r}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
          aria-label="Copy pitch to clipboard"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy pitch'}
        </button>
        {'ownerPhone' in payload && payload.ownerPhone ? (
          <a
            href={`tel:${payload.ownerPhone}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          >
            <Phone className="w-3.5 h-3.5" /> {payload.ownerPhone}
          </a>
        ) : null}
        {payload.lat != null && payload.lon != null && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${payload.lat},${payload.lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 ml-auto"
          >
            <MapPin className="w-3.5 h-3.5" /> Navigate
          </a>
        )}
      </div>
    </div>
  );
}

// ---------- pitch synthesis -----------------------------------------------

function buildPitch(p: AnyPayload, mode: 'call' | 'door'): string {
  // Pick the most impactful reason as the hook.
  const reasons = p.scoreReasons ?? [];
  const hailReason = reasons.find((r) => /hail/i.test(r));
  const roofReason = reasons.find((r) => /roof/i.test(r));
  const permitReason = reasons.find((r) => /permit/i.test(r));

  const owner = 'ownerFullName' in p && p.ownerFullName ? p.ownerFullName.split(' ')[0] : null;
  const addr = p.address ?? 'your property';

  // Dormant has the most commercial power — lead with it.
  if (p.dormantFlag) {
    const window =
      'claimWindowEndsAt' in p && p.claimWindowEndsAt
        ? ' You still have a claim window open.'
        : '';
    if (mode === 'call') {
      return (
        `Hi${owner ? ' ' + owner : ''}, we reviewed public storm records for ${addr} — ` +
        `${hailReason ?? 'a qualifying hail event hit your area'} and ` +
        `${permitReason ?? 'no re-roof permit is on file'}. ` +
        `${roofReason ?? 'Your roof is old enough that insurance usually covers most of a replacement.'}${window} ` +
        `Can we do a free no-obligation inspection this week?`
      );
    }
    return (
      `${hailReason ?? 'Your neighborhood was hit by hail recently'} and ` +
      `${permitReason ?? 'it looks like no one has pulled a roof permit here yet'}. ` +
      `I can document the damage for your insurance at no cost — takes 15 minutes.`
    );
  }

  // High-score but not dormant — go with opportunity framing.
  if ((p.score ?? 0) >= 70) {
    if (mode === 'call') {
      return (
        `Hi${owner ? ' ' + owner : ''}, we track storm activity in your area and ${addr} ` +
        `scored high for roof risk${hailReason ? ' — ' + hailReason : ''}${roofReason ? ', ' + roofReason.toLowerCase() : ''}. ` +
        `Want us to take a quick look?`
      );
    }
    return (
      `${hailReason ?? 'Your area had recent storm activity'}${roofReason ? ' and ' + roofReason.toLowerCase() : ''}. ` +
      `I'm in the neighborhood — mind if I take a look at the roof?`
    );
  }

  // Low-score fallback — keep it short and honest.
  return mode === 'call'
    ? `Hi${owner ? ' ' + owner : ''}, just checking in on your roof. Any concerns after recent weather?`
    : `Hi — just checking in after recent weather. Any spots on your roof you've been watching?`;
}
