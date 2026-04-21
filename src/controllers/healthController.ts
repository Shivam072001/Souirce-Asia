import type { Request, Response } from "express";
import { getRedisClient } from "../services/redis";

export class HealthController {
  async check(_req: Request, res: Response): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.ping();

      res.json({
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        redis: "connected",
      });
    } catch {
      res.status(503).json({
        status: "unhealthy",
        redis: "disconnected",
      });
    }
  }
}
