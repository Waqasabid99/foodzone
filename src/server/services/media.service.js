import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";
import { signUploadTicket, verifyUploadTicket } from "@/lib/api/tokens";
import { can } from "@/lib/api/permissions";
import { storage, storageDriverName } from "@/server/storage";
import { assertUploadAllowed, buildStorageKey, resolveKind, uploadPolicies } from "@/server/storage/policy";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { isSweepableKey, planUploadSweep, SWEEP_GRACE_MINUTES, SWEEP_LIMIT } from "@/server/ops/upload-sweep";

/**
 * Uploads happen in three steps:
 *
 *   1. POST /media/uploads          → we sign a target and hand back a ticket
 *   2. client PUT/POST to the provider → bytes go straight to storage
 *   3. POST /media/uploads/confirm  → we verify the object and record it
 *
 * The MediaAsset row is only written at step 3, so a failed or abandoned upload
 * leaves no database record — at worst an unreferenced object in the bucket,
 * which a sweep can collect later.
 */

function assetView(asset) {
  return {
    id: asset.id,
    url: asset.url,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    ownerType: asset.ownerType,
    ownerId: asset.ownerId,
    uploadedById: asset.uploadedById,
    createdAt: asset.createdAt,
  };
}

/** Step 1: validate, sign, and describe exactly how the client should upload. */
export async function requestUpload({ principal, mimeType, sizeBytes, ownerType = null, ownerId = null }) {
  const policy = assertUploadAllowed({ mimeType, sizeBytes });
  const storageKey = buildStorageKey({ ownerType, mimeType });
  const kind = resolveKind(mimeType);

  const ticket = signUploadTicket({
    sub: principal.userId,
    storageKey,
    mimeType,
    sizeBytes,
    kind,
    ownerType,
    ownerId,
  });

  const target = await (await storage()).createUploadTarget({ storageKey, mimeType, sizeBytes, kind, ticket });

  return {
    ticket,
    storageKey,
    driver: storageDriverName(),
    upload: target,
    // The client applies these before uploading; the confirm step verifies the
    // result rather than trusting that it did.
    policy: {
      kind,
      maxBytes: policy.maxBytes,
      compression: policy.compression,
    },
    expiresAt: new Date(Date.now() + env().UPLOAD_TICKET_TTL_SECONDS * 1000),
  };
}

/**
 * Step 3: confirm.
 *
 * Reads the object's real size back from the provider. This is the only
 * enforcement that matters — the size the client declared in step 1 was a
 * promise, this is the fact.
 */
export async function confirmUpload({ principal, ticket }) {
  const claims = verifyUploadTicket(ticket);
  if (!claims) throw ApiError.validation("That upload ticket is invalid or has expired");
  if (claims.sub !== principal.userId) throw ApiError.forbidden("That upload ticket belongs to someone else");

  const existing = await prisma.mediaAsset.findUnique({ where: { storageKey: claims.storageKey } });
  // Confirming twice is not an error: the client may have retried.
  if (existing) return assetView(existing);

  const driver = await storage();
  const stat = await driver.statObject({ storageKey: claims.storageKey, kind: claims.kind });

  if (!stat.exists) {
    throw ApiError.validation("No uploaded file was found for that ticket", {
      ticket: ["Upload the file before confirming"],
    });
  }

  const policy = uploadPolicies()[claims.kind];
  if (stat.sizeBytes > policy.maxBytes) {
    // Reject and clean up: an oversized object must not linger in the bucket.
    await driver.deleteObject({ storageKey: claims.storageKey, kind: claims.kind }).catch((error) =>
      logger.error("failed to delete an oversized upload", { storageKey: claims.storageKey, error: error.message }),
    );
    throw ApiError.validation("The uploaded file exceeds the size limit — compress it and try again", {
      sizeBytes: [`Maximum ${policy.maxBytes} bytes, received ${stat.sizeBytes}`],
    });
  }

  const asset = await prisma.mediaAsset.create({
    data: {
      url: stat.url ?? driver.publicUrl({ storageKey: claims.storageKey, kind: claims.kind }),
      storageKey: claims.storageKey,
      mimeType: claims.mimeType,
      sizeBytes: stat.sizeBytes,
      width: stat.width ?? null,
      height: stat.height ?? null,
      durationSeconds: stat.durationSeconds ?? null,
      ownerType: claims.ownerType,
      ownerId: claims.ownerId,
      uploadedById: principal.userId,
    },
  });

  return assetView(asset);
}

/** The local driver's receiving end: the only path where bytes touch our server. */
export async function storeLocalUpload({ ticket, buffer }) {
  const claims = verifyUploadTicket(ticket);
  if (!claims) throw ApiError.validation("That upload ticket is invalid or has expired");

  const policy = uploadPolicies()[claims.kind];
  if (buffer.byteLength > policy.maxBytes) throw ApiError.tooLarge("The uploaded file exceeds the size limit");

  const driver = await storage();
  if (typeof driver.writeObject !== "function") {
    throw ApiError.notFound("Direct uploads are not handled by this server");
  }

  await driver.writeObject({ storageKey: claims.storageKey, buffer });
  return { stored: true, storageKey: claims.storageKey, sizeBytes: buffer.byteLength };
}

