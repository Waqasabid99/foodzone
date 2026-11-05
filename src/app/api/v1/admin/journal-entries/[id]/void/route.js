import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { voidJournalEntrySchema } from "@/server/validation/finance.schemas";
import { voidDraftEntry } from "@/server/services/journal.service";

/** Drafts only. A posted entry is reversed, never voided. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "journal_entries.void",
    params: idParamSchema,
    body: voidJournalEntrySchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "journalEntry", params.id, "journal_entries.void");
    return ok(await voidDraftEntry(params.id, { reason: body.reason, actor: auth }));
  },
);
