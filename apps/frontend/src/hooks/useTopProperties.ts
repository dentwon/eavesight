'use client';
/**
 * useTopProperties — metro-scoped top-score list, with optional dormant filter.
 * Used by DormantLeadsList and by the map bar's "show dormant only" toggle.
 */
import { useEffect, useState } from 'react';
import { metrosApi, type PinCardPayloadFree } from '../lib/metros';

export interface TopProperty {
  propertyId: string;
  score: number | null;
  dormantFlag: boolean;
  payloadFree: PinCardPayloadFree;
}

export interface TopPropertiesOpts {
  limit?: number;
  minScore?: number;
  dormantOnly?: boolean;
}

export function useTopProperties(code: string | null, opts: TopPropertiesOpts = {}) {
  const [rows, setRows] = useState<TopProperty[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const key = `${code}|${opts.limit ?? 50}|${opts.minScore ?? ''}|${opts.dormantOnly ? 1 : 0}`;

  useEffect(() => {
    if (!code) return;
    let cancel = false;
    setRows(null);
    setError(null);
    metrosApi
      .top(code, opts)
      .then((r) => {
        if (!cancel) setRows(r as TopProperty[]);
      })
      .catch((e) => !cancel && setError(e));
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { rows, error, loading: rows === null && !error };
}
