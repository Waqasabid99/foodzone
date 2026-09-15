import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getJournalEntry } from "@/server/services/journal.service";

export const GET = apiHandler(
  { auth: true, permissions: "journal_entries.read", params: idParamSchema },
  async ({ params }) => ok(await getJournalEntry(params.id)),
);
