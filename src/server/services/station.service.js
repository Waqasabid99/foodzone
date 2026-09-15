import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";

/**
 * Kitchen stations: where a ticket prints.
 *
 * Small module, but it is what makes a KDS possible later — every product
 * routes to a station, and the kitchen display filters its queue by one.
 */

const SELECT = {
  id: true,
  name: true,
  code: true,
  printerId: true,
  sortOrder: true,
  isActive: true,
};

export async function listStations({ isActive } = {}) {
  const rows = await prisma.kitchenStation.findMany({
    where: { ...(isActive !== undefined ? { isActive } : {}) },
    select: { ...SELECT, _count: { select: { products: { where: { deletedAt: null } } } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return rows.map(({ _count, ...row }) => ({ ...row, productCount: _count.products }));
}

export async function createStation(data) {
  const clash = await prisma.kitchenStation.findUnique({ where: { code: data.code }, select: { id: true } });
  if (clash) throw ApiError.conflict(`A station with code "${data.code}" already exists`);

  return prisma.kitchenStation.create({ data, select: SELECT });
}

export async function updateStation(id, data) {
  const station = await prisma.kitchenStation.findUnique({ where: { id }, select: { id: true } });
  if (!station) throw ApiError.notFound("Kitchen station not found");

  if (data.code) {
    const clash = await prisma.kitchenStation.findFirst({
      where: { code: data.code, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`A station with code "${data.code}" already exists`);
  }

  return prisma.kitchenStation.update({ where: { id }, data, select: SELECT });
}

/**
 * Products keep working without a station — the ticket just prints nowhere in
 * particular — so unrouting them is safe, unlike deleting a category.
 */
export async function deleteStation(id) {
  const station = await prisma.kitchenStation.findUnique({
    where: { id },
    select: { id: true, _count: { select: { orderItems: true } } },
  });
  if (!station) throw ApiError.notFound("Kitchen station not found");

  // Order history points at the station it was cooked by; that reference is a
  // record of what happened and must not be rewritten.
  if (station._count.orderItems > 0) {
    throw ApiError.conflict("This station appears in order history. Deactivate it instead of deleting it.");
  }

  await prisma.$transaction([
    prisma.product.updateMany({ where: { stationId: id }, data: { stationId: null } }),
    prisma.kitchenStation.delete({ where: { id } }),
  ]);

  return { deleted: true, id };
}
