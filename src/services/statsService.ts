import { StatsRepository } from "../repositories/statsRepository";
import type { UserStats } from "../types";

export class StatsService {
  constructor(private readonly repo = new StatsRepository()) {}

  async recordAccepted(userId: string): Promise<void> {
    await this.repo.incrementAccepted(userId);
  }

  async recordRejected(userId: string): Promise<void> {
    await this.repo.incrementRejected(userId);
  }

  async recordQueued(userId: string): Promise<void> {
    await this.repo.incrementQueued(userId);
  }

  async recordProcessedFromQueue(userId: string): Promise<void> {
    await this.repo.incrementProcessedFromQueue(userId);
  }

  async getByUserId(userId: string): Promise<UserStats> {
    const raw = await this.repo.findByUserId(userId);
    return this.toUserStats(userId, raw);
  }

  async getAll(): Promise<UserStats[]> {
    const rows = await this.repo.findAll();
    return rows.map(({ userId, raw }) => this.toUserStats(userId, raw));
  }

  private toUserStats(
    userId: string,
    raw: Record<string, string>
  ): UserStats {
    return {
      user_id: userId,
      total_requests: parseInt(raw.total_requests || "0", 10),
      accepted: parseInt(raw.accepted || "0", 10),
      rejected: parseInt(raw.rejected || "0", 10),
      queued: parseInt(raw.queued || "0", 10),
      processed_from_queue: parseInt(raw.processed_from_queue || "0", 10),
      last_request_at: raw.last_request_at || null,
    };
  }
}
