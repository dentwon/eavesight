'use client';
/**
 * MetroMap — viewport-first map for /m/[metro].
 *
 * Rendering strategy (Phase 3.6a):
 *   zoom < 10.5 : H3 r6 hex choropleth (146 cells metro-wide, coarse heatmap)
 *   10.5 <= z   : H3 r8 hex choropleth (4.5k cells, neighborhood-scale)
 *   z >= 12     : PMTiles building footprints (vector), shaded via feature-state
 *                  from the viewport query results. Hexes continue to render
 *                  underneath as a faint texture up to zoom 15 (was: invisible
 *                  by zoom 12), giving spatial context while browsing buildings.
 *                  The building polygon IS the pin — no separate pin layer.
 *
 * Hex geometry built client-side from h3-js. Buildings served as static
 * PMTiles from /public. Pins streamed from the viewport endpoint. Zero
 * pre-denormalized "top 2000" cache.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import maplibregl, { Map as MLMap, LngLatBounds } from 'maplibre-gl';
import * as pmtiles from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cellToBoundary } from 'h3-js';
import { metrosApi, type HexAggregate, type ViewportFeature } from '@/lib/metros';
import { usePreferencesStore } from '@/stores/preferences';

// ---------------------------------------------------------------------------
// HUD reveal state (module-scoped on purpose)
// ---------------------------------------------------------------------------
// The parent remounts MetroMap on appTheme toggle (light/dark), and zooming
// back out re-renders r6/r8 layers inside the same mount. Neither of those
// should replay the Iron Man HUD wipe. But SPA route changes into a map
// page DO count as "selecting the map" and should replay it — so we reset
// the flag when the pathname changes (tracked in `hudLastPath`). Hard
// reload drops the whole module and we start clean.
// HUD reveal animation currently disabled — the feature-state-driven
// pop/crossfade was throwing MapLibre validator errors at runtime and taking
// the hex layers down with it. Initializing `hudRevealPlayed = true` makes
// every opacity/width/color helper short-circuit to its plain zoom-ramp form
// and makes `paint()` skip the scheduling block entirely. Grid renders reliably
// with the existing zoom-driven fade-in instead of the HUD wipe.
let hudRevealPlayed = true;
let hudRevealScheduled = true;
let hudLastPath: string | null = null;

/**
 * Call from MetroMap's mount effect. If the pathname has changed since the
 * last reveal, reset the gate so the new route's map gets the wipe. Theme
 * swaps keep the same path → no reset → the reveal stays gated.
 *
 * Also recovers from the "navigated away mid-reveal" footgun: if
 * hudRevealScheduled was left stuck at true (because cleanup happened
 * before runHudReveal finished), pathname-change reset wipes it.
 */
function maybeResetHudGate() {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (path !== hudLastPath) {
    // Reveal animation disabled — keep the gate closed so we never re-arm it
    // on SPA route changes. Both flags stay true; paint() skips scheduling.
    hudRevealPlayed = true;
    hudRevealScheduled = true;
    hudLastPath = path;
  }
}

/** Call from MetroMap's cleanup. If a reveal was scheduled but never played
 *  (e.g. user navigated during the 60ms settle), clear the scheduled flag
 *  so the next mount on the same path can still fire it. Doesn't touch
 *  hudRevealPlayed — a completed reveal stays "done" for this path. */
function recoverHudGateOnUnmount() {
  if (hudRevealScheduled && !hudRevealPlayed) {
    hudRevealScheduled = false;
  }
}

// ---------------------------------------------------------------------------
// HexClad sheen state (module-scoped)
// ---------------------------------------------------------------------------
// The hex grid reads as one continuous sheet of polished metal. A single
// virtual sun fixed at azimuth 45° (NE, world space, never rotates with the
// camera) drives a soft Gaussian highlight band that sweeps across all
// visible hexes as the user pans / rotates / pitches. At flat pitch the band
// is suppressed (clean top-down); above SHEEN_PITCH_THRESHOLD_DEG the band
// activates and feels like a real reflection catching off tilt.
//
// Per-hex centroid in lng/lat is precomputed once on source install so the
// per-frame update is just (project -> dot product -> setFeatureState).
type Centroid = { fid: string; lngLat: [number, number] };
const centroidStore: Record<Resolution, Centroid[]> = { r6: [], r8: [] };
let sheenActive = false;     // current pitch >= threshold (drives deactivation sweep)
let sheenRafPending = false; // single rAF coalesces bursts of camera events
const SHEEN_PITCH_THRESHOLD_DEG = 10;
const SUN_AZ_DEG = 45; // world-space NE. Never rotates with camera.

interface Props {
  metroCode: string;
  center?: [number, number];
  initialZoom?: number;
  /** Optional initial bearing (deg). Parent passes this to preserve camera
   *  orientation across theme-triggered remounts. */
  initialBearing?: number;
  /** Optional initial pitch (deg). Same rationale as initialBearing. */
  initialPitch?: number;
  /** Fires on every moveend / zoomend / rotateend / pitchend. Parent stashes
   *  this in a ref so the next theme-keyed remount can restore the view. */
  onViewChange?: (view: MapView) => void;
  dormantOnly?: boolean;
  onHexClick?: (cell: HexAggregate) => void;
  onPinClick?: (propertyId: string) => void;
  /** Max pins to request per viewport. Caps server-side at 500. */
  viewportLimit?: number;
  /** Debounce window (ms) for viewport refetch on move/zoom. */
  viewportDebounceMs?: number;
  /** Show the PMTiles building footprints layer (default: true). */
  showBuildings?: boolean;
}

/** Camera state the parent may want to persist across remounts. */
export interface MapView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

const LIGHT_STYLE  = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const DARK_STYLE   = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const PIN_ZOOM_THRESHOLD = 13;
// Buildings now paint from z12 so they come in before pins do — the user
// expects to see footprints as soon as it's plausible, not only at z14.
const BUILDING_ZOOM_THRESHOLD = 12;
const BUILDINGS_PMTILES_URL = 'pmtiles:///buildings-v4.pmtiles';
const BUILDINGS_SOURCE = 'metro-buildings';
const BUILDINGS_SOURCE_LAYER = 'buildings';

// Minimal palette overrides so buildings stay legible on either basemap.
// (StormMap's Dark-Matter tweaks a dozen layers; we only need the water
// and land basics to avoid visual clash with our slate polygons.)
function applyDarkBasemapTweaks(m: MLMap) {
  const s = m.getStyle();
  if (!s?.layers) return;
  for (const layer of s.layers) {
    try {
      if (layer.id === 'background') {
        m.setPaintProperty(layer.id, 'background-color', '#0f1729');
      } else if (layer.id === 'water') {
        m.setPaintProperty(layer.id, 'fill-color', '#0c1322');
      } else if (/landuse|landcover|park/.test(layer.id) && (layer as any).type === 'fill') {
        m.setPaintProperty(layer.id, 'fill-color', '#111d33');
      }
    } catch { /* some layers don't support the paint prop — fine */ }
  }
}

// Light-mode basemap warmth. Carto Positron ships nearly-white road
// fills — on a light basemap the road network basically disappears into
// the background cream. Override every `road_*` / `bridge_*` / `tunnel_*`
// / `highway_*` line layer's line-color with a warm stone gray, and a
// slightly darker tone for the casing layers so the road hierarchy still
// reads. Keeps light mode saturated and grounded without going to full
// dark mode. Only runs when the user is in light mode; dark mode uses
// applyDarkBasemapTweaks.
function applyLightBasemapTweaks(m: MLMap) {
  const s = m.getStyle();
  if (!s?.layers) return;
  // stone-500 for road fills — warm enough to feel tactile, dark enough
  // to carry weight against the Positron cream. Casing darker so the
  // hierarchy of motorway > primary > secondary still feels layered.
  const roadFill   = '#a8a29e';  // stone-400, mid-range body fill
  const roadCase   = '#57534e';  // stone-600, darker edge
  const motorwayFill = '#78716c'; // stone-500, heavier body for motorways
  const motorwayCase = '#44403c'; // stone-700, heavier edge
  const roadPattern     = /^(road|bridge|tunnel|street|transit)/i;
  const motorwayPattern = /motorway|highway|trunk/i;
  const casingPattern   = /(casing|hairline|outline|shield|_case|_outline)/i;
  for (const layer of s.layers) {
    try {
      const id = (layer.id || '');
      const lid = id.toLowerCase();
      if ((layer as any).type !== 'line') continue;
      if (!roadPattern.test(lid)) continue;
      const isMotorway = motorwayPattern.test(lid);
      const isCasing   = casingPattern.test(lid);
      let color: string;
      if (isMotorway) color = isCasing ? motorwayCase : motorwayFill;
      else            color = isCasing ? roadCase     : roadFill;
      m.setPaintProperty(id, 'line-color', color);
    } catch { /* some layers don't expose line-color — fine, skip */ }
  }
}

// Carto Positron and Dark-Matter both ship their own 'building' and
// 'building-top' layers that fade in around z14+. They almost — but not quite —
// align with our PMTiles footprints, which reads visually as a double outline.
// Hide them so only our layer paints.
function hideBasemapBuildings(m: MLMap) {
  for (const id of ['building', 'building-top']) {
    try {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none');
    } catch { /* not all Carto styles have both — ignore */ }
  }
}

// Returns the id of the first road/boundary/label layer in the current
// basemap. Used as `beforeId` when inserting the hex choropleth so the
// hexes render like plates on a table — above basemap fills (water,
// landuse, parks) but BENEATH streets, political boundaries, and place
// labels. Matches both Carto Positron ('road_*', 'boundary_*', '*-label')
// and Dark-Matter naming, plus falls through to the first symbol (label)
// layer when no road layer is present.
function firstRoadOrLabelLayerId(map: MLMap): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  const roadPattern = /^(road|bridge|tunnel|highway|motorway|street|transit|boundary|admin)/i;
  for (const l of layers) {
    const id = (l.id || '').toLowerCase();
    const t = (l as any).type;
    // First explicit line layer for a street/boundary — put hexes before it.
    if (t === 'line' && roadPattern.test(id)) return l.id;
    // Fallback: the first symbol (label). In rare styles there are no line
    // road layers (e.g. a label-only basemap) so symbols cap the search.
    if (t === 'symbol') return l.id;
  }
  return undefined;
}

// Returns the id of the first symbol (label) layer in the current basemap
// style. Used as `beforeId` when inserting our building layers so labels
// render on top of the 3D geometry instead of disappearing underneath.
function firstSymbolLayerId(map: MLMap): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  for (const l of layers) {
    if ((l as any).type === 'symbol') return l.id;
  }
  return undefined;
}

// Register the pmtiles protocol exactly once for the whole app.
let pmtilesProtocolRegistered = false;
function ensurePMTilesProtocol() {
  if (!pmtilesProtocolRegistered) {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    pmtilesProtocolRegistered = true;
  }
}

