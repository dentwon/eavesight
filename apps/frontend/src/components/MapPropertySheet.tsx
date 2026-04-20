'use client';

import { useMemo } from 'react';
import { Cloud, Compass, Home, Phone, Plus, Ruler, Wind } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { DataConfidenceBadge } from '@/components/DataConfidenceBadge';
import { EarmarkButton } from '@/components/EarmarkButton';
import { getPropertyValue } from '@/lib/propertyValue';
import { cn } from '@/lib/utils';

/**
 * MapPropertySheet - mobile property detail sheet.
 *
 * Lives *only* on phones (the existing desktop side-panel handles md+).
 * Surfaces the minimum a field rep needs to decide whether to knock:
 *   - address + verification badges
 *   - value / year built / roof size / storm history count
 *   - three action buttons: Navigate, Call (if phone on file), Create lead
 *
 * "Create lead" hands off to QuickCaptureSheet with the property pre-filled.
 */
interface MapProperty {
  id?: string;
  lat?: number | null;
  lon?: number | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  ownerFullName?: string | null;
  propertyOwner?: string | null;
  ownerPhone?: string | null;
  phone?: string | null;
  assessedValue?: number | null;
  marketValue?: number | null;
  yearBuilt?: number | null;
  yearBuiltConfidence?: string | null;
  roofAreaSqft?: number | null;
  roofSizeClass?: string | null;
  urgencyScore?: number | null;
  opportunityScore?: number | null;
  hailExposureIndex?: number | null;
  buildingFootprint?: { areaSqft?: number | null } | null;
  roofData?: { yearBuilt?: number | null; age?: number | null } | null;
  propertyStorms?: Array<{
    stormEvent: {
      id: string;
      date: string;
      type: string;
      severity?: string | null;
      hailSizeInches?: number | null;
    };
  }> | null;
  earmarked?: boolean;
}

interface Props {
  open: boolean;
  property: MapProperty | null;
  onClose: () => void;
  onCreateLead: (property: MapProperty) => void;
}

export function MapPropertySheet({ open, property, onClose, onCreateLead }: Props) {
  const value = useMemo(() => (property ? getPropertyValue(property) : null), [property]);

  if (!property) return null;

  const addr = property.address || 'Unknown address';
  const cityLine = [property.city, property.state, property.zip].filter(Boolean).join(', ');
  const roofSqft =
    property.roofAreaSqft ??
    (property.buildingFootprint?.areaSqft ? Number(property.buildingFootprint.areaSqft) : null);
  const yearBuilt = property.yearBuilt ?? property.roofData?.yearBuilt ?? null;
  const roofAge = yearBuilt ? new Date().getFullYear() - yearBuilt : property.roofData?.age ?? null;
  const stormCount = property.propertyStorms?.length ?? 0;
  const phone = property.phone || property.ownerPhone || null;
  const canNavigate = typeof property.lat === 'number' && typeof property.lon === 'number';
  const recentStorms = (property.propertyStorms || []).slice(0, 3);

  const navigate = () => {
    if (!canNavigate) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${property.lat},${property.lon}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Sheet open={open} onClose={onClose} title={addr} description={cityLine || undefined} maxHeight="88vh">
      {/* Score row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <ScorePill label="Urgency" value={property.urgencyScore} tone="destructive" />
        <ScorePill label="Opportunity" value={property.opportunityScore} tone="primary" />
        <ScorePill label="Hail" value={property.hailExposureIndex} tone="warning" />
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatTile
          icon={Home}
          label="Value"
          value={value ? `$${Math.round(value).toLocaleString()}` : '-'}
        />
        <StatTile
          icon={Compass}
          label="Year built"
          value={yearBuilt ? String(yearBuilt) : '-'}
          trailing={<DataConfidenceBadge confidence={property.yearBuiltConfidence} />}
        />
        <StatTile
          icon={Ruler}
          label="Roof"
          value={roofSqft ? `${Math.round(roofSqft).toLocaleString()} sqft` : '-'}
          hint={property.roofSizeClass || (roofAge ? `${roofAge}y old` : undefined)}
        />
        <StatTile
          icon={Wind}
          label="Storms"
          value={stormCount > 0 ? `${stormCount} hit${stormCount === 1 ? '' : 's'}` : 'None'}
          tone={stormCount > 0 ? 'warning' : undefined}
        />
      </div>

      {/* Storm history (top 3) */}
      {recentStorms.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
            Recent storms
          </p>
          <div className="space-y-1.5">
            {recentStorms.map((s) => (
              <StormRow key={s.stormEvent.id} storm={s.stormEvent} />
            ))}
          </div>
        </div>
      )}

      {/* Owner line */}
      {(property.ownerFullName || property.propertyOwner) && (
        <div className="mb-3 text-xs">
          <span className="text-muted-foreground">Owner: </span>
          <span className="font-medium">{property.ownerFullName || property.propertyOwner}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <ActionBtn Icon={Compass} label="Navigate" onClick={navigate} disabled={!canNavigate} />
        <ActionBtn
          Icon={Phone}
          label="Call"
          href={phone ? `tel:${phone}` : undefined}
          disabled={!phone}
        />
        <ActionBtn Icon={Plus} label="Lead" primary onClick={() => onCreateLead(property)} />
      </div>

      {/* Earmark under the action row */}
      {property.id && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Add to worklist</span>
          <EarmarkButton propertyId={property.id} initialEarmarked={!!property.earmarked} />
        </div>
      )}
    </Sheet>
  );
}

