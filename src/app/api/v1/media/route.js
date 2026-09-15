import { apiHandler, paginated } from "@/lib/api";
import { mediaQuerySchema } from "@/server/validation/schemas";
import { listAssets } from "@/server/services/media.service";

export const GET = apiHandler(
  { auth: true, permissions: "media.upload", query: mediaQuerySchema },
  async ({ query }) => {
    const { items, nextCursor, limit } = await listAssets(query);
    return paginated(items, { nextCursor, limit });
  },
);