export function MetroMap({
  metroCode,
  center,
  initialZoom = 9,
  initialBearing = 0,
  // Default: flat top-down, true north up. Tilt + rotation are opt-in — they
  // read as "map inspection tools" to the user, not a default perspective.
  // The HexClad sheen stays suppressed below 10° pitch (see applySheen), so
  // the flat load is intentionally a clean baseline state.
  initialPitch = 0,
  onViewChange,
  dormantOnly = false,
  onHexClick,
  onPinClick,
  viewportLimit = 100000,
  viewportDebounceMs = 250,
  showBuildings = true,
}: Props) {
  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<number>(initialZoom);
  const [hexesR6, setHexesR6] = useState<HexAggregate[] | null>(null);
  const [hexesR8, setHexesR8] = useState<HexAggregate[] | null>(null);
  const [pins, setPins] = useState<ViewportFeature[]>([]);
  // Honor the app's dark/light preference the same way StormMap does, so the
  // metro map doesn't look out-of-place when the rest of the UI is dark.
  const appTheme = usePreferencesStore((s) => s.appTheme);
  const isDark = appTheme === 'dark';

  // Lead-score coloring master toggle + per-bucket filters drive the building
  // fill-color expression. Changes re-run the re-paint effect; feature-state
  // stays intact either way so toggling is instant.
  const [scoresVisible, setScoresVisible] = useState<boolean>(true);
  const [bucketFilters, setBucketFilters] = useState<BucketFilters>(DEFAULT_BUCKETS);
  const toggleBucket = useCallback((key: BucketKey) => {
    setBucketFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Phase 3.6b — which metric drives the hex fill color.
  //   score    : scoreP90    (default — hot-lead density heatmap)
  //   dormant  : dormantCount (homeowners we think have old damage, no claim filed)
  //   roof_age : avgRoofAge  (aging-roof concentration)
  //   hail     : hailMaxInches (peak hail exposure)
  //   density  : n           (property density, sanity-check layer)
  // Independent of dormantOnly (which filters which hexes are drawn).
  const [hexMetric, setHexMetric] = useState<HexMetric>('score');

  // Hex focus — unified source of truth for the corner/bottom-bar panel.
  // Updated on hex click (both desktop + touch) and on hex mousemove when
  // the device actually supports hover. `isStale` flips true when the cursor
  // leaves the hex layer on desktop so the panel can dim without flicker.
  // On mobile the state only changes on tap, so isStale stays false until
  // the user taps elsewhere.
  const [hexFocus, setHexFocus] = useState<HexFocusState | null>(null);

  // Track current feature-state per property so we can diff on viewport
  // refresh — untouched buildings stay untouched (no re-paint flicker),
  // only changed buildings trigger the paint transition.
  const buildingStateIdsRef = useRef<Map<string, { score: number; dormant: boolean }>>(new Map());

  // Timers for the radial bloom stagger (see pins-apply effect). Cancelled
  // when a new viewport fetch comes in mid-animation so we don't end up with
  // two overlapping waves landing out of sync.
  const staggerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Which building the cursor is over / which the user has clicked. These
  // back per-feature 'hover' and 'selected' state on the buildings source,
  // which the paint expressions in installBuildings read to drive the
  // raise-on-hover and highlight-on-click polish.
  const hoveredIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  // Bucket-by-bucket pin counts for the legend. Dormant is counted as its own
  // bucket only (a dormant pin with score>=80 still shows amber in the legend,
  // not red, because the fill expression treats dormant as the winner).
  const bucketCounts = useMemo<Record<BucketKey, number>>(() => {
    const c: Record<BucketKey, number> = { dormant: 0, blazing: 0, hot: 0, warm: 0, low: 0 };
    for (const p of pins) {
      if (p.dormantFlag) { c.dormant += 1; continue; }
      const s = p.score ?? -1;
      // Scores 0-30 aren't counted into a bucket — they don't render in the
      // overlay, so the legend shouldn't advertise them either.
      if (s >= 85)      c.blazing += 1;
      else if (s >= 70) c.hot += 1;
      else if (s >= 50) c.warm += 1;
      else if (s >= 31) c.low += 1;
    }
    return c;
  }, [pins]);

  // Cancellation / debouncing for viewport fetch
  const viewportAbortRef = useRef<AbortController | null>(null);
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // r6 cells average 1,664 properties (metro-wide gradient only). Switch to r8
  // earlier (10.5 instead of 11) so neighborhood-scale cells appear as soon as
  // the user starts moving — the 146→4,514 jump is what previously made the
  // hex view feel "coarse then invisible" in the transition window.
  const activeRes: 6 | 8 = zoom < 10.5 ? 6 : 8;

  const fetchViewport = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getZoom() < PIN_ZOOM_THRESHOLD) {
      setPins((prev) => (prev.length ? [] : prev));
      return;
    }
    viewportAbortRef.current?.abort();
    const ctrl = new AbortController();
    viewportAbortRef.current = ctrl;

    const b: LngLatBounds = map.getBounds();
    const bbox = {
      lonMin: b.getWest(),
      latMin: b.getSouth(),
      lonMax: b.getEast(),
      latMax: b.getNorth(),
    };

    metrosApi
      .viewport(metroCode, bbox, { limit: viewportLimit, dormantOnly }, ctrl.signal)
      .then((r) => {
        if (ctrl.signal.aborted) return;
        setPins(r.features);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('aborted') || msg.includes('canceled')) return;
        console.warn('[MetroMap] viewport fetch failed:', err);
      });
  }, [metroCode, dormantOnly, viewportLimit]);

  const debouncedFetchViewport = useCallback(() => {
    if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    viewportTimerRef.current = setTimeout(fetchViewport, viewportDebounceMs);
  }, [fetchViewport, viewportDebounceMs]);

  // Metro detail -> initial center
  useEffect(() => {
    ensurePMTilesProtocol();
    // Reset the HUD reveal gate if the pathname changed since the last time
    // it played. Theme swaps leave pathname intact (gate stays set), route
    // changes reset it (reveal replays on the new map).
    maybeResetHudGate();
    let cancel = false;
    metrosApi.get(metroCode).then((m) => {
      if (cancel || !containerRef.current) return;
      const c: [number, number] = center ?? [m.centerLon, m.centerLat];
      if (mapRef.current) return;
      mapRef.current = new maplibregl.Map({
        container: containerRef.current,
        style: isDark ? DARK_STYLE : LIGHT_STYLE,
        center: c,
        zoom: initialZoom,
        // Default: modest tilt (pitch only, no bearing) so 3D buildings read as
        // 3D immediately while north still points straight up and place labels
        // render horizontally. If the parent is restoring camera state after a
        // theme remount, it passes the real pitch/bearing instead.
        // Parent may pass a persisted pitch/bearing across theme-triggered
        // remounts. On a fresh mount (no parent state) both are 0 by default,
        // so the map opens true-north-up, no tilt — a clean baseline.
        pitch: initialPitch,
        bearing: initialBearing,
        attributionControl: false,
        maxBounds: [
          [m.bboxMinLon - 0.5, m.bboxMinLat - 0.5],
          [m.bboxMaxLon + 0.5, m.bboxMaxLat + 0.5],
        ],
      });
      // Centralized view emitter — fires on every camera idle event. Parent
      // stashes the result in a useRef that survives the theme remount.
      const emitView = () => {
        if (!mapRef.current || !onViewChange) return;
        const c = mapRef.current.getCenter();
        onViewChange({
          center: [c.lng, c.lat],
          zoom: mapRef.current.getZoom(),
          bearing: mapRef.current.getBearing(),
          pitch: mapRef.current.getPitch(),
        });
      };
      mapRef.current.on('zoomend', () => {
        if (!mapRef.current) return;
        setZoom(mapRef.current.getZoom());
        debouncedFetchViewport();
        emitView();
      });
      mapRef.current.on('moveend', () => {
        debouncedFetchViewport();
        emitView();
      });
      mapRef.current.on('rotateend', emitView);
      mapRef.current.on('pitchend', emitView);
      mapRef.current.on('load', () => {
        if (isDark && mapRef.current) applyDarkBasemapTweaks(mapRef.current);
        if (!isDark && mapRef.current) applyLightBasemapTweaks(mapRef.current);
        if (mapRef.current) hideBasemapBuildings(mapRef.current);
        if (mapRef.current) applyAtmosphere(mapRef.current, isDark);
        if (mapRef.current) boostPlaceLabels(mapRef.current);
        if (mapRef.current) installBuildings(mapRef.current, onPinClick);
        if (mapRef.current) installBuildingInteractions(mapRef.current, selectedIdRef, hoveredIdRef);
        debouncedFetchViewport();
      });
    });
    return () => {
      cancel = true;
      // If a HUD reveal was scheduled but never ran (user navigated away
      // during the 60ms settle or mid-sweep), clear the scheduled flag so
      // the next mount isn't stuck with invisible hexes.
      recoverHudGateOnUnmount();
      viewportAbortRef.current?.abort();
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
      staggerTimersRef.current.forEach((t) => clearTimeout(t));
      staggerTimersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metroCode]);

  // Re-fetch on dormantOnly flip
  useEffect(() => {
    debouncedFetchViewport();
  }, [dormantOnly, debouncedFetchViewport]);

  // NOTE: theme swaps are handled by remounting the whole component — the
  // parent pages key <MetroMap> on `appTheme` so React unmounts the old
  // instance (cleanup tears down the map + aborts in-flight fetches) and
  // mounts a fresh one with the correct style. We used to do an in-place
  // `map.setStyle` + `installBuildings` re-install here, but that path was
  // racy: `setStyle` wipes every custom source/layer synchronously, and a
  // `styledata` 'once' listener could fire before the new style's symbol
  // layers settled, leaving us with a flat basemap and no buildings until a
  // manual page reload. A full remount is cheap (hex JSON + PMTiles header
  // are browser-cached) and deterministic.

  // Load hexes (unchanged)
  // Fetch r6 first — it's ~146 cells (coarse metro-wide heatmap) and paints
  // the canvas instantly. r8 (~4500 cells, neighborhood-scale) is kicked off
  // right after; if the user lands at zoom >= 10.5 they see r6 as a
  // placeholder and the view sharpens to r8 as soon as it arrives.
  useEffect(() => {
    let cancelled = false;
    metrosApi.hexes(metroCode, 6).then((r) => { if (!cancelled) setHexesR6(r.features); });
    // Start r8 on next microtask so r6 gets its HTTP slot first on the
    // connection queue. Both are served over the same HTTP/1.1 keep-alive
    // connection in most browsers; tiny stagger means r6 reliably wins the
    // race and paints the moment it lands.
    Promise.resolve().then(() => {
      metrosApi.hexes(metroCode, 8).then((r) => { if (!cancelled) setHexesR8(r.features); });
    });
    return () => { cancelled = true; };
  }, [metroCode]);

  // Two resolutions render simultaneously near the crossover zoom so the
  // tessellation cross-fades instead of popping. r6 fades out and r8 fades
  // in across z≈9.9→10.8; r8 outlines ghost in slightly earlier (from z≈9.6)
  // so you see the finer grid "etch" over the coarser plates before its fill
  // takes over. Both datasets are already fetched on mount — this is purely
  // a rendering change.
  const hexGeoJsonR6 = useMemo(() => buildHexGeoJson(hexesR6, dormantOnly), [hexesR6, dormantOnly]);
  const hexGeoJsonR8 = useMemo(() => buildHexGeoJson(hexesR8, dormantOnly), [hexesR8, dormantOnly]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!hexGeoJsonR6 && !hexGeoJsonR8) return;
    // Idempotent: updates whichever source/layer stacks have data, leaves the
    // rest alone. Fires again each time a new dataset lands or dormantOnly/
    // metric flip.
    const run = () =>
      paint(map, hexGeoJsonR6, hexGeoJsonR8, dormantOnly, hexMetric, isDark, onHexClick, setHexFocus);
    if (map.loaded()) run();
    else map.once('load', run);
    // NOTE: isDark isn't a dep — the whole component remounts on theme
    // change (parent key={appTheme}), so this effect re-runs fresh with
    // the correct `isDark` value as part of the remount.
  }, [hexGeoJsonR6, hexGeoJsonR8, dormantOnly, hexMetric, onHexClick]);

  // Building footprints layer — PMTiles, static file, added once.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const install = () => installBuildings(map, onPinClick);
    if (map.loaded()) install();
    else map.once('load', install);
  }, [onPinClick]);

  // Re-paint building colors when theme flips or score filter state changes.
  // Feature-state is untouched — toggling the master switch or any bucket
  // just rebuilds the fill-color expression and hands it to setPaintProperty,
  // so the response is instant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      // Base layer — neutral color only depends on theme; opacity is uniform.
      if (map.getLayer('metro-building-fill')) {
        map.setPaintProperty(
          'metro-building-fill', 'fill-color',
          withBloomAlpha(buildBaseFillColor(isDark)),
        );
        map.setPaintProperty(
          'metro-building-fill', 'fill-opacity',
          buildBaseFillOpacity(isDark),
        );
      }
      // Overlay layer — bucket-tinted extrusion. From top-down reads as a flat
      // wash; tilting the camera reveals 3D volume proportional to score.
      if (map.getLayer('metro-building-score-overlay')) {
        map.setPaintProperty(
          'metro-building-score-overlay', 'fill-extrusion-color',
          buildOverlayExtrusionColor(isDark, scoresVisible, bucketFilters),
        );
        map.setPaintProperty(
          'metro-building-score-overlay', 'fill-extrusion-height',
          buildOverlayExtrusionHeight(scoresVisible, bucketFilters),
        );
        map.setPaintProperty(
          'metro-building-score-overlay', 'fill-extrusion-opacity',
          buildOverlayExtrusionOpacity(scoresVisible),
        );
      }
      if (map.getLayer('metro-building-outline')) {
        map.setPaintProperty(
          'metro-building-outline', 'line-color',
          buildOutlineColor(isDark, scoresVisible, bucketFilters),
        );
        map.setPaintProperty(
          'metro-building-outline', 'line-opacity',
          buildOutlineOpacity(scoresVisible, bucketFilters),
        );
      }
    };
    if (map.loaded()) apply();
    else map.once('load', apply);
  }, [isDark, scoresVisible, bucketFilters]);

  // Paint building footprints via feature-state from viewport pins.
  // When `pins` refreshes, clear last round's state and apply new scores.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // How long the whole radial bloom takes, from center pin to outermost.
    // Paint transitions run 700ms on top of this, so end-to-end ~1.4s.
    const BLOOM_MS = 700;

    const apply = () => {
      if (!map.getSource(BUILDINGS_SOURCE)) return;
      const prev = buildingStateIdsRef.current;

      // Cancel any still-pending stagger timers — a new viewport batch
      // supersedes whatever was mid-animation.
      staggerTimersRef.current.forEach((t) => clearTimeout(t));
      staggerTimersRef.current = [];

      // Snapshot the current map center; every new pin is scheduled based
      // on its distance from here, so the bloom emanates from the middle
      // of the viewport outward.
      const c = map.getCenter();
      const centerLon = c.lng;
      const centerLat = c.lat;

      // Diff: split into NEW (no prior state -> needs bloom fade-in) and
      // CHANGED (has prior state but score/dormant shifted -> plain update,
      // paint transition covers the color change on its own).
      const seen = new Set<string>();
      const newOnes: Array<{ p: typeof pins[number]; dist2: number }> = [];
      for (const p of pins) {
        seen.add(p.id);
        const score = p.score ?? -1;
        const dormant = !!p.dormantFlag;
        const prior = prev.get(p.id);
        if (!prior) {
          const dlon = p.lon - centerLon;
          const dlat = p.lat - centerLat;
          newOnes.push({ p, dist2: dlon * dlon + dlat * dlat });
        } else if (prior.score !== score || prior.dormant !== dormant) {
          // Existing building, changed score — just update. bloom=1 persists,
          // paint transition interpolates the color shift over 1100ms.
          map.setFeatureState(
            { source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id: p.id },
            { score, dormant },
          );
          prev.set(p.id, { score, dormant });
        }
      }

      if (newOnes.length > 0) {
        // Normalize distances to [0,1] so the wave always spans the full
        // BLOOM_MS window regardless of viewport size.
        let maxDist2 = 0;
        for (const cc of newOnes) if (cc.dist2 > maxDist2) maxDist2 = cc.dist2;
        const maxDist = Math.sqrt(maxDist2) || 1;

        for (const { p, dist2 } of newOnes) {
          const norm = Math.sqrt(dist2) / maxDist;
          const delay = Math.round(norm * BLOOM_MS);
          const score = p.score ?? -1;
          const dormant = !!p.dormantFlag;
          const timer = setTimeout(() => {
            const m = mapRef.current;
            if (!m) return;
            // Frame 0: commit transparent at final color, so the paint
            // transition has a concrete "0" to interpolate from.
            m.setFeatureState(
              { source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id: p.id },
              { score, dormant, bloom: 0 },
            );
            // Frame 1+: after MapLibre has rendered the transparent state,
            // flip to bloom=1. The paint-property transition (1100ms on
            // fill-extrusion-color / line-opacity / fill-color) now
            // interpolates alpha 0 -> 1 per feature.
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (!mapRef.current) return;
                mapRef.current.setFeatureState(
                  { source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id: p.id },
                  { bloom: 1 },
                );
              });
            });
            prev.set(p.id, { score, dormant });
          }, delay);
          staggerTimersRef.current.push(timer);
        }
      }

      // Evict buildings no longer in viewport — immediate, no stagger.
      const toEvict: string[] = [];
      prev.forEach((_, id) => { if (!seen.has(id)) toEvict.push(id); });
      for (const id of toEvict) {
        map.removeFeatureState(
          { source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id },
          'score',
        );
        map.removeFeatureState(
          { source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id },
          'dormant',
        );
        prev.delete(id);
      }
    };
    if (map.loaded()) apply();
    else map.once('load', apply);
  }, [pins]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <ZoomBadge zoom={zoom} activeRes={activeRes} pinCount={pins.length} />
      <HexMetricSelector
        value={hexMetric}
        onChange={setHexMetric}
        disabled={dormantOnly}
        visible={zoom < 13}
      />
      <HexFocusPanel
        focus={hexFocus}
        activeRes={activeRes}
        onDismiss={() => setHexFocus(null)}
      />
      <LeadScoreLegend
        scoresOn={scoresVisible}
        onToggleScores={() => setScoresVisible((v) => !v)}
        filters={bucketFilters}
        onToggleBucket={toggleBucket}
        counts={bucketCounts}
        totalCount={pins.length}
      />
    </div>
  );
}

