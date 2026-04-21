import { getRedisClient } from "../services/redis";

const KEY_PREFIX = "rl:";

export interface SlidingWindowState {
  currentCount: number;
  oldestTimestamp: number | null;
}

export class RateLimitRepository {
  private keyFor(userId: string): string {
    return `${KEY_PREFIX}${userId}`;
  }

  async getWindowState(
    userId: string,
    windowStart: number
  ): Promise<SlidingWindowState> {
    const redis = getRedisClient();
    const key = this.keyFor(userId);

    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    pipeline.zrange(key, 0, 0, "WITHSCORES");

    const results = await pipeline.exec();
    if (!results) throw new Error("Redis pipeline failed");

    const currentCount = results[1][1] as number;

    let oldestTimestamp: number | null = null;
    const oldestEntry = results[2][1] as string[];
    if (oldestEntry.length >= 2) {
      oldestTimestamp = parseInt(oldestEntry[1], 10);
    }

    return { currentCount, oldestTimestamp };
  }

  async addEntry(
    userId: string,
    timestamp: number,
    windowMs: number
  ): Promise<void> {
    const redis = getRedisClient();
    const key = this.keyFor(userId);
    const member = `${timestamp}:${Math.random().toString(36).slice(2, 8)}`;

    await redis
      .pipeline()
      .zadd(key, timestamp, member)
      .pexpire(key, windowMs)
      .exec();
  }
}
