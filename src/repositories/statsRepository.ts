import { getRedisClient } from "../services/redis";

const KEY_PREFIX = "stats:";
const USERS_SET = "stats:known_users";

export interface RawUserStats {
  total_requests: string;
  accepted: string;
  rejected: string;
  queued: string;
  processed_from_queue: string;
  last_request_at: string;
}

export class StatsRepository {
  private keyFor(userId: string): string {
    return `${KEY_PREFIX}${userId}`;
  }

  async incrementAccepted(userId: string): Promise<void> {
    const redis = getRedisClient();
    const key = this.keyFor(userId);
    await redis
      .pipeline()
      .hincrby(key, "total_requests", 1)
      .hincrby(key, "accepted", 1)
      .hset(key, "last_request_at", new Date().toISOString())
      .sadd(USERS_SET, userId)
      .exec();
  }

  async incrementRejected(userId: string): Promise<void> {
    const redis = getRedisClient();
    const key = this.keyFor(userId);
    await redis
      .pipeline()
      .hincrby(key, "total_requests", 1)
      .hincrby(key, "rejected", 1)
      .hset(key, "last_request_at", new Date().toISOString())
      .sadd(USERS_SET, userId)
      .exec();
  }

  async incrementQueued(userId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.hincrby(this.keyFor(userId), "queued", 1);
  }

  async incrementProcessedFromQueue(userId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.hincrby(this.keyFor(userId), "processed_from_queue", 1);
  }

  async findByUserId(userId: string): Promise<Record<string, string>> {
    const redis = getRedisClient();
    return redis.hgetall(this.keyFor(userId));
  }

  async findAllUserIds(): Promise<string[]> {
    const redis = getRedisClient();
    return redis.smembers(USERS_SET);
  }

  async findAll(): Promise<{ userId: string; raw: Record<string, string> }[]> {
    const redis = getRedisClient();
    const userIds = await this.findAllUserIds();
    if (userIds.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of userIds) {
      pipeline.hgetall(this.keyFor(id));
    }

    const results = await pipeline.exec();
    if (!results) return [];

    return userIds.map((userId, i) => ({
      userId,
      raw: (results[i][1] as Record<string, string>) || {},
    }));
  }
}
