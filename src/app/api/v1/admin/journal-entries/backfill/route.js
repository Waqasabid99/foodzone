import { apiHandler, ok, RateLimits } from "@/lib/api";
import { backfillSchema } from "@/server/validation/finance.schemas";
import { postMissingEntries } from "@/server/services/posting.service";

/**
 * Posts everything that should be in the ledger and is not.
 *
 * The recovery path. Postings run from the outbox, and an event can be lost to
 * a bug, a bad deploy, or a chart of accounts that was not seeded yet — leaving
 * operational data right and the ledger short. Every rule is idempotent, so
 * this is safe to run at any time.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "journal_entries.post",
    body: backfillSchema,
    rateLimit: RateLimits.write,
    audit: { action: "journal.backfill", entityType: "JournalEntry" },
  },
  async ({ body }) => ok(await postMissingEntries(body)),
);