// Sky, horizon fog, and a single directional light. Called after 'load' and
// again after setStyle (which wipes style-level config). Theme-aware so the
// atmosphere matches the basemap palette instead of fighting it.
// Bump the basemap's place labels (city/town/neighborhood/suburb) so they
// read clearly over our 3D buildings. Wraps whatever existing text-size
// expression the style ships with in ['*', expr, LABEL_SCALE] so zoom-based
// interpolations still work -- we just multiply every stop by the same
// factor. Halo gets widened too so the larger glyphs don't smudge into
// building roofs.
const LABEL_SCALE = 1.4;

/**
 * Scale a text-size value (number, interpolate expression, or legacy
 * style-function) by a constant multiplier, preserving MapLibre's rule that
 * `["zoom"]` must be the direct input of the outermost interpolate/step.
 * Returns null if the input is a shape we don't know how to scale (unknown
 * expression op, `case`, `step` with non-numeric outputs, etc.) — callers
 * should treat null as "leave the layer alone rather than risk producing
 * an invalid expression".
 */
function scaleTextSize(size: any, scale: number): any | null {
  if (size == null) return 14 * scale;
  if (typeof size === 'number') return size * scale;

  // Legacy style-function: { base?: number, stops: [[zoom, value], ...] }.
  // CartoCDN positron / dark-matter styles still ship this form.
  if (!Array.isArray(size) && typeof size === 'object' && Array.isArray(size.stops)) {
    const base = typeof size.base === 'number' ? size.base : 1;
    const interpType: any = base !== 1 ? ['exponential', base] : ['linear'];
    const out: any[] = ['interpolate', interpType, ['zoom']];
    for (const pair of size.stops as Array<[number, any]>) {
      const [z, v] = pair;
      if (typeof v !== 'number') return null; // complex stop output — skip
      out.push(z, v * scale);
    }
    return out;
  }

  // Modern interpolate expression:
  //   ["interpolate", <type>, <input>, z1, v1, z2, v2, ...]
  // We only scale the numeric output values and keep everything else
  // byte-identical, so `["zoom"]` stays at position 2 (the input).
  if (Array.isArray(size) && (size[0] === 'interpolate' || size[0] === 'interpolate-hcl' || size[0] === 'interpolate-lab')) {
    const out: any[] = [size[0], size[1], size[2]];
    for (let i = 3; i < size.length; i += 2) {
      const z = size[i];
      const v = size[i + 1];
      if (typeof v !== 'number') return null; // data-driven stop — too risky
      out.push(z, v * scale);
    }
    return out;
  }

  // Anything else (step, let, case, custom expression) — decline politely.
  return null;
}

function boostPlaceLabels(map: MLMap): void {
  const style = map.getStyle();
  const layers = style?.layers ?? [];
  for (const l of layers) {
    if ((l as any).type !== 'symbol') continue;
    const id = l.id.toLowerCase();
    const srcLayer = String(((l as any)['source-layer'] ?? '')).toLowerCase();
    const isPlace =
      srcLayer === 'place' ||
      srcLayer.startsWith('place') ||
      id.includes('place') ||
      id.includes('city') ||
      id.includes('neighbourhood') ||
      id.includes('neighborhood') ||
      id.includes('suburb') ||
      id.includes('town') ||
      id.includes('locality');
    if (!isPlace) continue;

    // text-size may be:
    //   - absent (null/undefined) → use a reasonable default
    //   - a literal number        → multiply directly
    //   - a modern interpolate expression array → multiply each stop VALUE
    //     in place, keeping `interpolate` as the top-level expression
    //   - a legacy style-function object { base?, stops: [[z, v], ...] } →
    //     build a fresh `interpolate` with pre-multiplied stop values
    //
    // We can't use `['*', expr, LABEL_SCALE]` to wrap an existing zoom
    // interpolate: MapLibre requires `["zoom"]` to sit as the INPUT of the
    // top-level interpolate/step. Wrapping in `*` demotes it from the top
    // and the validator rejects the whole expression with "zoom expression
    // may only be used as input to a top-level step or interpolate".
    try {
      const size = map.getLayoutProperty(l.id, 'text-size');
      const boosted = scaleTextSize(size, LABEL_SCALE);
      if (boosted !== null) map.setLayoutProperty(l.id, 'text-size', boosted);
    } catch {
      // A few styles don't expose text-size on all symbol layers; skip.
    }
    // Thicker halo keeps labels legible when they overlap building tops.
    try { map.setPaintProperty(l.id, 'text-halo-width', 1.8); } catch {}
    try { map.setPaintProperty(l.id, 'text-halo-blur', 0.5); } catch {}
  }
}

function applyAtmosphere(map: MLMap, isDark: boolean) {
  try {
    // @ts-ignore MapLibre 4 typings don't all reach this on every release
    if (typeof map.setSky === 'function') {
      // @ts-ignore
      map.setSky(
        isDark
          ? {
              'sky-color': '#0b1220',
              'sky-horizon-blend': 0.55,
              'horizon-color': '#1e293b',
              'horizon-fog-blend': 0.5,
              'fog-color': '#0b1220',
              'fog-ground-blend': 0.2,
            }
          : {
              'sky-color': '#e2e8f0',
              'sky-horizon-blend': 0.5,
              'horizon-color': '#cbd5e1',
              'horizon-fog-blend': 0.5,
              'fog-color': '#f1f5f9',
              'fog-ground-blend': 0.2,
            },
      );
    }
  } catch { /* older style schema — skip */ }
  try {
    // Light from NW, low angle — east faces catch light, west faces fall
    // to shadow. Intensity kept modest so the base palette doesn't get
    // washed out.
    map.setLight({
      anchor: 'viewport',
      position: [1.5, 210, 30],
      color: isDark ? '#dbeafe' : '#ffffff',
      intensity: isDark ? 0.25 : 0.4,
    });
  } catch { /* not all style specs support setLight — skip */ }
}

// Hover and selection feedback on the two building layers. Idempotent —
// subsequent calls (after theme flip / setStyle) just re-register handlers
// on the fresh layer IDs.
function installBuildingInteractions(
  map: MLMap,
  selectedIdRef: { current: string | null },
  hoveredIdRef: { current: string | null },
) {
  const BUILDING_LAYERS = ['metro-building-fill', 'metro-building-score-overlay'];

  const clearHover = () => {
    const id = hoveredIdRef.current;
    if (id != null) {
      try {
        map.setFeatureState(
          { source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id },
          { hover: false },
        );
      } catch { /* feature may have left viewport */ }
    }
    hoveredIdRef.current = null;
  };
  const setHover = (id: string) => {
    if (hoveredIdRef.current === id) return;
    clearHover();
    hoveredIdRef.current = id;
    map.setFeatureState(
      { source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id },
      { hover: true },
    );
  };
  const clearSelection = () => {
    const id = selectedIdRef.current;
    if (id != null) {
      try {
        map.setFeatureState(
          { source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id },
          { selected: false },
        );
      } catch { /* ignore */ }
    }
    selectedIdRef.current = null;
  };
  const setSelection = (id: string) => {
    if (selectedIdRef.current === id) return;
    clearSelection();
    selectedIdRef.current = id;
    map.setFeatureState(
      { source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id },
      { selected: true },
    );
  };

  for (const layerId of BUILDING_LAYERS) {
    map.on('mousemove', layerId, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const pid =
        (f as any).id ?? (f.properties as any)?.propertyId ?? (f.properties as any)?.id;
      if (pid) setHover(String(pid));
    });
    map.on('mouseleave', layerId, () => { clearHover(); });
    // Click is also handled by the pin-click installer (below) for onPinClick
    // routing; here we only own the 'selected' state.
    map.on('click', layerId, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const pid =
        (f as any).id ?? (f.properties as any)?.propertyId ?? (f.properties as any)?.id;
      if (pid) setSelection(String(pid));
    });
  }
}

// Phase 3.6b: fill color is driven by a chosen metric instead of a single
// scoreP90 ramp. dormantOnly (parent prop) still overrides everything to
// keep the amber-dormant mode recognizable as its own view.
//
// Theme-aware ramps: the original light ramps used pastel `#e5e7eb` /
// `#f1f5f9` for the low end, which looked fine on Carto Positron's cream
// background but glowed far too brightly on Dark-Matter's navy. Dark-mode
// ramps drop the low end to deep slates that blend into the basemap, so
// hot cells read as the only things emitting "light" — closer to the heat
// map the eye expects from a surveillance/ops display.
//
// Hot colors (signal) stay saturated in both modes because red/orange
// carry the same "danger/activity" meaning regardless of surface.
function hexFillColorExpr(dormantOnly: boolean, metric: HexMetric, isDark: boolean): any {
  if (dormantOnly) {
    // Dormant-only override. Light ramp stepped another shade deeper so
    // low-count cells read with real weight on the cream basemap.
    return isDark
      ? ['interpolate', ['linear'], ['get', 'dormantCount'],
          0, '#451a03', 5, '#b45309', 20, '#f59e0b']
      : ['interpolate', ['linear'], ['get', 'dormantCount'],
          0, '#fbbf24', 5, '#b45309', 20, '#78350f'];
  }
  switch (metric) {
    case 'dormant':
      // Light ramp: slate-400 floor, amber-400 low, amber-700 mid, amber-900
      // hot. Two Tailwind shades deeper than the original pastel scheme so
      // the grid feels saturated against the light basemap.
      return isDark
        ? ['interpolate', ['linear'], ['coalesce', ['get', 'dormantCount'], 0],
            0, '#0f172a', 2, '#78350f', 8, '#d97706', 20, '#fbbf24']
        : ['interpolate', ['linear'], ['coalesce', ['get', 'dormantCount'], 0],
            0, '#94a3b8', 2, '#fbbf24', 8, '#b45309', 20, '#78350f'];

    case 'roof_age':
      // avgRoofAge 0-22 (cap tracks mod-22 inference). Mid-teens = prime
      // replacement window; older = redder. Light ramp two shades deeper —
      // null → slate-400, blue-100 → blue-300, amber/red stops bumped so
      // the new-roof to old-roof gradient carries visible contrast.
      return isDark
        ? ['case',
            ['==', ['get', 'avgRoofAge'], null], '#1e293b',
            ['interpolate', ['linear'], ['get', 'avgRoofAge'],
              0, '#1e3a8a', 8, '#78350f', 14, '#d97706', 20, '#991b1b']]
        : ['case',
            ['==', ['get', 'avgRoofAge'], null], '#94a3b8',
            ['interpolate', ['linear'], ['get', 'avgRoofAge'],
              0, '#93c5fd', 8, '#fcd34d', 14, '#d97706', 20, '#7f1d1d']];

    case 'hail':
      // Hail stones: 0.75 = severe threshold, 1.5 = major, 2.5 = catastrophic.
      // Light ramp: null/no-stone → slate-400, severe → amber-400, major →
      // orange-700. Catastrophic stays red-900 (can't go further).
      return isDark
        ? ['case',
            ['==', ['get', 'hailMaxInches'], null], '#1e293b',
            ['interpolate', ['linear'], ['get', 'hailMaxInches'],
              0,    '#0f172a',
              0.75, '#78350f',
              1.5,  '#ea580c',
              2.5,  '#7f1d1d']]
        : ['case',
            ['==', ['get', 'hailMaxInches'], null], '#94a3b8',
            ['interpolate', ['linear'], ['get', 'hailMaxInches'],
              0,    '#94a3b8',
              0.75, '#fbbf24',
              1.5,  '#c2410c',
              2.5,  '#7f1d1d']];

    case 'density':
      // Property density. Light ramp: slate-400 low-end, indigo-400 mid-low,
      // indigo-700 mid-high. Deep indigo hot end untouched.
      return isDark
        ? ['interpolate', ['linear'], ['get', 'n'],
            0, '#0f172a', 25, '#312e81', 100, '#4338ca', 400, '#6366f1', 1500, '#a5b4fc']
        : ['interpolate', ['linear'], ['get', 'n'],
            0, '#94a3b8', 25, '#818cf8', 100, '#4338ca', 400, '#312e81', 1500, '#1e1b4b'];

    case 'score':
    default:
      // Light ramp two shades darker: slate-400 cold, amber-400 low, orange-600
      // mid, red-700 hot. Grounded enough that zero-score hexes still read as
      // "occupied but unscored" against the cream basemap.
      return isDark
        ? ['interpolate', ['linear'], ['coalesce', ['get', 'p90'], 0],
            0, '#1e293b', 40, '#78350f', 70, '#c2410c', 90, '#dc2626']
        : ['interpolate', ['linear'], ['coalesce', ['get', 'p90'], 0],
            0, '#94a3b8', 40, '#fbbf24', 70, '#ea580c', 90, '#b91c1c'];
  }
}

