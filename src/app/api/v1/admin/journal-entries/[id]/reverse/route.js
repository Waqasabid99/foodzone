import { apiHandler, created, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { reverseJournalEntrySchema } from "@/server/validation/finance.schemas";
import { reverseJournalEntry } from "@/server/services/journal.service";

/**
 * The only way to correct a posted entry.
 *
 * Every line is flipped into a new entry pointing back at the original, and the
 * original is left exactly as it was. A ledger where mistakes disappear cannot
 * be used to prove anything, which is the only reason to keep one.
 *
 * Dated today by default: back-dating a correction into a period that has since
 * been reported would change figures somebody has already published.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "journal_entries.void",
    params: idParamSchema,
    body: reverseJournalEntrySchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "journalEntry", params.id, "journal_entries.void");
    return created(await reverseJournalEntry(params.id, { reason: body.reason, entryDate: body.entryDate, actor: auth }));
  },
);
