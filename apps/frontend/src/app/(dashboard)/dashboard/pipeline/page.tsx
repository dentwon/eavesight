'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

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
  };
}

const STAGES = [
  { key: 'NEW', label: 'New', color: 'bg-blue-500', textColor: 'text-blue-400', icon: '🆕' },
  { key: 'CONTACTED', label: 'Contacted', color: 'bg-purple-500', textColor: 'text-purple-400', icon: '📞' },
  { key: 'QUALIFIED', label: 'Qualified', color: 'bg-yellow-500', textColor: 'text-yellow-400', icon: '✅' },
  { key: 'QUOTED', label: 'Quoted', color: 'bg-cyan-500', textColor: 'text-cyan-400', icon: '💰' },
  { key: 'NEGOTIATING', label: 'Negotiating', color: 'bg-pink-500', textColor: 'text-pink-400', icon: '🤝' },
  { key: 'WON', label: 'Won', color: 'bg-emerald-500', textColor: 'text-emerald-400', icon: '🏆' },
  { key: 'LOST', label: 'Lost', color: 'bg-slate-500', textColor: 'text-slate-400', icon: '❌' },
];

const STAGE_MOVE: Record<string, string> = {
  NEW: 'Move to Contacted →',
  CONTACTED: 'Move to Qualified →',
  QUALIFIED: 'Move to Quoted →',
  QUOTED: 'Move to Negotiating →',
  NEGOTIATING: 'Mark as Won ✓',
  WON: '',
  LOST: '',
};

function getStageConfig(status: string) {
  return STAGES.find(s => s.key === status) || STAGES[0];
}