// Feature-collection builder shared between the r6 and r8 memos. Keeps the
// property shape consistent for tooltips + click handlers regardless of
// which resolution a hex came from.
function buildHexGeoJson(
  hexes: HexAggregate[] | null,
  dormantOnly: boolean,
): any | null {
  if (!hexes) return null;
  return {
    type: 'FeatureCollection' as const,
    features: hexes
      .filter((h) => (dormantOnly ? h.dormantCount > 0 : true))
      .map((h) => ({
        type: 'Feature' as const,
        properties: {
          h3Cell: h.h3Cell,
          n: h.n,
          p50: h.scoreP50,
          p90: h.scoreP90,
          scoreMax: h.scoreMax,
          dormantCount: h.dormantCount,
          hailMaxInches: h.hailMaxInches,
          avgRoofAge: h.avgRoofAge,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [cellToBoundary(h.h3Cell, true)],
        },
      })),
  };
}

// MapLibre's expression spec requires camera expressions (zoom / pitch) to
// appear at the *top level* of an interpolate/step — they can't be multiplied
// together inside `*`. So cross-fade envelopes are baked directly into each
// property's single top-level zoom ramp, per resolution × per theme. Pitch
// amplification for shimmer is applied at runtime via a pitch event handler
// that rewrites the shimmer paint properties (see installShimmerPitchAmp).
//
// Ramp tables below follow (res, theme, property) → [zoom, value, ...]. r6
// ramps fade to zero by z≈10.6–10.8; r8 ramps start at zero below the
// crossover and rise through it. r8 outline/shimmer lead r8 fill slightly,
// so the finer tessellation etches in *before* its color wash — reads like
// refining a lens rather than swapping slides.
type Resolution = 'r6' | 'r8';
type ThemeKey = 'dark' | 'light';

type NumberStops = readonly (number)[];
type Ramp = {
  fillOpacity: NumberStops;
  shimmerOpacity: NumberStops;
  shimmerWidth: NumberStops;
  shimmerBlur: NumberStops;
  outlineOpacity: NumberStops;
  outlineWidth: NumberStops;
};

// Shared width/blur ramps — visibility is governed by the opacity ramps,
// so width just tracks zoom and stays the same across resolutions. Ramps
// are extended out to z=15 with larger-than-hairline widths because the
// hex grid sits BELOW streets, labels, and building footprints in the
// layer stack — the user sees buildings on top, and the grid as a fabric
// behind them. Keeping the grid legible at z≥12 costs nothing because
// the buildings cover the busy parts.
const SHIMMER_WIDTH: NumberStops = [
  9, 2.8, 10.5, 2.3, 11, 1.9, 12, 1.4, 13, 0.9, 15, 0.5,
];
const SHIMMER_BLUR: NumberStops = [
  9, 3.0, 10.5, 2.4, 11, 1.8, 12, 1.3, 13, 0.9, 15, 0.55,
];
const OUTLINE_WIDTH: NumberStops = [
  9, 0.9, 10.5, 0.75, 11, 0.6, 12, 0.5, 13, 0.4, 15, 0.28,
];

const RAMPS: Record<Resolution, Record<ThemeKey, Ramp>> = {
  r6: {
    dark: {
      // Starts full, crossfades out by z=10.8. Dark-mode values sit higher
      // than the pre-shimmer curve now that hexes render beneath the label
      // layer — cells without signal blend into the navy ground and hot
      // cells POP.
      fillOpacity:    [9, 0.92, 10.5, 0.35, 10.8, 0, 15, 0],
      // Shimmer baseline is deliberately ghostly — dashed bright silver
      // that barely shows at rest. Pitch amp multiplies these up to ~4× on
      // tilt (see pitchMult ceilings), so the tilt reveal is pronounced
      // while the flat-top-down view stays quiet.
      shimmerOpacity: [9, 0.18, 10.4, 0.10, 10.6, 0, 15, 0],
      shimmerWidth:   SHIMMER_WIDTH,
      shimmerBlur:    SHIMMER_BLUR,
      // Outline is now slate-700 color — defines edges subtly without
      // shouting. Opacity kept moderate so it doesn't fade into the basemap.
      outlineOpacity: [9, 0.70, 10.4, 0.22, 10.6, 0, 15, 0],
      outlineWidth:   OUTLINE_WIDTH,
    },
    light: {
      fillOpacity:    [9, 0.72, 10.5, 0.27, 10.8, 0, 15, 0],
      shimmerOpacity: [9, 0.15, 10.4, 0.08, 10.6, 0, 15, 0],
      shimmerWidth:   SHIMMER_WIDTH,
      shimmerBlur:    SHIMMER_BLUR,
      outlineOpacity: [9, 0.85, 10.4, 0.25, 10.6, 0, 15, 0],
      outlineWidth:   OUTLINE_WIDTH,
    },
  },
  r8: {
    dark: {
      // Starts at zero, crossfades in. Outline leads fill by ~0.3z so you
      // see the finer tessellation etch in before the color shifts.
      //
      // Two-phase persistence: gentle decline across z=11→z=13 (buildings
      // are above, grid reads as a useful backdrop tile), then a fast
      // knock-down z=13→z=14 so the grid is effectively gone at z≥14 and
      // buildings + pins own the close-zoom view.
      //
      // Shimmer fades out ~1.5z EARLIER than fill/outline — the sparkle is
      // a stylistic metro-scale flourish, not something you want fighting
      // for attention at neighborhood/building zoom.
      fillOpacity:    [10.0, 0, 10.5, 0.40, 10.8, 0.78, 11, 0.74, 12, 0.62, 13, 0.45, 13.5, 0.22, 14, 0.03, 15, 0],
      shimmerOpacity: [9.6, 0, 9.9, 0.03, 10.6, 0.18, 11, 0.14, 11.5, 0.08, 12, 0.03, 12.5, 0, 15, 0],
      shimmerWidth:   SHIMMER_WIDTH,
      shimmerBlur:    SHIMMER_BLUR,
      outlineOpacity: [9.6, 0, 9.9, 0.11, 10.6, 0.70, 11, 0.66, 12, 0.55, 13, 0.40, 13.5, 0.20, 14, 0.02, 15, 0],
      outlineWidth:   OUTLINE_WIDTH,
    },
    light: {
      fillOpacity:    [10.0, 0, 10.5, 0.30, 10.8, 0.62, 11, 0.58, 12, 0.48, 13, 0.34, 13.5, 0.16, 14, 0.02, 15, 0],
      shimmerOpacity: [9.6, 0, 9.9, 0.025, 10.6, 0.14, 11, 0.11, 11.5, 0.06, 12, 0.02, 12.5, 0, 15, 0],
      shimmerWidth:   SHIMMER_WIDTH,
      shimmerBlur:    SHIMMER_BLUR,
      outlineOpacity: [9.6, 0, 9.9, 0.13, 10.6, 0.85, 11, 0.80, 12, 0.65, 13, 0.45, 13.5, 0.22, 14, 0.02, 15, 0],
      outlineWidth:   OUTLINE_WIDTH,
    },
  },
};

// Dasharray on shimmer = the "catches light on only certain edges" trick.
// [3, 7] in line-width units means bright for 3 units, gap for 7 — so the
// shimmer paints roughly 30% of each hex edge. Combined with the ghostly
// baseline opacity, the flat view reads as a dark hex grid with faint
// speckle; tilt amps the speckle into a visible metallic sheen on ~30% of
// the edge length, like polished metal catching light at angles.
const SHIMMER_DASH: [number, number] = [3, 7];

/** Build a top-level `['interpolate', ['linear'], ['zoom'], ...stops]` expression. */
function zoomInterp(stops: NumberStops, mult = 1): any {
  const expr: any[] = ['interpolate', ['linear'], ['zoom']];
  for (let i = 0; i < stops.length; i += 2) {
    expr.push(stops[i], stops[i + 1] * mult);
  }
  return expr;
}

/**
 * Opacity ramp, multiplied by per-feature `bloom` state (0..1) while the HUD
 * reveal is in flight. After the reveal completes we rebind the paint props
 * to plain `zoomInterp` so MapLibre doesn't keep chasing feature-state on
 * every frame.
 *
 * When `hudRevealPlayed === true` this returns the plain zoom ramp, so every
 * call site can blindly use `opacityExpr` without branching.
 */
function opacityExpr(stops: NumberStops, mult = 1): any {
  const z = zoomInterp(stops, mult);
  if (hudRevealPlayed) return z;
  // Default bloom=1 so that if the reveal never fires (dev edge case, stalled
  // rAF, whatever) hexes are still visible at full opacity. The reveal opens
  // by priming bloom=0 on every freshly-installed feature inside
  // installResolution — so the "start invisible, fade in left→right" behavior
  // is driven by an explicit prime, not by a zero default.
  return ['*', z, ['coalesce', ['feature-state', 'bloom'], 1]];
}

/**
 * Shimmer-only opacity expression. Same as `opacityExpr` but also multiplies
 * by the per-feature `sheen` state (default 1 when unset, so flat view with
 * no sheen computation reads as normal rim-catch). When pitch crosses the
 * threshold, applySheen writes per-hex values in [0.4, 1.0] so the reflective
 * highlight band brightens a subset of hexes while everything else dims to
 * 40% — reads as a single polished surface catching light, HexClad-style.
 */
function shimmerOpacityExpr(stops: NumberStops, mult = 1): any {
  const z = zoomInterp(stops, mult);
  const sheen = ['coalesce', ['feature-state', 'sheen'], 1];
  if (hudRevealPlayed) return ['*', z, sheen];
  // Default bloom=1 matches opacityExpr — features appear at full shimmer
  // unless the reveal explicitly primed them to 0. Sheen is independent and
  // always participates.
  return ['*', z, ['coalesce', ['feature-state', 'bloom'], 1], sheen];
}

/**
 * Line-width ramp with a per-feature `scalePulse` multiplier baked in during
 * the HUD reveal. Used for outline + shimmer layers so each hex "pops" as it
 * arrives — starts at scalePulse=0 (invisible stroke), pulses up to 2.5x
 * (overshoots its natural width), then settles to 1x (final size).
 *
 * Validator rule: zoom expression must be the input to the outermost
 * interpolate/step. So we keep `interpolate-on-zoom` at the top and multiply
 * each stop value by `['coalesce', ['feature-state', 'scalePulse'], 1]`. This
 * is legal — stop values can be arbitrary expressions.
 *
 * Once `hudRevealPlayed === true` we fall back to plain `zoomInterp` so
 * MapLibre isn't re-evaluating feature-state on every frame for no reason.
 */
function widthExpr(stops: NumberStops, mult = 1): any {
  if (hudRevealPlayed) return zoomInterp(stops, mult);
  const expr: any[] = ['interpolate', ['linear'], ['zoom']];
  for (let i = 0; i < stops.length; i += 2) {
    expr.push(stops[i], ['*', stops[i + 1] * mult, ['coalesce', ['feature-state', 'scalePulse'], 1]]);
  }
  return expr;
}

/**
 * Fill-color expression with a two-phase crossfade: a neutral slate tone
 * while the hex is arriving, interpolating to the data-driven color once
 * `colorPhase` flips to 1. Reads as "raw wireframe first, then data
 * populates" — the hex shows up empty-feeling, then the metric paints in.
 *
 * Interpolates between a single color string (neutral endpoint) and another
 * interpolate expression (data endpoint) — MapLibre allows expressions as
 * stop values for color interpolates. `coalesce` defaults to 1 so features
 * that were never primed (post-reveal, or filter-toggle re-install) jump
 * straight to the data color.
 */
function fillColorWithPhase(dormantOnly: boolean, metric: HexMetric, isDark: boolean): any {
  const dataColor = hexFillColorExpr(dormantOnly, metric, isDark);
  if (hudRevealPlayed) return dataColor;
  // Neutral endpoint: slate that reads as "structure, no data yet" — dark navy
  // on dark mode (blends with basemap) and light slate on light mode. Kept
  // close to the 0-value end of the real data ramps so the crossfade is subtle
  // where it needs to be (low-signal hexes) and dramatic where it matters
  // (high-signal hexes).
  const neutral = isDark ? '#1e293b' : '#e2e8f0';
  return ['interpolate', ['linear'], ['coalesce', ['feature-state', 'colorPhase'], 1],
    0, neutral,
    1, dataColor,
  ];
}

/** Deterministic 0..1 hash from a string (FNV-1a). Used for per-cell reveal
 *  jitter so the left-to-right sweep reads organic rather than a hard wipe. */
function hashStringToUnit(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 0xFFFFFFFF;
}

function sourceId(res: Resolution) { return `metro-hexes-${res}`; }
function fillLayerId(res: Resolution) { return `metro-hex-fill-${res}`; }
function shimmerLayerId(res: Resolution) { return `metro-hex-shimmer-${res}`; }
function outlineLayerId(res: Resolution) { return `metro-hex-outline-${res}`; }

/** Pitch-to-multiplier curve for shimmer amp. 0° = 1.0, 60° = 1.6. */
function pitchMult(pitch: number, ceiling = 1.6): number {
  const t = Math.min(1, Math.max(0, pitch / 60));
  return 1 + (ceiling - 1) * t;
}

/**
 * Apply the current pitch to both resolutions' shimmer layers. Rewrites
 * the zoom-interpolate ramps with pre-multiplied values so the pitch
 * amplification rides on top of the normal zoom response.
 *
 * Opacity ceiling is 4× because the baseline shimmer ramp is deliberately
 * ghostly (0.15–0.18 at z=9). Tilt brings it up to ~0.6–0.7 peak, which
 * combined with the [3,7] dasharray reads as light catching ~30% of the
 * hex edges — not a uniform glow. Width/blur get modest 1.5× and 1.25×
 * ceilings so tilt broadens the sheen slightly without making it gaudy.
 */
