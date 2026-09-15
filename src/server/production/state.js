import { ApiError } from "@/lib/api";

/**
 * The production run state machine.
 *
 * Pure, and deliberately small. A run is a physical thing — flour becomes
 * dough becomes bread — so the states exist to make sure the ledger only ever
 * reflects what actually happened:
 *
 *   PLANNED      nothing has moved; the run is a piece of paper
 *   IN_PROGRESS  raw materials have left the shelf and are on the bench
 *   COMPLETED    output exists and has been booked into stock
 *   CANCELLED    the run stopped; anything issued has been put back
 *
 * The two terminal states are terminal on purpose. Re-opening a completed run
 * would mean unbooking finished stock that has very likely already been sold,
 * and re-costing history under it. A mistake is corrected with an adjustment or
 * a wastage record, both of which leave a trail.
 */

export const PRODUCTION_TRANSITIONS = {
  PLANNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const TERMINAL_PRODUCTION_STATUSES = ["COMPLETED", "CANCELLED"];

/** States in which raw material is out of the store and on the bench. */
export const MATERIAL_ISSUED = ["IN_PROGRESS"];

export function allowedProductionTransitions(status) {
  return PRODUCTION_TRANSITIONS[status] ?? [];
}

export function canTransitionProduction(from, to) {
  return allowedProductionTransitions(from).includes(to);
}

/** Throws the same message the API returns, so callers do not each invent one. */
export function assertProductionTransition(from, to) {
  if (canTransitionProduction(from, to)) return;

  if (TERMINAL_PRODUCTION_STATUSES.includes(from)) {
    throw ApiError.conflict(`This run is already ${from.toLowerCase()} and cannot be changed`, { status: from });
  }

  throw ApiError.conflict(`A ${from.toLowerCase().replace(/_/g, " ")} run cannot become ${to.toLowerCase()}`, {
    status: from,
    allowed: allowedProductionTransitions(from),
  });
}