export async function getAsset(id) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) throw ApiError.notFound("File not found");
  return assetView(asset);
}

export async function getAssetByStorageKey(storageKey) {
  return prisma.mediaAsset.findUnique({ where: { storageKey } });
}

export async function listAssets({ ownerType, ownerId, mimeType, limit = 20, cursor }) {
  const rows = await prisma.mediaAsset.findMany({
    where: {
      ...(ownerType ? { ownerType } : {}),
      ...(ownerId ? { ownerId } : {}),
      ...(mimeType ? { mimeType: { startsWith: mimeType } } : {}),
    },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(assetView) };
}

/**
 * Everything pointing at this file, by the URL it is stored under.
 *
 * Images are referenced as plain URLs on the records that use them rather than
 * by a foreign key, so there is no constraint to lean on — this asks each
 * surface that can hold one. Used to refuse a delete that would leave a
 * product on the live menu with a broken picture.
 */
export async function assetUsage(asset) {
  const url = asset.url;
  const [products, images, categories, sections, items, qrCodes, users] = await Promise.all([
    prisma.product.findMany({ where: { imageUrl: url, deletedAt: null }, select: { id: true, name: true }, take: 5 }),
    prisma.productImage.findMany({ where: { url }, select: { id: true, product: { select: { id: true, name: true } } }, take: 5 }),
    prisma.category.findMany({ where: { imageUrl: url }, select: { id: true, name: true }, take: 5 }),
    prisma.menuSection.findMany({ where: { imageUrl: url }, select: { id: true, name: true }, take: 5 }),
    prisma.inventoryItem.findMany({ where: { imageUrl: url }, select: { id: true, name: true }, take: 5 }),
    prisma.qrCode.findMany({ where: { imageUrl: url }, select: { id: true, label: true }, take: 5 }),
    prisma.user.findMany({ where: { avatarUrl: url, deletedAt: null }, select: { id: true, name: true }, take: 5 }),
  ]);

  return [
    ...products.map((row) => ({ kind: "Product", id: row.id, name: row.name, href: `/dashboard/products/${row.id}` })),
    ...images.map((row) => ({ kind: "Product photo", id: row.product.id, name: row.product.name, href: `/dashboard/products/${row.product.id}` })),
    ...categories.map((row) => ({ kind: "Category", id: row.id, name: row.name, href: `/dashboard/categories` })),
    ...sections.map((row) => ({ kind: "Menu section", id: row.id, name: row.name, href: `/dashboard/menus` })),
    ...items.map((row) => ({ kind: "Stock item", id: row.id, name: row.name, href: `/dashboard/inventory-items/${row.id}` })),
    ...qrCodes.map((row) => ({ kind: "QR code", id: row.id, name: row.label ?? "QR code", href: `/dashboard/qr-codes` })),
    ...users.map((row) => ({ kind: "Profile photo", id: row.id, name: row.name, href: `/dashboard/users/${row.id}` })),
  ];
}

/**
 * Deletes the object and then the row.
 *
 * Object first: a row without its file shows a broken image, while a file
 * without its row is invisible and reclaimable. The first failure mode is worse.
 *
 * A file something is still using is refused, naming what to detach first — a
 * deleted image does not break quietly, it breaks on the storefront.
 */
export async function deleteAsset({ id, principal }) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) throw ApiError.notFound("File not found");

  const isUploader = asset.uploadedById === principal.userId;
  if (!isUploader && !can(principal, "media.delete")) {
    throw ApiError.forbidden("You cannot delete this file", { required: ["media.delete"] });
  }

  const usedBy = await assetUsage(asset);
  if (usedBy.length) {
    throw ApiError.conflict(`This file is still used by ${usedBy.map((row) => `${row.kind.toLowerCase()} “${row.name}”`).join(", ")}`, {
      usedBy,
      hint: "Replace or remove it there first",
    });
  }

  await (await storage()).deleteObject({ storageKey: asset.storageKey, kind: resolveKind(asset.mimeType) });
  await prisma.mediaAsset.delete({ where: { id } });

  return { deleted: true };
}

/** Attaches an already-uploaded asset to a record, once that record exists. */
export async function attachAsset({ id, ownerType, ownerId }) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) throw ApiError.notFound("File not found");

  const updated = await prisma.mediaAsset.update({
    where: { id },
    data: { ownerType, ownerId },
  });
  return assetView(updated);
}

