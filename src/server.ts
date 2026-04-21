import express from "express";
import { config } from "./config";
import { getRedisClient, closeRedis } from "./services/redis";
import { startWorker, closeQueue } from "./services/queueService";
import requestRoutes from "./routes/requestRoutes";
import statsRoutes from "./routes/statsRoutes";
import healthRoutes from "./routes/healthRoutes";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.use((req, _res, next) => {
    const start = Date.now();
    const { method, url } = req;

    req.on("close", () => {
      const duration = Date.now() - start;
      console.log(`${method} ${url} ${duration}ms`);
    });

    next();
  });

  app.use("/request", requestRoutes);
  app.use("/stats", statsRoutes);
  app.use("/health", healthRoutes);

  return app;
}

export async function startServer(): Promise<void> {
  getRedisClient();
  startWorker();

  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`[Server] Listening on port ${config.port}`);
    console.log(
      `[Config] Rate limit: ${config.rateLimit.maxRequests} requests per ${config.rateLimit.windowMs / 1000}s`
    );
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[Server] ${signal} received, shutting down gracefully...`);

    server.close(async () => {
      await closeQueue();
      await closeRedis();
      console.log("[Server] Shutdown complete");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("[Server] Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