function applyShimmerPitch(map: MLMap, theme: ThemeKey) {
  const pitch = map.getPitch();
  const opMult = pitchMult(pitch, 4.0);
  const wMult = pitchMult(pitch, 1.5);
  const blMult = pitchMult(pitch, 1.25);
  (['r6', 'r8'] as const).forEach((res) => {
    const id = shimmerLayerId(res);
    if (!map.getLayer(id)) return;
    const ramp = RAMPS[res][theme];
    // shimmerOpacityExpr bakes in bloom (mid-reveal) and sheen (always) so
    // the paint expression keeps the multipliers after a pitch-driven rewrite.
    map.setPaintProperty(id, 'line-opacity', shimmerOpacityExpr(ramp.shimmerOpacity, opMult));
    map.setPaintProperty(id, 'line-width',   zoomInterp(ramp.shimmerWidth,   wMult));
    map.setPaintProperty(id, 'line-blur',    zoomInterp(ramp.shimmerBlur,    blMult));
  });
}

/**
 * Recompute hex centroids (lng/lat) for a resolution. Called from
 * installResolution whenever the source data changes so applySheen can
 * project the right set of features every frame. Centroid is an average
 * of the ring vertices — plenty accurate for a Gaussian sheen band, and
 * way cheaper than a proper polygon centroid.
 */
/**
 * Prime every feature in the freshly-installed data to bloom=0, scalePulse=0,
 * colorPhase=0 so the HUD reveal can orchestrate a three-channel arrival:
 *
 *   bloom      0 → 1   opacity fade-in (multiplies fill-opacity / line-opacity)
 *   scalePulse 0 → 2.5 → 1  outline/shimmer width pops in, overshoots, settles
 *   colorPhase 0 → 1   fill crossfades from neutral slate → data-driven color
 *
 * Only runs while `hudRevealPlayed === false` — once the reveal has completed
 * (or bailed), new/updated sources render with the coalesce defaults
 * (bloom=1, scalePulse=1, colorPhase=1) so filter toggles or dynamic data
 * reloads don't replay the pop.
 *
 * Runs synchronously right after addSource, before addLayer, so the first
 * paint of the new layer already reflects the primed state (no flash of
 * full-opacity hexes between layer install and the setTimeout(60)).
 */
function primeBloomZero(map: MLMap, res: Resolution, data: any) {
  if (hudRevealPlayed) return;
  const srcId = sourceId(res);
  if (!map.getSource(srcId)) return;
  const features = data?.features;
  if (!Array.isArray(features)) return;
  for (const f of features) {
    const h3 = f?.properties?.h3Cell;
    if (!h3) continue;
    try {
      map.setFeatureState(
        { source: srcId, id: String(h3) },
        { bloom: 0, scalePulse: 0, colorPhase: 0 },
      );
    } catch { /* source unloaded */ }
  }
}

function captureCentroids(res: Resolution, data: any) {
  const out: Centroid[] = [];
  const features = data?.features;
  if (!Array.isArray(features)) {
    centroidStore[res] = out;
    return;
  }
  for (const f of features) {
    const h3 = f?.properties?.h3Cell;
    const ring = f?.geometry?.coordinates?.[0];
    if (!h3 || !Array.isArray(ring) || ring.length === 0) continue;
    let sumLng = 0;
    let sumLat = 0;
    let n = 0;
    for (const c of ring) {
      if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
        sumLng += c[0]; sumLat += c[1]; n++;
      }
    }
    if (n === 0) continue;
    out.push({ fid: String(h3), lngLat: [sumLng / n, sumLat / n] });
  }
  centroidStore[res] = out;
}

/**
 * Compute the sheen state across both resolutions for the current camera
 * pose. Below pitch threshold: clear sheen once, skip the per-frame math
 * (flat top-down reads as clean baseline rim-catch). Above threshold: project
 * the world-space NE sun direction onto screen, pick a specular line whose
 * offset from viewport center scales with pitch, and write a Gaussian band
 * value per hex via feature-state.
 *
 * Intentionally throttled via scheduleSheen + rAF — camera events can burst
 * at 60Hz and ~4.6k setFeatureState calls per event would melt the main
 * thread. rAF coalescing caps us at one pass per animation frame.
 */
function applySheen(map: MLMap) {
  const pitch = map.getPitch();

  if (pitch < SHEEN_PITCH_THRESHOLD_DEG) {
    // Deactivate: one-shot clear back to sheen=1 so shimmer = full baseline.
    // Only runs on the transition edge; later calls are cheap no-ops.
    if (sheenActive) {
      sheenActive = false;
      (['r6', 'r8'] as const).forEach((res) => {
        const srcId = sourceId(res);
        if (!map.getSource(srcId)) return;
        for (const { fid } of centroidStore[res]) {
          try { map.setFeatureState({ source: srcId, id: fid }, { sheen: 1 }); } catch { /* source gone */ }
        }
      });
    }
    return;
  }
  sheenActive = true;

  const canvas = map.getCanvas();
  const vw = canvas.clientWidth || 1;
  const vh = canvas.clientHeight || 1;
  const cx = vw / 2;
  const cy = vh / 2;

  // Find screen-space direction of the NE world axis. We project map-center
  // and center + 0.001° NE, then take the delta — this gives us "which way
  // is NE on screen" under the current bearing/pitch. World-fixed sun means
  // this vector rotates on screen as the user rotates the map.
  const center = map.getCenter();
  const sunRad = (SUN_AZ_DEG * Math.PI) / 180;
  const sunWorld: [number, number] = [
    center.lng + Math.sin(sunRad) * 0.001,
    center.lat + Math.cos(sunRad) * 0.001,
  ];
  const centerPx = map.project(center);
  const sunPx = map.project(sunWorld);
  let sdx = sunPx.x - centerPx.x;
  let sdy = sunPx.y - centerPx.y;
  const sLen = Math.hypot(sdx, sdy) || 1;
  sdx /= sLen; sdy /= sLen; // unit vector: NE direction in screen space

  // Specular hotspot offsets from viewport center toward the sun as pitch
  // increases. At the threshold the band passes through center; by pitch 60°
  // it's pushed ~30% of the viewport away in the sun direction. Feels like
  // tilt-toward-sun revealing brighter reflection past the horizon line.
  const pitchNorm = Math.min(1, (pitch - SHEEN_PITCH_THRESHOLD_DEG) / (60 - SHEEN_PITCH_THRESHOLD_DEG));
  const spec = pitchNorm * 0.30 * Math.min(vw, vh);
  const specX = cx + sdx * spec;
  const specY = cy + sdy * spec;

  // Band width: ~1/6 viewport = soft diffuse reflection, not a laser stripe.
  const sigma = Math.max(vw, vh) / 6;
  const twoSigma2 = 2 * sigma * sigma;

  // Gaussian falloff in [0.4, 1.0]. Peak (in-band) hexes at 1.0, out-of-band
  // damped to 0.4 so the whole grid still reads as lit metal — just with a
  // brighter sweep passing across it.
  const FLOOR = 0.4;
  const HEAD = 1.0 - FLOOR;

  (['r6', 'r8'] as const).forEach((res) => {
    const srcId = sourceId(res);
    if (!map.getSource(srcId)) return;
    for (const { fid, lngLat } of centroidStore[res]) {
      const px = map.project(lngLat as any);
      // Perpendicular distance from specular line (band runs perpendicular
      // to sun direction, passes through (specX, specY)).
      const d = (px.x - specX) * sdx + (px.y - specY) * sdy;
      const g = Math.exp(-(d * d) / twoSigma2); // 0..1
      const sheen = FLOOR + HEAD * g;
      try { map.setFeatureState({ source: srcId, id: fid }, { sheen }); } catch { /* source gone */ }
    }
  });
}

function scheduleSheen(map: MLMap) {
  if (sheenRafPending) return;
  sheenRafPending = true;
  requestAnimationFrame(() => {
    sheenRafPending = false;
    applySheen(map);
  });
}

function installResolution(
  map: MLMap,
  res: Resolution,
  data: any,
  dormantOnly: boolean,
  metric: HexMetric,
  isDark: boolean,
  insertBefore: string | undefined,
) {
  const srcId = sourceId(res);
  const fillId = fillLayerId(res);
  const shimmerId = shimmerLayerId(res);
  const outlineId = outlineLayerId(res);

  // Source: create or update. promoteId lifts `h3Cell` into the feature id
  // so setFeatureState({ source, id: h3 }, { bloom: ... }) works without
  // wrestling top-level feature.id typing.
  const existing = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
  const sourceIsFresh = !existing;
  if (existing) {
    existing.setData(data);
  } else {
    map.addSource(srcId, { type: 'geojson', data, promoteId: 'h3Cell' });
  }

  // Prime bloom=0 on all features so the HUD reveal can fade them in. Only on
  // a fresh source — not on setData updates (filter toggle), which would stomp
  // bloom=1 values mid-sweep. Runs before addLayer so the initial frame
  // already has the features hidden. No-op once hudRevealPlayed flips.
  if (sourceIsFresh) primeBloomZero(map, res, data);

  // Re-capture centroids on every data change — the dormantOnly filter
  // removes/adds features so the set the sheen pass iterates over must
  // match what's actually rendered.
  captureCentroids(res, data);

  // Re-tint on every call so dormantOnly/metric flips propagate.
  if (map.getLayer(fillId)) {
    map.setPaintProperty(fillId, 'fill-color', hexFillColorExpr(dormantOnly, metric, isDark));
    return;
  }

  const themeKey: ThemeKey = isDark ? 'dark' : 'light';
  const ramp = RAMPS[res][themeKey];
  // Dark-mode outline: slate-700 (#334155). Slate-800 was too close to the
  // Dark-Matter navy and read as no grid at all. Slate-700 stays quiet but
  // actually shows up as defined outlines. Shimmer (slate-400, dashed,
  // pitch-amped) still does the "light catching the edges" work on top.
  // Darker outlines — near-black but with a slight blue-slate undertone so
  // it still reads as part of the slate UI palette instead of pure #000.
  // Dark mode: slate-950 (#020617) — almost indistinguishable from the
  // basemap navy in RGB but just bright enough to draw a crisp edge.
  // Light mode: slate-900 (#0f172a) — nearly black on a light basemap,
  // gives the grid a hard, confident border instead of the previous airy
  // slate-600 wash.
  const outlineColor = isDark ? '#020617' : '#0f172a';
  // Shimmer: slate-400 on dark (was slate-300 — too silvery), slate-700 on
  // light. Dashed so only ~30% of each edge catches light.
  const shimmerColor = isDark ? '#94a3b8' : '#334155';
  const initialPitch = map.getPitch();
  const opMult = pitchMult(initialPitch, 4.0);
  const wMult = pitchMult(initialPitch, 1.5);
  const blMult = pitchMult(initialPitch, 1.25);

  map.addLayer({
    id: fillId,
    type: 'fill',
    source: srcId,
    maxzoom: 15,
    paint: {
      // Plain data-driven color — no feature-state wrapping. hexFillColorExpr
      // returns a case/interpolate over the selected metric.
      'fill-color': hexFillColorExpr(dormantOnly, metric, isDark),
      // Plain zoom ramp — fades hexes in naturally as you zoom into the
      // metro, no per-feature bloom state required.
      'fill-opacity': zoomInterp(ramp.fillOpacity),
    },
  }, insertBefore);

  // Shimmer — pitch-reactive metallic edge. Base ramp is written here; the
  // pitch event handler rewrites the same three paint properties with
  // pre-multiplied ramps each time the camera tilts. Dashed so only ~30%
  // of each hex edge carries the shimmer — reads as light catching certain
  // edge fragments rather than a uniform glow band. shimmerOpacityExpr
  // still participates via the `sheen` feature-state (pitch-driven
  // highlight band); that path is stable.
  map.addLayer({
    id: shimmerId,
    type: 'line',
    source: srcId,
    maxzoom: 15,
    paint: {
      'line-color': shimmerColor,
      'line-blur': zoomInterp(ramp.shimmerBlur, blMult),
      'line-width': zoomInterp(ramp.shimmerWidth, wMult),
      'line-opacity': shimmerOpacityExpr(ramp.shimmerOpacity, opMult),
      'line-dasharray': SHIMMER_DASH,
    },
  }, insertBefore);

  map.addLayer({
    id: outlineId,
    type: 'line',
    source: srcId,
    maxzoom: 15,
    paint: {
      'line-color': outlineColor,
      'line-width': zoomInterp(ramp.outlineWidth),
      'line-opacity': zoomInterp(ramp.outlineOpacity),
    },
  }, insertBefore);
}

/**
 * Iron Man HUD reveal. Features wipe in left-to-right across the metro with
 * per-cell noise so the edge reads organic instead of a hard vertical bar.
 *
 * Runs at most once per page load:
 *   - hudRevealScheduled = true as soon as we kick it off (prevents double-fire
 *     while r6/r8 arrive in the same tick).
 *   - hudRevealPlayed = true when the rAF loop drains and we swap paint props
 *     back to plain zoom ramps.
 *
 * Theme swap remounts the component but NOT the module — the flags survive,
 * so subsequent mounts see hudRevealPlayed === true and skip straight to
 * plain fade-in via the zoom ramp.
 */
