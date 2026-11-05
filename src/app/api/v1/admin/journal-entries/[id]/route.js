import { apiHandler, ok } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { getJournalEntry } from "@/server/services/journal.service";

export const GET = apiHandler(
  { auth: true, permissions: "journal_entries.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "journalEntry", params.id, "journal_entries.read");
    return ok(await getJournalEntry(params.id));
  },
);
