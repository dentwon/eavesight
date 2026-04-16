'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import * as pmtiles from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { usePreferencesStore } from '@/stores/preferences';

// ============================================================
// Types
// ============================================================

interface StormPoint {
  id: string;
  lat: number;
  lon: number;
  type: string;
  severity: string | null;
  date: string;
  hailSizeInches?: number;
  windSpeedMph?: number;
  description?: string;
  city?: string;
  county?: string;
  state?: string;
}

interface PropertyPoint {
  id: string;
  lat: number;
  lon: number;
  address: string;
  ownerFullName?: string;
  assessedValue?: number;
  yearBuilt?: number;
  roofData?: {
    totalAreaSqft?: number;
    material?: string;
    condition?: string;
    estimatedTotalCost?: number;
  };
  buildingFootprint?: {
    geometry: any;
    areaSqft?: number;
  };
}

interface BuildingClickData {
  id: string;
  lat: number;
  lon: number;
  areaSqft: number;
  damageScore: number;
  distanceKm: number;
  stormType: string;
  stormSeverity: string;
}

interface StormMapProps {
  storms?: StormPoint[];
  properties?: PropertyPoint[];
  center?: [number, number];
  zoom?: number;
  interactive?: boolean;
  showStorms?: boolean;
  showProperties?: boolean;
  showFootprints?: boolean;
  onStormClick?: (storm: StormPoint) => void;
  onPropertyClick?: (property: PropertyPoint) => void;
  onBuildingClick?: (building: BuildingClickData) => void;
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  className?: string;
}

// ============================================================
// Color Palettes (professional, muted, no garish colors)
// ============================================================

const STORM_COLORS: Record<string, Record<string, string>> = {
  HAIL: {
    EXTREME: '#22d3ee',   // cyan-400
    SEVERE: '#06b6d4',    // cyan-500
    MODERATE: '#0891b2',  // cyan-600
    LIGHT: '#0e7490',     // cyan-700
    default: '#06b6d4',
  },
  TORNADO: {
    EXTREME: '#f87171',   // red-400
    SEVERE: '#ef4444',    // red-500
    MODERATE: '#dc2626',  // red-600
    LIGHT: '#b91c1c',     // red-700
    default: '#ef4444',
  },
  WIND: {
    EXTREME: '#a78bfa',   // violet-400
    SEVERE: '#8b5cf6',    // violet-500
    MODERATE: '#7c3aed',  // violet-600
    LIGHT: '#6d28d9',     // violet-700
    default: '#8b5cf6',
  },
  TSTM: {
    default: '#fbbf24',   // amber-400
  },
  FLOOD: {
    default: '#3b82f6',   // blue-500
  },
  default: {
    default: '#94a3b8',   // slate-400
  },
};

const SEVERITY_SIZES: Record<string, number> = {
  EXTREME: 12,
  SEVERE: 9,
  MODERATE: 7,
  LIGHT: 5,
};

const SEVERITY_OPACITY: Record<string, number> = {
  EXTREME: 0.95,
  SEVERE: 0.8,
  MODERATE: 0.65,
  LIGHT: 0.5,
};

// ============================================================
// PMTiles protocol (register once)
// ============================================================

let pmtilesProtocolRegistered = false;

function ensurePMTilesProtocol() {
  if (!pmtilesProtocolRegistered) {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    pmtilesProtocolRegistered = true;
  }
}

// ============================================================
// Helper: add PMTiles building source + layer
// ============================================================

