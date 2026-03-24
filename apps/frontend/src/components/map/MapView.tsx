'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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

interface Property {
  id: string;
  address: string;
  city: string;
  state: string;
  lat?: number;
  lon?: number;
  yearBuilt?: number;
  roofAge?: number;
}

interface Lead {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  status: string;
  priority: string;
  address?: string;
  lat?: number;
  lon?: number;
  createdAt?: string;
  property?: {
    address?: string;
    city?: string;
    state?: string;
    yearBuilt?: number;
    [key: string]: any;
  };
}

interface MapViewProps {
  storms?: StormEvent[];
  properties?: Property[];
  leads?: Lead[];
  center?: [number, number];
  zoom?: number;
  onLeadClick?: (lead: any) => void;
  onPropertyClick?: (property: any) => void;
  onStormClick?: (storm: any) => void;
}

export default function MapView({
  storms = [],
  properties = [],
  leads = [],
  center = [-86.5854, 34.7304], // Huntsville, AL default
  zoom = 10,
  onLeadClick,
  onPropertyClick,
  onStormClick,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [activeLayer, setActiveLayer] = useState<'all' | 'storms' | 'properties' | 'leads'>('all');

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center,
      zoom,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Add storm markers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const sourceName = 'storms';
    const sourceId = `${sourceName}-source`;
    const layerId = `${sourceName}-layer`;

    // Remove existing if any
    if (map.current.getLayer(layerId)) map.current.removeLayer(layerId);
    if (map.current.getSource(sourceId)) map.current.removeSource(sourceId);

    const stormData = storms
      .filter((s) => s.lat && s.lon)
      .map((s) => ({
        type: 'Feature' as const,
        properties: { ...s },
        geometry: {
          type: 'Point' as const,
          coordinates: [s.lon!, s.lat!],
        },
      }));

    if (stormData.length > 0) {
      map.current.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: stormData },
      });

      map.current.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 12,
          'circle-color': getStormColor(''),
          'circle-opacity': 0.7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });

      map.current.on('click', layerId, (e) => {
        if (e.features && e.features[0] && onStormClick) {
          onStormClick(e.features[0].properties as unknown as StormEvent);
        }
      });

      map.current.on('mouseenter', layerId, () => {
        if (map.current) map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', layerId, () => {
        if (map.current) map.current.getCanvas().style.cursor = '';
      });
    }
  }, [storms, mapLoaded, onStormClick]);

  // Add lead markers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const sourceName = 'leads';
    const sourceId = `${sourceName}-source`;
    const layerId = `${sourceName}-layer`;

    if (map.current.getLayer(layerId)) map.current.removeLayer(layerId);
    if (map.current.getSource(sourceId)) map.current.removeSource(sourceId);

    const leadData = leads
      .filter((l) => l.lat && l.lon)
      .map((l) => ({
        type: 'Feature' as const,
        properties: { ...l },
        geometry: {
          type: 'Point' as const,
          coordinates: [l.lon!, l.lat!],
        },
      }));

    if (leadData.length > 0) {
      map.current.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: leadData },
      });

      map.current.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 10,
          'circle-color': getLeadColor(''),
          'circle-opacity': 0.8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });

      map.current.on('click', layerId, (e) => {
        if (e.features && e.features[0] && onLeadClick) {
          onLeadClick(e.features[0].properties as unknown as Lead);
        }
      });

      map.current.on('mouseenter', layerId, () => {
        if (map.current) map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', layerId, () => {
        if (map.current) map.current.getCanvas().style.cursor = '';
      });
    }
  }, [leads, mapLoaded, onLeadClick]);

  const getStormColor = (severity: string) => {
    switch (severity.toUpperCase()) {
      case 'EXTREME': return '#dc2626';
      case 'SEVERE': return '#ea580c';
      case 'MODERATE': return '#f59e0b';
      case 'LIGHT': return '#22c55e';
      default: return '#6366f1';
    }
  };

  const getLeadColor = (status: string) => {
    switch (status.toUpperCase()) {
      case 'NEW': return '#3b82f6';
      case 'CONTACTED': return '#8b5cf6';
      case 'QUALIFIED': return '#f59e0b';
      case 'QUOTED': return '#06b6d4';
      case 'NEGOTIATING': return '#ec4899';
      case 'WON': return '#22c55e';
      case 'LOST': return '#6b7280';
      default: return '#3b82f6';
    }
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Layer controls */}
      <div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg p-2 z-[1000]">
        <p className="text-xs font-medium text-gray-500 mb-2 px-2">Show on map</p>
        <div className="space-y-1">
          {[
            { key: 'all', label: 'All' },
            { key: 'storms', label: 'Storms' },
            { key: 'leads', label: 'Leads' },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveLayer(item.key as any)}
              className={`block w-full text-left px-3 py-1.5 rounded text-sm ${
                activeLayer === item.key
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-lg p-3 z-[1000]">
        <p className="text-xs font-medium text-gray-500 mb-2">Legend</p>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#6366f1]"></span>
            <span>Storm Event</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#3b82f6]"></span>
            <span>Lead</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#22c55e]"></span>
            <span>Property</span>
          </div>
        </div>
      </div>

      {/* Map controls info */}
      <div className="absolute bottom-4 left-4 bg-white/90 rounded-lg shadow-lg px-3 py-2 z-[1000]">
        <p className="text-xs text-gray-500">
          {leads.length} leads • {storms.length} storms
        </p>
      </div>
    </div>
  );
}
