import { apiHandler, ok } from "@/lib/api";
import { assertInternalRequest } from "@/lib/api/internal";
import { runAttendanceCycle } from "@/server/jobs";

/**
 * Folds yesterday's punches into the attendance days payroll reads.
 *
 * Its own endpoint rather than part of maintenance because this decides what
 * people are paid: an absence becomes a row only when something derives the
 * day, so a fold that quietly stopped would be discovered on payday.
 *
 * Run it nightly, after every branch's day is over. Running it more often is
 * harmless but wasteful: a day is recomputed from the same punches and lands
 * on the same answer, and the two that must not move — a paid day and one a
 * human corrected — are refused by the derivation itself.
 */
async function handler({ request }) {
  assertInternalRequest(request);
  return ok(await runAttendanceCycle());
}

export const GET = apiHandler({}, handler);
export const POST = apiHandler({}, handler);
