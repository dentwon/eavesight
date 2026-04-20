import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '@/lib/api';

export interface AlertProperty {
  id: string;
  lat: number | null;
  lon: number | null;
  address: string | null;
  city: string | null;
  zip: string | null;
}

export interface StormAlertBatch {
  alertType: 'TORNADO_WARNING' | 'SEVERE_TSTORM' | 'HAIL_CORE' | 'HIGH_WIND' | 'FLOOD';
  alertSource: 'NWS_ALERT' | 'MRMS_HAIL' | 'NEXRAD' | 'SPC_REPORT';
  severity: 'EXTREME' | 'SEVERE' | 'MODERATE';
  startedAt: string;
  expiresAt: string | null;
  stormEventId: string | null;
  properties: AlertProperty[];
  orgId?: string;
}

export interface ActiveAlert {
  id: string;
  propertyId: string;
  alertType: string;
  alertSource: string;
  severity: string;
  startedAt: string;
  expiresAt: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lon: number | null;
  isEarmarked: boolean;
  hailExposureIndex: number | null;
}

/**
 * useStormAlerts — connects to /api/alerts/stream via EventSource and
 * mirrors the current "active alerts" snapshot via /api/alerts/active.
 *
 * Returns a merged, deduped list of property alerts that should be visible
 * in the UI right now. The banner + map use this same hook.
 */
export function useStormAlerts(options: { autoConnect?: boolean } = { autoConnect: true }) {
  const [activeAlerts, setActiveAlerts] = useState<ActiveAlert[]>([]);
  const [liveBatches, setLiveBatches] = useState<StormAlertBatch[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Initial snapshot
  const refresh = useCallback(async () => {
    try {
      const res = await api.get<ActiveAlert[]>('/alerts/active');
      setActiveAlerts(res.data);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load alerts');
    }
  }, []);

  useEffect(() => {
    if (!options.autoConnect) return;
    refresh();
    // Background re-poll every 60s as a safety net in case SSE drops.
    const i = setInterval(refresh, 60_000);
    return () => clearInterval(i);
  }, [options.autoConnect, refresh]);

  // Live stream
  useEffect(() => {
    if (!options.autoConnect || typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    // EventSource does NOT support custom headers — we pass token as query arg.
    // The backend AuthGuard reads it off req.query.token as a fallback.
    const base = process.env.NEXT_PUBLIC_API_URL || '/api';
    const url = `${base}/alerts/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    let es: EventSource;
    try {
      es = new EventSource(url, { withCredentials: true });
    } catch {
      return;
    }
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('property.alert', (ev: MessageEvent) => {
      try {
        const batch: StormAlertBatch = JSON.parse(ev.data);
        setLiveBatches((prev) => [batch, ...prev].slice(0, 25));
        refresh(); // pull fresh snapshot so newly-alerted properties are known
      } catch {}
    });
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [options.autoConnect, refresh]);

  return {
    activeAlerts,
    liveBatches,
    connected,
    error,
    refresh,
    /** True if any EXTREME alerts are currently in flight. */
    hasExtreme: activeAlerts.some((a) => a.severity === 'EXTREME'),
    /** Most-recent live batch (useful for inline toast). */
    latestBatch: liveBatches[0] ?? null,
  };
}
