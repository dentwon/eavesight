'use client';

import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Parcel {
  pin: string;
  propertyAddress: string;
  propertyOwner: string;
  totalAppraisedValue: number | null;
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
  onParcelClick: (p: Parcel) => void;
}

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const MADISON_CENTER: [number, number] = [-86.55, 34.76];

export default function MapView({ parcels, onBoundsChange, valueColor, onParcelClick }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const loaded = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: MADISON_CENTER,
      zoom: 11,
      attributionControl: false,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

    map.current.on('load', () => {
      loaded.current = true;

      // Add source for parcels
      map.current!.addSource('parcels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Circle layer — colored by value
      map.current!.addLayer({
        id: 'parcels-circle',
        type: 'circle',
        source: 'parcels',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            8, 3,
            12, 7,
            15, 12,
          ],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': 'rgba(255,255,255,0.3)',
        },
      });

      // Heatmap layer (shown at low zoom)
      map.current!.addLayer({
        id: 'parcels-heat',
        type: 'heatmap',
        source: 'parcels',
        layout: { visibility: 'visible' },
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 3],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(255,255,255,0)',
            0.2, 'rgba(59,130,246,0.4)',
            0.4, 'rgba(34,197,94,0.6)',
            0.6, 'rgba(234,179,8,0.7)',
            0.8, 'rgba(249,115,22,0.8)',
            1, 'rgba(225,29,72,0.9)',
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 20, 14, 40],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 13, 0],
        },
      }, 'parcels-circle');

      // Click handler
      map.current!.on('click', 'parcels-circle', (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        const props = f.properties as any;

        if (popup.current) popup.current.remove();
        popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:system-ui,sans-serif;padding:4px">
              <p style="font-weight:600;font-size:13px;margin:0 0 4px">${props.address || 'Unknown'}</p>
              <p style="color:#64748b;font-size:11px;margin:0 0 6px">PIN: ${props.pin}</p>
              <p style="font-size:12px;margin:0;color:#334155">${props.owner || '—'}</p>
              <p style="font-size:14px;font-weight:700;margin:4px 0 0;color:#16a34a">
                ${props.value ? '$' + Number(props.value).toLocaleString() : 'No value data'}
              </p>
            </div>
          `)
          .addTo(map.current!);

        // Call sidebar
        const parcel = parcels.find(p => p.pin === props.pin);
        if (parcel) onParcelClick(parcel);
      });

      map.current!.on('mouseenter', 'parcels-circle', () => {
        if (map.current) map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current!.on('mouseleave', 'parcels-circle', () => {
        if (map.current) map.current.getCanvas().style.cursor = '';
      });

      // Fires after map moves
      map.current!.on('moveend', () => {
        if (!map.current) return;
        const b = map.current.getBounds();
        onBoundsChange({
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        });
      });

      // Initial fetch
      const b = map.current!.getBounds();
      onBoundsChange({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
        loaded.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update parcels data
  useEffect(() => {
    if (!loaded.current || !map.current) return;
    const source = map.current.getSource('parcels') as maplibregl.GeoJSONSource;
    if (!source) return;

    const features: GeoJSON.Feature[] = parcels.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        pin: p.pin,
        address: p.propertyAddress,
        owner: p.propertyOwner,
        value: p.totalAppraisedValue,
        color: valueColor(p),
        weight: p.totalAppraisedValue ? Math.min(p.totalAppraisedValue / 300000, 1) : 0.2,
      },
    }));

    source.setData({ type: 'FeatureCollection', features });
  }, [parcels, valueColor]);

  return (
    <div ref={mapContainer} className="w-full h-full" />
  );
}
