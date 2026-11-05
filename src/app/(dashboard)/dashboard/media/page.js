import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import MediaLibrary from "@/components/dashboard/admin/MediaLibrary";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listAssets } from "@/server/services/media.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Media — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;

/** Everything uploaded, wherever it was uploaded from. */
export default async function MediaPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/media"));
  const granted = grantedPermissionKeys(principal);
  if (!["media.upload", "media.delete"].some((key) => hasPermission(granted, key))) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const kind = ["image", "video"].includes(one(params.kind)) ? one(params.kind) : "";

  const page = await listAssets({ ...(kind ? { mimeType: `${kind}/` } : {}), limit: PAGE_SIZE });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Media"
        description="Every picture the system holds — uploaded here, or from a product, a menu or a stock item. A file something is using cannot be deleted."
      />
      <ListFilters
        id="media"
        fields={[
          {
            type: "select",
            name: "kind",
            label: "Kind",
            value: kind,
            options: [
              { value: "", label: "Everything" },
              { value: "image", label: "Pictures" },
              { value: "video", label: "Video" },
            ],
          },
        ]}
      />
      <MediaLibrary assets={serialize(page.items)} canDelete={can(principal, "media.delete")} currentUserId={principal.userId} />
    </div>
  );
}
