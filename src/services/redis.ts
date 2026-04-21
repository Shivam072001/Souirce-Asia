import Redis from "ioredis";
import { config } from "../config";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      username: config.redis.username,
      password: config.redis.password,
      maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
    });

    client.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    client.on("connect", () => {
      console.log("[Redis] Connected");
    });
  }

  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
