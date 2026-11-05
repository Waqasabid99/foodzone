import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import CounterOrder from "@/components/dashboard/service/CounterOrder";
import { getAuthContext } from "@/lib/api/auth";
import { can } from "@/lib/api/permissions";
import { isNotFound } from "@/lib/api/errors";
import { serialize } from "@/lib/api/serialize";
import { inScope } from "@/server/access/scope";
import { orderScope } from "@/server/ordering/access";
import { getOrder } from "@/server/services/order.service";
import { actionableBranches, counterMenu, tableOccupancy, tableOptions } from "@/server/content/service-admin";
import { COUNTER_TYPES } from "@/lib/service";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Take an order — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The counter.
 *
 * When the money is taken depends on the order, the way it does in every shop
 * that serves both ways. A collection order is a quick-service counter: it is
 * paid before it fires, because once the customer walks off with the bag there
 * is nobody left to charge. A dine-in order is table service: it goes to the
 * kitchen now and the bill is settled at the end, because asking a seated
 * table to pay before they have eaten is not a restaurant, and a second round
 * has to be able to join the same bill.
 *
 * This screen does that second round too, with `?addTo=`. It is the same act —
 * find the thing, choose how it is made, say how many — so it is the same
 * screen rather than a second menu, a second combo builder and a second set of
 * modifier rules to keep in step. What changes is everything that belongs to
 * *starting* a sale: no type, no table, no customer, no money.
 */
export default async function NewOrderPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/orders/new"));

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  // Adding to an order needs the permission for editing one, not for creating
  // one — they are different acts and a role may well hold only the first.
  const addToId = one(params.addTo) || null;
  const existing = addToId
    ? await getOrder(addToId).catch((error) => {
        if (isNotFound(error)) return null;
        throw error;
      })
    : null;

  if (addToId) {
    if (!existing || !inScope(orderScope(principal), existing.branchId)) redirect("/dashboard/orders");
    if (!can(principal, "orders.edit_items", { branchId: existing.branchId })) {
      redirect(`/dashboard/orders/${addToId}`);
    }
  }

  const branches = await actionableBranches(principal, existing ? "orders.edit_items" : "orders.create");
  if (!branches.length) redirect("/dashboard/orders");

  const branchId = existing
    ? existing.branchId
    : branches.some((row) => row.id === one(params.branch))
      ? one(params.branch)
      : branches[0].id;
  const type = existing
    ? existing.type
    : COUNTER_TYPES.some((row) => row.value === one(params.type))
      ? one(params.type)
      : "DINE_IN";

  const [menu, tables, seated] = await Promise.all([
    counterMenu({ branchId, type }),
    type === "DINE_IN" && !existing ? tableOptions(principal, branchId) : [],
    type === "DINE_IN" && !existing ? tableOccupancy(principal, branchId) : {},
  ]);

  // Arriving from the floor plan, where the table was already tapped. Checked
  // against the room rather than trusted: a table id in a URL is a claim.
  const wantedTable = one(params.table);
  const initialTableId = tables.some((row) => row.id === wantedTable) ? wantedTable : "";

  const where = existing?.table?.name ? `table ${existing.table.name}` : existing?.orderNumber;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={existing ? "Add a round" : "Take an order"}
        description={
          existing
            ? `Another round for ${where}. It joins the same bill and goes to the kitchen as its own ticket.`
            : type === "PICKUP"
              ? "The same menu the website sells from. A collection order is paid here, then it goes to the kitchen."
              : "The same menu the website sells from, so the counter can never sell something the kitchen has taken off."
        }
        back={
          existing
            ? { href: `/dashboard/orders/${existing.id}`, label: existing.orderNumber }
            : { href: "/dashboard/orders", label: "Orders" }
        }
      />
      <CounterOrder
        branches={serialize(branches)}
        branchId={branchId}
        type={type}
        menu={serialize(menu)}
        tables={serialize(tables)}
        seated={serialize(seated)}
        initialTableId={initialTableId}
        addTo={existing ? serialize({ id: existing.id, orderNumber: existing.orderNumber, table: existing.table }) : null}
        currency={branches.find((row) => row.id === branchId)?.currency ?? existing?.currency ?? "PKR"}
        canCharge={can(principal, "payments.capture", { branchId })}
        canCollect={can(principal, "payments.mark_collected", { branchId })}
      />
    </div>
  );
}
