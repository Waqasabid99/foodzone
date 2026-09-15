import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getTransfer } from "@/server/services/stock-transfer.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock_transfers.read", params: idParamSchema },
  async ({ params }) => ok(await getTransfer(params.id)),
);
