import { cookies } from "next/headers";
import CheckoutView from "@/components/checkout/CheckoutView";
import { getSiteIdentity } from "@/server/content/site";
import { TABLE_COOKIE } from "@/lib/table-context";
import { tableForCheckout } from "@/server/content/table-context";

export const metadata = {
  title: "Checkout — FoodZone",
  robots: { index: false, follow: false },
};

/**
 * Checkout.
 *
 * A thin server shell, like the basket and for the same reason: a guest's cart
 * is matched by a session id kept in `localStorage`, which the server never
 * sees. Only the currency default is resolved here, from cached settings, so
 * the page has something sensible to format with before the cart arrives.
 *
 * Even the heading belongs to the client component: once an order is placed the
 * page is a receipt, and "Last look before the kitchen starts" sitting above a
 * confirmed order reads as though nothing happened.
 */
export default async function CheckoutPage() {
  const [{ currency }, cookieStore] = await Promise.all([getSiteIdentity(), cookies()]);

  // The cookie is a hint left by a scanned table code; the table row is the
  // authority. One that has been deleted or switched off resolves to nothing
  // rather than tagging an order for a seat that no longer exists.
  const table = await tableForCheckout(cookieStore.get(TABLE_COOKIE)?.value ?? null);

  return (
    <div className="mx-auto max-w-page px-margin-mobile py-8 md:px-margin-desktop md:py-10">
      <CheckoutView currency={currency} tableId={table?.id ?? null} tableName={table?.name ?? null} />
    </div>
  );
}
