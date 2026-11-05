import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import { Mail, MapPin, Phone } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import DeleteSection from "@/components/dashboard/DeleteSection";
import PriceListEditor from "@/components/dashboard/purchasing/PriceListEditor";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { itemOptions } from "@/server/content/inventory-admin";
import { supplierActivity } from "@/server/content/purchasing-admin";
import { getSupplier } from "@/server/services/supplier.service";
import { formatMoney } from "@/lib/format";
import { BILL_STATES, PO_STATES, dateLabel, outstandingOf, termLabel } from "@/lib/purchasing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Supplier — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One supplier: how to reach them, what they charge, and what has been bought.
 *
 * Deactivating rather than deleting is the normal ending, and the page says so
 * where the delete button is. Purchase orders and receipts point at a
 * supplier, and a delivery record that cannot name who brought the food is
 * useless in a recall.
 */
export default async function SupplierPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/suppliers/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "suppliers.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getSupplier(id));
  if (!raw) notFound();
  const supplier = serialize(raw);

  const [{ currency, timeZone }, items, activity] = await Promise.all([
    getSiteIdentity(),
    hasPermission(permissions, "suppliers.update") ? itemOptions() : [],
    supplierActivity(principal, id),
  ]);

  const canEdit = hasPermission(permissions, "suppliers.update");
  const canDelete = hasPermission(permissions, "suppliers.delete");
  const orders = serialize(activity.orders);
  const bills = serialize(activity.bills);
  const address = [supplier.addressLine1, supplier.city, supplier.state, supplier.country, supplier.postalCode]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={supplier.name}
        description={`${supplier.code} · pay in ${termLabel(supplier.paymentTermDays).toLowerCase()}`}
        back={{ href: "/dashboard/suppliers", label: "Suppliers" }}
        actions={
          <>
            {supplier.isActive ? null : <Chip>Not buying from them</Chip>}
            {canEdit ? (
              <Link
                href={`/dashboard/suppliers/${id}/edit`}
                className="rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Edit
              </Link>
            ) : null}
            {hasPermission(permissions, "purchase_orders.create") && supplier.isActive ? (
              <Link
                href={`/dashboard/purchase-orders/new?supplier=${id}`}
                className="rounded-field bg-primary-container px-4 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Raise an order
              </Link>
            ) : null}
          </>
        }
      />

      <Section title="Getting hold of them">
        <ul className="flex flex-col gap-2 text-body-md text-on-surface">
          {supplier.contactPerson ? <li>{supplier.contactPerson}</li> : null}
          {supplier.phone ? (
            <li className="flex items-center gap-2">
              <Phone aria-hidden="true" className="size-4 text-on-surface-variant" />
              <a href={`tel:${supplier.phone}`} className="hover:underline">{supplier.phone}</a>
            </li>
          ) : null}
          {supplier.email ? (
            <li className="flex items-center gap-2">
              <Mail aria-hidden="true" className="size-4 text-on-surface-variant" />
              <a href={`mailto:${supplier.email}`} className="break-all hover:underline">{supplier.email}</a>
            </li>
          ) : null}
          {address ? (
            <li className="flex items-start gap-2">
              <MapPin aria-hidden="true" className="mt-1 size-4 shrink-0 text-on-surface-variant" />
              <span>{address}</span>
            </li>
          ) : null}
          {supplier.taxIdentifier ? <li className="text-on-surface-variant">Tax number {supplier.taxIdentifier}</li> : null}
          {supplier.creditLimit ? (
            <li className="text-on-surface-variant">Credit limit {formatMoney(supplier.creditLimit, currency)}</li>
          ) : null}
          {supplier.notes ? <li className="text-on-surface-variant">“{supplier.notes}”</li> : null}
        </ul>
      </Section>

      <PriceListEditor supplierId={id} currency={currency} rows={supplier.items} items={serialize(items)} canEdit={canEdit} />

      {hasPermission(permissions, "purchase_orders.read") ? (
        <Section title="Recent orders" description="Only orders at branches you can see.">
          {orders.length ? (
            <ul className="flex flex-col gap-2">
              {orders.map((order) => (
                <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/purchase-orders/${order.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                      {order.poNumber}
                    </Link>
                    <Chip tone={PO_STATES[order.status]?.tone}>{PO_STATES[order.status]?.label ?? order.status}</Chip>
                    <span className="text-body-md text-on-surface-variant">{dateLabel(order.orderDate, timeZone)}</span>
                  </span>
                  <span className="tabular-nums text-body-md text-on-surface">{formatMoney(order.grandTotal, order.currency ?? currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">Nothing ordered from them yet.</p>
          )}
        </Section>
      ) : null}

      {hasPermission(permissions, "supplier_bills.read") ? (
        <Section title="Recent bills">
          {bills.length ? (
            <ul className="flex flex-col gap-2">
              {bills.map((bill) => (
                <li key={bill.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/supplier-bills/${bill.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                      {bill.billNumber}
                    </Link>
                    <Chip tone={BILL_STATES[bill.status]?.tone}>{BILL_STATES[bill.status]?.label ?? bill.status}</Chip>
                    <span className="text-body-md text-on-surface-variant">{dateLabel(bill.billDate)}</span>
                  </span>
                  <span className="tabular-nums text-body-md text-on-surface">
                    {formatMoney(outstandingOf(bill), bill.currency ?? currency)} owed
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">No invoices from them yet.</p>
          )}
        </Section>
      ) : null}

      {canDelete ? (
        <DeleteSection
          title="Delete this supplier"
          description="Only possible while nothing has ever been ordered from them. Once there is purchase history the record has to stay — a delivery that cannot name who brought the food is useless in a recall — so turn off “buying from them” instead."
          endpoint={`/admin/suppliers/${id}`}
          confirm={`Delete ${supplier.name}?`}
          redirectTo="/dashboard/suppliers"
          success={`${supplier.name} deleted.`}
        />
      ) : null}
    </div>
  );
}
