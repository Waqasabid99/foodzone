import CheckoutComplete from "@/components/checkout/CheckoutComplete";

export const metadata = { title: "Confirming your payment — FoodZone", robots: { index: false, follow: false } };

/**
 * Where a hosted gateway sends the customer back.
 *
 * A thin shell on purpose. The query string a gateway appends is **not**
 * evidence: anybody can type this URL with any order id, and Safepay's own
 * documentation says to treat the webhook as the outcome and the redirect as
 * nothing more than the customer's browser arriving back. So the page states
 * no result of its own — it asks our server what it actually recorded, and
 * waits for the callback if it has not landed yet.
 */
export default async function CheckoutCompletePage({ searchParams }) {
  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  return (
    <div className="mx-auto max-w-page px-margin-mobile py-10 md:px-margin-desktop md:py-14">
      <CheckoutComplete orderId={one(params.order) ?? null} cancelled={one(params.cancelled) === "1"} />
    </div>
  );
}
