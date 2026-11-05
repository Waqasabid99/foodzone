import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import AdjustmentForm from "@/components/dashboard/inventory/AdjustmentForm";
import { getAuthContext } from "@/lib/api/auth";
import { serialize } from "@/lib/api/serialize";
import { actionableLocations, itemOptions, levelMap } from "@/server/content/inventory-admin";
import { loginHref } from "@/lib/redirects";
import { ADJUSTMENT_TYPES } from "@/lib/inventory";

const COPY = {
  CORRECTION: {
    title: "New adjustment",
    description:
      "For stock that changed with no delivery, sale, transfer or waste to explain it — a found box, a miscount, something used without a record. It waits for approval before anything moves.",
  },
  OPENING_STOCK: {
    title: "Opening stock",
    description:
      "What was already on the shelf when you started using the system, and what it cost. It waits for approval, then sets each item's starting balance here. In the accounts it is part of the opening position, not a profit.",
  },
};

export const metadata = { title: "New adjustment — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewAdjustmentPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/stock-adjustments/new"));

  const locations = await actionableLocations(principal, "stock_adjustments.create");
  if (!locations.length) redirect("/dashboard/stock-adjustments");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const type = one(params.type) === "OPENING_STOCK" ? "OPENING_STOCK" : "CORRECTION";
  const switchHref = (value) => {
    const search = new URLSearchParams();
    if (value !== "CORRECTION") search.set("type", value);
    if (one(params.item)) search.set("item", one(params.item));
    if (one(params.location)) search.set("location", one(params.location));
    const query = search.toString();
    return query ? `/dashboard/stock-adjustments/new?${query}` : "/dashboard/stock-adjustments/new";
  };
  const [items, levels] = await Promise.all([itemOptions(), levelMap(locations.map((location) => location.id))]);
  const defaultItemId = items.some((item) => item.id === one(params.item)) ? one(params.item) : "";
  const defaultLocationId = locations.some((location) => location.id === one(params.location)) ? one(params.location) : "";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title={COPY[type].title} description={COPY[type].description} back={{ href: "/dashboard/stock-adjustments", label: "Adjustments" }} />
      <nav aria-label="Kind of adjustment" className="flex flex-wrap gap-2">
        {ADJUSTMENT_TYPES.map((entry) => (
          <Link
            key={entry.value}
            href={switchHref(entry.value)}
            aria-current={entry.value === type ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${entry.value === type ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      <AdjustmentForm
        key={type}
        type={type}
        locations={serialize(locations)}
        items={serialize(items)}
        levels={levels}
        defaultItemId={defaultItemId}
        defaultLocationId={defaultLocationId}
      />
    </div>
  );
}
