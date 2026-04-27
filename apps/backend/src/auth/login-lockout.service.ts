import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory per-email login-failure tracker. Defends against credential
 * stuffing attacks that hit a single account from many IPs (the IP-based
 * @Throttle decorator on /login does not stop these — different IPs are
 * different rate buckets).
 *
 * State is process-local. With PM2 cluster mode (multiple worker
 * processes), each worker tracks its own counter — that's a soft cap, not
 * a hard one, but still raises the cost of credential-stuffing significantly.
 *
 * For a hard cap that survives restarts and shares across workers, this
 * should move to Redis. Filed as follow-up.
 *
 * Threshold: 10 failures within 15 minutes per email → 15-minute lockout.
 * Lockout extends on additional failures during the lockout window.
 */
@Injectable()
export class LoginLockoutService {
  private readonly logger = new Logger(LoginLockoutService.name);

  private static readonly WINDOW_MS = 15 * 60 * 1000; // 15 min
  private static readonly THRESHOLD = 10;
  private static readonly LOCKOUT_MS = 15 * 60 * 1000;
  private static readonly MAX_ENTRIES = 10_000;

  // emailLower -> { failures: timestamps[], lockedUntil: ms }
  private state = new Map<string, { failures: number[]; lockedUntil: number }>();

  /** Throw-or-not check before bcrypt. Returns ms remaining if locked. */
  isLocked(email: string): number {
    const entry = this.state.get(email.toLowerCase());
    if (!entry) return 0;
    const now = Date.now();
    if (entry.lockedUntil > now) return entry.lockedUntil - now;
    return 0;
  }

  recordFailure(email: string): void {
    const key = email.toLowerCase();
    const now = Date.now();
    const entry = this.state.get(key) || { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => now - t < LoginLockoutService.WINDOW_MS);
    entry.failures.push(now);
    if (entry.failures.length >= LoginLockoutService.THRESHOLD) {
      entry.lockedUntil = now + LoginLockoutService.LOCKOUT_MS;
      this.logger.warn(`Login lockout engaged for ${key} (${entry.failures.length} failures in window)`);
      entry.failures = [];
    }
    // Bump-on-touch: delete-then-set so re-insertion moves the key to
    // the tail of insertion order. Eviction (oldest 10%) then truly
    // pops the least-recently-touched entries — without this, a
    // determined attacker can churn 10k throwaway emails to push a
    // target's entry out of the map and reset their counter.
    this.state.delete(key);
    this.state.set(key, entry);
    this.evictIfTooLarge();
  }

  recordSuccess(email: string): void {
    this.state.delete(email.toLowerCase());
  }

  private evictIfTooLarge(): void {
    if (this.state.size <= LoginLockoutService.MAX_ENTRIES) return;
    // Evict the oldest 10%. Cheap LRU-ish trim.
    const trim = Math.ceil(this.state.size * 0.1);
    let i = 0;
    for (const k of this.state.keys()) {
      if (i++ >= trim) break;
      this.state.delete(k);
    }
  }
}
