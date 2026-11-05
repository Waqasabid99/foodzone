import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listContentPages } from "@/server/services/content-page.service";
import { firstParagraph } from "@/lib/prose";
import { dateLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { getSiteIdentity } from "@/server/content/site";

export const metadata = { title: "Public pages — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The pages customers read, listed so somebody can go and fix one.
 *
 * Every row links to where it appears on the storefront, because the question
 * being answered here is almost always "what does this actually say" and the
 * fastest way to answer it is to look at the page.
 */
export default async function ContentPagesPage() {
  const { timeZone } = await getSiteIdentity();
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/pages"));
  if (!hasPermission(grantedPermissionKeys(principal), "content_pages.read")) redirect("/dashboard");

  const pages = serialize(await listContentPages());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Public pages"
        description="About, Contact and the legal pages. The words are yours to change; the addresses are fixed so links already out in the world keep working."
      />

      <ul className="flex flex-col gap-3">
        {pages.map((page) => (
          <li key={page.id} className="rounded-card bg-surface-container-lowest p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <FileText aria-hidden="true" className="size-4 text-on-surface-variant" />
                  <span className="text-label-bold text-on-surface">{page.title}</span>
                  {page.isPublished ? null : <Chip tone="bg-surface-container-high text-on-surface-variant">Hidden</Chip>}
                </p>

                <p className="mt-1 text-body-md text-on-surface-variant">
                  {page.summary || firstParagraph(page.body)}
                </p>

                <p className="mt-1 text-label-bold font-normal text-on-surface-variant">
                  /{page.slug} · updated {dateLabel(page.updatedAt, timeZone)}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  href={`/${page.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  View
                </Link>
                <Link
                  href={`/dashboard/pages/${page.id}`}
                  className="rounded-field bg-primary-container px-5 py-2 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Edit
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