function runHudReveal(map: MLMap, theme: ThemeKey) {
  if (hudRevealPlayed) {
    // eslint-disable-next-line no-console
    console.log('[hex-reveal] runHudReveal skipped — already played');
    return;
  }

  // Read from centroidStore — captureCentroids already did the work at
  // installResolution time, and it survives MapLibre version churn (earlier
  // versions exposed raw data on `source._data`, 4.x doesn't).
  type Entry = { srcId: string; fid: string; lng: number; delay: number };
  const entries: Entry[] = [];
  (['r6', 'r8'] as const).forEach((res) => {
    if (!map.getSource(sourceId(res))) return;
    for (const { fid, lngLat } of centroidStore[res]) {
      entries.push({ srcId: sourceId(res), fid, lng: lngLat[0], delay: 0 });
    }
  });
  // eslint-disable-next-line no-console
  console.log('[hex-reveal] runHudReveal starting', {
    theme,
    entries: entries.length,
    r6Centroids: centroidStore.r6.length,
    r8Centroids: centroidStore.r8.length,
    r6Source: !!map.getSource(sourceId('r6')),
    r8Source: !!map.getSource(sourceId('r8')),
    r6Layer: !!map.getLayer(fillLayerId('r6')),
    r8Layer: !!map.getLayer(fillLayerId('r8')),
  });

  // Defensive: if we somehow have nothing to animate (both sources failed
  // to install, data fetch pending, etc.), mark the gate as played and
  // rebind plain expressions so we don't leave hexes stuck at opacity 0
  // or width 0.
  if (entries.length === 0) {
    hudRevealPlayed = true;
    (['r6', 'r8'] as const).forEach((res) => {
      const ramp = RAMPS[res][theme];
      const fillId = fillLayerId(res);
      const shimmerId = shimmerLayerId(res);
      const outlineId = outlineLayerId(res);
      if (map.getLayer(fillId))    map.setPaintProperty(fillId,    'fill-opacity', zoomInterp(ramp.fillOpacity));
      if (map.getLayer(outlineId)) {
        map.setPaintProperty(outlineId, 'line-opacity', zoomInterp(ramp.outlineOpacity));
        map.setPaintProperty(outlineId, 'line-width',   zoomInterp(ramp.outlineWidth));
      }
      if (map.getLayer(shimmerId)) {
        map.setPaintProperty(shimmerId, 'line-opacity', shimmerOpacityExpr(ramp.shimmerOpacity));
        map.setPaintProperty(shimmerId, 'line-width',   zoomInterp(ramp.shimmerWidth));
      }
    });
    return;
  }

  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const e of entries) {
    if (e.lng < minLng) minLng = e.lng;
    if (e.lng > maxLng) maxLng = e.lng;
  }
  const span = Math.max(1e-6, maxLng - minLng);

  // 900ms sweep with ±110ms jitter per cell — long enough to read as
  // intentional, short enough the user isn't waiting on it. Jitter size
  // scales with span roughness; pure ±110ms feels right for a metro-sized
  // bbox (~0.6° lng).
  const sweepMs = 900;
  const jitterMs = 220;
  for (const e of entries) {
    const t = (e.lng - minLng) / span;       // 0 at left edge, 1 at right
    const j = (hashStringToUnit(e.fid) - 0.5) * jitterMs;
    e.delay = Math.max(0, Math.min(sweepMs + jitterMs, t * sweepMs + j));
  }
  entries.sort((a, b) => a.delay - b.delay);

  const start = performance.now();
  // Two-phase cursors, both walking the same delay-sorted list:
  //   popCursor    — at each entry's delay, fires "arrive" state
  //                  (bloom=1, scalePulse=2.5). Line-width transitions 0→2.5x
  //                  over 180ms (the overshoot), opacity transitions 0→1 over
  //                  220ms. Color stays neutral.
  //   settleCursor — POP_SETTLE_MS after each entry's delay, fires the
  //                  "settle" state (scalePulse=1, colorPhase=1). Line-width
  //                  transitions 2.5x→1x over 180ms (the spring-back), and
  //                  fill-color crossfades from neutral → data color over 260ms.
  // Each hex's timeline: rawPop(0→2.5x, invisible→full) → settle(2.5x→1x,
  // neutral→data color). Felt duration per hex ≈ 400ms; sweep reads as a
  // coordinated left→right wave that fills the map with raw structure first,
  // then data lights up behind it.
  const POP_SETTLE_MS = 170;
  let popCursor = 0;
  let settleCursor = 0;

  function step() {
    const elapsed = performance.now() - start;
    // Phase 1: each hex arrives at its own jittered delay.
    while (popCursor < entries.length && entries[popCursor].delay <= elapsed) {
      const e = entries[popCursor];
      try {
        map.setFeatureState({ source: e.srcId, id: e.fid }, {
          bloom: 1,
          scalePulse: 2.5,
        });
      } catch { /* source may have unloaded during a style swap — skip */ }
      popCursor++;
    }
    // Phase 2: POP_SETTLE_MS after each hex's arrival, collapse scale back
    // to 1x and flip color from neutral → data.
    while (
      settleCursor < entries.length &&
      entries[settleCursor].delay + POP_SETTLE_MS <= elapsed
    ) {
      const e = entries[settleCursor];
      try {
        map.setFeatureState({ source: e.srcId, id: e.fid }, {
          scalePulse: 1,
          colorPhase: 1,
        });
      } catch { /* source may have unloaded during a style swap — skip */ }
      settleCursor++;
    }
    if (settleCursor < entries.length) {
      requestAnimationFrame(step);
      return;
    }
    // Drain complete. Flip the flag FIRST so every helper returns its
    // post-reveal shape (plain zoom ramps, sheen-only shimmer, direct
    // data-color fill). Then rebind every paint prop that was riding
    // feature-state so MapLibre doesn't keep re-evaluating the wrappers.
    // eslint-disable-next-line no-console
    console.log('[hex-reveal] drain complete, rebinding', { theme });
    hudRevealPlayed = true;
    (['r6', 'r8'] as const).forEach((res) => {
      const ramp = RAMPS[res][theme];
      const fillId = fillLayerId(res);
      const shimmerId = shimmerLayerId(res);
      const outlineId = outlineLayerId(res);
      if (map.getLayer(fillId)) {
        map.setPaintProperty(fillId, 'fill-opacity', zoomInterp(ramp.fillOpacity));
        // hexFillColorExpr from outside the reveal is pure data-driven — but
        // installResolution is what owns the tint, so reach into its memo by
        // re-calling paint()? No — cheaper to just ask fillColorWithPhase
        // which now short-circuits to data color since hudRevealPlayed=true.
        // We need current dormantOnly/metric/isDark — not visible here. The
        // fill is already using fillColorWithPhase with colorPhase=1 flipped
        // on every feature, so it's already showing data color. Rebinding
        // would require threading state; skip it — the feature-state path
        // resolves identically at colorPhase=1.
      }
      if (map.getLayer(outlineId)) {
        map.setPaintProperty(outlineId, 'line-opacity', zoomInterp(ramp.outlineOpacity));
        map.setPaintProperty(outlineId, 'line-width',   zoomInterp(ramp.outlineWidth));
      }
      if (map.getLayer(shimmerId)) {
        map.setPaintProperty(shimmerId, 'line-opacity', shimmerOpacityExpr(ramp.shimmerOpacity));
        map.setPaintProperty(shimmerId, 'line-width',   zoomInterp(ramp.shimmerWidth));
      }
    });
    // Re-apply current pitch amp and kick one sheen pass — covers the case
    // where the user loaded the page already pitched.
    applyShimmerPitch(map, theme);
    scheduleSheen(map);
  }

  requestAnimationFrame(step);
}

function paint(
  map: MLMap,
  dataR6: any | null,
  dataR8: any | null,
  dormantOnly: boolean,
  metric: HexMetric,
  isDark: boolean,
  onHexClick?: (cell: HexAggregate) => void,
  setFocus?: (s: HexFocusState | null | ((prev: HexFocusState | null) => HexFocusState | null)) => void,
) {
  // Stack order (bottom → top): fill-r6, shimmer-r6, outline-r6, fill-r8,
  // shimmer-r8, outline-r8, basemap roads/labels. r6 always sits below r8
  // so during the crossover both tessellations are legible.
  const firstBasemap = firstRoadOrLabelLayerId(map);
  // If r8 layers already exist, insert r6 below them; otherwise both go
  // beneath the basemap streets/labels. Handles whichever resolution
  // finishes loading first.
  const r8FillExists = !!map.getLayer(fillLayerId('r8'));
  const r6InsertBefore = r8FillExists ? fillLayerId('r8') : firstBasemap;
  const r8InsertBefore = firstBasemap;

  if (dataR6) installResolution(map, 'r6', dataR6, dormantOnly, metric, isDark, r6InsertBefore);
  if (dataR8) installResolution(map, 'r8', dataR8, dormantOnly, metric, isDark, r8InsertBefore);

  // Bind click/hover/pitch handlers exactly once per map instance. MapLibre
  // accepts an array of layer ids — the filter is evaluated per-event, so
  // layer ids that don't exist yet are silently skipped until their
  // resolution installs.
  const anyMap = map as any;
  if (!anyMap.__metroHexBound) {
    anyMap.__metroHexBound = true;
    const fillLayers = [fillLayerId('r6'), fillLayerId('r8')];

    const hoverCapable = () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;

    map.on('click', fillLayers, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const props = f.properties as unknown as HexFocusProps;
      if (setFocus) setFocus({ props, isStale: false, pinned: true });
      if (onHexClick) onHexClick(f.properties as unknown as HexAggregate);
    });
    map.on('mouseenter', fillLayers, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mousemove', fillLayers, (e) => {
      if (!setFocus || !hoverCapable()) return;
      const f = e.features?.[0];
      if (!f) return;
      const props = f.properties as unknown as HexFocusProps;
      setFocus((prev) => {
        if (prev?.pinned && prev.props.h3Cell === props.h3Cell) return prev;
        return { props, isStale: false, pinned: false };
      });
    });
    map.on('mouseleave', fillLayers, () => {
      map.getCanvas().style.cursor = '';
      if (!setFocus || !hoverCapable()) return;
      setFocus((prev) => (prev && !prev.pinned ? { ...prev, isStale: true } : prev));
    });

    // Pitch-amped shimmer. MapLibre doesn't let camera expressions (zoom,
    // pitch) be multiplied inside a paint expression — they must be the
    // top-level operator of their interpolate/step. So pitch amplification
    // is applied imperatively here: on every pitch event, rewrite the
    // shimmer layer's zoom ramps with pre-multiplied values. Event is
    // throttled by MapLibre internally and paint-property updates are
    // cheap (they don't re-tessellate geometry).
    const theme: ThemeKey = isDark ? 'dark' : 'light';
    map.on('pitch', () => applyShimmerPitch(map, theme));
    // Also catch the end of a pitch gesture in case 'pitch' didn't fire
    // for the final frame (some trackpad gestures settle via pitchend).
    map.on('pitchend', () => applyShimmerPitch(map, theme));

    // HexClad sheen. Any camera change (pan, rotate, zoom, pitch) shifts
    // where hexes land in screen space, so the specular band has to be
    // recomputed. scheduleSheen coalesces bursts via rAF — one pass per
    // frame, regardless of how many events fire.
    const kick = () => scheduleSheen(map);
    map.on('move', kick);
    map.on('rotate', kick);
    map.on('zoom', kick);
    map.on('pitch', kick);
  }

  // Rekick sheen on every paint(): when r8 arrives after r6 (separate fetch),
  // its centroids weren't populated at the time of the first paint's kick.
  // scheduleSheen is rAF-coalesced so this is free on cold flat-pitch loads
  // (applySheen no-ops below the threshold) and ensures mid-flight data
  // appends get covered without waiting on a camera nudge.
  scheduleSheen(map);

  // Iron Man HUD reveal — fires exactly once per page load (per path). The
  // 60ms settle gives the companion resolution time to install if both r6 and
  // r8 arrive in the same microtask (paint() usually runs twice back-to-back).
  // Module flags persist across theme-keyed remounts so light/dark swap
  // doesn't replay the sweep; same for zoom-out.
  if (!hudRevealPlayed && !hudRevealScheduled) {
    hudRevealScheduled = true;
    const theme: ThemeKey = isDark ? 'dark' : 'light';
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.log('[hex-reveal] scheduled', { theme, r6: centroidStore.r6.length, r8: centroidStore.r8.length });
    }
    window.setTimeout(() => runHudReveal(map, theme), 60);

    // Safety net. If the reveal hasn't completed 2.2s after being scheduled
    // (rAF suspended by a backgrounded tab, setFeatureState silently not
    // applying, data source replaced mid-sweep, whatever), force-flip the
    // gate and rebind every hex layer to plain zoom ramps so the user isn't
    // staring at a blank map or at a hex grid frozen mid-pop. Budget:
    //   900ms sweep + 220ms jitter + 170ms pop-settle + 180ms width tween +
    //   260ms color crossfade ≈ 1730ms. 2.2s leaves ~500ms of headroom.
    window.setTimeout(() => {
      if (hudRevealPlayed) return;
      // eslint-disable-next-line no-console
      console.warn('[hex-reveal] safety timeout — forcing visibility', { theme });
      hudRevealPlayed = true;
      (['r6', 'r8'] as const).forEach((res) => {
        const ramp = RAMPS[res][theme];
        const fillId = fillLayerId(res);
        const shimmerId = shimmerLayerId(res);
        const outlineId = outlineLayerId(res);
        if (map.getLayer(fillId))    map.setPaintProperty(fillId,    'fill-opacity', zoomInterp(ramp.fillOpacity));
        if (map.getLayer(outlineId)) {
          map.setPaintProperty(outlineId, 'line-opacity', zoomInterp(ramp.outlineOpacity));
          map.setPaintProperty(outlineId, 'line-width',   zoomInterp(ramp.outlineWidth));
        }
        if (map.getLayer(shimmerId)) {
          map.setPaintProperty(shimmerId, 'line-opacity', shimmerOpacityExpr(ramp.shimmerOpacity));
          map.setPaintProperty(shimmerId, 'line-width',   zoomInterp(ramp.shimmerWidth));
        }
      });
      applyShimmerPitch(map, theme);
      scheduleSheen(map);
    }, 2200);
  }
}

// Phase 3.6b — supporting types.
type HexMetric = 'score' | 'dormant' | 'roof_age' | 'hail' | 'density';

interface HexFocusProps {
  h3Cell: string;
  n: number;
  p50: number | null;
  p90: number | null;
  scoreMax: number | null;
  dormantCount: number;
  hailMaxInches: number | null;
  avgRoofAge: number | null;
}

/** Unified hex-focus state for the responsive panel.
 *  - `pinned: true`  → set via click/tap. Survives mousemove onto the same
 *    hex and mouseleave without dimming. Cleared by clicking a different hex.
 *  - `pinned: false` → set via hover (desktop only). Dims to `isStale` when
 *    the cursor leaves the hex layer, keeping the last card legible.
 */
interface HexFocusState {
  props: HexFocusProps;
  isStale: boolean;
  pinned: boolean;
}