/**
 * Deletes objects that were uploaded but never confirmed.
 *
 * The three-step flow above writes the `MediaAsset` row at confirm, so a
 * client that asks for a ticket, sends the bytes and then closes the tab
 * leaves a file in the bucket that nothing in the database points to. Nobody
 * will ever see it again and it is billed every month, so something has to go
 * and look.
 *
 * It has to look at the *bucket*, not the database: the defining property of
 * an orphan is that no row mentions it. That makes this the only housekeeping
 * job that deletes data with no transaction behind it, so the rules live in
 * `planUploadSweep`, where they are unit-tested, and this function does only
 * the parts that need the provider and the database:
 *
 *   * page through the bucket, with a budget, so a huge bucket is swept across
 *     several runs rather than one request that times out;
 *   * ask the database about *only the keys on this page* — a `storageKey IN
 *     (...)` of a few hundred, never a full table read;
 *   * delete one object at a time, and let a single failure be logged and
 *     skipped rather than abandoning the run.
 *
 * `dryRun` reports exactly what it would delete and touches nothing, which is
 * how this should be run the first time against any real bucket.
 */
export async function sweepOrphanedUploads({
  dryRun = false,
  minAgeMinutes = SWEEP_GRACE_MINUTES,
  limit = SWEEP_LIMIT,
  maxPages = 20,
  now = new Date(),
} = {}) {
  const driver = await storage();
  const driverName = storageDriverName();

  if (typeof driver.listObjects !== "function") {
    // A driver that cannot enumerate cannot be swept. Say so rather than
    // reporting a clean bucket, which is the same output as "found nothing".
    logger.warn("upload sweep skipped: driver cannot list objects", { driver: driverName });
    return { driver: driverName, skipped: true, reason: "DRIVER_CANNOT_LIST", deleted: 0, bytes: 0 };
  }

  const totals = {
    driver: driverName,
    dryRun,
    scanned: 0,
    deleted: 0,
    failed: 0,
    bytes: 0,
    deferred: 0,
    counts: { confirmed: 0, tooNew: 0, undated: 0, ignored: 0 },
    pages: 0,
  };
  const removed = [];
  let cursor = null;
  let budget = limit;

  for (let page = 0; page < maxPages && budget > 0; page += 1) {
    const listing = await driver.listObjects({ limit: 500, cursor });
    totals.pages += 1;
    const objects = listing?.objects ?? [];

    // Only the keys we could ever delete are worth a database round trip.
    const candidateKeys = objects.map((object) => object.storageKey).filter((key) => isSweepableKey(key));
    const known = candidateKeys.length
      ? await prisma.mediaAsset.findMany({ where: { storageKey: { in: candidateKeys } }, select: { storageKey: true } })
      : [];

    const plan = planUploadSweep({
      objects,
      knownKeys: new Set(known.map((row) => row.storageKey)),
      now,
      minAgeMinutes,
      limit: budget,
    });

    totals.scanned += plan.scanned;
    totals.deferred += plan.deferred;
    for (const reason of Object.keys(totals.counts)) totals.counts[reason] += plan.counts[reason];

    for (const storageKey of plan.remove) {
      const object = objects.find((candidate) => candidate.storageKey === storageKey);
      const size = Number(object?.sizeBytes ?? 0);

      if (dryRun) {
        removed.push(storageKey);
        totals.deleted += 1;
        totals.bytes += size;
        budget -= 1;
        continue;
      }

      try {
        await driver.deleteObject({ storageKey, kind: resolveKind(mimeFromKey(storageKey)) });
        removed.push(storageKey);
        totals.deleted += 1;
        totals.bytes += size;
      } catch (error) {
        // One object that refuses to go must not cost the rest of the run.
        totals.failed += 1;
        logger.error("failed to sweep an orphaned upload", { storageKey, driver: driverName, error: error.message });
      }
      budget -= 1;
    }

    cursor = listing?.cursor ?? null;
    if (!cursor) break;
  }

  // Logged whatever the outcome: a sweep that deleted nothing is the normal
  // case, and the only way to know it ran is this line.
  logger[totals.deleted || totals.failed ? "warn" : "info"]("orphaned upload sweep", {
    driver: driverName,
    dryRun,
    scanned: totals.scanned,
    deleted: totals.deleted,
    failed: totals.failed,
    bytes: totals.bytes,
    deferred: totals.deferred,
    ...totals.counts,
  });

  // The keys are returned for a dry run — somebody deciding whether to let this
  // loose on a real bucket needs to see the list, not a count.
  return { ...totals, removed: dryRun ? removed : removed.length };
}

/**
 * The mime type a key implies, from its extension.
 *
 * Only the *kind* matters here (image, video, raw), because that is all
 * `deleteObject` needs to find the object on a provider that partitions by
 * type. A key with an extension we do not recognise is treated as a document,
 * which is the kind whose delete path makes no assumptions.
 */
function mimeFromKey(storageKey) {
  const extension = String(storageKey).split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif", "avif", "svg"].includes(extension)) return `image/${extension}`;
  if (["mp4", "mov", "webm", "m4v"].includes(extension)) return `video/${extension}`;
  return "application/octet-stream";
}
