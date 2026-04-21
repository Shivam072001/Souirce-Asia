import { Queue, Worker, type Job } from "bullmq";
import { config } from "../config";
import { RateLimiterService } from "./rateLimiterService";
import { StatsService } from "./statsService";
import type { QueuedJob } from "../types";

const QUEUE_NAME = "rate-limited-requests";

let queue: Queue | null = null;
let worker: Worker | null = null;

const rateLimiter = new RateLimiterService();
const stats = new StatsService();

function redisConnection() {
  return {
    host: config.redis.host,
    port: config.redis.port,
    username: config.redis.username,
    password: config.redis.password,
    maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
  };
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: config.queue.maxRetries,
        backoff: {
          type: "exponential",
          delay: config.queue.retryDelayMs,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return queue;
}

async function processJob(job: Job<QueuedJob>): Promise<void> {
  const { user_id, payload } = job.data;
  const result = await rateLimiter.check(user_id);

  if (!result.allowed) {
    const retryDelay = Math.max(result.retryAfterMs, config.queue.retryDelayMs);
    console.log(
      `[Queue] Job ${job.id} for user ${user_id} still rate-limited. ` +
        `Retry in ${retryDelay}ms (attempt ${job.attemptsMade + 1}/${config.queue.maxRetries})`
    );
    throw new Error(
      `Rate limit active for ${user_id}, retry after ${retryDelay}ms`
    );
  }

  console.log(
    `[Queue] Processing queued request for user ${user_id}:`,
    JSON.stringify(payload).slice(0, 200)
  );

  await stats.recordAccepted(user_id);
  await stats.recordProcessedFromQueue(user_id);
}

export function startWorker(): void {
  if (worker) return;

  worker = new Worker(QUEUE_NAME, processJob, {
    connection: redisConnection(),
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  });

  worker.on("completed", (job) => {
    console.log(`[Queue] Job ${job.id} completed for user ${job.data.user_id}`);
  });

  worker.on("failed", (job, err) => {
    if (job) {
      console.warn(
        `[Queue] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`
      );
    }
  });

  worker.on("error", (err) => {
    console.error("[Queue] Worker error:", err.message);
  });

  console.log("[Queue] Worker started");
}

export async function enqueueRequest(
  userId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const job = await getQueue().add("process-request", {
    user_id: userId,
    payload,
    original_timestamp: Date.now(),
    attempt: 0,
  } satisfies QueuedJob);

  return job.id ?? "unknown";
}

export async function closeQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
