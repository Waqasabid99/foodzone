import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { postDraftEntry } from "@/server/services/journal.service";

/** The period is checked now, not when the draft was written. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "journal_entries.post",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => ok(await postDraftEntry(params.id, auth)),
);
