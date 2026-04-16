'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { usePreferencesStore } from '@/stores/preferences';

interface Parcel {
  pin: string;
  propertyAddress: string;
  propertyOwner: string;
  mailingAddressFull: string;
  totalAppraisedValue: number | null;
  totalBuildingValue: number | null;
  acres: number | null;
  zoning: string | null;
  floodZone: string | null;
  lat: number;
  lon: number;
}

interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface MapViewProps {
  parcels: Parcel[];
  onBoundsChange: (bounds: MapBounds) => void;
  valueColor: (p: Parcel) => string;
  onParcelClick: (p: Parcel | null) => void;
}

const MAP_STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};

const CARTO_LIGHT_STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const CARTO_DARK_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MADISON_CENTER: [number, number] = [-86.55, 34.76];

export default function MapView({ parcels, onBoundsChange, valueColor, onParcelClick }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapTheme = usePreferencesStore((s) => s.mapTheme);
  const setMapTheme = usePreferencesStore((s) => s.setMapTheme);

  // Apply dark blue + orange label overrides for CARTO dark-matter
  const applyCartoOverrides = (m: maplibregl.Map) => {
    const s = m.getStyle();
    if (s && s.layers) {
      for (const layer of s.layers) {
        try {
          if (layer.id === 'background') m.setPaintProperty(layer.id, 'background-color', '#0f1729');
          if (layer.id === 'water') m.setPaintProperty(layer.id, 'fill-color', '#0c1322');
          if (layer.id.includes('landuse') || layer.id.includes('landcover') || layer.id === 'park') {
            if ((layer as any).type === 'fill') m.setPaintProperty(layer.id, 'fill-color', '#111d33');
          }
          if ((layer.id.startsWith('road') || layer.id.startsWith('tunnel') || layer.id.startsWith('bridge')) && (layer as any).type === 'line') {
            m.setPaintProperty(layer.id, 'line-color', '#1e2d4a');
          }
          if (layer.id.includes('boundary') && (layer as any).type === 'line') {
            m.setPaintProperty(layer.id, 'line-color', '#1e3050');
          }
          if ((layer as any).type === 'symbol') {
            const isWater = layer.id.includes('water');
            const isMajor = layer.id.includes('city') || layer.id.includes('country') || layer.id.includes('state');
            const isPlace = layer.id.startsWith('place_');
            const clr = isWater ? '#2a4a6a' : isMajor ? '#e8933e' : isPlace ? '#c4853f' : '#9a7848';
            m.setPaintProperty(layer.id, 'text-color', clr);
          }
        } catch (e) {}
      }
    }
  };

  // Init map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const style = mapTheme === 'light' ? CARTO_LIGHT_STYLE_URL : CARTO_DARK_STYLE_URL;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style,
      center: MADISON_CENTER,
      zoom: 11,
      attributionControl: false,
    });

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current.addControl(new maplibregl.ScaleControl({ maxWidth: 150, unit: 'imperial' }), 'bottom-left');

    map.current.on('load', () => {
      if (mapTheme !== 'light') applyCartoOverrides(map.current!);
      setMapLoaded(true);
    });

    map.current.on('moveend', () => {
      if (!map.current) return;
      const b = map.current.getBounds();
      onBoundsChange({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    });

    return () => {
      map.current?.remove();
      map.current = null;
      setMapLoaded(false);
    };
  }, []);

  // Handle theme changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const style = mapTheme === 'light' ? CARTO_LIGHT_STYLE_URL : CARTO_DARK_STYLE_URL;
    map.current.setStyle(style);
    map.current.once('style.load', () => {
      if (mapTheme !== 'light') applyCartoOverrides(map.current!);
      setMapLoaded(true);
    });
  }, [mapTheme]);

  // Parcel layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;

    const features = parcels.map((p) => ({
      type: 'Feature' as const,
      properties: {
        pin: p.pin,
        address: p.propertyAddress,
        owner: p.propertyOwner,
        mailing: p.mailingAddressFull,
        value: p.totalAppraisedValue,
        buildingValue: p.totalBuildingValue,
        zoning: p.zoning,
        floodZone: p.floodZone,
        acres: p.acres,
        color: valueColor(p),
      },
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
    }));

    const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

    if (m.getSource('parcels')) {
      (m.getSource('parcels') as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      m.addSource('parcels', { type: 'geojson', data: geojson });

      m.addLayer({
        id: 'parcel-glow',
        type: 'circle',
        source: 'parcels',
        paint: {
          'circle-radius': ['*', ['zoom'], 0.8],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.2,
          'circle-blur': 1,
        },
      });

      m.addLayer({
        id: 'parcel-points',
        type: 'circle',
        source: 'parcels',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 18, 12],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': mapTheme === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)',
        },
      });
    }

    // Click handler
    const clickHandler = (e: maplibregl.MapMouseEvent) => {
      const features = m.queryRenderedFeatures(e.point, { layers: ['parcel-points'] });
      if (!features.length) {
        popup.current?.remove();
        onParcelClick(null);
        return;
      }
      const props = features[0].properties as any;
      const coords = (features[0].geometry as any).coordinates;
      popup.current?.remove();

      const value = props.value ? `$${Number(props.value).toLocaleString()}` : '—';
      const building = props.buildingValue ? `$${Number(props.buildingValue).toLocaleString()}` : '—';

      popup.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px' })
        .setLngLat(coords)
        .setHTML(`
          <div style="background:#1e293b;color:#e2e8f0;padding:12px;border-radius:8px;font-family:system-ui;border:1px solid #334155;min-width:220px;">
            <div style="font-size:13px;font-weight:600;color:#f1f5f9;margin-bottom:2px;">${props.address}</div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">${props.pin}</div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:2px;">${props.owner || '—'}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;margin-top:8px;">
              <div><div style="color:#64748b;">Appraised</div><div style="color:#e2e8f0;">${value}</div></div>
              <div><div style="color:#64748b;">Building</div><div style="color:#e2e8f0;">${building}</div></div>
              <div><div style="color:#64748b;">Zoning</div><div style="color:#e2e8f0;">${props.zoning || '—'}</div></div>
              <div><div style="color:#64748b;">Flood Zone</div><div style="color:#e2e8f0;">${props.floodZone || '—'}</div></div>
              <div style="grid-column:span 2"><div style="color:#64748b;">Acres</div><div style="color:#e2e8f0;">${props.acres ? Number(props.acres).toFixed(2) : '—'}</div></div>
            </div>
          </div>
        `)
        .addTo(m);

      onParcelClick(
        parcels.find(
          (p) => p.lon === coords[0] && p.lat === coords[1]
        ) || null
      );
    };

    m.off('click', 'parcel-points', clickHandler as any);
    m.on('click', 'parcel-points', clickHandler as any);
    m.off('click', (e: maplibregl.MapMouseEvent) => {
      const features = m.queryRenderedFeatures(e.point, { layers: ['parcel-points'] });
      if (!features.length) { popup.current?.remove(); onParcelClick(null); }
    });
    m.on('click', (e: maplibregl.MapMouseEvent) => {
      const features = m.queryRenderedFeatures(e.point, { layers: ['parcel-points'] });
      if (!features.length) { popup.current?.remove(); onParcelClick(null); }
    });

    m.on('mouseenter', 'parcel-points', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'parcel-points', () => { m.getCanvas().style.cursor = ''; });
  }, [parcels, mapLoaded, mapTheme]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Dark/Light map theme toggle */}
      <div className="absolute top-3 left-3 z-10 flex items-center bg-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-lg overflow-hidden text-xs">
        <button
          onClick={() => setMapTheme('dark')}
          className={`px-3 py-1.5 font-medium transition-colors ${
            mapTheme === 'dark' ? 'bg-slate-600/80 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Dark
        </button>
        <button
          onClick={() => setMapTheme('light')}
          className={`px-3 py-1.5 font-medium transition-colors ${
            mapTheme === 'light' ? 'bg-slate-600/80 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Light
        </button>
      </div>

      {/* Dark map controls override */}
      <style jsx global>{`
        .maplibregl-ctrl-scale { background-color: rgba(15,23,41,0.8) !important; color: #cbd5e1 !important; border-color: #475569 !important; font-size: 10px !important; padding: 1px 6px !important; border-radius: 4px !important; }
        .maplibregl-ctrl-group { background: rgba(15,23,41,0.85) !important; border: 1px solid rgba(71,85,105,0.5) !important; border-radius: 8px !important; }
        .maplibregl-ctrl-group button { background-color: transparent !important; }
        .maplibregl-ctrl-group button span { filter: invert(0.8) !important; }
        .maplibregl-ctrl-group button:hover { background-color: rgba(30,41,59,0.8) !important; }
        .maplibregl-popup-content { padding: 0 !important; background: transparent !important; box-shadow: none !important; }
        .maplibregl-popup-tip { border-top-color: #1e293b !important; }
        .maplibregl-popup-close-button { color: #94a3b8 !important; font-size: 18px !important; }
      `}</style>
    </div>
  );
}