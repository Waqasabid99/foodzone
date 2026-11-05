import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { publicPaymentOptions } from "@/server/services/payment-provider.service";

/**
 * How a customer may pay at this branch.
 *
 * Unauthenticated, because a guest checking out has no session worth the name.
 * That makes what it returns a deliberate decision: the gateway's name and the
 * methods it covers, and nothing else. No keys, no mode, no merchant
 * identifier — none of which a customer needs, and all of which would then be
 * readable by anyone who can load a menu.
 *
 * Paying in person is not listed here. It is always available and is the
 * default, so it belongs in the client's own copy rather than being a
 * server-sent option that could go missing and leave somebody unable to order
 * at all.
 */
export const GET = apiHandler(
  { query: z.object({ branchId: z.string().trim().min(1).max(64) }) },
  async ({ query }) => ok(await publicPaymentOptions({ branchId: query.branchId })),
);
