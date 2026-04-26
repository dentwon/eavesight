'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Search,
  X,
  User,
  Home,
  MapPin,
  Award,
  DollarSign,
  Factory,
  Landmark,
  School,
  Plus,
  Building2,
  Cross,
  Car,
} from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

interface Parcel {
  pin: string;
  propertyAddress: string;
  propertyOwner: string;
  mailingAddress: string;
  mailingAddressFull: string;
  totalAppraisedValue: number;
  totalBuildingValue: number;
  totalLandValue: number;
  totalAssessedValue: number;
  zoning: string | null;
  floodZone: string | null;
  acres: number | null;
  subdivision: string | null;
  highSchool: string | null;
  hubZone: string | null;
  opportunityZone: string | null;
  eDistrictName: string | null;
  industrialPark: string | null;
  localHistoricDistrict: string | null;
  deedDate: string | null;
  bridgeStreet15: string | null;
  hospital15: string | null;
  marshall15: string | null;
  nhip15: string | null;
  toyota15: string | null;
  bridgeStreet30: string | null;
  hospital30: string | null;
  marshall30: string | null;
  nhip30: string | null;
  toyota30: string | null;
  lead?: {
    id: string;
    status: string;
    score: number;
    priority: string;
  };
}

/**
 * Weak heuristic based on the building-value / total-value ratio.
 * Only used as a very-low-confidence last-resort estimate.
 */
function estimateRoofAgeFromValueRatio(
  appraisedValue: number,
  buildingValue: number
): { years: number; confidence: 'RATIO_GUESS' } | null {
  if (appraisedValue <= 0 || buildingValue <= 0) return null;
  const ratio = buildingValue / appraisedValue;
  if (ratio > 0.72) return { years: 2, confidence: 'RATIO_GUESS' };
  if (ratio > 0.65) return { years: 8, confidence: 'RATIO_GUESS' };
  if (ratio > 0.58) return { years: 15, confidence: 'RATIO_GUESS' };
  if (ratio > 0.5) return { years: 22, confidence: 'RATIO_GUESS' };
  if (ratio > 0.42) return { years: 30, confidence: 'RATIO_GUESS' };
  return null;
}

/**
 * Prospect-table shortcut: rough roof age from appraised/building-value ratio
 * when the parcel is not yet promoted to a full Property record (and therefore
 * has no yearBuilt / roofInstalledAt anchor yet). Purely heuristic -- label
 * output as "est" everywhere it shows up.
 *
 * Deliberately named differently from the canonical `estimateRoofAge` in
 * `@/lib/roofAgeEstimate` (which takes a PropertyInput shape) so IDE
 * auto-import never picks the wrong one.
 */
function estimateProspectRoofAge(
  appraisedValue: number,
  buildingValue: number,
): number | null {
  const r = estimateRoofAgeFromValueRatio(appraisedValue, buildingValue);
  return r ? r.years : null;
}