type BucketKey = 'dormant' | 'blazing' | 'hot' | 'warm' | 'low';
type BucketFilters = Record<BucketKey, boolean>;

const DEFAULT_BUCKETS: BucketFilters = {
  dormant: true, blazing: true, hot: true, warm: true, low: true,
};

// Wraps any color expression so the feature's `bloom` feature-state (0..1)
// drives its alpha. New buildings start with bloom=0 (fully transparent),
// get flipped to bloom=1 on the next animation frame, and the paint
// transition interpolates between the two — producing a real alpha
// fade-in per feature instead of a snap-to-color. Unseen bloom defaults
// to 1 so buildings whose state hasn't been explicitly animated render
// at full alpha.
function withBloomAlpha(color: any): any {
  return [
    'interpolate', ['linear'],
    ['coalesce', ['feature-state', 'bloom'], 1],
    0, 'rgba(0,0,0,0)',
    1, color,
  ];
}

// Neutral base fill — every building uses this, regardless of score. It's
// the canvas; the score overlay rides on top as a thin wash. We lean on a
// true neutral grey (gray-600 / gray-400) rather than slate/stone so the
// building floor reads as "unpainted" canvas and any scored overlay pops
// as obvious paint on top. No blue or warm cast that could be confused
// with a weak score tint.
function buildBaseFillColor(isDark: boolean): string {
  // Dark mode: gray-600 — flat neutral grey on the navy basemap.
  // Light mode: gray-400 — same neutral family, lighter step so footprints
  // read clearly on the near-white Positron basemap.
  return isDark ? '#4b5563' : '#9ca3af';
}

// Extruded score overlay — color. Warm sequential palette (pale amber ->
// deep red) so the hue itself encodes intensity; below 31 falls through to
// transparent so those buildings render as pure basemap (no wash, no
// extrusion). Dormant is its own amber-brown lane because it's a different
// KIND of signal, not hotter-than-hot.
function buildOverlayExtrusionColor(isDark: boolean, scoresOn: boolean, filters: BucketFilters): any {
  // When the master heat-map toggle is off, every building paints in the
  // neutral base color — its 3D volume is still there (see the height /
  // opacity builders), it just reads as the theme's base palette instead of
  // a bucket tint.
  if (!scoresOn) return withBloomAlpha(buildBaseFillColor(isDark));
  return withBloomAlpha([
    'case',
    ['all',
      filters.dormant,
      ['boolean', ['feature-state', 'dormant'], false],
    ], '#78350f',
    ['all',
      filters.blazing,
      ['>=', ['coalesce', ['feature-state', 'score'], -1], 85],
    ], '#b91c1c',
    ['all',
      filters.hot,
      ['>=', ['coalesce', ['feature-state', 'score'], -1], 70],
    ], '#ea580c',
    ['all',
      filters.warm,
      ['>=', ['coalesce', ['feature-state', 'score'], -1], 50],
    ], '#f59e0b',
    ['all',
      filters.low,
      ['>=', ['coalesce', ['feature-state', 'score'], -1], 31],
    ], '#fde68a',
    // Scores 0-30 (and unscored): paint the SAME color as the base fill.
    // Can't use rgba(0,0,0,0) here — with fill-extrusion-opacity at 1.0
    // MapLibre writes the RGB channels opaquely and the building renders
    // solid black in top-down view. Matching the base color means the
    // overlay is effectively invisible for this bucket (same color over
    // same color, height 0 = no volume).
    buildBaseFillColor(isDark),
  ]);
}

// Uniform base opacity, zoom-faded. No per-feature branching — every building
// paints at the same strength so the canvas is consistent; score/weather add
// variation as overlays.
function buildBaseFillOpacity(isDark: boolean): any {
  const maxAlpha = isDark ? 0.75 : 0.85;
  return [
    'interpolate', ['linear'], ['zoom'],
    12, 0,
    13, maxAlpha * 0.55,
    14, maxAlpha,
  ];
}

// Extruded overlay opacity. MapLibre doesn't allow data-driven values on
// fill-extrusion-opacity (it's camera-only), so per-bucket variation is
// encoded in the COLOR alpha if we need it — here we just zoom-fade a single
// scalar. At 0.55 it blends with the slate/stone base from top-down (reads
// like a flat wash), and from a tilted camera it gives the extruded volume
// body without fully obscuring the base layer on the ground.
function buildOverlayExtrusionOpacity(_scoresOn: boolean): any {
  // Opacity is no longer the master toggle — when the heat-map is off, the
  // overlay still renders at base color / uniform height so buildings stay
  // 3D. Same z12->z14 fade-in as before; the color/height builders encode
  // the on/off distinction.
  return [
    'interpolate', ['linear'], ['zoom'],
    12, 0,
    13, 0.55,
    14, 1.0,
  ];
}

// Extrude height is uniform baseline (5m) for every building, bumped for
// interactive states. Selected > hover > base. Height, not color, is what
// sells "this is the one I just clicked" from any camera angle.
function buildOverlayExtrusionHeight(_scoresOn: boolean, _filters: BucketFilters): any {
  // Elevation is locked at 5m, bumped only for `selected`. Rollover
  // highlighting lives entirely in the outline (see buildOutlineColor /
  // buildOutlineOpacity / line-width) so the skyline doesn't jitter as
  // the cursor crosses buildings.
  return [
    'case',
    // Selected only bumps to 8m (from the 5m base) -- a perceptible but
    // restrained lift. Bigger numbers here start to dominate the skyline
    // and compete with the actual heat-map signal.
    ['boolean', ['feature-state', 'selected'], false], 8,
    5,
  ];
}

// Outline is reserved for the very top of the hierarchy: Dormant and Blazing
// (score >= 85). Everything else paints at zero opacity. Keeps the outline
// rare enough that when you see one, it means something.
function buildOutlineColor(
  isDark: boolean,
  scoresOn: boolean,
  filters: BucketFilters,
): any {
  const dormantEdge = '#7c2d12';
  const blazingEdge = '#7f1d1d';
  const neutral = isDark ? '#4b5563' : '#94a3b8';
  // Magenta accent is distinct from every bucket color so the selection
  // never reads as "another bucket" — it reads as "selected". The warm
  // amber/red score palette makes pink the clearest out-of-band choice.
  // Hover uses the softer pink-300 so hovered+selected still resolves
  // visually to selected.
  const selectedEdge = '#ec4899';
  const hoverEdge = '#f9a8d4';
  return [
    'case',
    ['boolean', ['feature-state', 'selected'], false], selectedEdge,
    ['boolean', ['feature-state', 'hover'], false], hoverEdge,
    ['all',
      scoresOn,
      filters.dormant,
      ['boolean', ['feature-state', 'dormant'], false],
    ], dormantEdge,
    ['all',
      scoresOn,
      filters.blazing,
      ['>=', ['coalesce', ['feature-state', 'score'], -1], 85],
    ], blazingEdge,
    neutral,
  ];
}

function buildOutlineOpacity(
  scoresOn: boolean,
  filters: BucketFilters,
): any {
  // Every building gets a whisper-thin outline (0.18) so the skyline reads
  // as individual drawn volumes rather than a flat color wash. Dormant and
  // Blazing jump to 0.55 when the heat-map is on — their edge carries
  // meaning. Selected is a solid highlight regardless of mode.
  // Multiply by bloom so outlines fade in alongside the fill volume.
  return [
    '*',
    ['coalesce', ['feature-state', 'bloom'], 1],
    [
    'case',
    ['boolean', ['feature-state', 'selected'], false], 0.95,
    ['boolean', ['feature-state', 'hover'], false], 0.75,
    ['all',
      scoresOn,
      filters.dormant,
      ['boolean', ['feature-state', 'dormant'], false],
    ], 0.55,
    ['all',
      scoresOn,
      filters.blazing,
      ['>=', ['coalesce', ['feature-state', 'score'], -1], 85],
    ], 0.55,
    0.18,
    ],
  ];
}

function installBuildings(
  map: MLMap,
  onPinClick?: (propertyId: string) => void,
  scoresOn: boolean = true,
  filters: BucketFilters = DEFAULT_BUCKETS,
) {
  if (!map.getSource(BUILDINGS_SOURCE)) {
    map.addSource(BUILDINGS_SOURCE, {
      type: 'vector',
      url: BUILDINGS_PMTILES_URL,
      // Promote the `propertyId` attribute (string cuid) to the feature id, so
      // setFeatureState({ id: propertyId }) from the viewport response lines up.
      // @ts-ignore promoteId is a valid maplibre option
      promoteId: 'propertyId',
    });
  }

  const styleName = (map.getStyle() as any)?.name ?? '';
  const isDark = /dark/i.test(styleName);

  // Slot our layers UNDER the first symbol layer so basemap labels (cities,
  // neighborhoods, streets) stay on top of the buildings.
  const labelBeforeId = firstSymbolLayerId(map);

  const fillLayerIsNew = !map.getLayer('metro-building-fill');
  if (fillLayerIsNew) {
    // Base canvas: uniform neutral color, uniform opacity, no bucket logic.
    map.addLayer({
      id: 'metro-building-fill',
      type: 'fill',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      minzoom: BUILDING_ZOOM_THRESHOLD,
      paint: {
        'fill-color': withBloomAlpha(buildBaseFillColor(isDark)),
        'fill-opacity': buildBaseFillOpacity(isDark),
        // Smooth color/opacity changes instead of snapping when the theme
        // flips or when new feature-state arrives from a viewport refresh.
        'fill-color-transition': { duration: 1100, delay: 0 },
        'fill-opacity-transition': { duration: 1100, delay: 0 },
      },
    }, labelBeforeId);
  }
  const overlayLayerIsNew = !map.getLayer('metro-building-score-overlay');
  if (overlayLayerIsNew) {
    // Extruded score overlay. Warm-sequential palette, bucket-based height.
    // From top-down the ~0.55 opacity blends with the base canvas below and
    // reads as a flat wash; tilt the camera and the buildings stand up.
    map.addLayer({
      id: 'metro-building-score-overlay',
      type: 'fill-extrusion',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      minzoom: BUILDING_ZOOM_THRESHOLD,
      paint: {
        'fill-extrusion-color': buildOverlayExtrusionColor(isDark, scoresOn, filters),
        'fill-extrusion-height': buildOverlayExtrusionHeight(scoresOn, filters),
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': buildOverlayExtrusionOpacity(scoresOn),
        // Fade-in when colors/heights change — either because the user
        // toggled a bucket, or because a new viewport brought in fresh
        // feature-state on buildings that just entered the map.
        'fill-extrusion-color-transition': { duration: 1100, delay: 0 },
        'fill-extrusion-height-transition': { duration: 1100, delay: 0 },
        'fill-extrusion-opacity-transition': { duration: 1100, delay: 0 },
      },
    }, labelBeforeId);
  }

  if (!map.getLayer('metro-building-glow')) {
    // Selected-building glow, rendered as a translucent magenta
    // fill-extrusion shell slightly taller (8.6m) than the selected
    // building (8m). A `line` layer would render at ground level and be
    // occluded by the extruded walls at any pitch > 0, so we use a
    // fill-extrusion that wraps the whole 3D body. No vertical gradient
    // -> uniform magenta aura. Opacity stays at 0 for non-selected
    // buildings so we can keep one layer live rather than add/remove on
    // every click.
    map.addLayer({
      id: 'metro-building-glow',
      type: 'fill-extrusion',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      minzoom: BUILDING_ZOOM_THRESHOLD,
      paint: {
        'fill-extrusion-color': '#ec4899',
        'fill-extrusion-base': 0,
        'fill-extrusion-height': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 8.6,
          0,
        ],
        // fill-extrusion-opacity is camera-only in MapLibre — data expressions
        // (feature-state, get, etc.) aren't allowed. Height=0 on non-selected
        // features already collapses them to nothing, so a fixed scalar is
        // enough: only the selected building has any volume to render.
        'fill-extrusion-opacity': 0.35,
        // Flat shading so the shell reads as a uniform glow instead of
        // picking up the directional light we set in applyAtmosphere.
        'fill-extrusion-vertical-gradient': false,
        // Ease the glow in/out so clicking between properties doesn't pop.
        'fill-extrusion-opacity-transition': { duration: 350, delay: 0 },
        'fill-extrusion-height-transition': { duration: 350, delay: 0 },
      },
    }, labelBeforeId);
  }

  if (!map.getLayer('metro-building-outline')) {
    map.addLayer({
      id: 'metro-building-outline',
      type: 'line',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      // Don't draw outline during the fade-in zoom (12->14); start at 13 so it
      // catches up with the fill without flashing an edge on an empty body.
      minzoom: 13,
      paint: {
        // Outline color is a deep sibling of the bucket fill (amber-900 for
        // dormant, red-900 for hot) so the edge reads as amplification, not
        // contrast. Non-highlighted buildings fall through to a neutral shade
        // that will be rendered at zero opacity anyway.
        'line-color': buildOutlineColor(isDark, scoresOn, filters),
        'line-opacity': buildOutlineOpacity(scoresOn, filters),
        // MapLibre requires `["zoom"]` to appear only as the first argument
        // of the OUTERMOST interpolate/step in a paint expression — wrapping
        // multiple zoom-interpolates inside a `case` trips the validator
        // with "Only one zoom-based step or interpolate subexpression may be
        // used". The legal shape is zoom-interpolate at top, with a
        // data-driven `case` inside each stop's value slot.
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          13, [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 1.6,
            ['boolean', ['feature-state', 'hover'], false],    1.1,
            0.6,
          ],
          16, [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 2.4,
            ['boolean', ['feature-state', 'hover'], false],    1.7,
            1.1,
          ],
          18, [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 3.0,
            ['boolean', ['feature-state', 'hover'], false],    2.1,
            1.4,
          ],
        ],
        'line-color-transition': { duration: 1100, delay: 0 },
        'line-opacity-transition': { duration: 1100, delay: 0 },
      },
    }, labelBeforeId);
  }

  // Magenta halo ring — second line layer stacked over the outline, blurred
  // and ~3x wider so it reads as a soft glow around the footprint rather
  // than a hard edge. Only paints for hover (pink-300) and selected
  // (pink-500); everything else gets zero opacity so the halo is rare
  // enough to be meaningful. Sits ABOVE the outline so it isn't clipped
  // by the crisp edge.
  if (!map.getLayer('metro-building-halo')) {
    map.addLayer({
      id: 'metro-building-halo',
      type: 'line',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      minzoom: 13,
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], '#ec4899',
          ['boolean', ['feature-state', 'hover'], false],    '#f9a8d4',
          '#ec4899',
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 0.85,
          ['boolean', ['feature-state', 'hover'], false],    0.55,
          0,
        ],
        // Same shape rewrite as building-outline — zoom-interpolate on the
        // outside, case-per-state inside each stop. Idle state is 0 (halo
        // invisible unless the feature is hovered or selected).
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          13, [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 5.0,
            ['boolean', ['feature-state', 'hover'], false],    3.5,
            0,
          ],
          16, [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 8.0,
            ['boolean', ['feature-state', 'hover'], false],    5.5,
            0,
          ],
          18, [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 11.0,
            ['boolean', ['feature-state', 'hover'], false],    7.5,
            0,
          ],
        ],
        'line-blur': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 4.0,
          ['boolean', ['feature-state', 'hover'], false],    3.0,
          0,
        ],
        'line-opacity-transition': { duration: 300, delay: 0 },
        'line-width-transition':   { duration: 300, delay: 0 },
      },
    }, labelBeforeId);
  }

  const installClick = (layerId: string) => {
    map.on('click', layerId, (e) => {
      const f = e.features?.[0];
      if (!f || !onPinClick) return;
      const pid =
        (f as any).id ??
        (f.properties as any)?.propertyId ??
        (f.properties as any)?.id;
      if (pid) onPinClick(String(pid));
    });
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  };
  if (fillLayerIsNew) installClick('metro-building-fill');
  if (overlayLayerIsNew) installClick('metro-building-score-overlay');
}

