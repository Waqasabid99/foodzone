import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { publicVideo } from "@/server/services/creator-engagement.service";

export const GET = apiHandler(
  { auth: false, params: idParamSchema },
  async ({ params }) => ok(await publicVideo(params.id)),
);
