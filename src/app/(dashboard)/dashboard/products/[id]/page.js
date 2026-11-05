import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import ProductWorkspace from "@/components/dashboard/products/ProductWorkspace";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { getProduct } from "@/server/services/product.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const product = await getProduct(id, { includeDeleted: true }).catch(() => null);
  return {
    title: product ? `${product.name} — Products — FoodZone` : "Product — FoodZone",
    robots: { index: false, follow: false },
  };
}

export default async function ProductPage({ params }) {
  const { id } = await params;
  const [viewer, principal, { currency }] = await Promise.all([
    getWorkspaceViewer(),
    getAuthContext(),
    getSiteIdentity(),
  ]);
  if (!viewer || !principal) redirect(loginHref(`/dashboard/products/${id}`));
  if (!hasPermission(viewer.permissions, "products.read")) redirect("/dashboard");

  // Scoped: another outlet's product is a 404 here, not a page they can read.
  const raw = await nullIfMissing(
    getProduct(id, {
      includeDeleted: true,
      scope: branchScope(principal, "products.read"),
    }),
  );
  // `getProduct` also matches a slug; this URL is only ever an id.
  if (!raw || raw.id !== id) notFound();
  // A combo lives on the Combos page, where its slots are.
  if (raw.type === "COMBO") redirect(`/dashboard/combos/${id}`);

  return <ProductWorkspace raw={raw} viewer={viewer} currency={currency} />;
}
