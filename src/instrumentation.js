/**
 * Runs once per server instance, before the first request is served.
 *
 * Used to start the in-process outbox worker on long-lived deployments
 * (Docker/VPS). On serverless there is no long-lived process, so
 * WORKER_IN_PROCESS stays false and a cron drives the same work through
 * /api/internal/jobs/outbox instead.
 */
export async function register() {
  // The Edge runtime has no database client and no timers worth keeping.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startInProcessWorker } = await import("@/server/jobs");
  startInProcessWorker();
}
