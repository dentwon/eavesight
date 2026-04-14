'use client';

import { useEffect, useRef } from 'react';

interface StormDot {
  lat: number;
  lng: number;
  severity?: 'low' | 'medium' | 'high';
}

interface LeafletMapProps {
  center: [number, number];
  zoom: number;
  className?: string;
  stormDots?: StormDot[];
  interactive?: boolean;
}

// Sample storm locations across the US for the landing page hero
const DEFAULT_STORM_DOTS: StormDot[] = [
  { lat: 35.2, lng: -97.4, severity: 'high' },    // Oklahoma City
  { lat: 32.7, lng: -96.8, severity: 'high' },     // Dallas
  { lat: 33.4, lng: -84.4, severity: 'medium' },   // Atlanta south
  { lat: 30.3, lng: -89.9, severity: 'high' },     // Gulfport
  { lat: 38.6, lng: -90.2, severity: 'medium' },   // St Louis
  { lat: 39.8, lng: -86.2, severity: 'medium' },   // Indianapolis
  { lat: 41.9, lng: -87.6, severity: 'low' },      // Chicago
  { lat: 29.8, lng: -95.4, severity: 'high' },     // Houston
  { lat: 36.2, lng: -86.8, severity: 'medium' },   // Nashville
  { lat: 34.7, lng: -92.3, severity: 'medium' },   // Little Rock
  { lat: 37.7, lng: -97.3, severity: 'high' },     // Wichita
  { lat: 32.3, lng: -90.2, severity: 'high' },     // Jackson MS
  { lat: 33.5, lng: -86.8, severity: 'medium' },   // Birmingham
  { lat: 35.1, lng: -90.0, severity: 'high' },     // Memphis
  { lat: 31.3, lng: -92.4, severity: 'medium' },   // Alexandria LA
  { lat: 40.8, lng: -96.7, severity: 'low' },      // Lincoln NE
  { lat: 30.5, lng: -97.7, severity: 'medium' },   // Austin
  { lat: 36.1, lng: -95.9, severity: 'high' },     // Tulsa
  { lat: 34.2, lng: -77.9, severity: 'low' },      // Wilmington NC
  { lat: 28.5, lng: -81.4, severity: 'medium' },   // Orlando
  { lat: 35.8, lng: -78.6, severity: 'low' },      // Raleigh
  { lat: 39.1, lng: -94.6, severity: 'high' },     // Kansas City
  { lat: 42.0, lng: -93.6, severity: 'low' },      // Ames IA
  { lat: 33.0, lng: -97.0, severity: 'medium' },   // Denton TX
];

export default function LeafletMap({ center, zoom, className = '', stormDots, interactive = false }: LeafletMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Inject pulse animation CSS
    if (!document.querySelector('#storm-dot-styles')) {
      const style = document.createElement('style');
      style.id = 'storm-dot-styles';
      style.textContent = `
        @keyframes stormPulse {
          0% { transform: scale(1); opacity: 0.9; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
          50% { transform: scale(1.15); opacity: 1; box-shadow: 0 0 12px 4px rgba(34, 197, 94, 0.4); }
          100% { transform: scale(1); opacity: 0.9; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
        @keyframes stormRing {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(3); opacity: 0; }
        }
        .storm-dot {
          border-radius: 50%;
          animation: stormPulse 2s ease-in-out infinite;
          position: relative;
        }
        .storm-dot::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 2px solid rgba(34, 197, 94, 0.5);
          transform: translate(-50%, -50%) scale(1);
          animation: stormRing 2.5s ease-out infinite;
        }
        .storm-dot.severity-high {
          background: radial-gradient(circle, #22c55e 0%, #16a34a 60%, rgba(22,163,74,0.3) 100%);
          animation-duration: 1.5s;
        }
        .storm-dot.severity-medium {
          background: radial-gradient(circle, #4ade80 0%, #22c55e 60%, rgba(34,197,94,0.3) 100%);
          animation-duration: 2s;
        }
        .storm-dot.severity-low {
          background: radial-gradient(circle, #86efac 0%, #4ade80 60%, rgba(74,222,128,0.3) 100%);
          animation-duration: 2.5s;
        }
      `;
      document.head.appendChild(style);
    }

    // Dynamically load Leaflet CSS
    if (!document.querySelector('link[href*="leaflet"]')) {
      const linkEl = document.createElement('link');
      linkEl.rel = 'stylesheet';
      linkEl.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(linkEl);
    }

    // Dynamically load Leaflet JS
    const loadLeaflet = () => {
      return new Promise<void>((resolve) => {
        if ((window as any).L) { resolve(); return; }
        const scriptEl = document.createElement('script');
        scriptEl.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        scriptEl.async = true;
        scriptEl.onload = () => resolve();
        document.body.appendChild(scriptEl);
      });
    };

    loadLeaflet().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;

      const L = (window as any).L;

      const map = L.map(mapRef.current, {
        center,
        zoom,
        zoomControl: interactive,
        attributionControl: false,
        dragging: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        touchZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
      });

      // Dark map tiles for landing page aesthetic
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
      }).addTo(map);

      // Add storm dots
      const dots = stormDots || DEFAULT_STORM_DOTS;
      dots.forEach((dot, i) => {
        const severity = dot.severity || 'medium';
        const sizes: Record<string, number> = { high: 14, medium: 10, low: 8 };
        const size = sizes[severity];

        const icon = L.divIcon({
          className: '',
          html: `<div class="storm-dot severity-${severity}" style="width:${size}px;height:${size}px;animation-delay:${(i * 0.15) % 2}s;"></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });

        L.marker([dot.lat, dot.lng], { icon, interactive: false }).addTo(map);
      });

      mapInstanceRef.current = map;
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [center, zoom, interactive, stormDots]);

  return <div ref={mapRef} className={className} />;
}
