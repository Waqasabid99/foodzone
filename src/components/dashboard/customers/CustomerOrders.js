import { ORDER_STATES, ORDER_TYPE_LABELS, PAYMENT_STATES } from "@/lib/order-status";
import { formatMoney } from "@/lib/format";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * A customer's recent orders.
 *
 * Read-only here: an order is changed on the Orders screen, where its items,
 * payments and kitchen state are. This answers "what do they order, and how
 * often", which is what someone on this page is asking.
 */
export default function CustomerOrders({ orders, currency, truncated = false, guest = false }) {
  return (
    <Section
      title="Recent orders"
      description={`The last ${orders.length === 1 ? "order" : `${orders.length} orders`}${guest ? " placed from this number" : ""}, newest first.`}
    >
      {orders.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-md">
            <caption className="sr-only">Recent orders</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="py-2 pr-4 font-normal">Order</th>
                <th scope="col" className="hidden py-2 pr-4 font-normal sm:table-cell">When</th>
                <th scope="col" className="py-2 pr-4 font-normal">Status</th>
                <th scope="col" className="py-2 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const state = ORDER_STATES[order.status] ?? { label: order.status, tone: "bg-surface-container-high text-on-surface-variant" };
                return (
                  <tr key={order.id} className="border-b border-outline-variant/60 align-top last:border-0">
                    <td className="py-3 pr-4">
                      <p className="text-label-bold text-on-surface">{order.orderNumber}</p>
                      <p className="text-on-surface-variant">
                        {ORDER_TYPE_LABELS[order.type] ?? order.type} · {order.branch.name}
                        {order._count?.items ? ` · ${order._count.items} ${order._count.items === 1 ? "item" : "items"}` : ""}
                      </p>
                      <p className="text-on-surface-variant sm:hidden">
                        {order.placedAt ? new Date(order.placedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not placed"}
                      </p>
                    </td>
                    <td className="hidden py-3 pr-4 text-on-surface-variant sm:table-cell">
                      {order.placedAt
                        ? new Date(order.placedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "Not placed"}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-label-bold ${state.tone}`}>{state.label}</span>
                      <p className="mt-1 text-on-surface-variant">{PAYMENT_STATES[order.paymentState] ?? order.paymentState}</p>
                    </td>
                    <td className="py-3 text-right tabular-nums text-on-surface">{formatMoney(Number(order.grandTotal), currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-body-md text-on-surface-variant">No orders yet.</p>
      )}

      {truncated ? (
        <p className="text-label-bold font-normal text-on-surface-variant">
          This customer has more orders than are counted here. The figures above cover their most recent 500.
        </p>
      ) : null}
    </Section>
  );
}
