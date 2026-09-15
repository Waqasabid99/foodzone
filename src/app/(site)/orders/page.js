import Link from "next/link";
import { getAuthContext } from "@/lib/api/session";
import { listOrders } from "@/server/services/order.service";
import { formatDateTime } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const auth = await getAuthContext();

  if (!auth) {
    return (
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-20 text-center">
        <p className="text-neutral-500 mb-4">Log in to view your orders.</p>
        <Link href="/login" className="text-red-600 font-medium hover:underline">
          Log in
        </Link>
      </div>
    );
  }

  const orders = await listOrders({ userId: auth.userId });

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl font-bold text-neutral-900 mb-8">My Orders</h1>

      {orders.length === 0 ? (
        <p className="text-neutral-500">You haven&apos;t placed any orders yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {orders?.map((order) => (
            <div key={order.id} className="rounded-xl border border-neutral-200 bg-white p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-neutral-500">
                  {formatDateTime(order.createdAt)}
                </span>
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
                  {order.status}
                </span>
              </div>
              <ul className="text-sm text-neutral-700 flex flex-col gap-1 mb-3">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between">
                    <span>
                      {item.quantity} × {item.product.name}
                    </span>
                    <span>${item.lineTotal.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-neutral-100 pt-3 font-semibold text-neutral-900">
                <span>Total</span>
                <span>${order.totalAmount.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
