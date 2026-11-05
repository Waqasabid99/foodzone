import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getPayout } from "@/server/services/driver-payout.service";
import { assertRecordAccess } from "@/server/delivery/access";

export const GET = apiHandler(
  { auth: true, permissions: "driver_payouts.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "driverPayout", params.id, "driver_payouts.read");
    return ok(await getPayout(params.id));
  },
);
