'use client';
/**
 * useMetro — hook to fetch and cache metro metadata.
 * Persists the active metro in localStorage so the user's last-viewed market
 * is restored across sessions. Defaults to 'north-alabama' on first load.
 */
import { useEffect, useState } from 'react';
import { metrosApi, Metro, MetroDetail } from '../lib/metros';

const KEY = 'eavesight.activeMetro';
const DEFAULT = 'north-alabama';

export function useActiveMetroCode() {
  const [code, setCode] = useState<string>(DEFAULT);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(KEY);
    if (saved) setCode(saved);
  }, []);
  const update = (next: string) => {
    setCode(next);
    if (typeof window !== 'undefined') localStorage.setItem(KEY, next);
  };
  return [code, update] as const;
}

export function useMetros() {
  const [metros, setMetros] = useState<Metro[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let cancel = false;
    metrosApi.list().then(m => { if (!cancel) setMetros(m); }).catch(setError);
    return () => { cancel = true; };
  }, []);
  return { metros, error, loading: metros === null && !error };
}

export function useMetro(code: string | null) {
  const [metro, setMetro] = useState<MetroDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!code) return;
    let cancel = false;
    setMetro(null); setError(null);
    metrosApi.get(code).then(m => { if (!cancel) setMetro(m); }).catch(setError);
    return () => { cancel = true; };
  }, [code]);
  return { metro, error, loading: metro === null && !error };
}
