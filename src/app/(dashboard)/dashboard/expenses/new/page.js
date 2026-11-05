import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ExpenseForm from "@/components/dashboard/finance/ExpenseForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { actionableBranches, expenseCategoryOptions, paymentSourceAccounts } from "@/server/content/finance-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Record spend — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewExpensePage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/expenses/new"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "expenses.create")) redirect("/dashboard/expenses");

  const [branches, categories, accounts] = await Promise.all([
    actionableBranches(principal, "expenses.create"),
    expenseCategoryOptions(),
    paymentSourceAccounts(),
  ]);

  // Offered no branch they may spend at, the form has nothing to submit.
  if (!branches.length) redirect("/dashboard/expenses");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Record spend"
        description="Something the business paid for that is not a supplier invoice. It is saved as a draft and becomes a cost in the books when it is approved."
        back={{ href: "/dashboard/expenses", label: "Expenses" }}
      />
      <ExpenseForm branches={serialize(branches)} categories={serialize(categories)} accounts={serialize(accounts)} />
    </div>
  );
}
