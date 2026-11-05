import { redirect, notFound } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import PageEditor from "@/components/dashboard/content/PageEditor";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getContentPage } from "@/server/services/content-page.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { ApiError } from "@/lib/api";

export const metadata = { title: "Edit page — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditContentPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/pages/${id}`));

  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "content_pages.read")) redirect("/dashboard");

  let page;
  try {
    page = await getContentPage(id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={page.title}
        description={`Shown to customers at /${page.slug}. The address is fixed — links already printed or emailed keep working.`}
        back={{ href: "/dashboard/pages", label: "Public pages" }}
      />
      <PageEditor page={serialize(page)} canEdit={hasPermission(permissions, "content_pages.update")} />
    </div>
  );
}
