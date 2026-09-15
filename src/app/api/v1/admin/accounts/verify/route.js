import { apiHandler, ok } from "@/lib/api";
import { verifyChart } from "@/server/services/account.service";

/**
 * Checks the chart can still support the posting rules.
 *
 * Every code the rules reference has to exist and be active. A missing one is
 * found here rather than at the moment a sale tries to post and fails.
 */
export const GET = apiHandler(
  { auth: true, permissions: "accounts.read" },
  async () => ok(await verifyChart()),
);