function addBuildingsPMTiles(
  map: maplibregl.Map,
  onBuildingClick?: (building: BuildingClickData) => void,
) {
  const SOURCE = 'buildings-pmtiles';
  const SOURCE_LAYER = 'buildings';

  try {
    if (map.getLayer('building-fill')) map.removeLayer('building-fill');
    if (map.getLayer('building-outline')) map.removeLayer('building-outline');
    if (map.getLayer('building-highlight')) map.removeLayer('building-highlight');
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  } catch (e) {}

  map.addSource(SOURCE, {
    type: 'vector',
    url: 'pmtiles:///north_alabama_buildings.pmtiles',
    // @ts-ignore promoteId is valid maplibre opt
    promoteId: 'id',
  });

  // Neutral polygon fill \u2014 visible at higher zooms, painted from feature-state
  map.addLayer({
    id: 'building-fill',
    type: 'fill',
    source: SOURCE,
    'source-layer': SOURCE_LAYER,
    minzoom: 12,
    paint: {
      'fill-color': [
        'case',
        ['has', 'score', ['properties']], '#3b82f6',
        [
          'interpolate', ['linear'],
          ['coalesce', ['feature-state', 'score'], -1],
          -1, 'rgba(148, 163, 184, 0.20)',
          0, 'rgba(148, 163, 184, 0.25)',
          40, '#60a5fa',
          60, '#f59e0b',
          80, '#f97316',
          100, '#dc2626',
        ],
      ],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 0.85,
        ['>', ['coalesce', ['feature-state', 'score'], -1], -1], 0.75,
        0.35,
      ],
    },
  });

  map.addLayer({
    id: 'building-outline',
    type: 'line',
    source: SOURCE,
    'source-layer': SOURCE_LAYER,
    minzoom: 13,
    paint: {
      'line-color': 'rgba(148, 163, 184, 0.55)',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        13, 0.2,
        15, 0.5,
        17, 1.0,
      ],
    },
  });

  // Hover highlight
  let hoveredId: number | string | null = null;
  const onMove = (e: any) => {
    const f = e.features && e.features[0];
    if (hoveredId !== null) {
      map.setFeatureState({ source: SOURCE, sourceLayer: SOURCE_LAYER, id: hoveredId }, { hover: false });
    }
    if (f) {
      hoveredId = f.id as any;
      map.setFeatureState({ source: SOURCE, sourceLayer: SOURCE_LAYER, id: hoveredId }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
    } else {
      hoveredId = null;
      map.getCanvas().style.cursor = '';
    }
  };
  const onLeave = () => {
    if (hoveredId !== null) {
      map.setFeatureState({ source: SOURCE, sourceLayer: SOURCE_LAYER, id: hoveredId }, { hover: false });
      hoveredId = null;
    }
    map.getCanvas().style.cursor = '';
  };
  map.on('mousemove', 'building-fill', onMove);
  map.on('mouseleave', 'building-fill', onLeave);

  map.on('click', 'building-fill', (e) => {
    if (!e.features?.[0]) return;
    const f = e.features[0];
    const props: any = f.properties || {};
    const coords = e.lngLat;
    if (onBuildingClick) {
      onBuildingClick({
        id: String((f as any).id ?? props.id ?? ''),
        lat: coords.lat,
        lon: coords.lng,
        areaSqft: props.area ?? 0,
        damageScore: 0,
        distanceKm: 0,
        stormType: '',
        stormSeverity: '',
      });
    }
  });
}

// ============================================================
// Viewport scores fetcher (dynamic painting via feature-state)
// ============================================================

async function fetchAndApplyScores(
  map: maplibregl.Map,
  layer: string,
) {
  const SOURCE = 'buildings-pmtiles';
  const SOURCE_LAYER = 'buildings';
  if (!map.getSource(SOURCE)) return;
  const b = map.getBounds();
  const params = new URLSearchParams({
    layer,
    minLon: String(b.getWest()),
    minLat: String(b.getSouth()),
    maxLon: String(b.getEast()),
    maxLat: String(b.getNorth()),
    limit: '50000',
  });
  try {
    const res = await fetch('/api/map/scores?' + params.toString());
    if (!res.ok) return;
    const data = await res.json();
    const scores: Record<string, number> = data.scores || {};
    // Clear previous feature-state
    map.removeFeatureState({ source: SOURCE, sourceLayer: SOURCE_LAYER });
    for (const idStr of Object.keys(scores)) {
      const id = Number(idStr);
      map.setFeatureState(
        { source: SOURCE, sourceLayer: SOURCE_LAYER, id },
        { score: scores[idStr] },
      );
    }
  } catch (e) {
    // Non-fatal
  }
}

// ============================================================
// Component
// ============================================================

