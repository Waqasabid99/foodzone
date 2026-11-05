import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import MenuForm from "@/components/dashboard/menus/MenuForm";
import { getAuthContext } from "@/lib/api/auth";
import { scopedBranches } from "@/server/content/menu-admin";
import { prisma } from "@/lib/prisma";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New menu — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewMenuPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/menus/new"));

  // Only branches they may create a menu at; none at all means the page is not theirs.
  const branches = await scopedBranches(principal, "menus.create");
  if (!branches.length) redirect("/dashboard/menus");

  const { branch } = await searchParams;
  const defaultBranchId = branches.some((option) => option.id === branch) ? branch : "";

  /*
   * What is already live where, so the form can say whether this menu will go
   * live on creation or wait. Branch and type only — it is a yes/no question
   * about displacement, not a list anybody reads.
   */
  const liveMenus = await prisma.menu.findMany({
    where: { isActive: true, branchId: { in: branches.map((option) => option.id) } },
    select: { branchId: true, type: true },
  });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="New menu" back={{ href: "/dashboard/menus", label: "Menus" }} />
      <MenuForm branches={branches} defaultBranchId={defaultBranchId} liveMenus={liveMenus} />
    </div>
  );
}
