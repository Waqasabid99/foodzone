import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { myPayslips } from "@/server/services/payroll.service";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(60).optional() });

/**
 * An employee's own payslips.
 *
 * Deliberately not the admin endpoint with a filter. Reading anybody's payslip
 * needs `payslips.view_all`; reading your own needs nothing but being you, and
 * conflating the two is how one endpoint ends up leaking the whole payroll.
 * Only approved and paid slips are visible — a draft is still being worked on.
 */
export const GET = apiHandler(
  { auth: true, query: querySchema },
  async ({ query, auth }) => ok(await myPayslips({ userId: auth.userId, limit: query.limit })),
);
