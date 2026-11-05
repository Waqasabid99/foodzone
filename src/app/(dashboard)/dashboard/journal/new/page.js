import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import JournalEntryForm from "@/components/dashboard/finance/JournalEntryForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { accountOptions, scopedBranches } from "@/server/content/finance-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Write an entry — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewJournalEntryPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/journal/new"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "journal_entries.create")) redirect("/dashboard/journal");

  const [accounts, branches] = await Promise.all([
    accountOptions(),
    scopedBranches(principal, "journal_entries.create"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Write a journal entry"
        description="For a correction or an opening balance. Everything else in the ledger is written by the thing that caused it."
        back={{ href: "/dashboard/journal", label: "Journal" }}
      />
      <JournalEntryForm
        accounts={serialize(accounts)}
        branches={serialize(branches)}
        canPost={hasPermission(permissions, "journal_entries.post")}
      />
    </div>
  );
}