function calcLeadScore(p: Parcel): number {
  let score = 0;
  const val = p.totalAppraisedValue || 0;
  const acres = p.acres || 0.25;

  if (val >= 150_000) score += 25;
  else if (val >= 100_000) score += 15;
  else if (val >= 50_000) score += 5;

  if (val > 400_000) score += 10;

  if (acres >= 1) score += 15;
  else if (acres >= 0.5) score += 10;
  else if (acres >= 0.25) score += 5;

  if (p.hubZone) score += 10;
  if (p.opportunityZone) score += 5;
  if (p.industrialPark) score += 8;
  if (p.localHistoricDistrict) score += 8;

  const near15 = [p.bridgeStreet15, p.hospital15, p.marshall15, p.nhip15, p.toyota15].filter(
    Boolean
  ).length;
  const near30 = [p.bridgeStreet30, p.hospital30, p.marshall30, p.nhip30, p.toyota30].filter(
    Boolean
  ).length;
  score += near15 * 8;
  score += near30 * 3;

  if (p.floodZone) score += 10;

  if (p.deedDate) {
    const yearsSinceSale =
      (Date.now() - new Date(p.deedDate).getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (yearsSinceSale < 2) score += 12;
    else if (yearsSinceSale < 5) score += 6;
  }

  return Math.min(100, score);
}

type ScoreBadgeVariant = 'success' | 'info' | 'warning' | 'secondary';

function getScoreBadge(score: number): { variant: ScoreBadgeVariant; label: string } {
  if (score >= 75) return { variant: 'success', label: 'Hot' };
  if (score >= 55) return { variant: 'info', label: 'Warm' };
  if (score >= 35) return { variant: 'warning', label: 'Cool' };
  return { variant: 'secondary', label: 'Cold' };
}

function ParcelCard({
  parcel,
  onSelect,
}: {
  parcel: Parcel;
  onSelect: (p: Parcel) => void;
}) {
  const score = calcLeadScore(parcel);
  const badge = getScoreBadge(score);
  const roofAge = estimateProspectRoofAge(parcel.totalAppraisedValue, parcel.totalBuildingValue);
  const isAlreadyLead = !!parcel.lead;

  return (
    <Card
      className="group cursor-pointer p-4 transition-colors hover:border-[hsl(var(--ring))]"
      onClick={() => onSelect(parcel)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[hsl(var(--foreground))] transition-colors group-hover:text-[hsl(var(--primary))]">
              {parcel.propertyAddress}
            </h3>
            {isAlreadyLead && (
              <Badge variant="info" className="shrink-0">
                LEAD
              </Badge>
            )}
          </div>
          <p className="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
            {parcel.mailingAddress}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
            {parcel.propertyOwner && (
              <span
                className="flex max-w-[180px] items-center gap-1 truncate"
                title={parcel.propertyOwner}
              >
                <User className="h-3 w-3 shrink-0" />
                {parcel.propertyOwner}
              </span>
            )}
            {roofAge !== null && (
              <span
                className="flex items-center gap-1"
                title="Estimated from building/land value ratio — low confidence."
              >
                <Home className="h-3 w-3 shrink-0" />~{roofAge}yr roof
                <span className="text-[hsl(var(--muted-foreground))] opacity-70">est</span>
              </span>
            )}
            {parcel.subdivision && (
              <span
                className="flex max-w-[140px] items-center gap-1 truncate"
                title={parcel.subdivision}
              >
                <MapPin className="h-3 w-3 shrink-0" />
                {parcel.subdivision}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge variant={badge.variant} className="tabular-nums">
            {badge.label} · {score}
          </Badge>
          {parcel.totalAppraisedValue > 0 && (
            <span className="text-xs font-medium text-[hsl(var(--foreground))]">
              ${(parcel.totalAppraisedValue / 1000).toFixed(0)}K
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function ParcelDetail({
  parcel,
  onClose,
  onCreateLead,
}: {
  parcel: Parcel;
  onClose: () => void;
  onCreateLead: (p: Parcel) => void;
}) {
  const score = calcLeadScore(parcel);
  const badge = getScoreBadge(score);
  const roofAge = estimateProspectRoofAge(parcel.totalAppraisedValue, parcel.totalBuildingValue);
  const buildingToLand =
    parcel.totalAppraisedValue > 0
      ? ((parcel.totalBuildingValue / parcel.totalAppraisedValue) * 100).toFixed(0)
      : null;

  const badgeToneBg: Record<ScoreBadgeVariant, string> = {
    success: 'bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]',
    info: 'bg-[hsl(var(--info)/0.15)] text-[hsl(var(--info))]',
    warning: 'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]',
    secondary: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  };

  const proximity: { key: keyof Parcel; label: string; Icon: typeof Building2 }[] = [
    { key: 'bridgeStreet15', label: 'Bridge St', Icon: Building2 },
    { key: 'hospital15', label: 'Cross', Icon: Cross },
    { key: 'marshall15', label: 'Marshall', Icon: Building2 },
    { key: 'nhip15', label: 'NHIP', Icon: Cross },
    { key: 'toyota15', label: 'Toyota', Icon: Car },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border))] p-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">
              {parcel.propertyAddress}
            </h2>
            <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))]">
              {parcel.mailingAddress}
            </p>
            {parcel.subdivision && (
              <p className="mt-1 flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                <MapPin className="h-3 w-3" />
                {parcel.subdivision}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <div className={cn('rounded-md px-3 py-2 text-center', badgeToneBg[badge.variant])}>
              <div className="text-xl font-black tabular-nums">{score}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider">
                {badge.label}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Owner & Contact */}
        <div className="border-b border-[hsl(var(--border))] p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            Owner
          </h3>
          <p className="font-medium text-[hsl(var(--foreground))]">
            {parcel.propertyOwner || 'Unknown'}
          </p>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            {parcel.mailingAddressFull}
          </p>
          {parcel.lead ? (
            <div className="mt-3 flex items-center gap-2">
              <Badge variant="info">
                {parcel.lead.status} · Score {parcel.lead.score}
              </Badge>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Already a lead</span>
            </div>
          ) : (
            <Button onClick={() => onCreateLead(parcel)} className="mt-3 w-full">
              <Plus className="h-4 w-4" />
              Create Lead
            </Button>
          )}
        </div>

        {/* Property Value */}
        <div className="border-b border-[hsl(var(--border))] p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            Property Value
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-[hsl(var(--muted))] p-3 text-center">
              <div className="text-lg font-bold text-[hsl(var(--foreground))]">
                ${(parcel.totalAppraisedValue / 1000).toFixed(0)}K
              </div>
              <div className="text-[10px] uppercase text-[hsl(var(--muted-foreground))]">
                Appraised
              </div>
            </div>
            <div className="rounded-lg bg-[hsl(var(--muted))] p-3 text-center">
              <div className="text-lg font-bold text-[hsl(var(--foreground))]">
                ${(parcel.totalAssessedValue / 1000).toFixed(0)}K
              </div>
              <div className="text-[10px] uppercase text-[hsl(var(--muted-foreground))]">
                Assessed
              </div>
            </div>
            <div className="rounded-lg bg-[hsl(var(--muted))] p-3 text-center">
              <div className="text-lg font-bold text-[hsl(var(--foreground))]">
                {roofAge !== null ? `~${roofAge}yr` : 'Unknown'}
              </div>
              <div
                className="text-[10px] uppercase text-[hsl(var(--muted-foreground))]"
                title="Estimated from building/land value ratio — low confidence"
              >
                Est. Roof Age{' '}
                {roofAge !== null && (
                  <span className="opacity-70">(guess)</span>
                )}
              </div>
            </div>
          </div>
          {buildingToLand && (
            <p className="mt-2 text-center text-xs text-[hsl(var(--muted-foreground))]">
              Building is {buildingToLand}% of total value
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between rounded bg-[hsl(var(--muted))] px-3 py-1.5">
              <span className="text-[hsl(var(--muted-foreground))]">Building</span>
              <span className="text-[hsl(var(--foreground))]">
                ${(parcel.totalBuildingValue / 1000).toFixed(0)}K
              </span>
            </div>
            <div className="flex justify-between rounded bg-[hsl(var(--muted))] px-3 py-1.5">
              <span className="text-[hsl(var(--muted-foreground))]">Land</span>
              <span className="text-[hsl(var(--foreground))]">
                ${(parcel.totalLandValue / 1000).toFixed(0)}K
              </span>
            </div>
          </div>
        </div>

        {/* Location Signals */}
        {(parcel.zoning ||
          parcel.highSchool ||
          parcel.hubZone ||
          parcel.opportunityZone ||
          parcel.industrialPark) && (
          <div className="border-b border-[hsl(var(--border))] p-6">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Location Signals
            </h3>
            <div className="flex flex-wrap gap-2">
              {parcel.hubZone && (
                <Badge variant="success" className="gap-1">
                  <Award className="h-3 w-3" />
                  HubZone
                </Badge>
              )}
              {parcel.opportunityZone && (
                <Badge variant="info" className="gap-1">
                  <DollarSign className="h-3 w-3" />
                  OppZone
                </Badge>
              )}
              {parcel.industrialPark && (
                <Badge variant="accent" className="gap-1">
                  <Factory className="h-3 w-3" />
                  IndPark
                </Badge>
              )}
              {parcel.localHistoricDistrict && (
                <Badge variant="warning" className="gap-1">
                  <Landmark className="h-3 w-3" />
                  Historic
                </Badge>
              )}
              {parcel.zoning && <Badge variant="secondary">Z: {parcel.zoning}</Badge>}
              {parcel.highSchool && (
                <Badge variant="secondary" className="gap-1">
                  <School className="h-3 w-3" />
                  {parcel.highSchool}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Flood & Environment */}
        <div className="border-b border-[hsl(var(--border))] p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            Environment
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Flood Zone</span>
              <span
                className={cn(
                  'text-sm font-medium',
                  parcel.floodZone
                    ? 'text-[hsl(var(--warning))]'
                    : 'text-[hsl(var(--muted-foreground))]'
                )}
              >
                {parcel.floodZone || 'None'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Lot Size</span>
              <span className="text-sm text-[hsl(var(--foreground))]">
                {parcel.acres ? `${parcel.acres.toFixed(2)} acres` : '—'}
              </span>
            </div>
            {parcel.eDistrictName && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-[hsl(var(--muted-foreground))]">District</span>
                <span className="text-sm text-[hsl(var(--foreground))]">
                  {parcel.eDistrictName}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Proximity */}
        {proximity.some(({ key }) => {
          const val15 = parcel[key] as string | null;
          const val30 = parcel[(String(key).replace('15', '30') as keyof Parcel)] as string | null;
          return val15 || val30;
        }) && (
          <div className="p-6">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Proximity
            </h3>
            <div className="space-y-1.5">
              {proximity.map(({ key, label, Icon }) => {
                const val15 = parcel[key] as string | null;
                const val30 = parcel[
                  (String(key).replace('15', '30') as keyof Parcel)
                ] as string | null;
                if (!val15 && !val30) return null;
                return (
                  <div key={String(key)} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {val15 ? '15 min' : val30 ? '30 min' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ProspectsPage() {
  const { user } = useAuthStore();
  const organizationId = user?.orgId;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Parcel[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null);
  const [, setCreatingLead] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (q.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.get('/madison/search', {
          params: { q: q.trim(), limit: 20 },
        });
        setResults(res.data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const handleCreateLead = async (parcel: Parcel) => {
    if (!organizationId) return;
    setCreatingLead(parcel.pin);
    try {
      const res = await api.post('/madison/leads', {
        parcelId: parcel.pin,
        address: parcel.propertyAddress,
        source: 'SEARCH',
      });
      setSelectedParcel({ ...parcel, lead: res.data });
      setResults((prev) =>
        prev.map((p) => (p.pin === parcel.pin ? { ...p, lead: res.data } : p))
      );
    } catch (err) {
      console.error('Failed to create lead:', err);
    } finally {
      setCreatingLead(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-2xl p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">Find Prospects</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Search any address in Madison County to find and score leads
          </p>
        </div>

        {/* Search Bar */}
        <div className="relative mb-6">
          <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
            {searching ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
            ) : (
              <Search className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
            )}
          </div>
          <Input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by address or owner name..."
            autoFocus
            className="h-12 pl-12 pr-10 text-sm"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setResults([]);
              }}
              className="absolute inset-y-0 right-3 flex items-center text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
              {results.length} result{results.length === 20 ? '+' : ''} for &ldquo;{query}&rdquo;
            </p>
            {results.map((parcel) => (
              <ParcelCard key={parcel.pin} parcel={parcel} onSelect={setSelectedParcel} />
            ))}
          </div>
        )}

        {/* Empty state — no query */}
        {query.length === 0 && (
          <div className="space-y-4">
            <EmptyState
              icon={Search}
              title="Search for any property"
              description="Type an address or owner name to find properties in Madison County, AL"
            />
            <div className="flex flex-wrap justify-center gap-2">
              {['SEARCY DR', 'MAPLE DR', 'OAK ST', 'GOLF COURSE'].map((s) => (
                <Button
                  key={s}
                  onClick={() => handleSearch(s)}
                  variant="outline"
                  size="sm"
                >
                  Try: {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {query.length >= 2 && results.length === 0 && !searching && (
          <EmptyState
            icon={Home}
            title="No properties found"
            description="Try a different address or owner name"
          />
        )}
      </div>

      {/* Parcel Detail Modal */}
      {selectedParcel && (
        <ParcelDetail
          parcel={selectedParcel}
          onClose={() => setSelectedParcel(null)}
          onCreateLead={handleCreateLead}
        />
      )}
    </div>
  );
}
