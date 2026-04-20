'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Phone,
  CheckCircle2,
  DollarSign,
  Coins,
  Trophy,
  XCircle,
  X,
  Mail,
  ChevronRight,
  Flame,
  Inbox,
  LucideIcon,
} from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Lead {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  status: string;
  priority: string;
  score: number;
  source?: string;
  notes?: string;
  parcelId?: string;
  createdAt: string;
  quotedAmount?: number | null;
  property?: {
    address?: string;
    city?: string;
    state?: string;
    yearBuilt?: number;
    ownerFullName?: string;
    assessedValue?: number;
    marketValue?: number;
  };
}

type StageTone = 'info' | 'accent' | 'warning' | 'default' | 'pink' | 'success' | 'muted';

interface StageDef {
  key: string;
  label: string;
  tone: StageTone;
  icon: LucideIcon;
}

const STAGES: StageDef[] = [
  { key: 'NEW', label: 'New', tone: 'info', icon: Sparkles },
  { key: 'CONTACTED', label: 'Contacted', tone: 'accent', icon: Phone },
  { key: 'QUALIFIED', label: 'Qualified', tone: 'warning', icon: CheckCircle2 },
  { key: 'QUOTED', label: 'Quoted', tone: 'default', icon: DollarSign },
  { key: 'NEGOTIATING', label: 'Negotiating', tone: 'pink', icon: Coins },
  { key: 'WON', label: 'Won', tone: 'success', icon: Trophy },
  { key: 'LOST', label: 'Lost', tone: 'muted', icon: XCircle },
];

const toneTextClass: Record<StageTone, string> = {
  info: 'text-[hsl(var(--info))]',
  accent: 'text-[hsl(var(--accent))]',
  warning: 'text-[hsl(var(--warning))]',
  default: 'text-[hsl(var(--primary))]',
  pink: 'text-[hsl(var(--destructive))]',
  success: 'text-[hsl(var(--success))]',
  muted: 'text-[hsl(var(--muted-foreground))]',
};

const toneBgSoft: Record<StageTone, string> = {
  info: 'bg-[hsl(var(--info)/0.12)]',
  accent: 'bg-[hsl(var(--accent)/0.12)]',
  warning: 'bg-[hsl(var(--warning)/0.12)]',
  default: 'bg-[hsl(var(--primary)/0.12)]',
  pink: 'bg-[hsl(var(--destructive)/0.12)]',
  success: 'bg-[hsl(var(--success)/0.12)]',
  muted: 'bg-[hsl(var(--muted))]',
};

const toneBorder: Record<StageTone, string> = {
  info: 'border-[hsl(var(--info)/0.3)]',
  accent: 'border-[hsl(var(--accent)/0.3)]',
  warning: 'border-[hsl(var(--warning)/0.3)]',
  default: 'border-[hsl(var(--primary)/0.3)]',
  pink: 'border-[hsl(var(--destructive)/0.3)]',
  success: 'border-[hsl(var(--success)/0.3)]',
  muted: 'border-[hsl(var(--border))]',
};

const toneBgSolid: Record<StageTone, string> = {
  info: 'bg-[hsl(var(--info))] text-[hsl(var(--info-foreground))]',
  accent: 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]',
  warning: 'bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]',
  default: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
  pink: 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]',
  success: 'bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]',
  muted: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
};

const STAGE_MOVE: Record<string, string> = {
  NEW: 'Move to Contacted →',
  CONTACTED: 'Move to Qualified →',
  QUALIFIED: 'Move to Quoted →',
  QUOTED: 'Move to Negotiating →',
  NEGOTIATING: 'Mark as Won',
  WON: '',
  LOST: '',
};

function getStageConfig(status: string): StageDef {
  return STAGES.find((s) => s.key === status) || STAGES[0];
}

function formatCurrency(v?: number | null) {
  if (!v) return null;
  return `$${v.toLocaleString()}`;
}

