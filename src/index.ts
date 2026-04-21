import "dotenv/config";
import { startServer } from "./server";

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  process.exit(1);
});

startServer().catch((err) => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
