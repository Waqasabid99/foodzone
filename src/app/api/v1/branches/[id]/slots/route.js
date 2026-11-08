import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { slotQuerySchema } from "@/server/validation/ordering.schemas";
import { slotsForDate } from "@/server/services/slot.service";

/**
 * The times a customer can order for.
 *
 * Public, because it is part of choosing what to buy — the storefront shows it
 * before anybody signs in. It returns the whole grid rather than only what is
 * free: a slot shown as full reads as "that one is taken, pick another",
 * while hiding it reads as "no slots", and a customer who can see the shape of
 * the evening picks a workable time without being told to.
 *
 * `date` defaults to today in the branch's own timezone. `dates` in the
 * response is the calendar the client should offer.
 */
export const GET = apiHandler(
  {
    params: idParamSchema,
    query: slotQuerySchema,
    rateLimit: RateLimits.public,
    scope: "ordering:slots",
    doc: {
      summary: "Scheduling slots for a branch",
      description:
        "The pickup and delivery slots for one local date, built from the branch's trading hours, " +
        "its closures and how many orders already hold each slot. Slots inside the kitchen's lead " +
        "time are not offered; full ones are returned marked unavailable.",
      tag: "Branches",
    },
  },
  async ({ params, query }) =>
    ok(await slotsForDate({ branchId: params.id, date: query.date ?? null, channel: query.channel ?? null })),
);
