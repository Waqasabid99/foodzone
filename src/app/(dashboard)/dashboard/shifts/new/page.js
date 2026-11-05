import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ShiftForm from "@/components/dashboard/people/ShiftForm";
import { getAuthContext } from "@/lib/api/auth";
import { can } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { scopedBranches } from "@/server/content/branch-scope";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New shift — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewShiftPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/shifts/new"));
  if (!can(principal, "shifts.manage")) redirect("/dashboard/shifts");

  const branches = await scopedBranches(principal, "shifts.manage");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="New shift"
        description="Times are the wall clock. An end earlier than the start means the next morning."
        back={{ href: "/dashboard/shifts", label: "Shifts" }}
      />
      <ShiftForm branches={serialize(branches)} />
    </div>
  );
}
