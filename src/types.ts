export interface IncomingRequest {
  user_id: string;
  [key: string]: unknown;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
  windowMs: number;
}

export interface UserStats {
  user_id: string;
  total_requests: number;
  accepted: number;
  rejected: number;
  queued: number;
  processed_from_queue: number;
  last_request_at: string | null;
}

export interface QueuedJob {
  user_id: string;
  payload: Record<string, unknown>;
  original_timestamp: number;
  attempt: number;
}