function ZoomBadge({
  zoom, activeRes, pinCount,
}: { zoom: number; activeRes: 6 | 8; pinCount: number }) {
  const showingBuildings = zoom >= BUILDING_ZOOM_THRESHOLD;
  const showingScored = zoom >= PIN_ZOOM_THRESHOLD;
  return (
    <div className="absolute top-3 left-3 rounded-md bg-card/90 border border-border text-card-foreground px-2 py-1 text-[11px] font-mono shadow-sm">
      z={zoom.toFixed(1)} · {showingScored ? `scored (${pinCount})` : `hex r${activeRes}`}
      {showingBuildings ? ' · bldg' : ''}
    </div>
  );
}

// Phase 3.6b — segmented control that picks which aggregate drives the hex
// fill color. Each option re-interprets the same hex geometry through a
// different lens, so the user can switch from "where are the hot leads?" to
// "where are the aging roofs?" without reloading.
const HEX_METRIC_OPTIONS: Array<{ key: HexMetric; label: string; hint: string }> = [
  { key: 'score',    label: 'Score',    hint: 'Hot-lead density (p90 of lead score)' },
  { key: 'dormant',  label: 'Dormant',  hint: 'Homeowners with old storm damage, no claim filed' },
  { key: 'roof_age', label: 'Roof age', hint: 'Avg roof age across the cell' },
  { key: 'hail',     label: 'Hail',     hint: 'Max hail size observed in the cell' },
  { key: 'density',  label: 'Density',  hint: 'Property count per cell' },
];

function HexMetricSelector({
  value, onChange, disabled, visible,
}: {
  value: HexMetric;
  onChange: (m: HexMetric) => void;
  disabled: boolean;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center rounded-lg bg-card/95 text-card-foreground border border-border shadow-sm overflow-hidden text-[12px] font-medium"
      title={disabled ? 'Dormant-only view is active — disable it to switch metrics' : 'Pick the metric colored in the hex heatmap'}
    >
      <span className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground border-r border-border">
        Heatmap
      </span>
      {HEX_METRIC_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.key)}
          className={[
            'px-3 py-1.5 border-r border-border last:border-r-0 transition-colors',
            // `foreground` + `background` inverts the surface → the selected
            // pill becomes the high-contrast color for the current theme
            // (slate-950 on light, near-white on dark).
            disabled
              ? 'text-muted-foreground/60 cursor-not-allowed'
              : value === opt.key
                ? 'bg-foreground text-background'
                : 'text-foreground hover:bg-muted',
          ].join(' ')}
          title={opt.hint}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Responsive hex-focus panel. Replaces the old cursor-following tooltip.
//
// Behavior, unified across input modalities:
//   - Desktop (hover + pointer fine): grows on mousemove, dims on mouseleave,
//     pins on click.
//   - Touch (no hover): only updates on tap. `isStale` stays false.
//
// Layout:
//   - md+ : absolute-positioned card docked bottom-right, ~260px wide.
//   - <md : full-width bar pinned to the bottom of the map container.
//           Collapsed state shows three high-signal metrics; tap the chevron
//           (or the bar) to expand into the full six-row grid.
//   - Both: empty state reads "Tap a hex to explore".
//
// Dismissal:
//   - Touch: the small × in the top-right clears focus.
//   - Desktop: not needed (dims naturally on mouseleave), but × is still there
//     as an affordance for the rare user who wants the map unoccluded.
function HexFocusPanel({
  focus, activeRes, onDismiss,
}: {
  focus: HexFocusState | null;
  activeRes: 6 | 8;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const fmt = (v: number | null | undefined, digits = 0) =>
    v == null ? '—' : v.toFixed(digits);
  const fmtHail = (v: number | null | undefined) =>
    v == null || v <= 0 ? '—' : `${v.toFixed(2)}″`;

  const empty = !focus;
  const p = focus?.props;
  const stale = focus?.isStale === true;

  // Common container: docks bottom-right at md+, bottom-full-width on mobile.
  // Opacity dips to 65% when stale so the eye knows the data is "last seen"
  // rather than "live." Pointer events stay live so the user can tap × or
  // expand on mobile even while stale.
  // All theme-aware classes read from the token system in globals.css
  // (--card, --card-foreground, --border, --muted-foreground, etc.) so the
  // panel flips automatically on light/dark without any JS branching.
  const wrapper = [
    'absolute z-20 transition-opacity duration-150',
    // Mobile: pinned to bottom, full width (minus small side gutter).
    'bottom-2 left-2 right-2',
    // Desktop: corner card.
    'md:left-auto md:right-3 md:bottom-3 md:w-[260px]',
    stale ? 'opacity-65' : 'opacity-100',
  ].join(' ');

  const card = [
    'rounded-lg border border-border bg-card/95 text-card-foreground shadow-lg backdrop-blur-sm',
    'text-[12px]',
  ].join(' ');

  if (empty) {
    return (
      <div className={wrapper}>
        <div className={`${card} px-3 py-2.5 flex items-center gap-2`}>
          <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />
          <span className="text-muted-foreground">Tap a hex to explore</span>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapper}>
      <div className={card}>
        {/* Header — hex id + dismiss. Dismiss is a 44x44 touch target on
            mobile but visually compact. */}
        <div className="flex items-center justify-between px-3 pt-2 pb-1.5 border-b border-border">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-card-foreground">Hex r{activeRes}</span>
            {focus!.pinned && (
              <span className="text-[9px] uppercase tracking-wider text-primary font-medium">
                Pinned
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Mobile-only expand chevron */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="md:hidden min-w-[44px] min-h-[32px] -mr-1.5 px-2 py-1 text-muted-foreground hover:text-foreground"
              aria-label={expanded ? 'Collapse hex details' : 'Expand hex details'}
              aria-expanded={expanded}
            >
              <svg
                className={`w-4 h-4 mx-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="min-w-[44px] min-h-[32px] md:min-w-0 md:min-h-0 md:w-6 md:h-6 -mr-1.5 md:mr-0 px-2 md:px-0 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss hex details"
            >
              <svg className="w-4 h-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile: compact row (3 metrics) — shown when collapsed.
            Hidden entirely on md+ (desktop jumps straight to the full grid). */}
        {!expanded && (
          <div className="md:hidden flex items-stretch divide-x divide-border">
            <MiniStat label="Properties" value={p!.n.toLocaleString()} />
            <MiniStat label="p50 / p90" value={`${fmt(p!.p50)} / ${fmt(p!.p90)}`} />
            <MiniStat label="Dormant" value={p!.dormantCount.toLocaleString()} />
          </div>
        )}

        {/* Full grid — always visible on desktop, expanded-only on mobile.
            Tailwind emits responsive variants inside a media block that comes
            after base utilities, so `md:grid` reliably overrides `hidden` at
            md+ regardless of source order. */}
        <dl
          className={[
            expanded ? 'grid' : 'hidden',
            'md:grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2',
          ].join(' ')}
        >
          <dt className="text-muted-foreground">Properties</dt>
          <dd className="text-right font-medium text-foreground">{p!.n.toLocaleString()}</dd>

          <dt className="text-muted-foreground">Lead score p50 / p90</dt>
          <dd className="text-right font-medium text-foreground">
            {fmt(p!.p50)} / {fmt(p!.p90)}
          </dd>

          <dt className="text-muted-foreground">Score max</dt>
          <dd className="text-right font-medium text-foreground">{fmt(p!.scoreMax)}</dd>

          <dt className="text-muted-foreground">Avg roof age</dt>
          <dd className="text-right font-medium text-foreground">
            {p!.avgRoofAge == null ? '—' : `${p!.avgRoofAge.toFixed(1)} yr`}
          </dd>

          <dt className="text-muted-foreground">Dormant count</dt>
          <dd className="text-right font-medium text-foreground">
            {p!.dormantCount.toLocaleString()}
          </dd>

          <dt className="text-muted-foreground">Max hail</dt>
          <dd className="text-right font-medium text-foreground">{fmtHail(p!.hailMaxInches)}</dd>

          <dt className="col-span-2 text-[10px] font-mono text-muted-foreground/70 pt-1" title={p!.h3Cell}>
            {p!.h3Cell}
          </dt>
        </dl>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 px-3 py-2 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="text-[13px] font-semibold text-foreground truncate">{value}</div>
    </div>
  );
}

interface LegendRow {
  key: BucketKey;
  color: string;
  label: string;
  range: string;
}

const LEGEND_ROWS: LegendRow[] = [
  { key: 'dormant', color: '#78350f', label: 'Dormant',  range: 'storm-exposed, no claim' },
  { key: 'blazing', color: '#b91c1c', label: 'Blazing',  range: 'score ≥ 85' },
  { key: 'hot',     color: '#ea580c', label: 'Hot',      range: '70–84' },
  { key: 'warm',    color: '#f59e0b', label: 'Warm',     range: '50–69' },
  { key: 'low',     color: '#fde68a', label: 'Low',      range: '31–49' },
];

function LeadScoreLegend({
  scoresOn, onToggleScores,
  filters, onToggleBucket,
  counts, totalCount,
}: {
  scoresOn: boolean;
  onToggleScores: () => void;
  filters: BucketFilters;
  onToggleBucket: (key: BucketKey) => void;
  counts: Record<BucketKey, number>;
  totalCount: number;
}) {
  // Default OPEN — the heat-map toggle + bucket filters live here, so the
  // panel needs to be immediately discoverable. Collapsing is optional.
  const [open, setOpen] = useState(true);

  if (!open) {
    // Collapsed pill: still clearly a 'legend' control (labeled + color-stripe
    // preview) so the user can find their way back in without hunting.
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-2 rounded-full bg-card/95 border border-border shadow-sm px-3 py-1.5 text-[12px] font-medium text-card-foreground hover:bg-card hover:brightness-110 transition-colors"
        title="Show lead-score legend"
        aria-label="Show lead-score legend"
      >
        <span className="inline-flex items-center">
          {LEGEND_ROWS.map((r) => (
            <span
              key={r.key}
              className="inline-block h-2.5 w-2.5 first:rounded-l-sm last:rounded-r-sm border-y border-border first:border-l last:border-r"
              style={{ background: r.color }}
            />
          ))}
        </span>
        <span>Legend</span>
        <svg className="w-3 h-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }

  return (
    <div className="absolute top-3 right-3 z-10 w-56 rounded-md bg-card/95 border border-border shadow-sm text-[12px] text-card-foreground">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full flex items-center justify-between px-3 py-2 font-medium hover:bg-muted rounded-t-md"
      >
        <span>Lead scores {totalCount ? `(${totalCount})` : ''}</span>
        <svg
          className="w-3.5 h-3.5 text-muted-foreground"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          aria-label="Close"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <div className="border-t border-border px-3 py-2 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={scoresOn}
              onChange={onToggleScores}
              // `accent-color` is the modern way to tint native checkboxes
              // from a CSS variable, so the checkmark color flips with theme.
              className="h-3.5 w-3.5 rounded border-border focus:ring-2 focus:ring-ring"
              style={{ accentColor: 'hsl(var(--primary))' }}
            />
            <span className="font-medium text-foreground">Color buildings by score</span>
          </label>
          <div className={`space-y-1 ${scoresOn ? '' : 'opacity-40 pointer-events-none'}`}>
            {LEGEND_ROWS.map((row) => (
              <label
                key={row.key}
                className="flex items-center gap-2 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={filters[row.key]}
                  onChange={() => onToggleBucket(row.key)}
                  className="h-3.5 w-3.5 rounded border-border focus:ring-2 focus:ring-ring"
                  style={{ accentColor: 'hsl(var(--primary))' }}
                />
                <span
                  // Bucket swatch colors stay hardcoded — they're score-severity
                  // signal, not theme. The border uses the token so the swatch
                  // chrome blends with whichever surface is underneath.
                  className="inline-block h-3 w-3 rounded-sm border border-border flex-shrink-0"
                  style={{ background: row.color }}
                />
                <span className="flex-1 flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium text-foreground">{row.label}</span>{' '}
                    <span className="text-muted-foreground">· {row.range}</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">{counts[row.key]}</span>
                </span>
              </label>
            ))}
        </div>
      </div>
    </div>
  );
}
