import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import GatewaySetup from "@/components/dashboard/admin/GatewaySetup";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listBranchProviders } from "@/server/services/payment-provider.service";
import { listBranches } from "@/server/services/branch.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Payment gateways — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where each branch's own merchant account is configured.
 *
 * Unlike every other settings screen, this one is **per branch with no
 * company-wide layer**. A gateway account belongs to whoever signed the
 * contract with the acquirer, and inheriting one branch's merchant keys into
 * another would mean one restaurant collecting another's takings. So a branch
 * is always chosen, and there is no "company-wide" tab to fall back to.
 */
export default async function PaymentGatewaysPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/payment-gateways"));
  if (!hasPermission(grantedPermissionKeys(principal), "payment_providers.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const branchPage = await listBranches({ limit: 100 });
  const branches = branchPage.items ?? branchPage;

  // A branch is mandatory here, so the first one stands in rather than showing
  // an empty screen that looks broken.
  const requested = one(params.branch);
  const branchId = branches.some((row) => row.id === requested) ? requested : (branches[0]?.id ?? null);
  const branch = branches.find((row) => row.id === branchId) ?? null;

  if (!branchId) {
    return (
      <div className="flex max-w-4xl flex-col gap-6">
        <PageHeader title="Payment gateways" description="There are no branches yet." />
      </div>
    );
  }

  const gateways = serialize(await listBranchProviders({ branchId }));
  const canEdit = can(principal, "payment_providers.manage", { branchId });

  const online = gateways.filter((row) => row.supportsOnline);
  const offline = gateways.filter((row) => !row.supportsOnline);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Payment gateways"
        description={
          branch
            ? `${branch.name} collects into its own merchant account. These are its keys, and nobody else's.`
            : "Each branch collects into its own merchant account."
        }
      />

      {branches.length > 1 ? (
        <nav aria-label="Which branch" className="flex flex-wrap gap-2">
          {branches.map((row) => (
            <Link
              key={row.id}
              href={`/dashboard/payment-gateways?branch=${row.id}`}
              aria-current={branchId === row.id ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${branchId === row.id ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {row.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <Section
        title="Online gateways"
        description="Each one needs the credentials from that provider's own dashboard. Secrets are encrypted before they are stored and are never shown again."
      >
        <div className="flex flex-col gap-4">
          {online.map((gateway) => (
            <GatewaySetup key={gateway.provider} gateway={gateway} branchId={branchId} canEdit={canEdit} />
          ))}
        </div>
      </Section>

      {offline.length ? (
        <Section title="Settled outside the system" description="Cash, a card terminal, an aggregator paying out weekly. Nothing to configure.">
          <div className="flex flex-col gap-4">
            {offline.map((gateway) => (
              <GatewaySetup key={gateway.provider} gateway={gateway} branchId={branchId} canEdit={canEdit} />
            ))}
          </div>
        </Section>
      ) : null}

      {canEdit ? null : (
        <p className="text-body-md text-on-surface-variant">
          You can see which gateways are set up, but not change them. That needs the
          &ldquo;Configure gateway credentials&rdquo; permission.
        </p>
      )}
    </div>
  );
}
