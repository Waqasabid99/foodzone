import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { driverEarningsSummary } from "@/server/services/driver-payout.service";
import { assertRecordAccess } from "@/server/delivery/access";

export const GET = apiHandler(
  { auth: true, permissions: "driver_payouts.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "driver", params.id, "driver_payouts.read");
    return ok(await driverEarningsSummary({ driverId: params.id }));
  },
);
