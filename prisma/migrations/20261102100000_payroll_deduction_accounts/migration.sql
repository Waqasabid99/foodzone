-- Payroll deductions post where they belong.
--
-- `PayslipLine.accountId` already existed, documented as "Ledger account this
-- component posts to", and nothing ever wrote it: the whole deduction total was
-- credited to 2200 Tax payable. A provident fund is not tax, and an advance
-- being recovered is an asset coming back rather than a liability going up, so
-- the tax account was overstated by everything withheld for any other reason —
-- which only surfaces when somebody is asked to remit it.
--
-- The component now names the account, and the payslip line freezes a copy at
-- generation so editing the component later cannot restate a payslip already
-- issued.
ALTER TABLE "EmployeeSalaryComponent" ADD COLUMN IF NOT EXISTS "accountId" TEXT;

ALTER TABLE "EmployeeSalaryComponent"
  ADD CONSTRAINT "EmployeeSalaryComponent_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayslipLine"
  ADD CONSTRAINT "PayslipLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "EmployeeSalaryComponent_accountId_idx" ON "EmployeeSalaryComponent"("accountId");
CREATE INDEX IF NOT EXISTS "PayslipLine_accountId_idx" ON "PayslipLine"("accountId");

-- The two accounts the feature needs out of the box. `prisma/seed.js` upserts
-- the standard chart by code, but an existing database is not reseeded on
-- deploy, so they are inserted here. Parent 2000/1000 must exist; if the chart
-- was never seeded there is nothing to attach to and nothing to do.
INSERT INTO "Account" ("id", "code", "name", "type", "subType", "normalBalance", "parentId", "description", "isSystem", "currency", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text, '2320', 'Employee deductions payable', 'LIABILITY', 'Payable', 'CREDIT',
  (SELECT "id" FROM "Account" WHERE "code" = '2000'),
  'Withheld from wages and owed to somebody else, where no more specific account is set on the component',
  true, 'PKR', true, now(), now()
WHERE EXISTS (SELECT 1 FROM "Account" WHERE "code" = '2000')
  AND NOT EXISTS (SELECT 1 FROM "Account" WHERE "code" = '2320');

INSERT INTO "Account" ("id", "code", "name", "type", "subType", "normalBalance", "parentId", "description", "isSystem", "currency", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text, '1350', 'Employee advances', 'ASSET', 'Receivable', 'DEBIT',
  (SELECT "id" FROM "Account" WHERE "code" = '1000'),
  'Money advanced to staff, recovered from later wages',
  true, 'PKR', true, now(), now()
WHERE EXISTS (SELECT 1 FROM "Account" WHERE "code" = '1000')
  AND NOT EXISTS (SELECT 1 FROM "Account" WHERE "code" = '1350');
