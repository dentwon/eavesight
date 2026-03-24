'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

// Dynamic import for map to avoid SSR issues
const MapView = dynamic(() => import('@/components/map/MapView'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-gray-600">Loading map...</p>
      </div>
    </div>
  ),
});

interface Lead {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  status: string;
  priority: string;
  address?: string;
  city?: string;
  lat?: number;
  lon?: number;
  createdAt: string;
  property?: {
    address: string;
    city: string;
    yearBuilt?: number;
  };
}

interface Storm {
  id: string;
  type: string;
  severity: string;
  date: string;
  county: string;
  city?: string;
  lat?: number;
  lon?: number;
}

interface Stats {
  leads: { total: number; new: number; won: number; conversionRate: number };
  properties: { total: number };
  storms: { last30Days: number };
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [storms, setStorms] = useState<Storm[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLeadPanel, setShowLeadPanel] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.orgId) return;

      try {
        const [leadsRes, stormsRes, statsRes] = await Promise.all([
          api.get('/leads', { params: { limit: 20 } }),
          api.get('/storms', { params: { state: 'AL', limit: 50 } }),
          api.get('/analytics/overview'),
        ]);

        setLeads(leadsRes.data.data || []);
        setStorms(stormsRes.data.data || []);
        setStats(statsRes.data);
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.orgId]);

  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead);
    setShowLeadPanel(true);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case 'NEW': return 'bg-blue-100 text-blue-800';
      case 'CONTACTED': return 'bg-purple-100 text-purple-800';
      case 'QUALIFIED': return 'bg-yellow-100 text-yellow-800';
      case 'QUOTED': return 'bg-cyan-100 text-cyan-800';
      case 'WON': return 'bg-green-100 text-green-800';
      case 'LOST': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority.toUpperCase()) {
      case 'URGENT': return 'text-red-600';
      case 'HIGH': return 'text-orange-600';
      case 'MEDIUM': return 'text-yellow-600';
      case 'LOW': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-81px)] flex">
      {/* Main content - Map */}
      <div className="flex-1 relative min-h-0">
        <div className="absolute inset-0 pt-0">
          <MapView
            leads={leads}
            storms={storms}
            center={[-86.5854, 34.7304]} // Huntsville, AL
            zoom={10}
            onLeadClick={handleLeadClick}
          />
        </div>

        {/* Floating stats cards */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000]">
          <div className="bg-white rounded-lg shadow-lg px-4 py-2 flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{stats?.leads?.total || 0}</p>
              <p className="text-xs text-gray-500">Total Leads</p>
            </div>
            <div className="w-px h-8 bg-gray-200"></div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{stats?.leads?.won || 0}</p>
              <p className="text-xs text-gray-500">Jobs Won</p>
            </div>
            <div className="w-px h-8 bg-gray-200"></div>
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-600">{stats?.storms?.last30Days || 0}</p>
              <p className="text-xs text-gray-500">Storms (30d)</p>
            </div>
            <div className="w-px h-8 bg-gray-200"></div>
            <div className="text-center">
              <p className="text-2xl font-bold text-cyan-600">{stats?.leads?.conversionRate || 0}%</p>
              <p className="text-xs text-gray-500">Win Rate</p>
            </div>
          </div>
        </div>

        {/* Quick add lead button */}
        <div className="absolute bottom-4 right-[340px] z-[1000]">
          <button className="bg-primary hover:bg-primary-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Lead
          </button>
        </div>
      </div>

      {/* Right sidebar - Recent leads */}
      <div className="w-80 bg-white border-l border-gray-200 flex flex-col z-[1000]">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Recent Leads</h2>
          <p className="text-sm text-gray-500">{leads.length} leads in your area</p>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {leads.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <p className="mb-2">No leads yet</p>
              <p className="text-sm">Click "Add Lead" or search properties on the map</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {leads.slice(0, 15).map((lead) => (
                <div
                  key={lead.id}
                  onClick={() => handleLeadClick(lead)}
                  className="p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {lead.firstName || lead.lastName 
                          ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim()
                          : 'Unknown'}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
                        {lead.property?.address || lead.address || 'No address'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Added {formatDate(lead.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(lead.status)}`}>
                        {lead.status}
                      </span>
                      <span className={`text-xs font-medium ${getPriorityColor(lead.priority)}`}>
                        {lead.priority}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-200">
          <a href="/dashboard/leads" className="block w-full text-center text-sm text-primary hover:text-primary-600 font-medium">
            View all leads →
          </a>
        </div>
      </div>

      {/* Lead detail panel */}
      {showLeadPanel && selectedLead && (
        <div className="fixed inset-0 z-[2000] flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowLeadPanel(false)}></div>
          <div className="relative w-full max-w-md bg-white shadow-xl h-full overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Lead Details</h2>
              <button
                onClick={() => setShowLeadPanel(false)}
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Contact info */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3">Contact Information</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {selectedLead.firstName || selectedLead.lastName 
                          ? `${selectedLead.firstName || ''} ${selectedLead.lastName || ''}`.trim()
                          : 'Unknown'}
                      </p>
                      <p className="text-sm text-gray-500">{selectedLead.email || 'No email'}</p>
                    </div>
                  </div>
                  {selectedLead.phone && (
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <a href={`tel:${selectedLead.phone}`} className="text-primary hover:underline">
                        {selectedLead.phone}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Property info */}
              {selectedLead.property && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Property</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <p className="font-medium text-gray-900">{selectedLead.property.address}</p>
                    <p className="text-sm text-gray-500">{selectedLead.property.city}, AL</p>
                    {selectedLead.property.yearBuilt && (
                      <p className="text-sm text-gray-500">Built: {selectedLead.property.yearBuilt}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Status */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3">Status</h3>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(selectedLead.status)}`}>
                    {selectedLead.status}
                  </span>
                  <span className={`text-sm font-medium ${getPriorityColor(selectedLead.priority)}`}>
                    {selectedLead.priority} Priority
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3">
                <button className="w-full bg-primary hover:bg-primary-600 text-white px-4 py-2 rounded-lg font-medium transition-colors">
                  Update Status
                </button>
                <button className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors">
                  Edit Lead
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