export default function StormMap({
  storms = [],
  properties = [],
  center = [-86.5854, 34.7304],
  zoom = 8,
  interactive = true,
  showStorms = true,
  showProperties = true,
  showFootprints = true,
  onStormClick,
  onPropertyClick,
  onBuildingClick,
  onBoundsChange,
  className = '',
}: StormMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [activeLayer, setActiveLayer] = useState<string>("lead_score");
  const appTheme = usePreferencesStore((s) => s.appTheme);
  // mapMode is derived from appTheme so the useEffect fires on theme toggle
  const [mapMode, setMapMode] = useState<'map' | 'satellite'>(
    appTheme === 'light' ? 'map' : 'map'
  );

  // Sync mapMode whenever appTheme changes from external source (e.g. store toggle)
  useEffect(() => {
    // appTheme drives the style; mapMode only differs if user explicitly picked satellite
    if (mapMode !== 'satellite') {
      // theme changed — force the effect by briefly flipping mapMode
      setMapMode('satellite');
      setTimeout(() => setMapMode('map'), 0);
    }
  }, [appTheme]);

  const CARTO_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const CARTO_LIGHT_STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

  // Apply dark blue + orange label overrides for CARTO dark-matter
  const applyCartoOverrides = useCallback((m: maplibregl.Map) => {
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
  }, []);

  // Add 3D building extrusions (map mode only)
  const addBuildingExtrusions = useCallback((m: maplibregl.Map) => {
    try {
      if (m.getLayer('building-3d')) m.removeLayer('building-3d');
      const style = m.getStyle();
      if (!style || !style.layers) return;
      const buildingLayer = style.layers.find(l => l.id.includes('building') && (l as any).type === 'fill');
      if (!buildingLayer) return;
      const sourceId = (buildingLayer as any).source;
      const sourceLayerId = (buildingLayer as any)['source-layer'] || 'building';
      m.addLayer({
        id: 'building-3d',
        source: sourceId,
        'source-layer': sourceLayerId,
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#1a2744',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['*', ['coalesce', ['get', 'levels'], 2], 3]],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.7,
        },
      });
    } catch (e) {
      // Building extrusion is optional
    }
  }, []);

  // Build a minimal satellite style
  const buildSatelliteStyle = useCallback((): maplibregl.StyleSpecification => {
    return {
      version: 8,
      sources: {
        satellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'ESRI World Imagery',
        },
      },
      layers: [
        {
          id: 'satellite-tiles',
          type: 'raster',
          source: 'satellite',
          paint: { 'raster-opacity': 1 },
        },
      ],
    } as maplibregl.StyleSpecification;
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    // Register PMTiles protocol before creating the map
    ensurePMTilesProtocol();

    const getInitialStyle = () => {
      if (appTheme === 'light') return CARTO_LIGHT_STYLE_URL;
      return CARTO_STYLE_URL;
    };

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: getInitialStyle(),
      center: center as [number, number],
      zoom,
      attributionControl: false,
      maxZoom: 20,
      minZoom: 3,
    });

    if (interactive) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 150, unit: 'imperial' }), 'bottom-left');
    } else {
      map.scrollZoom.disable();
      map.dragPan.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
    }

    map.on('load', () => {
      applyCartoOverrides(map);
      addBuildingExtrusions(map);

      // Buildings from PMTiles
      addBuildingsPMTiles(map, onBuildingClick);

      setMapLoaded(true);
    });

    // Bounds change callback for loading properties on viewport
    if (onBoundsChange) {
      map.on('moveend', () => {
        const bounds = map.getBounds();
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      });
    }

    // Recovery: if PMTiles source disappears (rapid zoom), re-add on idle
    map.on('idle', () => {
      if (map.isStyleLoaded() && !map.getSource('buildings-pmtiles')) {
        addBuildingsPMTiles(map, onBuildingClick);
      }
    });

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  // Handle map mode switching (map <-> satellite)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapLoaded) return;

    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const currentBearing = map.getBearing();
    const currentPitch = map.getPitch();

    if (mapMode === 'satellite') {
      map.setStyle(buildSatelliteStyle());
    } else if (appTheme === 'light') {
      map.setStyle(CARTO_LIGHT_STYLE_URL);
    } else {
      map.setStyle(CARTO_STYLE_URL);
    }

    map.once('style.load', () => {
      map.setCenter(currentCenter);
      map.setZoom(currentZoom);
      map.setBearing(currentBearing);
      map.setPitch(currentPitch);

      if (appTheme !== 'light') {
        applyCartoOverrides(map);
        addBuildingExtrusions(map);
      }

      // Re-add PMTiles building source + layer after style change
      addBuildingsPMTiles(map, onBuildingClick);


      // Re-trigger data layer additions with a small delay for stability
      setMapLoaded(false);
      setTimeout(() => setMapLoaded(true), 50);
    });
  }, [mapMode, appTheme]);


  // ============================================================
  // Viewport score painting (dynamic feature-state)
  // ============================================================
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapLoaded) return;
    // Initial paint
    fetchAndApplyScores(map, activeLayer);
    const handler = () => fetchAndApplyScores(map, activeLayer);
    map.on('moveend', handler);
    return () => { map.off('moveend', handler); };
  }, [mapLoaded, activeLayer]);



  // Hail frequency heat map layer - uses full 76-year NOAA dataset
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapLoaded) return;

    const loadHeatmap = async () => {
      const bounds = map.getBounds();
      const params = new URLSearchParams({
        north: String(bounds.getNorth()),
        south: String(bounds.getSouth()),
        east: String(bounds.getEast()),
        west: String(bounds.getWest()),
        gridSize: '0.05',
      });

      try {
        const res = await fetch(`/api/storms/heatmap?${params}`);
        if (!res.ok) return;
        const geojson = await res.json();

        if (map.getSource('hail-frequency')) {
          (map.getSource('hail-frequency') as maplibregl.GeoJSONSource).setData(geojson);
        } else {
          map.addSource('hail-frequency', { type: 'geojson', data: geojson });

          // Add the fill layer BEFORE storm dots so it renders underneath
          const firstStormLayer = map.getLayer('storm-clusters') ? 'storm-clusters' : undefined;

          map.addLayer({
            id: 'hail-frequency-fill',
            type: 'fill',
            source: 'hail-frequency',
            paint: {
              'fill-color': [
                'interpolate',
                ['linear'],
                ['get', 'normalized'],
                0, 'rgba(0, 0, 0, 0)',
                0.1, 'rgba(59, 130, 246, 0.08)',
                0.3, 'rgba(59, 130, 246, 0.15)',
                0.5, 'rgba(245, 158, 11, 0.2)',
                0.7, 'rgba(239, 68, 68, 0.25)',
                1.0, 'rgba(239, 68, 68, 0.35)',
              ],
              'fill-opacity': 0.8,
            },
          }, firstStormLayer);

          map.addLayer({
            id: 'hail-frequency-outline',
            type: 'line',
            source: 'hail-frequency',
            paint: {
              'line-color': [
                'interpolate',
                ['linear'],
                ['get', 'normalized'],
                0, 'rgba(0, 0, 0, 0)',
                0.3, 'rgba(59, 130, 246, 0.1)',
                0.7, 'rgba(239, 68, 68, 0.15)',
                1.0, 'rgba(239, 68, 68, 0.25)',
              ],
              'line-width': 0.5,
            },
          }, firstStormLayer);
        }
      } catch (err) {
        console.warn('Failed to load hail frequency heatmap:', err);
      }
    };

    loadHeatmap();

    // Reload when map moves
    const handler = () => loadHeatmap();
    map.on('moveend', handler);
    return () => { map.off('moveend', handler); };
  }, [mapLoaded]);

  // Update storm data
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapLoaded || !showStorms) return;

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: storms
        .filter(s => s.lat && s.lon)
        .map(storm => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [storm.lon, storm.lat],
          },
          properties: {
            id: storm.id,
            type: storm.type,
            severity: storm.severity || 'MODERATE',
            date: storm.date,
            hailSize: storm.hailSizeInches || 0,
            windSpeed: storm.windSpeedMph || 0,
            description: storm.description || '',
            city: storm.city || '',
            county: storm.county || '',
            state: storm.state || '',
            color: getStormColor(storm.type, storm.severity),
            size: SEVERITY_SIZES[storm.severity || 'MODERATE'] || 7,
            opacity: SEVERITY_OPACITY[storm.severity || 'MODERATE'] || 0.65,
          },
        })),
    };

    // Add or update source
    if (map.getSource('storms')) {
      (map.getSource('storms') as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource('storms', {
        type: 'geojson',
        data: geojson,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 40,
      });

      // Cluster circles
      map.addLayer({
        id: 'storm-clusters',
        type: 'circle',
        source: 'storms',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#0e7490',   // cyan-700 for small clusters
            10, '#06b6d4', // cyan-500
            50, '#22d3ee', // cyan-400
            200, '#67e8f9', // cyan-300
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16,
            10, 22,
            50, 30,
            200, 38,
          ],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 12, 0.6, 13, 0.3, 14, 0],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(255,255,255,0.15)',
        },
      });

      // Cluster count labels
      map.addLayer({
        id: 'storm-cluster-count',
        type: 'symbol',
        source: 'storms',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
        },
        paint: {
          'text-color': '#ffffff',
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 1, 12, 0.7, 13, 0.3, 14, 0],
        },
      });

      // Individual storm points with glow effect
      // Outer glow
      map.addLayer({
        id: 'storm-points-glow',
        type: 'circle',
        source: 'storms',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['*', ['get', 'size'], 2.5],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.15,
          'circle-blur': 1,
        },
      });

      // Main storm dot
      map.addLayer({
        id: 'storm-points',
        type: 'circle',
        source: 'storms',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['get', 'size'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.2)',
        },
      });

      // Inner bright core
      map.addLayer({
        id: 'storm-points-core',
        type: 'circle',
        source: 'storms',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['*', ['get', 'size'], 0.35],
          'circle-color': '#ffffff',
          'circle-opacity': ['*', ['get', 'opacity'], 0.6],
        },
      });

      // Click handler for storm points
      map.on('click', 'storm-points', (e) => {
        if (!e.features?.[0]) return;
        const props = e.features[0].properties;
        if (!props) return;

        if (onStormClick) {
          const storm = storms.find(s => s.id === props.id);
          if (storm) onStormClick(storm);
        }

        // Show popup
        const coords = (e.features[0].geometry as any).coordinates;
        const severityLabel = props.severity || 'Unknown';
        const typeLabel = props.type || 'Storm';
        const dateStr = props.date ? new Date(props.date).toLocaleDateString() : '';

        new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          className: 'storm-popup',
          maxWidth: '280px',
        })
          .setLngLat(coords)
          .setHTML(`
            <div style="background:#1e293b;color:#e2e8f0;padding:12px;border-radius:8px;font-family:system-ui;border:1px solid #334155;">
              <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#f1f5f9;">
                ${typeLabel} ${severityLabel !== 'null' ? '- ' + severityLabel : ''}
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">
                ${props.city || ''}${props.city && props.county ? ', ' : ''}${props.county || ''} ${props.state || ''}
              </div>
              <div style="font-size:11px;color:#94a3b8;">${dateStr}</div>
              ${props.hailSize > 0 ? `<div style="font-size:11px;color:#22d3ee;margin-top:4px;">Hail: ${props.hailSize}" diameter</div>` : ''}
              ${props.windSpeed > 0 ? `<div style="font-size:11px;color:#a78bfa;margin-top:2px;">Wind: ${props.windSpeed} mph</div>` : ''}
              ${props.description && props.description !== 'null' ? `<div style="font-size:10px;color:#64748b;margin-top:6px;border-top:1px solid #334155;padding-top:6px;">${props.description.substring(0, 120)}</div>` : ''}
            </div>
          `)
          .addTo(map);
      });

      // Click clusters to zoom in
      map.on('click', 'storm-clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['storm-clusters'] });
        const clusterId = features[0]?.properties?.cluster_id;
        if (clusterId === undefined) return;

        (map.getSource('storms') as maplibregl.GeoJSONSource).getClusterExpansionZoom(
          clusterId,
        ).then(zoom => {
          map.easeTo({
            center: (features[0].geometry as any).coordinates,
            zoom: zoom || 10,
          });
        });
      });

      // Cursor changes
      map.on('mouseenter', 'storm-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'storm-points', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'storm-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'storm-clusters', () => { map.getCanvas().style.cursor = ''; });
    }
  }, [storms, mapLoaded, showStorms, mapMode]);

  // Update property data (shown at higher zoom levels)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapLoaded || !showProperties) return;

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: properties
        .filter(p => p.lat && p.lon)
        .map(prop => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [prop.lon, prop.lat],
          },
          properties: {
            id: prop.id,
            address: prop.address,
            owner: prop.ownerFullName || '',
            value: prop.assessedValue || 0,
            yearBuilt: prop.yearBuilt || 0,
            roofCost: prop.roofData?.estimatedTotalCost || 0,
            roofArea: prop.roofData?.totalAreaSqft || 0,
          },
        })),
    };

    if (map.getSource('properties')) {
      (map.getSource('properties') as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource('properties', {
        type: 'geojson',
        data: geojson,
      });

      // Property markers (visible at zoom 13+)
      map.addLayer({
        id: 'property-points',
        type: 'circle',
        source: 'properties',
        minzoom: 13,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            13, 3,
            16, 6,
            19, 10,
          ],
          'circle-color': '#34d399',  // emerald-400
          'circle-opacity': 0.8,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.3)',
        },
      });

      // Property labels at high zoom
      map.addLayer({
        id: 'property-labels',
        type: 'symbol',
        source: 'properties',
        minzoom: 16,
        layout: {
          'text-field': ['get', 'address'],
          'text-size': 10,
          'text-offset': [0, 1.5],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#94a3b8',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1,
        },
      });

      // Click handler
      map.on('click', 'property-points', (e) => {
        if (!e.features?.[0]) return;
        const props = e.features[0].properties;
        if (!props) return;

        if (onPropertyClick) {
          const property = properties.find(p => p.id === props.id);
          if (property) onPropertyClick(property);
        }

        const coords = (e.features[0].geometry as any).coordinates;
        const valueStr = props.value ? `$${Number(props.value).toLocaleString()}` : 'N/A';
        const roofStr = props.roofArea ? `${Number(props.roofArea).toLocaleString()} sqft` : '';
        const costStr = props.roofCost ? `$${Number(props.roofCost).toLocaleString()}` : '';

        new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          maxWidth: '260px',
        })
          .setLngLat(coords)
          .setHTML(`
            <div style="background:#1e293b;color:#e2e8f0;padding:12px;border-radius:8px;font-family:system-ui;border:1px solid #334155;">
              <div style="font-size:13px;font-weight:600;color:#f1f5f9;margin-bottom:4px;">
                ${props.address}
              </div>
              ${props.owner ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">${props.owner}</div>` : ''}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;">
                <div style="color:#64748b;">Value</div>
                <div style="color:#e2e8f0;text-align:right;">${valueStr}</div>
                ${roofStr ? `<div style="color:#64748b;">Roof</div><div style="color:#e2e8f0;text-align:right;">${roofStr}</div>` : ''}
                ${costStr ? `<div style="color:#64748b;">Est. Job</div><div style="color:#34d399;text-align:right;">${costStr}</div>` : ''}
                ${props.yearBuilt > 0 ? `<div style="color:#64748b;">Built</div><div style="color:#e2e8f0;text-align:right;">${props.yearBuilt}</div>` : ''}
              </div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', 'property-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'property-points', () => { map.getCanvas().style.cursor = ''; });
    }
  }, [properties, mapLoaded, showProperties, mapMode]);

  // Building footprints at high zoom
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapLoaded || !showFootprints) return;

    const footprintFeatures = properties
      .filter(p => p.buildingFootprint?.geometry)
      .map(p => ({
        type: 'Feature' as const,
        geometry: p.buildingFootprint!.geometry,
        properties: {
          id: p.id,
          areaSqft: p.buildingFootprint?.areaSqft || 0,
        },
      }));

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: footprintFeatures,
    };

    if (map.getSource('footprints')) {
      (map.getSource('footprints') as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource('footprints', {
        type: 'geojson',
        data: geojson,
      });

      // Building footprint fill
      map.addLayer({
        id: 'footprint-fill',
        type: 'fill',
        source: 'footprints',
        minzoom: 15,
        paint: {
          'fill-color': '#34d399',
          'fill-opacity': 0.15,
        },
      });

      // Building footprint outline
      map.addLayer({
        id: 'footprint-outline',
        type: 'line',
        source: 'footprints',
        minzoom: 15,
        paint: {
          'line-color': '#34d399',
          'line-width': 1.5,
          'line-opacity': 0.6,
        },
      });
    }
  }, [properties, mapLoaded, showFootprints, mapMode]);

  return (
    <div className={`relative ${className}`}>
      <div ref={mapRef} className="w-full h-full" />

      {/* Layer toggle */}
      {interactive && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-slate-900/90 backdrop-blur-sm border border-slate-700/50 rounded-lg p-1 text-xs">
          {[
            { id: 'lead_score', label: 'Lead Score' },
            { id: 'storm_recent', label: 'Latest Storm' },
            { id: 'roof_age', label: 'Roof Age' },
            { id: 'dormant', label: 'Dormant' },
            { id: 'pipeline', label: 'Pipeline' },
          ].map((l) => (
            <button
              key={l.id}
              onClick={() => setActiveLayer(l.id)}
              className={"px-3 py-1.5 rounded font-medium transition-colors " + (activeLayer === l.id ? 'bg-amber-500/90 text-slate-900' : 'text-slate-300 hover:bg-slate-700/60')}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {/* Satellite / Map / Light toggle */}
      {interactive && (
        <div className="absolute top-3 right-3 z-10 flex items-center bg-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-lg overflow-hidden text-xs">
          <button
            onClick={() => setAppTheme('dark')}
            className={`px-3 py-1.5 font-medium transition-colors ${
              appTheme === 'dark'
                ? 'bg-slate-600/80 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Dark mode"
          >
            Dark
          </button>
          <button
            onClick={() => setAppTheme('light')}
            className={`px-3 py-1.5 font-medium transition-colors ${
              appTheme === 'light'
                ? 'bg-slate-600/80 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Light mode"
          >
            Light
          </button>
        </div>
      )}

      {/* Dark styling for map controls */}
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

      {/* Legend: pill toggle on mobile, compact panel on desktop */}
      {interactive && showStorms && (
        <>
          <button
            onClick={() => setLegendOpen(!legendOpen)}
            className="lg:hidden absolute bottom-3 right-3 z-10 flex items-center gap-1.5 bg-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-full px-3 py-2 text-xs text-slate-300 hover:text-white transition-colors min-h-[36px]"
          >
            <span>Legend</span>
            <svg className={`w-3 h-3 transition-transform ${legendOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          {legendOpen && (
            <>
              <div className="lg:hidden fixed inset-0 z-20 bg-black/40" onClick={() => setLegendOpen(false)} />
              <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-slate-900 border-t border-slate-700/50 rounded-t-2xl p-4 pb-6 max-h-[50vh] overflow-y-auto">
                <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-4" />
                <LegendContent />
              </div>
            </>
          )}
          <div className="hidden lg:block absolute bottom-8 right-4 bg-slate-900/90 backdrop-blur-sm border border-slate-700/50 rounded-lg p-3 text-xs">
            <LegendContent />
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================


function LegendContent() {
  return (
    <div className="text-xs">
      <div className="text-slate-400 font-medium mb-2 text-[10px] uppercase tracking-wider">Storm Types</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:flex sm:flex-col sm:gap-y-1.5">
        <LegendItem color="#06b6d4" label="Hail" />
        <LegendItem color="#ef4444" label="Tornado" />
        <LegendItem color="#8b5cf6" label="Wind" />
        <LegendItem color="#fbbf24" label="Thunderstorm" />
        <LegendItem color="#3b82f6" label="Flood" />
      </div>
      <div className="border-t border-slate-700/50 mt-3 pt-3">
        <div className="text-slate-400 font-medium mb-2 text-[10px] uppercase tracking-wider">Severity</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-slate-400 opacity-50" /><span className="text-slate-500">Light</span></div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-slate-400 opacity-70" /><span className="text-slate-500">Med</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-slate-400 opacity-90" /><span className="text-slate-500">Severe</span></div>
        </div>
      </div>
    </div>
  );
}

function getStormColor(type: string, severity: string | null): string {
  const typeColors = STORM_COLORS[type] || STORM_COLORS.default;
  return typeColors[severity || 'default'] || typeColors.default;
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-slate-400">{label}</span>
    </div>
  );
}
