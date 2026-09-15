import { apiHandler, ok } from "@/lib/api";
import { assertInternalRequest } from "@/lib/api/internal";
import { runMaintenanceCycle } from "@/server/jobs";

/** Housekeeping: prunes delivered outbox events. Daily is enough. */
async function handler({ request }) {
  assertInternalRequest(request);
  return ok(await runMaintenanceCycle());
}

export const GET = apiHandler({}, handler);
export const POST = apiHandler({}, handler);