// atoms ----------------------------------------------------------------

function ScorePill({
  label,
  value,
  tone,
}: {
  label: string;
  value?: number | null;
  tone: 'destructive' | 'primary' | 'warning';
}) {
  const pct = typeof value === 'number' ? Math.max(0, Math.min(100, Math.round(value))) : null;
  const toneCls =
    tone === 'destructive'
      ? 'bg-red-500/10 text-red-500 border-red-500/20'
      : tone === 'warning'
        ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
        : 'bg-blue-500/10 text-blue-500 border-blue-500/20';
  return (
    <div className={cn('rounded-lg border px-2 py-2 flex flex-col items-start', toneCls)}>
      <span className="text-[9px] uppercase tracking-wide opacity-80">{label}</span>
      <span className="text-base font-semibold leading-tight">{pct != null ? pct : '-'}</span>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  trailing,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  trailing?: React.ReactNode;
  tone?: 'warning';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2',
        tone === 'warning' && 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <Icon className="w-3 h-3" /> {label}
        </span>
        {trailing}
      </div>
      <div className="text-sm font-semibold leading-tight">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

function StormRow({ storm }: { storm: { date: string; type: string; severity?: string | null; hailSizeInches?: number | null } }) {
  const d = new Date(storm.date);
  const dateStr = isNaN(d.getTime()) ? storm.date : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-1.5 min-w-0">
        <Cloud className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">{storm.type}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
        {storm.hailSizeInches ? <span>{storm.hailSizeInches}"</span> : null}
        {storm.severity ? <span>{storm.severity}</span> : null}
        <span>{dateStr}</span>
      </div>
    </div>
  );
}

function ActionBtn({
  Icon,
  label,
  onClick,
  href,
  disabled,
  primary,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  const base = cn(
    'flex-1 inline-flex flex-col items-center justify-center gap-1 rounded-xl py-3 text-xs font-medium transition-colors',
    disabled && 'opacity-40 cursor-not-allowed',
    primary
      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:brightness-110'
      : 'bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/70 text-foreground',
  );
  const content = (
    <>
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </>
  );
  if (href && !disabled) {
    return (
      <a href={href} className={base}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={base}>
      {content}
    </button>
  );
}

export default MapPropertySheet;
