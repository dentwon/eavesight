'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// --- Types ---

interface StormEvent {
  id: string;
  type: string;
  severity: string;
  date: string;
  county: string;
  city?: string;
  lat?: number;
  lon?: number;
}

interface Lead {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  status: string;
  priority: string;
  score?: number;
  lat?: number;
  lon?: number;
  createdAt?: string;
  property?: {
    address?: string;
    city?: string;
    state?: string;
    lat?: number;
    lon?: number;
    yearBuilt?: number;
    roofAge?: number;
    [key: string]: any;
  };
}

interface MapViewProps {
  storms?: StormEvent[];
  leads?: Lead[];
  center?: [number, number];
  zoom?: number;
  onLeadClick?: (lead: any) => void;
  onStormClick?: (storm: any) => void;
}

// --- Map Styles ---

const MAP_STYLES = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

// --- Color Helpers ---

const STORM_COLORS: Record<string, string> = {
  EXTREME: '#dc2626',
  SEVERE: '#ea580c',
  MODERATE: '#f59e0b',
  LIGHT: '#22c55e',
};

const LEAD_COLORS: Record<string, string> = {
  NEW: '#3b82f6',
  CONTACTED: '#8b5cf6',
  QUALIFIED: '#f59e0b',
  QUOTED: '#06b6d4',
  NEGOTIATING: '#ec4899',
  WON: '#22c55e',
  LOST: '#6b7280',
};

const STORM_TYPE_ICONS: Record<string, string> = {
  HAIL: '\u{1F9CA}',
  WIND: '\u{1F4A8}',
  TORNADO: '\u{1F32A}',
  HURRICANE: '\u{1F300}',
  FLOOD: '\u{1F30A}',
};

// --- Component ---

