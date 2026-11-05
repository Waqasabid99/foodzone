-- A posted entry must not lose its accounting period.
--
-- The previous constraint let a period be deleted out from under a posted
-- journal entry, nulling the link. Nothing fails and nothing warns: the entry
-- stays in the ledger and in the account balances, but every statement is
-- built by period, so it silently stops being counted. Seven real entries were
-- orphaned this way before this constraint existed.
--
-- `RESTRICT` means deleting a fiscal year that has postings under it now fails
-- loudly instead. Books should be hard to destroy by accident.
ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "JournalEntry_periodId_fkey";
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
