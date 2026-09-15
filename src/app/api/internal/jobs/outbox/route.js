import { apiHandler, ok } from "@/lib/api";
import { assertInternalRequest } from "@/lib/api/internal";
import { runOutboxCycle } from "@/server/jobs";
import { outboxStats } from "@/server/jobs/outbox";

/**
 * Drains the outbox. Called by a scheduler on serverless; harmless alongside
 * the in-process worker, because claiming uses SKIP LOCKED.
 *
 * GET and POST both work: Vercel Cron issues GET, most other schedulers POST.
 */
async function handler({ request }) {
  assertInternalRequest(request);
  const result = await runOutboxCycle();
  return ok({ ...result, stats: await outboxStats() });
}

export const GET = apiHandler({}, handler);
export const POST = apiHandler({}, handler);
