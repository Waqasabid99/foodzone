import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";

/**
 * The customer address book.
 *
 * Addresses are soft-deleted: past orders snapshot the address they were
 * delivered to, but they also reference the row, and a customer removing an old
 * address must not break their order history.
 *
 * Exactly one address is the default. That invariant is maintained in a
 * transaction on every write, because two defaults makes checkout ambiguous.
 */
const ADDRESS_SELECT = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  line1: true,
  line2: true,
  landmark: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  latitude: true,
  longitude: true,
  deliveryNote: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
};

export async function listAddresses({ userId }) {
  return prisma.address.findMany({
    where: { userId, deletedAt: null },
    select: ADDRESS_SELECT,
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

async function findOwnedAddress(userId, addressId) {
  const address = await prisma.address.findFirst({
    where: { id: addressId, userId, deletedAt: null },
    select: ADDRESS_SELECT,
  });
  // Not found and not yours are the same answer: otherwise the endpoint
  // confirms which address ids exist.
  if (!address) throw ApiError.notFound("Address not found");
  return address;
}

export async function getAddress({ userId, addressId }) {
  return findOwnedAddress(userId, addressId);
}

export async function createAddress({ userId, data }) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.address.count({ where: { userId, deletedAt: null } });
    // The first address is always the default, whatever the client asked for.
    const isDefault = count === 0 ? true : Boolean(data.isDefault);

    if (isDefault && count > 0) {
      await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }

    return tx.address.create({
      data: { ...data, isDefault, userId },
      select: ADDRESS_SELECT,
    });
  });
}

export async function updateAddress({ userId, addressId, data }) {
  await findOwnedAddress(userId, addressId);

  return prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.address.updateMany({
        where: { userId, isDefault: true, id: { not: addressId } },
        data: { isDefault: false },
      });
    }

    // Refuse to leave the book with no default.
    if (data.isDefault === false) {
      const current = await tx.address.findUnique({ where: { id: addressId }, select: { isDefault: true } });
      if (current?.isDefault) {
        throw ApiError.validation("Set another address as default instead of unsetting this one");
      }
    }

    return tx.address.update({ where: { id: addressId }, data, select: ADDRESS_SELECT });
  });
}

export async function deleteAddress({ userId, addressId }) {
  const address = await findOwnedAddress(userId, addressId);

  await prisma.$transaction(async (tx) => {
    await tx.address.update({ where: { id: addressId }, data: { deletedAt: new Date(), isDefault: false } });

    // Promote the most recent remaining address so the customer always has one.
    if (address.isDefault) {
      const next = await tx.address.findFirst({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });

  return { deleted: true };
}

export async function setDefaultAddress({ userId, addressId }) {
  await findOwnedAddress(userId, addressId);

  await prisma.$transaction([
    prisma.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    prisma.address.update({ where: { id: addressId }, data: { isDefault: true } }),
  ]);

  return listAddresses({ userId });
}
