export const config = {
  port: parseInt(process.env.PORT || "3000", 10),

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null as null,
  },

  rateLimit: {
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || "5", 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  },

  queue: {
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || "3", 10),
    retryDelayMs: parseInt(process.env.QUEUE_RETRY_DELAY_MS || "10000", 10),
  },
} as const;
