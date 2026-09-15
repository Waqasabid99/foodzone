import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { driverEarningsSummary } from "@/server/services/driver-payout.service";

export const GET = apiHandler(
  { auth: true, permissions: "driver_payouts.read", params: idParamSchema },
  async ({ params }) => ok(await driverEarningsSummary({ driverId: params.id })),
);
