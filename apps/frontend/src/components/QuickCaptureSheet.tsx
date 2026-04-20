'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Crosshair, Loader2, MapPin, Phone, Save, User } from 'lucide-react';
import { api } from '@/lib/api';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * QuickCaptureSheet — "I just drove past this house, lock it in before I forget."
 *
 * Opens from the center FAB in the mobile bottom nav.
 * Flow:
 *   1. On open → immediately request browser geolocation
 *   2. Reverse-geocode coords → property lookup → suggested address
 *   3. Rep fills name/phone/note (all optional); one-tap Save
 *   4. POST /leads with whatever we have — server links to property if coords matched one
 *
 * Designed for one-handed use with thumbs. No forms hidden behind dropdowns.
 */
interface Props {
  open: boolean;
  onClose: () => void;
}

export function QuickCaptureSheet({ open, onClose }: Props) {
  const router = useRouter();

  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [coordStatus, setCoordStatus] = useState<'idle' | 'locating' | 'ok' | 'denied' | 'error'>('idle');

  const [address, setAddress] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [propertyId, setPropertyId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Kick off geolocation + property lookup as soon as the sheet opens
  const requestedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      // reset on close
      requestedRef.current = false;
      setCoords(null);
      setCoordStatus('idle');
      setAddress('');
      setFirstName('');
      setLastName('');
      setPhone('');
      setNotes('');
      setPropertyId(null);
      setError(null);
      setOk(false);
      return;
    }
    if (requestedRef.current) return;
    requestedRef.current = true;
    locate();
  }, [open]);

  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setCoordStatus('error');
      return;
    }
    setCoordStatus('locating');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setCoords({ lat, lon });
        setCoordStatus('ok');
        // Lookup nearest known property (non-fatal if this fails)
        try {
          const res = await api.get<
            | {
                id?: string;
                address?: string;
                city?: string;
                zip?: string;
                distanceM?: number;
                matched?: boolean;
              }
            | null
          >(`/properties/nearest?lat=${lat}&lon=${lon}`);
          if (res.data?.matched && res.data.address) {
            const parts = [res.data.address, res.data.city, res.data.zip].filter(Boolean);
            setAddress(parts.join(', '));
            if (res.data.id) setPropertyId(res.data.id);
          }
        } catch {
          /* fine — user can still type their own address */
        }
      },
      (err) => {
        setCoordStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    );
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        source: 'field-capture',
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        phone: phone.trim() || undefined,
        notes: [
          address ? `Address: ${address}` : null,
          coords ? `GPS: ${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}` : null,
          notes.trim() || null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
      if (propertyId) payload.propertyId = propertyId;

      await api.post('/leads', payload);
      setOk(true);
      // quick haptic on success (Android + iOS Safari supports)
      try {
        navigator.vibrate?.(18);
      } catch {
        /* noop */
      }
      // Give user ~800ms to see the green state, then close
      setTimeout(() => {
        onClose();
        router.refresh();
      }, 800);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Could not save');
    } finally {
      setSubmitting(false);
    }
  };

  const locBadge =
    coordStatus === 'locating'
      ? { txt: 'Locating…', cls: 'bg-[hsl(var(--info))]/15 text-[hsl(var(--info))]', icon: Loader2, spin: true }
      : coordStatus === 'ok'
        ? { txt: coords ? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}` : 'Located', cls: 'bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]', icon: MapPin, spin: false }
        : coordStatus === 'denied'
          ? { txt: 'Location denied — type the address', cls: 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]', icon: Crosshair, spin: false }
          : coordStatus === 'error'
            ? { txt: 'Location unavailable', cls: 'bg-[hsl(var(--destructive))]/15 text-[hsl(var(--destructive))]', icon: Crosshair, spin: false }
            : { txt: 'Getting location…', cls: 'bg-[hsl(var(--muted))] text-muted-foreground', icon: Crosshair, spin: false };

  const LocIcon = locBadge.icon;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Quick capture"
      description="Drop a lead where you stand"
      maxHeight="92vh"
    >
      {/* Location strip */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium mb-3',
          locBadge.cls,
        )}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <LocIcon className={cn('w-3.5 h-3.5 shrink-0', locBadge.spin && 'animate-spin')} />
          <span className="truncate">{locBadge.txt}</span>
        </span>
        {(coordStatus === 'denied' || coordStatus === 'error') && (
          <button
            type="button"
            onClick={locate}
            className="underline decoration-dotted"
          >
            Retry
          </button>
        )}
      </div>

      <div className="space-y-3">
        <Field label="Address" icon={MapPin}>
          <input
            type="text"
            inputMode="text"
            autoComplete="street-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, Huntsville"
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="First" icon={User}>
            <input
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Optional"
              className={inputCls}
            />
          </Field>
          <Field label="Last">
            <input
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Optional"
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Phone" icon={Phone}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Optional"
            className={inputCls}
          />
        </Field>

        <Field label="Notes" icon={Camera}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What stood out? (missing shingles, dented gutter, etc.)"
            rows={3}
            className={cn(inputCls, 'resize-none')}
          />
        </Field>

        {error && (
          <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting || ok}
          className={cn(
            'w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-sm font-semibold transition-colors',
            ok
              ? 'bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]'
              : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:brightness-110',
            (submitting || ok) && 'opacity-90 cursor-not-allowed',
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </>
          ) : ok ? (
            <>Saved ✓</>
          ) : (
            <>
              <Save className="w-4 h-4" /> Save lead
            </>
          )}
        </button>

        <p className="text-[11px] text-muted-foreground text-center">
          Fields are optional. Faster now, fill in later from the lead detail.
        </p>
      </div>
    </Sheet>
  );
}

// Local styling helpers --------------------------------------------------

const inputCls =
  'w-full rounded-lg bg-[hsl(var(--muted))] border border-[hsl(var(--border))] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]';

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </span>
      {children}
    </label>
  );
}

export default QuickCaptureSheet;