function formatCurrency(v?: number | null) {
  if (!v) return null;
  return `$${v.toLocaleString()}`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Lead Detail / Action Sheet (mobile bottom sheet) ────────────────────────

function LeadSheet({ lead, onClose, onUpdate }: {
  lead: Lead;
  onClose: () => void;
  onUpdate: (updated: Lead, newStatus?: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState(lead.notes || '');
  const [quotedAmount, setQuotedAmount] = useState(lead.quotedAmount?.toString() || '');
  const stage = getStageConfig(lead.status);
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
  const addr = lead.property?.address || lead.parcelId ? `Parcel ${lead.parcelId}` : 'No address';

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/leads/${lead.id}`, { notes, quotedAmount: quotedAmount ? parseFloat(quotedAmount) : null });
      onUpdate(res.data, lead.status);
    } catch { } finally { setSaving(false); }
  };

  const handleMoveTo = async (newStatus: string) => {
    setSaving(true);
    try {
      const res = await api.patch(`/leads/${lead.id}`, { status: newStatus });
      onUpdate(res.data, newStatus);
    } catch { } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Sheet */}
      <div className="relative bg-slate-800 border-t border-slate-700 rounded-t-2xl max-h-[90vh] overflow-y-auto">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-slate-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="px-5 pb-4 border-b border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">{name}</h2>
              <p className="text-sm text-slate-400 mt-0.5">{addr}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${stage.bg} ${stage.textColor}`}>
                  <span>{stage.icon}</span>{stage.label}
                </span>
                {lead.quotedAmount && (
                  <span className="text-sm font-bold text-emerald-400">{formatCurrency(lead.quotedAmount)}</span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-white shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 space-y-3">
          {/* Phone / Email */}
          <div className="flex gap-2">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex-1 flex items-center justify-center gap-2 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm rounded-xl transition-colors active:scale-95">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Call
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl transition-colors active:scale-95">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email
              </a>
            )}
          </div>

          {/* Next action */}
          {STAGE_MOVE[lead.status] && (
            <button
              onClick={() => {
                const next = lead.status === 'NEGOTIATING' ? 'WON' :
                  STAGES[STAGES.findIndex(s => s.key === lead.status) + 1]?.key;
                if (next) handleMoveTo(next);
              }}
              disabled={saving}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors active:scale-95"
            >
              {saving ? 'Moving...' : STAGE_MOVE[lead.status]}
            </button>
          )}

          {lead.status === 'NEGOTIATING' && (
            <button
              onClick={() => handleMoveTo('WON')}
              disabled={saving}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors active:scale-95"
            >
              🏆 Mark as Won — Close the Job!
            </button>
          )}

          {lead.status === 'WON' && (
            <div className="w-full py-3 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-bold text-sm rounded-xl text-center">
              🏆 Job Won! Great work!
            </div>
          )}

          {lead.status === 'LOST' && (
            <div className="w-full py-3 bg-slate-500/20 border border-slate-500/30 text-slate-400 font-bold text-sm rounded-xl text-center">
              ❌ Not a fit — move on
            </div>
          )}

          {/* Quoted amount */}
          {lead.status === 'QUOTED' || lead.status === 'NEGOTIATING' || lead.status === 'WON' ? (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Quoted Amount</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input
                  type="number"
                  value={quotedAmount}
                  onChange={e => setQuotedAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-3 bg-slate-900 border border-slate-700 text-white font-bold text-lg rounded-xl focus:outline-none focus:border-cyan-500/50 placeholder-slate-600"
                />
              </div>
            </div>
          ) : null}

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Call notes, property observations..."
              rows={3}
              className="w-full px-3 py-3 bg-slate-900 border border-slate-700 text-white rounded-xl focus:outline-none focus:border-cyan-500/50 text-sm resize-none placeholder-slate-600"
            />
          </div>

          <button
            onClick={handleSaveNotes}
            disabled={saving}
            className="w-full py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors active:scale-95"
          >
            {saving ? 'Saving...' : 'Save Notes'}
          </button>

          {/* Mark lost */}
          {lead.status !== 'LOST' && lead.status !== 'WON' && (
            <button
              onClick={() => handleMoveTo('LOST')}
              disabled={saving}
              className="w-full py-3 text-slate-500 hover:text-slate-300 text-sm font-medium transition-colors"
            >
              Not a fit — remove from pipeline
            </button>
          )}
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}

// ─── Mobile: Stage Tabs + Card List ──────────────────────────────────────────

function MobilePipeline({ leads, onSelectLead, activeStage, setActiveStage }: {
  leads: Lead[];
  onSelectLead: (l: Lead) => void;
  activeStage: string;
  setActiveStage: (s: string) => void;
}) {
  const counts: Record<string, number> = {};
  STAGES.forEach(s => { counts[s.key] = leads.filter(l => l.status === s.key).length; });

  const stageLeads = leads.filter(l => l.status === activeStage);

  return (
    <div className="flex flex-col h-full">
      {/* Stage tabs — horizontal scroll */}
      <div className="shrink-0 overflow-x-auto px-4 pt-4 pb-2">
        <div className="flex gap-2 min-w-max">
          {STAGES.map(s => (
            <button
              key={s.key}
              onClick={() => setActiveStage(s.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition-all ${
                activeStage === s.key
                  ? `${s.color} text-white shadow-lg`
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              <span>{s.icon}</span>
              <span>{s.label}</span>
              {counts[s.key] > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeStage === s.key ? 'bg-white/20' : 'bg-slate-700'
                }`}>{counts[s.key]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Lead list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {stageLeads.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">
              {STAGES.find(s => s.key === activeStage)?.icon}
            </div>
            <p className="text-slate-400 font-medium">No leads in this stage</p>
            <p className="text-xs text-slate-600 mt-1">Search prospects to add leads</p>
          </div>
        ) : (
          stageLeads.map(lead => <LeadRow key={lead.id} lead={lead} onTap={() => onSelectLead(lead)} />)
        )}
      </div>
    </div>
  );
}

function LeadRow({ lead, onTap }: { lead: Lead; onTap: () => void }) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
  const addr = lead.property?.address || (lead.parcelId ? `Parcel ${lead.parcelId}` : 'No address');
  const stage = getStageConfig(lead.status);

  return (
    <button
      onClick={onTap}
      className="w-full text-left bg-slate-800/80 border border-slate-700/50 rounded-2xl p-4 hover:border-slate-600 active:scale-[0.98] transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-base font-bold text-white truncate">{name}</p>
            {lead.score >= 75 && <span className="text-sm">🔥</span>}
          </div>
          <p className="text-sm text-slate-400 truncate">{addr}</p>
          <div className="flex items-center gap-3 mt-2">
            {lead.phone && (
              <span className="text-xs text-slate-500">{lead.phone}</span>
            )}
            {lead.quotedAmount && (
              <span className="text-xs font-bold text-emerald-400">{formatCurrency(lead.quotedAmount)}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-xs font-bold px-2 py-1 rounded-lg ${lead.score >= 75 ? 'bg-emerald-500/20 text-emerald-400' : lead.score >= 55 ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-700 text-slate-400'}`}>
            {lead.score}
          </span>
          <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </button>
  );
}

// ─── Desktop: Compact Cards Grid ─────────────────────────────────────────────

function DesktopPipeline({ leads, onSelectLead }: {
  leads: Lead[];
  onSelectLead: (l: Lead) => void;
}) {
  return (
    <div className="flex gap-4 p-6 h-full overflow-x-auto">
      {STAGES.map(stage => {
        const stageLeads = leads.filter(l => l.status === stage.key);
        return (
          <div key={stage.key} className="flex flex-col w-64 shrink-0">
            {/* Column header */}
            <div className={`mb-3 px-3 py-2.5 rounded-xl border ${stage.color}/20`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{stage.icon}</span>
                  <span className="text-sm font-bold text-slate-200">{stage.label}</span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${stage.color}/20 ${stage.textColor}`}>
                  {stageLeads.length}
                </span>
              </div>
            </div>
            {/* Cards */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {stageLeads.length === 0 && (
                <div className="text-center py-8 text-xs text-slate-600 italic">No leads</div>
              )}
              {stageLeads.map(lead => {
                const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
                const addr = lead.property?.address || (lead.parcelId ? `Parcel ${lead.parcelId}` : 'No address');
                return (
                  <button
                    key={lead.id}
                    onClick={() => onSelectLead(lead)}
                    className="w-full text-left bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 hover:border-slate-600 hover:bg-slate-800 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold text-slate-200 truncate">{name}</p>
                      <span className={`text-xs font-bold shrink-0 ${lead.score >= 75 ? 'text-emerald-400' : lead.score >= 55 ? 'text-cyan-400' : 'text-slate-500'}`}>
                        {lead.score}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mb-1.5">{addr}</p>
                    <div className="flex items-center justify-between">
                      {lead.phone ? (
                        <span className="text-xs text-slate-400">{lead.phone}</span>
                      ) : <span />}
                      {lead.quotedAmount && (
                        <span className="text-xs font-bold text-emerald-400">{formatCurrency(lead.quotedAmount)}</span>
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
  const { organizationId } = useAuthStore();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [activeStage, setActiveStage] = useState('NEW');
  const [isMobile, setIsMobile] = useState(false);
  const [windowHeight, setWindowHeight] = useState(800);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setWindowHeight(window.innerHeight);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const fetchLeads = useCallback(async () => {
    if (!organizationId) return;
    try {
      const res = await api.get('/leads', { params: { limit: 500 } });
      setLeads(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch { } finally { setLoading(false); }
  }, [organizationId]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const handleUpdate = (updated: Lead, newStatus?: string) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    if (newStatus) setActiveStage(newStatus);
    setSelectedLead(null);
  };

  const totalWon = leads.filter(l => l.status === 'WON').reduce((s, l) => s + (l.quotedAmount || 0), 0);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">My Jobs</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {leads.length} total &bull;
              {totalWon > 0 && <span className="text-emerald-400"> Won: {formatCurrency(totalWon)}</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Pipeline body */}
      <div className="flex-1 overflow-hidden">
        {isMobile ? (
          <MobilePipeline
            leads={leads}
            onSelectLead={setSelectedLead}
            activeStage={activeStage}
            setActiveStage={setActiveStage}
          />
        ) : (
          <DesktopPipeline
            leads={leads}
            onSelectLead={setSelectedLead}
          />
        )}
      </div>

      {/* Bottom sheet */}
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
