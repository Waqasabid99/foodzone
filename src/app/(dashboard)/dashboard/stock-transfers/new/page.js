import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import TransferForm from "@/components/dashboard/inventory/TransferForm";
import { getAuthContext } from "@/lib/api/auth";
import { serialize } from "@/lib/api/serialize";
import { actionableLocations, allActiveLocations, itemOptions, levelMap } from "@/server/content/inventory-admin";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New transfer — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewTransferPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/stock-transfers/new"));

  const sources = await actionableLocations(principal, "stock_transfers.create");
  if (!sources.length) redirect("/dashboard/stock-transfers");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const [destinations, items, levels] = await Promise.all([allActiveLocations(), itemOptions(), levelMap(sources.map((row) => row.id))]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="New transfer"
        description="Plan what is going where. Stock stays put until the transfer is dispatched."
        back={{ href: "/dashboard/stock-transfers", label: "Transfers" }}
      />
      {destinations.length < 2 ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface">A transfer needs two locations. Add another on the Locations page first.</p>
      ) : (
        <TransferForm
          sources={serialize(sources)}
          destinations={serialize(destinations)}
          items={serialize(items)}
          levels={levels}
          defaultItemId={items.some((row) => row.id === one(params.item)) ? one(params.item) : ""}
        />
      )}
    </div>
  );
}
