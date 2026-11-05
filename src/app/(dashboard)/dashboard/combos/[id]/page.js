import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import ProductWorkspace from "@/components/dashboard/products/ProductWorkspace";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { getProduct } from "@/server/services/product.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const combo = await nullIfMissing(getProduct(id, { includeDeleted: true }));
  return { title: combo ? `${combo.name} — Combos — FoodZone` : "Combo — FoodZone", robots: { index: false, follow: false } };
}

export default async function ComboPage({ params }) {
  const { id } = await params;
  const [viewer, { currency }] = await Promise.all([getWorkspaceViewer(), getSiteIdentity()]);
  if (!viewer) redirect(loginHref(`/dashboard/combos/${id}`));
  if (!hasPermission(viewer.permissions, "combos.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getProduct(id, { includeDeleted: true }));
  if (!raw || raw.id !== id) notFound();
  if (raw.type !== "COMBO") redirect(`/dashboard/products/${id}`);

  return <ProductWorkspace raw={raw} viewer={viewer} currency={currency} />;
}
