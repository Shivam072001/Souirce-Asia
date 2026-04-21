# Rate Limiter API Service

A production-ready rate-limiting API built with **TypeScript**, **Express**, **Redis**, and **BullMQ**.

---

**LIVE -** [https://souirce-asia.onrender.com](https://souirce-asia.onrender.com/health)
## Features

- **Sliding window rate limiting** — 5 requests per user per minute (configurable)
- **Automatic request queueing** — rate-limited requests are queued and retried via BullMQ
- **Per-user stats** — real-time tracking of accepted, rejected, and queued requests
- **Graceful shutdown** — clean connection teardown on SIGTERM/SIGINT
- **Health check endpoint** — with Redis connectivity status
- **Docker Compose deployment** — single command to run the full stack
- **Standard rate-limit headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`

---

## Architecture

### Layered Architecture

The codebase follows a strict **Repository → Service → Controller → Router → Server** pattern where each layer has a single responsibility and only depends on the layer below it.

```
HTTP Request
  │
  ▼
┌──────────────────────────────────────────────────────┐
│  Server  (server.ts)                                 │
│  Express app, middleware, route mounting, lifecycle  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Routers  (routes/)                            │  │
│  │  Map URL paths to controller methods           │  │
│  │                                                │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │  Controllers  (controllers/)             │  │  │
│  │  │  Validate input, call services,          │  │  │
│  │  │  format HTTP responses                   │  │  │
│  │  │                                          │  │  │
│  │  │  ┌────────────────────────────────────┐  │  │  │
│  │  │  │  Services  (services/)             │  │  │  │
│  │  │  │  Business logic, orchestration     │  │  │  │
│  │  │  │                                    │  │  │  │
│  │  │  │  ┌──────────────────────────────┐  │  │  │  │
│  │  │  │  │  Repositories  (repos/)      │  │  │  │  │
│  │  │  │  │  Raw Redis data access       │  │  │  │  │
│  │  │  │  └──────────────────────────────┘  │  │  │  │
│  │  │  └────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

| Layer | Directory | Responsibility | Knows about |
|---|---|---|---|
| **Repository** | `repositories/` | Raw Redis reads/writes (sorted sets, hashes, sets) | Redis only |
| **Service** | `services/` | Business logic — rate limit algorithm, stats aggregation, queue orchestration | Repositories |
| **Controller** | `controllers/` | Parse HTTP input, validate, call services, format HTTP response | Services |
| **Router** | `routes/` | Map URL + method → controller method. Zero logic. | Controllers |
| **Server** | `server.ts` | Express app creation, middleware, mount routers, graceful lifecycle | Routers |
| **Entry** | `index.ts` | Load env, boot server | Server |

### Request Flow

```
POST /request
  │
  Router ──→ RequestController.submit()
                │
                ├─ Validate user_id
                │
                ├─ RateLimiterService.check(userId)
                │     ├─ RateLimitRepository.getWindowState() ──→ Redis ZREMRANGEBYSCORE, ZCARD, ZRANGE
                │     └─ [if allowed] RateLimitRepository.addEntry() ──→ Redis ZADD, PEXPIRE
                │
                ├─ Set X-RateLimit Headers
                │
                ├─ [if allowed]  StatsService.recordAccepted()
                │                  └─ StatsRepository.incrementAccepted() ──→ Redis HINCRBY
                │
                └─ [if denied]   Set Retry-After Header
                                 QueueService.enqueueRequest() ──→ BullMQ Queue
                                 StatsService.recordRejected()
                                 StatsService.recordQueued()
```

### Rate Limiting Algorithm

Uses the **sliding window log** pattern with Redis sorted sets:

1. On each request, remove all entries older than the window (60s)
2. Count remaining entries in the sorted set
3. If count < limit → allow and add a new timestamped entry
4. If count >= limit → reject with 429 and queue for retry

This is more accurate than fixed-window counters, which suffer from burst issues at window boundaries. The tradeoff is slightly higher memory usage per user (one sorted set member per request vs. a single counter).

### Queue & Retry Logic

When a request is rate-limited:
1. The client receives a **429** immediately with `Retry-After` header
2. The request is added to a **BullMQ queue** backed by Redis
3. A background worker picks it up and retries with **exponential backoff**
4. The worker re-checks the rate limit before processing
5. After max retries (default: 3), the job moves to the failed set

---

## API Reference

### `POST /request`

Submit a request for processing.

**Request body:**
```json
{
  "user_id": "user_123",
  "action": "send_email",
  "data": { "to": "test@example.com" }
}
```

**Example cURL:**
```bash
curl -X POST https://souirce-asia.onrender.com/request \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user_123", "action": "send_email", "data": {"to": "test@example.com"}}'
```

**Success (200):**
```json
{
  "status": "accepted",
  "message": "Request processed successfully",
  "rate_limit": {
    "remaining": 4,
    "limit": 5,
    "window_ms": 60000
  }
}
```

**Rate limited (429):**
```json
{
  "status": "rate_limited",
  "message": "Rate limit exceeded. Max 5 requests per 60s. Request queued for retry.",
  "queued": {
    "job_id": "12",
    "max_retries": 3
  },
  "rate_limit": {
    "remaining": 0,
    "limit": 5,
    "window_ms": 60000,
    "retry_after_ms": 42000
  }
}
```

**Response headers (always present):**
| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Max requests per window |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Window-Ms` | Window duration in milliseconds |
| `Retry-After` | Seconds until retry (only on 429) |

### `GET /stats`

Get per-user request statistics.

**All users:** `GET /stats`

**Example cURL:**
```bash
curl https://souirce-asia.onrender.com/stats
```

```json
{
  "data": [
    {
      "user_id": "user_123",
      "total_requests": 15,
      "accepted": 10,
      "rejected": 5,
      "queued": 5,
      "processed_from_queue": 3,
      "last_request_at": "2026-04-21T10:30:00.000Z"
    }
  ],
  "total_users": 1
}
```

**Single user:** `GET /stats?user_id=user_123`

**Example cURL:**
```bash
curl "https://souirce-asia.onrender.com/stats?user_id=user_123"
```

```json
{
  "data": {
    "user_id": "user_123",
    "total_requests": 15,
    "accepted": 10,
    "rejected": 5,
    "queued": 5,
    "processed_from_queue": 3,
    "last_request_at": "2026-04-21T10:30:00.000Z"
  }
}
```

### `GET /health`

**Example cURL:**
```bash
curl https://souirce-asia.onrender.com/health
```

```json
{
  "status": "healthy",
  "uptime": 120.5,
  "timestamp": "2026-04-21T10:30:00.000Z",
  "redis": "connected"
}
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **Redis** >= 6 (or use the included Docker Compose)
- **Docker + Docker Compose** (for containerized deployment)

### Option 1: Docker Compose (recommended)

```bash
# Clone and enter the directory
cd Backend

# (Optional) customize config
cp .env.example .env

# Start everything
docker compose up --build
```

The API will be available at `https://souirce-asia.onrender.com`.

### Option 2: Local Development

```bash
cd Backend

# Install dependencies
npm install

# Start Redis (must be running on localhost:6379)
# e.g. via Docker: docker run -d -p 6379:6379 redis:7-alpine

# Copy and configure environment
cp .env.example .env

# Run in development mode (hot reload)
npm run dev

# Or build and run production
npm run build
npm start
```

### Quick Test

```bash
# Send a request
curl -X POST https://souirce-asia.onrender.com/request \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test_user", "action": "demo"}'

# Check stats
curl https://souirce-asia.onrender.com/stats

# Health check
curl https://souirce-asia.onrender.com/health

# Trigger rate limit (run 6+ times quickly)
for i in $(seq 1 7); do
  curl -s -X POST https://souirce-asia.onrender.com/request \
    -H "Content-Type: application/json" \
    -d '{"user_id": "test_user"}' | jq .status
done
```

---

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_USERNAME` | *(empty)* | Redis username |
| `REDIS_PASSWORD` | *(empty)* | Redis password |
| `RATE_LIMIT_MAX` | `5` | Max requests per window per user |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms (60s) |
| `QUEUE_MAX_RETRIES` | `3` | Max retry attempts for queued jobs |
| `QUEUE_RETRY_DELAY_MS` | `10000` | Base retry delay (exponential backoff) |

---

## Design Decisions

### Why Repository → Service → Controller → Router → Server?

- **Testability** — each layer can be unit-tested in isolation by mocking the layer below (e.g., mock the repository to test the service without Redis)
- **Separation of concerns** — Redis key schemas live in one place (repositories), business rules in another (services), and HTTP formatting in a third (controllers). Changing the data store means only rewriting the repository layer.
- **Readability** — any developer can trace a request top-down through 5 clear layers without mental context-switching between HTTP, business logic, and data access in the same file
- **Scalability** — as the service grows (e.g., add PostgreSQL for auditing), new repositories slot in without touching controllers or routes

### Why TypeScript + Express?

- Strong typing catches bugs at compile time, critical for a rate-limiting service where off-by-one errors have outsized impact
- Express is the most battle-tested Node.js HTTP framework with minimal overhead
- Excellent Redis ecosystem (ioredis) and queue library (BullMQ) in the Node.js world

### Why Sliding Window Log over Fixed Window?

Fixed-window counters (e.g., "reset at the top of each minute") allow up to 2x the limit at window boundaries. A user could send 5 requests at 0:59 and 5 more at 1:00 — 10 within 2 seconds. The sliding window log eliminates this by tracking exact timestamps. The cost is ~40 bytes per request entry in Redis vs. a single integer, which is negligible at the scale this service targets.

### Why BullMQ?

- Redis-backed, so no additional infrastructure beyond what we already need
- Built-in exponential backoff, dead-letter handling, and job lifecycle events
- Battle-tested in production (used by companies like Automattic and Vendure)
- The worker re-checks the rate limit before processing a queued job, so it won't bypass the limiter

### Why queue on 429 instead of just rejecting?

Purely rejecting is simpler, but offering automatic retry is more useful for the caller:
- The client gets an immediate 429 so it knows the request was rate-limited
- The request is still queued and will be processed when the window opens
- Stats track both `rejected` and `queued` so operators have full visibility

### Redis Key Design

| Key Pattern | Type | Purpose |
|---|---|---|
| `rl:{user_id}` | Sorted Set | Sliding window entries (score = timestamp) |
| `stats:{user_id}` | Hash | Per-user counters |
| `stats:known_users` | Set | Index of all user IDs for the `/stats` endpoint |
| `bull:rate-limited-requests:*` | Various | BullMQ internal keys |

---

## Known Limitations

1. **No authentication/authorization** — the `user_id` is trusted from the request body. In production, this should come from a verified JWT or API key, not client-submitted data.

2. **No persistent storage** — all data lives in Redis. If Redis is flushed or crashes without AOF persistence, stats and rate limit state are lost. The Docker Compose config enables AOF, but a production deployment should use Redis Sentinel or Cluster for HA.

3. **Single-node queue worker** — the BullMQ worker runs in the same process as the API. For higher throughput, workers should be separate processes/containers that can scale independently.

4. **No request deduplication** — if the same payload is submitted twice, both are processed independently. An idempotency key mechanism would be needed for exactly-once semantics.

5. **Stats are append-only** — there's no TTL or rotation on stats counters. Over very long periods, the `stats:known_users` set and per-user hashes grow unbounded (though each entry is tiny).

6. **No TLS termination** — the API serves plain HTTP. In production, place it behind a reverse proxy (nginx, Caddy, or a cloud load balancer) for HTTPS.

7. **Memory-bound rate limit data** — each request in the sliding window occupies ~40 bytes in Redis. At 5 req/min per user, even 1M concurrent users would use ~200MB, well within a small Redis instance.

---

## What I Would Improve With More Time

1. **Authentication layer** — JWT or API key validation middleware, so `user_id` is derived from the token rather than trusted from the body.

2. **Distributed rate limiting** — use Redis Cluster or a dedicated rate-limiting service (like Envoy's ratelimit) for multi-region deployments.

3. **Prometheus metrics** — expose `/metrics` endpoint with counters for requests, rate limits, queue depth, and processing latency. Wire up Grafana dashboards.

4. **Request persistence** — store processed request payloads in PostgreSQL or MongoDB for audit trails, with the Redis layer purely for rate limiting and queueing.

5. **API versioning** — prefix routes with `/v1/` to allow non-breaking API evolution.

6. **Comprehensive test suite** — unit tests for the rate limiter (mock Redis), integration tests with a real Redis instance via testcontainers, and load tests with k6 or Artillery.

7. **Circuit breaker** — if Redis goes down, the API should degrade gracefully (e.g., allow all requests with a warning) rather than returning 500s.

8. **WebSocket or SSE for job status** — let clients subscribe to their queued job's progress instead of polling.

9. **Rate limit tiers** — support different limits per user tier (free: 5/min, pro: 100/min) configurable via a database or config file.

10. **Admin dashboard** — a simple UI to view stats, manage queues, and adjust rate limits in real time.

---

## Project Structure

```
Backend/
├── src/
│   ├── index.ts                          # Entry point — loads env, boots server
│   ├── server.ts                         # Express app, middleware, route mounting, lifecycle
│   ├── config.ts                         # Environment-based configuration
│   ├── types.ts                          # Shared TypeScript interfaces
│   │
│   ├── routes/                           # Layer 4: URL → controller mapping
│   │   ├── requestRoutes.ts              #   POST /request
│   │   ├── statsRoutes.ts                #   GET  /stats
│   │   └── healthRoutes.ts               #   GET  /health
│   │
│   ├── controllers/                      # Layer 3: HTTP input/output handling
│   │   ├── requestController.ts          #   Validate, call services, format response
│   │   ├── statsController.ts            #   Parse query params, return stats
│   │   └── healthController.ts           #   Ping Redis, return status
│   │
│   ├── services/                         # Layer 2: Business logic & orchestration
│   │   ├── redis.ts                      #   Redis client singleton (infra)
│   │   ├── rateLimiterService.ts         #   Sliding window rate limit algorithm
│   │   ├── statsService.ts               #   Stats aggregation & recording
│   │   └── queueService.ts              #   BullMQ queue + worker management
│   │
│   └── repositories/                     # Layer 1: Raw Redis data access
│       ├── rateLimitRepository.ts        #   Sorted set ops for sliding window
│       └── statsRepository.ts            #   Hash/set ops for user stats
│
├── Dockerfile                            # Multi-stage production build
├── docker-compose.yml                    # API + Redis stack
├── .dockerignore
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## License

MIT
