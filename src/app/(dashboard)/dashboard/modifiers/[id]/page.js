import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import HealthNotice from "@/components/dashboard/HealthNotice";
import DeleteSection from "@/components/dashboard/DeleteSection";
import ModifierGroupForm from "@/components/dashboard/modifiers/ModifierGroupForm";
import ModifierOptionsEditor from "@/components/dashboard/modifiers/ModifierOptionsEditor";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { getModifierGroup } from "@/server/services/modifier.service";
import { serialize } from "@/lib/api/serialize";
import { modifierGroupHealth } from "@/lib/modifier-rules";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const group = await nullIfMissing(getModifierGroup(id));
  return { title: group ? `${group.name} — Modifiers — FoodZone` : "Modifier group — FoodZone", robots: { index: false, follow: false } };
}

export default async function ModifierGroupPage({ params }) {
  const { id } = await params;
  const [viewer, { currency }] = await Promise.all([getWorkspaceViewer(), getSiteIdentity()]);
  if (!viewer) redirect(loginHref(`/dashboard/modifiers/${id}`));
  const can = (key) => hasPermission(viewer.permissions, key);
  if (!can("modifiers.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getModifierGroup(id));
  if (!raw) notFound();
  const group = serialize(raw);
  const activeCount = group.options.filter((option) => option.isActive).length;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={group.name}
        description={group.internalName ? `Internal name: ${group.internalName}` : null}
        back={{ href: "/dashboard/modifiers", label: "Modifiers" }}
      />

      <HealthNotice issues={modifierGroupHealth(group)} />

      <ModifierGroupForm group={group} optionCount={activeCount} currency={currency} readOnly={!can("modifiers.update")} />

      <ModifierOptionsEditor group={group} currency={currency} canEdit={can("modifiers.update")} />

      <Section title="Used by" description="Add or remove this group, and mark it Required, from each product's own page.">
        {group.products.length ? (
          <ul className="flex flex-col gap-2">
            {group.products.map((product) => (
              <li key={product.id} className="flex flex-wrap items-baseline justify-between gap-2 text-body-md">
                <Link
                  href={product.type === "COMBO" ? `/dashboard/combos/${product.id}` : `/dashboard/products/${product.id}`}
                  className="text-label-bold text-on-surface hover:underline"
                >
                  {product.name}
                </Link>
                <span className="text-on-surface-variant">
                  {product.isRequired ? "Required" : "Optional"}
                  {product.overrides.minSelect !== null || product.overrides.maxSelect !== null ? " · own limits" : ""}
                  {product.isActive ? "" : " · draft"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">No products use this group yet.</p>
        )}
      </Section>

      {can("modifiers.delete") ? (
        <DeleteSection
          title="Delete group"
          description="Only a group no product uses can be deleted. To stop offering it everywhere at once, switch it off instead."
          endpoint={`/admin/modifier-groups/${group.id}`}
          confirm={`Delete "${group.name}" and all its choices? This cannot be undone.`}
          redirectTo="/dashboard/modifiers"
          success="Group deleted."
        />
      ) : null}
    </div>
  );
}
