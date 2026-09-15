import { env } from "@/lib/env";

/**
 * One storage interface, three implementations, chosen by `STORAGE_DRIVER`.
 *
 * Every driver exposes the same operations, so nothing above this layer knows
 * which provider is in use. Moving from Cloudinary to R2 is an env change plus
 * a migration of the existing objects — no code change.
 *
 *   createUploadTarget → where and how the client should send the bytes
 *   statObject         → does it exist, and how big is it really
 *   deleteObject       → remove it
 *   publicUrl          → the URL to serve it from
 *
 * Drivers are imported lazily and cached: without that, every route that
 * touches storage pulls in the AWS SDK, the Cloudinary SDK and `node:fs`,
 * which bloats the bundle and slows cold starts on serverless.
 */
const cache = new Map();

const LOADERS = {
  cloudinary: async () => (await import("@/server/storage/cloudinary.driver")).cloudinaryDriver,
  s3: async () => (await import("@/server/storage/s3.driver")).s3Driver,
  local: async () => (await import("@/server/storage/local.driver")).localDriver,
};

export async function storage() {
  const name = storageDriverName();
  if (!cache.has(name)) cache.set(name, await (LOADERS[name] ?? LOADERS.local)());
  return cache.get(name);
}

export function storageDriverName() {
  const configured = env().STORAGE_DRIVER;
  return LOADERS[configured] ? configured : "local";
}
