import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { publishTermsSchema } from "@/server/validation/creator.schemas";
import { listTerms, publishTerms } from "@/server/services/creator.service";

export const GET = apiHandler(
  { auth: true, permissions: "creator_program.manage_terms" },
  async () => ok(await listTerms()),
);

/** Publishing a new current version can force creators to re-accept. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "creator_program.manage_terms",
    body: publishTermsSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await publishTerms(body, auth)),
);
