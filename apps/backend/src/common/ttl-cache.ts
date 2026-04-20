/**
 * Tiny TTL + size-bounded cache. No dependencies.
 *
 * - get() returns the value if present AND not expired, else undefined (and evicts)
 * - set() evicts oldest entries when over capacity (insertion-order Map)
 * - Safe for hot-path use; zero allocations on hit
 */
export class TtlCache<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number = 128,
    private readonly ttlMs: number = 60_000,
  ) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Bump to most-recently-used by re-inserting
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlOverrideMs?: number): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlOverrideMs ?? this.ttlMs),
    });
    // Evict oldest (first-inserted) if over capacity
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Quantize a bbox into a stable cache key so tiny pans hit the same key.
 * precision = 0.01° ≈ 1.1 km snap, generous enough to merge jittery pans.
 */
export function bboxKey(
  north: number,
  south: number,
  east: number,
  west: number,
  precision = 0.01,
): string {
  const q = (n: number) => Math.round(n / precision) * precision;
  return `${q(north).toFixed(3)},${q(south).toFixed(3)},${q(east).toFixed(3)},${q(west).toFixed(3)}`;
}
