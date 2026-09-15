import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getSession } from "@/server/services/register.service";

/**
 * One session, with its movements and the running expected figure.
 *
 * While the session is open `expectedCash` is what the drawer should hold right
 * now — derived from the opening float plus every movement, never a stored
 * running total that could drift from the rows.
 */
export const GET = apiHandler(
  { auth: true, permissions: "cash_registers.read", params: idParamSchema },
  async ({ params }) => ok(await getSession(params.id)),
);
