import type { Request, Response } from "express";
import { StatsService } from "../services/statsService";

const stats = new StatsService();

export class StatsController {
  async get(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.query.user_id as string | undefined;

      if (userId) {
        const data = await stats.getByUserId(userId.trim());
        res.json({ data });
        return;
      }

      const allStats = await stats.getAll();
      res.json({
        data: allStats,
        total_users: allStats.length,
      });
    } catch (err) {
      console.error("[StatsController] get error:", err);
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to retrieve stats",
      });
    }
  }
}
