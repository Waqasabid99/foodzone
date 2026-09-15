import { apiHandler, ok } from "@/lib/api";
import { assertInternalRequest } from "@/lib/api/internal";
import { runCreatorCycle } from "@/server/jobs";

/**
 * Credits earnings past their hold, and expires what has run out of time.
 *
 * Its own endpoint rather than part of maintenance because these move money:
 * burying "make this creator's balance spendable" in a job that also prunes log
 * rows makes it far too easy to disable by accident.
 */
async function handler({ request }) {
  assertInternalRequest(request);
  return ok(await runCreatorCycle());
}

export const GET = apiHandler({}, handler);
export const POST = apiHandler({}, handler);
