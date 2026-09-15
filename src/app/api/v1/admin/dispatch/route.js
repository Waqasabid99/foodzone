import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { listDeliveries } from "@/server/services/delivery.service";
import { driverPositions } from "@/server/services/driver.service";

const querySchema = z.object({ branchId: cuidSchema });

/**
 * The dispatch board: unassigned jobs, work in flight, and where the drivers
 * are — one call, because a board that needs three is a board that flickers.
 */
export const GET = apiHandler(
  { auth: true, permissions: ["deliveries.read", "drivers.track"], query: querySchema, branch: "query" },
  async ({ query }) => {
    const [pending, active, drivers] = await Promise.all([
      listDeliveries({ branchId: query.branchId, unassigned: true, limit: 100 }),
      listDeliveries({ branchId: query.branchId, limit: 100 }),
      driverPositions({ branchId: query.branchId }),
    ]);

    return ok({
      branchId: query.branchId,
      unassigned: pending.items,
      inFlight: active.items.filter((delivery) => delivery.driverId && delivery.status !== "DELIVERED"),
      drivers,
    });
  },
);
