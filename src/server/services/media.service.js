import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";
import { signUploadTicket, verifyUploadTicket } from "@/lib/api/tokens";
import { can } from "@/lib/api/permissions";
import { storage, storageDriverName } from "@/server/storage";
import { assertUploadAllowed, buildStorageKey, resolveKind, uploadPolicies } from "@/server/storage/policy";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

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
 * Deletes the object and then the row.
 *
 * Object first: a row without its file shows a broken image, while a file
 * without its row is invisible and reclaimable. The first failure mode is worse.
 */
export async function deleteAsset({ id, principal }) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) throw ApiError.notFound("File not found");

  const isUploader = asset.uploadedById === principal.userId;
  if (!isUploader && !can(principal, "media.delete")) {
    throw ApiError.forbidden("You cannot delete this file", { required: ["media.delete"] });
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
