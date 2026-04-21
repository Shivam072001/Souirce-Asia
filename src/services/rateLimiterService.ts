import { config } from "../config";
import { RateLimitRepository } from "../repositories/rateLimitRepository";
import type { RateLimitResult } from "../types";

/**
 * Sliding window log algorithm.
 *
 * Each request adds a timestamped entry to a Redis sorted set.
 * We prune expired entries, count remaining, and decide allow/deny.
 * More accurate than fixed-window counters which allow 2x burst at boundaries.
 */
export class RateLimiterService {
  constructor(private readonly repo = new RateLimitRepository()) {}

  async check(userId: string): Promise<RateLimitResult> {
    const { maxRequests, windowMs } = config.rateLimit;
    const now = Date.now();
    const windowStart = now - windowMs;

    const { currentCount, oldestTimestamp } = await this.repo.getWindowState(
      userId,
      windowStart
    );

    const allowed = currentCount < maxRequests;

    let retryAfterMs = 0;
    if (!allowed && oldestTimestamp !== null) {
      retryAfterMs = Math.max(0, oldestTimestamp + windowMs - now);
    }

    if (allowed) {
      await this.repo.addEntry(userId, now, windowMs);
    }

    return {
      allowed,
      remaining: Math.max(0, maxRequests - currentCount - (allowed ? 1 : 0)),
      limit: maxRequests,
      retryAfterMs,
      windowMs,
    };
  }
}
