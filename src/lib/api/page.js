import { notFound } from "next/navigation";
import { isForbidden, isNotFound } from "@/lib/api/errors";

/**
 * Page-side wrappers around the service layer's errors.
 *
 * Separate from `@/lib/api/errors` because `notFound()` belongs to the router:
 * the API handlers share that module and must not pull a navigation primitive
 * in behind them.
 */

/**
 * Runs an access assertion and shows the not-found screen for the two answers
 * it gives on purpose.
 *
 * An out-of-scope record answers 404 rather than 403 — that it exists at
 * another branch is itself more than a scoped supervisor should learn — and a
 * company-wide record the viewer lacks the permission for answers 403. Both
 * mean the same thing to the page. Everything else is a real failure and goes
 * to the error boundary, which says the screen did not load rather than
 * claiming the record is not there.
 *
 * Returns whatever the assertion returned, so a caller that wants the branch
 * id still gets it — including the legitimate `null` of a record that belongs
 * to no single branch.
 */
export async function requireReachable(promise) {
  try {
    return await promise;
  } catch (error) {
    if (isNotFound(error) || isForbidden(error)) notFound();
    throw error;
  }
}
