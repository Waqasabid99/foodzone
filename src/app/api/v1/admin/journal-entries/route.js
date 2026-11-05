import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { createJournalEntrySchema, listJournalEntriesSchema } from "@/server/validation/finance.schemas";
import { createManualEntry, listJournalEntries } from "@/server/services/journal.service";

export const GET = apiHandler(
  { auth: true, permissions: "journal_entries.read", query: listJournalEntriesSchema, branch: "query" },
  async ({ query, auth }) => ok(await listJournalEntries({ ...query, scope: branchScope(auth, "journal_entries.read") })),
);

/**
 * A manual entry, typed by a person.
 *
 * Created as a draft unless `post` is set, so a second pair of eyes can post
 * it — which is why creating and posting are separate permissions. A manual
 * entry is the one posting no business event justifies, so it is the one that
 * most wants a control around it.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "journal_entries.create",
    body: createJournalEntrySchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createManualEntry(body, auth)),
);