export default function MapView({
  storms = [],
  leads = [],
  center = [-86.5854, 34.7304],
  zoom = 10,
  onLeadClick,
  onStormClick,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [layers, setLayers] = useState({
    storms: true,
    stormHeatmap: false,
    leads: true,
  });
  const [showLayerPanel, setShowLayerPanel] = useState(false);

  // Initialize map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[theme],
      center,
      zoom,
      attributionControl: false,
    });

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.current.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
    }), 'bottom-right');
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
        setMapLoaded(false);
      }
    };
  }, []);

  // Handle theme changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.setStyle(MAP_STYLES[theme]);

    // Re-add data sources after style change
    map.current.once('style.load', () => {
      addStormLayers();
      addLeadLayers();
    });
  }, [theme]);

  // --- Storm Layers ---
  const addStormLayers = useCallback(() => {
    if (!map.current) return;

    const m = map.current;
    const sourceId = 'storms-source';

    // Clean up existing
    ['storms-circles', 'storms-heatmap', 'storms-labels'].forEach(id => {
      if (m.getLayer(id)) m.removeLayer(id);
    });
    if (m.getSource(sourceId)) m.removeSource(sourceId);

    const features = storms
      .filter(s => s.lat && s.lon)
      .map(s => ({
        type: 'Feature' as const,
        properties: {
          id: s.id,
          type: s.type,
          severity: s.severity || 'LIGHT',
          date: s.date,
          county: s.county,
          city: s.city || '',
          // Numeric severity for heatmap weight
          severityWeight: s.severity === 'EXTREME' ? 4 : s.severity === 'SEVERE' ? 3 : s.severity === 'MODERATE' ? 2 : 1,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [s.lon!, s.lat!],
        },
      }));

    if (features.length === 0) return;

    m.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    // Heatmap layer (togglable)
    m.addLayer({
      id: 'storms-heatmap',
      type: 'heatmap',
      source: sourceId,
      layout: {
        visibility: layers.stormHeatmap ? 'visible' : 'none',
      },
      paint: {
        'heatmap-weight': ['get', 'severityWeight'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 3],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.1, '#22c55e',
          0.3, '#f59e0b',
          0.5, '#ea580c',
          0.7, '#dc2626',
          1, '#7f1d1d',
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 30, 12, 15],
        'heatmap-opacity': 0.6,
      },
    });

    // Circle markers layer
    m.addLayer({
      id: 'storms-circles',
      type: 'circle',
      source: sourceId,
      layout: {
        visibility: layers.storms ? 'visible' : 'none',
      },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 10, 16, 14],
        'circle-color': [
          'match', ['get', 'severity'],
          'EXTREME', STORM_COLORS.EXTREME,
          'SEVERE', STORM_COLORS.SEVERE,
          'MODERATE', STORM_COLORS.MODERATE,
          'LIGHT', STORM_COLORS.LIGHT,
          '#6366f1',
        ],
        'circle-opacity': 0.8,
        'circle-stroke-width': 2,
        'circle-stroke-color': theme === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)',
      },
    });

    // Click handler
    m.on('click', 'storms-circles', (e) => {
      if (e.features?.[0] && onStormClick) {
        const props = e.features[0].properties;
        onStormClick(props);
      }
      if (e.features?.[0]) {
        const coords = (e.features[0].geometry as any).coordinates;
        const props = e.features[0].properties as any;
        showPopup(coords, `
          <div class="sv-popup">
            <div class="sv-popup-header">${STORM_TYPE_ICONS[props.type] || ''} ${props.type} Storm</div>
            <div class="sv-popup-severity sv-severity-${(props.severity || '').toLowerCase()}">${props.severity}</div>
            <div class="sv-popup-detail">${props.city || props.county || 'Unknown'}</div>
            <div class="sv-popup-date">${new Date(props.date).toLocaleDateString()}</div>
          </div>
        `);
      }
    });

    m.on('mouseenter', 'storms-circles', () => { if (m) m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'storms-circles', () => { if (m) m.getCanvas().style.cursor = ''; });
  }, [storms, layers.storms, layers.stormHeatmap, theme, onStormClick]);

  // --- Lead Layers ---
  const addLeadLayers = useCallback(() => {
    if (!map.current) return;

    const m = map.current;
    const sourceId = 'leads-source';

    ['leads-circles', 'leads-labels'].forEach(id => {
      if (m.getLayer(id)) m.removeLayer(id);
    });
    if (m.getSource(sourceId)) m.removeSource(sourceId);

    const features = leads
      .filter(l => {
        const lat = l.lat || l.property?.lat;
        const lon = l.lon || l.property?.lon;
        return lat && lon;
      })
      .map(l => {
        const lat = l.lat || l.property?.lat || 0;
        const lon = l.lon || l.property?.lon || 0;
        return {
          type: 'Feature' as const,
          properties: {
            id: l.id,
            name: [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unknown',
            status: l.status || 'NEW',
            priority: l.priority || 'MEDIUM',
            score: l.score || 50,
            address: l.property?.address || '',
            city: l.property?.city || '',
            roofAge: l.property?.roofAge || null,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [lon, lat],
          },
        };
      });

    if (features.length === 0) return;

    m.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    m.addLayer({
      id: 'leads-circles',
      type: 'circle',
      source: sourceId,
      layout: {
        visibility: layers.leads ? 'visible' : 'none',
      },
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['get', 'score'],
          0, 6,
          50, 8,
          75, 10,
          100, 14,
        ],
        'circle-color': [
          'match', ['get', 'status'],
          'NEW', LEAD_COLORS.NEW,
          'CONTACTED', LEAD_COLORS.CONTACTED,
          'QUALIFIED', LEAD_COLORS.QUALIFIED,
          'QUOTED', LEAD_COLORS.QUOTED,
          'NEGOTIATING', LEAD_COLORS.NEGOTIATING,
          'WON', LEAD_COLORS.WON,
          'LOST', LEAD_COLORS.LOST,
          '#3b82f6',
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 2,
        'circle-stroke-color': theme === 'dark' ? 'rgba(255,255,255,0.4)' : '#ffffff',
      },
    });

    // Click handler
    m.on('click', 'leads-circles', (e) => {
      if (e.features?.[0] && onLeadClick) {
        onLeadClick(e.features[0].properties);
      }
      if (e.features?.[0]) {
        const coords = (e.features[0].geometry as any).coordinates;
        const props = e.features[0].properties as any;
        showPopup(coords, `
          <div class="sv-popup">
            <div class="sv-popup-header">${props.name}</div>
            <div class="sv-popup-score">Score: ${props.score}</div>
            <div class="sv-popup-status sv-status-${(props.status || '').toLowerCase()}">${props.status}</div>
            <div class="sv-popup-detail">${props.address}</div>
            <div class="sv-popup-detail">${props.city}</div>
            ${props.roofAge ? `<div class="sv-popup-detail">Roof age: ${props.roofAge} years</div>` : ''}
          </div>
        `);
      }
    });

    m.on('mouseenter', 'leads-circles', () => { if (m) m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'leads-circles', () => { if (m) m.getCanvas().style.cursor = ''; });
  }, [leads, layers.leads, theme, onLeadClick]);

  // Update layers when data or visibility changes
  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    addStormLayers();
  }, [storms, mapLoaded, addStormLayers]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    addLeadLayers();
  }, [leads, mapLoaded, addLeadLayers]);

  // Toggle layer visibility
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;
    const setVis = (id: string, visible: boolean) => {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    };
    setVis('storms-circles', layers.storms);
    setVis('storms-heatmap', layers.stormHeatmap);
    setVis('leads-circles', layers.leads);
  }, [layers, mapLoaded]);

  // Popup helper
  const showPopup = (coords: [number, number], html: string) => {
    if (popupRef.current) popupRef.current.remove();
    if (!map.current) return;

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: '240px',
      className: theme === 'dark' ? 'sv-popup-dark' : '',
    })
      .setLngLat(coords)
      .setHTML(html)
      .addTo(map.current);
  };

  const toggleLayer = (key: keyof typeof layers) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Theme toggle */}
      <button
        onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        className="absolute top-3 right-3 z-10 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg p-2 shadow-lg hover:shadow-xl transition-all"
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? (
          <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 20 20">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        )}
      </button>

      {/* Layer toggle button (mobile-friendly) */}
      <button
        onClick={() => setShowLayerPanel(!showLayerPanel)}
        className="absolute top-3 left-3 z-10 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg p-2 shadow-lg hover:shadow-xl transition-all"
      >
        <svg className="w-5 h-5 text-gray-700 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Layer control panel */}
      {showLayerPanel && (
        <div className={`absolute top-14 left-3 z-10 rounded-xl shadow-xl p-3 min-w-[200px] transition-all ${
          theme === 'dark' ? 'bg-gray-900/95 text-white' : 'bg-white/95 text-gray-900'
        } backdrop-blur-sm`}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
          }`}>Map Layers</p>

          <div className="space-y-2">
            <LayerToggle
              label="Storm Events"
              sublabel={`${storms.filter(s => s.lat).length} events`}
              active={layers.storms}
              color="#ea580c"
              onToggle={() => toggleLayer('storms')}
              dark={theme === 'dark'}
            />
            <LayerToggle
              label="Storm Heatmap"
              sublabel="Severity density"
              active={layers.stormHeatmap}
              color="#dc2626"
              onToggle={() => toggleLayer('stormHeatmap')}
              dark={theme === 'dark'}
            />
            <LayerToggle
              label="Leads"
              sublabel={`${leads.filter(l => l.lat || l.property?.lat).length} leads`}
              active={layers.leads}
              color="#3b82f6"
              onToggle={() => toggleLayer('leads')}
              dark={theme === 'dark'}
            />
          </div>

          {/* Legend */}
          <div className={`mt-4 pt-3 border-t ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
            <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}>Storm Severity</p>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(STORM_COLORS).map(([severity, color]) => (
                <div key={severity} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[11px]">{severity.charAt(0) + severity.slice(1).toLowerCase()}</span>
                </div>
              ))}
            </div>

            <p className={`text-xs font-semibold uppercase tracking-wider mt-3 mb-2 ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}>Lead Status</p>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(LEAD_COLORS).slice(0, 6).map(([status, color]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[11px]">{status.charAt(0) + status.slice(1).toLowerCase()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom stats bar */}
      <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full px-4 py-1.5 shadow-lg ${
        theme === 'dark' ? 'bg-gray-900/90 text-gray-300' : 'bg-white/90 text-gray-600'
      } backdrop-blur-sm`}>
        <p className="text-xs font-medium">
          <span className="text-orange-500">{storms.filter(s => s.lat).length}</span> storms
          <span className="mx-2 opacity-30">|</span>
          <span className="text-blue-500">{leads.filter(l => l.lat || l.property?.lat).length}</span> leads
        </p>
      </div>

      {/* Popup styles */}
      <style jsx global>{`
        .maplibregl-popup-content {
          padding: 0 !important;
          border-radius: 12px !important;
          overflow: hidden;
          box-shadow: 0 10px 25px rgba(0,0,0,0.15) !important;
        }
        .sv-popup-dark .maplibregl-popup-content {
          background: #1f2937 !important;
          color: #f3f4f6 !important;
        }
        .sv-popup-dark .maplibregl-popup-tip {
          border-top-color: #1f2937 !important;
        }
        .sv-popup {
          padding: 12px 14px;
          font-size: 13px;
          line-height: 1.4;
        }
        .sv-popup-header {
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 4px;
        }
        .sv-popup-severity, .sv-popup-status {
          display: inline-block;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 9999px;
          margin-bottom: 6px;
        }
        .sv-severity-extreme { background: #fecaca; color: #991b1b; }
        .sv-severity-severe { background: #fed7aa; color: #9a3412; }
        .sv-severity-moderate { background: #fef3c7; color: #92400e; }
        .sv-severity-light { background: #dcfce7; color: #166534; }
        .sv-status-new { background: #dbeafe; color: #1e40af; }
        .sv-status-contacted { background: #ede9fe; color: #5b21b6; }
        .sv-status-qualified { background: #fef3c7; color: #92400e; }
        .sv-status-won { background: #dcfce7; color: #166534; }
        .sv-popup-detail {
          color: inherit;
          opacity: 0.7;
          font-size: 12px;
        }
        .sv-popup-date {
          color: inherit;
          opacity: 0.5;
          font-size: 11px;
          margin-top: 2px;
        }
        .sv-popup-score {
          font-weight: 700;
          font-size: 13px;
          margin-bottom: 4px;
        }
        .maplibregl-popup-close-button {
          font-size: 18px;
          padding: 4px 8px;
          color: inherit;
          opacity: 0.5;
        }
        .maplibregl-popup-close-button:hover {
          opacity: 1;
          background: transparent;
        }
      `}</style>
    </div>
  );
}

// --- Layer Toggle Component ---

function LayerToggle({
  label,
  sublabel,
  active,
  color,
  onToggle,
  dark,
}: {
  label: string;
  sublabel: string;
  active: boolean;
  color: string;
  onToggle: () => void;
  dark: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-3 w-full px-2.5 py-2 rounded-lg transition-all ${
        active
          ? dark ? 'bg-gray-800' : 'bg-gray-100'
          : dark ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'
      }`}
    >
      <div
        className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
          active ? 'border-transparent' : dark ? 'border-gray-600' : 'border-gray-300'
        }`}
        style={active ? { backgroundColor: color } : {}}
      >
        {active && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <div className="text-left">
        <p className="text-sm font-medium leading-tight">{label}</p>
        <p className={`text-[11px] ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{sublabel}</p>
      </div>
    </button>
  );
}
