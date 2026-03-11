interface WindowState {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  count: number;
  remaining: number;
  resetAt: number;
}

interface FixedWindowRateLimiterOptions {
  maxEntries?: number;
  pruneEveryHits?: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, WindowState>();

  private hitCounter = 0;

  private readonly maxEntries: number;

  private readonly pruneEveryHits: number;

  public constructor(options?: FixedWindowRateLimiterOptions) {
    this.maxEntries = options?.maxEntries && options.maxEntries > 0 ? Math.floor(options.maxEntries) : 10_000;
    this.pruneEveryHits =
      options?.pruneEveryHits && options.pruneEveryHits > 0 ? Math.floor(options.pruneEveryHits) : 250;
  }

  public hit(input: { key: string; limit: number; windowMs: number; now?: number }): RateLimitResult {
    const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
    const limit = input.limit > 0 ? Math.floor(input.limit) : 1;
    const windowMs = input.windowMs > 0 ? Math.floor(input.windowMs) : 1_000;

    const existing = this.windows.get(input.key);
    if (!existing || existing.resetAt <= now) {
      const next: WindowState = {
        count: 1,
        resetAt: now + windowMs,
      };
      this.windows.set(input.key, next);
      this.scheduleMaintenance(now);
      return {
        allowed: true,
        limit,
        count: next.count,
        remaining: Math.max(0, limit - next.count),
        resetAt: next.resetAt,
      };
    }

    existing.count += 1;
    this.scheduleMaintenance(now);
    return {
      allowed: existing.count <= limit,
      limit,
      count: existing.count,
      remaining: Math.max(0, limit - existing.count),
      resetAt: existing.resetAt,
    };
  }

  private scheduleMaintenance(now: number): void {
    this.hitCounter += 1;
    if (this.windows.size <= this.maxEntries && this.hitCounter % this.pruneEveryHits !== 0) {
      return;
    }

    this.prune(now);
  }

  private prune(now: number): void {
    for (const [key, state] of this.windows.entries()) {
      if (state.resetAt <= now) {
        this.windows.delete(key);
      }
    }

    if (this.windows.size <= this.maxEntries) {
      return;
    }

    const overflow = this.windows.size - this.maxEntries;
    let removed = 0;
    for (const key of this.windows.keys()) {
      this.windows.delete(key);
      removed += 1;
      if (removed >= overflow) {
        break;
      }
    }
  }
}