function scoreVariant(
  score: number
): 'success' | 'info' | 'warning' | 'secondary' {
  if (score >= 75) return 'success';
  if (score >= 55) return 'info';
  if (score >= 35) return 'warning';
  return 'secondary';
}

// ─── Lead Detail / Action Sheet (mobile bottom sheet) ────────────────────────

function LeadSheet({
  lead,
  onClose,
  onUpdate,
}: {
  lead: Lead;
  onClose: () => void;
  onUpdate: (updated: Lead, newStatus?: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState(lead.notes || '');
  const [quotedAmount, setQuotedAmount] = useState(lead.quotedAmount?.toString() || '');
  const stage = getStageConfig(lead.status);
  const StageIcon = stage.icon;
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
  const addr = lead.property?.address || (lead.parcelId ? `Parcel ${lead.parcelId}` : 'No address');

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/leads/${lead.id}`, {
        notes,
        quotedAmount: quotedAmount ? parseFloat(quotedAmount) : null,
      });
      onUpdate(res.data, lead.status);
    } catch {
      /* noop */
    } finally {
      setSaving(false);
    }
  };

  const handleMoveTo = async (newStatus: string) => {
    setSaving(true);
    try {
      const res = await api.patch(`/leads/${lead.id}`, { status: newStatus });
      onUpdate(res.data, newStatus);
    } catch {
      /* noop */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative max-h-[90vh] overflow-y-auto rounded-t-2xl border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]">
        <div className="flex justify-center pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-[hsl(var(--muted-foreground)/0.4)]" />
        </div>

        {/* Header */}
        <div className="border-b border-[hsl(var(--border))] px-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">{name}</h2>
              <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))]">{addr}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold',
                    toneBgSoft[stage.tone],
                    toneTextClass[stage.tone]
                  )}
                >
                  <StageIcon className="h-3 w-3" />
                  {stage.label}
                </span>
                {lead.quotedAmount && (
                  <span className="text-sm font-bold text-[hsl(var(--success))]">
                    {formatCurrency(lead.quotedAmount)}
                  </span>
                )}
              </div>
            </div>
            <Button
              onClick={onClose}
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3 px-5 py-4">
          {/* Phone / Email */}
          {(lead.phone || lead.email) && (
            <div className="flex gap-2">
              {lead.phone && (
                <Button asChild className="flex-1" size="lg">
                  <a href={`tel:${lead.phone}`}>
                    <Phone className="h-4 w-4" />
                    Call
                  </a>
                </Button>
              )}
              {lead.email && (
                <Button asChild className="flex-1" size="lg" variant="secondary">
                  <a href={`mailto:${lead.email}`}>
                    <Mail className="h-4 w-4" />
                    Email
                  </a>
                </Button>
              )}
            </div>
          )}

          {/* Next action */}
          {STAGE_MOVE[lead.status] && (
            <Button
              onClick={() => {
                const next =
                  lead.status === 'NEGOTIATING'
                    ? 'WON'
                    : STAGES[STAGES.findIndex((s) => s.key === lead.status) + 1]?.key;
                if (next) handleMoveTo(next);
              }}
              disabled={saving}
              size="lg"
              className="w-full"
            >
              {saving ? 'Moving…' : STAGE_MOVE[lead.status]}
            </Button>
          )}

          {lead.status === 'WON' && (
            <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.12)] py-3 text-sm font-bold text-[hsl(var(--success))]">
              <Trophy className="h-4 w-4" />
              Job Won! Great work!
            </div>
          )}

          {lead.status === 'LOST' && (
            <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] py-3 text-sm font-bold text-[hsl(var(--muted-foreground))]">
              <XCircle className="h-4 w-4" />
              Not a fit — move on
            </div>
          )}

          {/* Quoted amount */}
          {(lead.status === 'QUOTED' ||
            lead.status === 'NEGOTIATING' ||
            lead.status === 'WON') && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Quoted Amount
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-[hsl(var(--muted-foreground))]">
                  $
                </span>
                <Input
                  type="number"
                  value={quotedAmount}
                  onChange={(e) => setQuotedAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-12 pl-7 text-lg font-bold"
                />
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Call notes, property observations…"
              rows={3}
              className="w-full resize-none rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-3 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            />
          </div>

          <Button
            onClick={handleSaveNotes}
            disabled={saving}
            variant="secondary"
            size="lg"
            className="w-full"
          >
            {saving ? 'Saving…' : 'Save Notes'}
          </Button>

          {lead.status !== 'LOST' && lead.status !== 'WON' && (
            <Button
              onClick={() => handleMoveTo('LOST')}
              disabled={saving}
              variant="ghost"
              className="w-full text-[hsl(var(--muted-foreground))]"
            >
              Not a fit — remove from pipeline
            </Button>
          )}
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}

// ─── Mobile: Stage Tabs + Card List ──────────────────────────────────────────

function MobilePipeline({
  leads,
  onSelectLead,
  activeStage,
  setActiveStage,
}: {
  leads: Lead[];
  onSelectLead: (l: Lead) => void;
  activeStage: string;
  setActiveStage: (s: string) => void;
}) {
  const counts: Record<string, number> = {};
  STAGES.forEach((s) => {
    counts[s.key] = leads.filter((l) => l.status === s.key).length;
  });

  const stageLeads = leads.filter((l) => l.status === activeStage);
  const activeStageDef = STAGES.find((s) => s.key === activeStage) ?? STAGES[0];
  const ActiveIcon = activeStageDef.icon;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 overflow-x-auto px-4 pt-4 pb-2">
        <div className="flex min-w-max gap-2">
          {STAGES.map((s) => {
            const Icon = s.icon;
            const isActive = activeStage === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setActiveStage(s.key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                  isActive
                    ? toneBgSolid[s.tone]
                    : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{s.label}</span>
                {counts[s.key] > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-xs',
                      isActive ? 'bg-white/20' : 'bg-[hsl(var(--muted))]'
                    )}
                  >
                    {counts[s.key]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {stageLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div
              className={cn(
                'mb-3 flex h-12 w-12 items-center justify-center rounded-full',
                toneBgSoft[activeStageDef.tone],
                toneTextClass[activeStageDef.tone]
              )}
            >
              <ActiveIcon className="h-6 w-6" />
            </div>
            <p className="font-medium text-[hsl(var(--foreground))]">No leads in this stage</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              Search prospects to add leads
            </p>
          </div>
        ) : (
          stageLeads.map((lead) => (
            <LeadRow key={lead.id} lead={lead} onTap={() => onSelectLead(lead)} />
          ))
        )}
      </div>
    </div>
  );
}

function LeadRow({ lead, onTap }: { lead: Lead; onTap: () => void }) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
  const addr = lead.property?.address || (lead.parcelId ? `Parcel ${lead.parcelId}` : 'No address');

  return (
    <button
      onClick={onTap}
      className="group w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-left text-[hsl(var(--card-foreground))] transition-colors hover:border-[hsl(var(--ring))]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <p className="truncate text-base font-bold text-[hsl(var(--foreground))]">{name}</p>
            {lead.score >= 75 && <Flame className="h-4 w-4 text-[hsl(var(--destructive))]" />}
          </div>
          <p className="truncate text-sm text-[hsl(var(--muted-foreground))]">{addr}</p>
          <div className="mt-2 flex items-center gap-3">
            {lead.phone && (
              <span className="text-xs text-[hsl(var(--muted-foreground))]">{lead.phone}</span>
            )}
            {lead.quotedAmount && (
              <span className="text-xs font-bold text-[hsl(var(--success))]">
                {formatCurrency(lead.quotedAmount)}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge variant={scoreVariant(lead.score)} className="tabular-nums">
            {lead.score}
          </Badge>
          <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
        </div>
      </div>
    </button>
  );
}

// ─── Desktop: Compact Cards Grid ─────────────────────────────────────────────

function DesktopPipeline({
  leads,
  onSelectLead,
}: {
  leads: Lead[];
  onSelectLead: (l: Lead) => void;
}) {
  return (
    <div className="flex h-full gap-4 overflow-x-auto p-6">
      {STAGES.map((stage) => {
        const stageLeads = leads.filter((l) => l.status === stage.key);
        const Icon = stage.icon;
        return (
          <div key={stage.key} className="flex w-64 shrink-0 flex-col">
            <div
              className={cn(
                'mb-3 rounded-md border px-3 py-2.5',
                toneBgSoft[stage.tone],
                toneBorder[stage.tone]
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className={cn('h-4 w-4', toneTextClass[stage.tone])} />
                  <span className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {stage.label}
                  </span>
                </div>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-bold',
                    toneBgSoft[stage.tone],
                    toneTextClass[stage.tone]
                  )}
                >
                  {stageLeads.length}
                </span>
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {stageLeads.length === 0 && (
                <div className="py-8 text-center text-xs italic text-[hsl(var(--muted-foreground))]">
                  No leads
                </div>
              )}
              {stageLeads.map((lead) => {
                const name =
                  [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
                const addr =
                  lead.property?.address ||
                  (lead.parcelId ? `Parcel ${lead.parcelId}` : 'No address');
                return (
                  <button
                    key={lead.id}
                    onClick={() => onSelectLead(lead)}
                    className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-left transition-colors hover:border-[hsl(var(--ring))]"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                        {name}
                      </p>
                      <Badge variant={scoreVariant(lead.score)} className="shrink-0 tabular-nums">
                        {lead.score}
                      </Badge>
                    </div>
                    <p className="mb-1.5 truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {addr}
                    </p>
                    <div className="flex items-center justify-between">
                      {lead.phone ? (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          {lead.phone}
                        </span>
                      ) : (
                        <span />
                      )}
                      {lead.quotedAmount && (
                        <span className="text-xs font-bold text-[hsl(var(--success))]">
                          {formatCurrency(lead.quotedAmount)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const { user } = useAuthStore();
  const organizationId = user?.orgId;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [activeStage, setActiveStage] = useState('NEW');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const fetchLeads = useCallback(async () => {
    if (!organizationId) return;
    try {
      const res = await api.get('/leads', { params: { limit: 500 } });
      setLeads(Array.isArray(res.data) ? res.data : res.data?.data || []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleUpdate = (updated: Lead, newStatus?: string) => {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    if (newStatus) setActiveStage(newStatus);
    setSelectedLead(null);
  };

  const totalWon = leads
    .filter((l) => l.status === 'WON')
    .reduce((s, l) => s + (l.quotedAmount || 0), 0);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[hsl(var(--background))]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[hsl(var(--background))]">
      {/* Header */}
      <div className="shrink-0 border-b border-[hsl(var(--border))] px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">My Jobs</h1>
            <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))]">
              {leads.length} total
              {totalWon > 0 && (
                <>
                  {' '}
                  &bull;{' '}
                  <span className="text-[hsl(var(--success))]">
                    Won: {formatCurrency(totalWon)}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Pipeline body */}
      <div className="flex-1 overflow-hidden">
        {leads.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <Card className="flex flex-col items-center justify-center p-10 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                <Inbox className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">
                No leads yet
              </h3>
              <p className="mt-1 max-w-md text-sm text-[hsl(var(--muted-foreground))]">
                Search prospects to add your first lead.
              </p>
            </Card>
          </div>
        ) : isMobile ? (
          <MobilePipeline
            leads={leads}
            onSelectLead={setSelectedLead}
            activeStage={activeStage}
            setActiveStage={setActiveStage}
          />
        ) : (
          <DesktopPipeline leads={leads} onSelectLead={setSelectedLead} />
        )}
      </div>

      {selectedLead && (
        <LeadSheet
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
