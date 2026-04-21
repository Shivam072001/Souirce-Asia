import type { Request, Response } from "express";
import { RateLimiterService } from "../services/rateLimiterService";
import { StatsService } from "../services/statsService";
import { enqueueRequest } from "../services/queueService";
import type { IncomingRequest } from "../types";

const rateLimiter = new RateLimiterService();
const stats = new StatsService();

export class RequestController {
  async submit(req: Request, res: Response): Promise<void> {
    const body = req.body as Partial<IncomingRequest>;

    if (!body.user_id || typeof body.user_id !== "string") {
      res.status(400).json({
        error: "Bad Request",
        message: "user_id is required and must be a string",
      });
      return;
    }

    const userId = body.user_id.trim();
    if (userId.length === 0 || userId.length > 128) {
      res.status(400).json({
        error: "Bad Request",
        message: "user_id must be between 1 and 128 characters",
      });
      return;
    }

    const { user_id: _, ...payload } = body;

    try {
      const result = await rateLimiter.check(userId);

      res.set({
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Window-Ms": String(result.windowMs),
      });

      if (result.allowed) {
        await stats.recordAccepted(userId);

        res.status(200).json({
          status: "accepted",
          message: "Request processed successfully",
          rate_limit: {
            remaining: result.remaining,
            limit: result.limit,
            window_ms: result.windowMs,
          },
        });
        return;
      }

      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      res.set("Retry-After", String(retryAfterSec));

      const jobId = await enqueueRequest(
        userId,
        payload as Record<string, unknown>
      );
      await stats.recordRejected(userId);
      await stats.recordQueued(userId);

      res.status(429).json({
        status: "rate_limited",
        message: `Rate limit exceeded. Max ${result.limit} requests per ${result.windowMs / 1000}s. Request queued for retry.`,
        queued: {
          job_id: jobId,
          max_retries: 3,
        },
        rate_limit: {
          remaining: 0,
          limit: result.limit,
          window_ms: result.windowMs,
          retry_after_ms: result.retryAfterMs,
        },
      });
    } catch (err) {
      console.error("[RequestController] submit error:", err);
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to process request",
      });
    }
  }
}
