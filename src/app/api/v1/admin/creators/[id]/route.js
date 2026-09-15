import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getCreator, listStrikes } from "@/server/services/creator.service";

export const GET = apiHandler(
  { auth: true, permissions: "creators.read", params: idParamSchema },
  async ({ params }) => {
    const [creator, strikes] = await Promise.all([getCreator(params.id), listStrikes(params.id)]);
    return ok({ ...creator, strikes });
  },
);
