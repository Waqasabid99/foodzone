import CheckoutView from "@/components/checkout/CheckoutView";
import { getSiteIdentity } from "@/server/content/site";

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
  const { currency } = await getSiteIdentity();

  return (
    <div className="mx-auto max-w-page px-margin-mobile py-8 md:px-margin-desktop md:py-10">
      <CheckoutView currency={currency} />
    </div>
  );
}
