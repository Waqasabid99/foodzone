import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Local disk, for development and for self-hosted deployments that keep files
 * on a mounted volume.
 *
 * There is no third party to sign an upload for, so the "signed target" is our
 * own route, authorised by the same upload ticket the other drivers use. The
 * bytes do pass through the server here — unavoidable without a provider, and
 * acceptable because this driver is not for serverless.
 *
 * Never select this on Vercel or any read-only/ephemeral filesystem: writes
 * either fail or vanish on the next deploy.
 */
function root() {
  // turbopackIgnore keeps the bundler from tracing the whole project into the
  // server output just because this path is computed at runtime.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env().UPLOAD_DIR);
}

/**
 * Resolves a key inside the upload root, refusing anything that escapes it.
 * Keys are server-generated, but this is the last line against traversal.
 */
export function resolveLocalPath(storageKey) {
  const base = root();
  const target = path.resolve(/*turbopackIgnore: true*/ base, storageKey);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return target;
}

export const localDriver = {
  name: "local",
  supportsDirectUpload: false,

  async createUploadTarget({ storageKey, mimeType, ticket }) {
    return {
      provider: "local",
      method: "PUT",
      // Relative on purpose: the client already knows the API's origin, and
      // hard-coding one breaks behind a proxy or in the mobile app.
      url: `/api/v1/media/local/${encodeURIComponent(ticket)}`,
      headers: { "content-type": mimeType },
      storageKey,
    };
  },

  async writeObject({ storageKey, buffer }) {
    const target = resolveLocalPath(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    return { sizeBytes: buffer.byteLength };
  },

  async readObject({ storageKey }) {
    return fs.readFile(resolveLocalPath(storageKey));
  },

  async statObject({ storageKey }) {
    try {
      const stat = await fs.stat(resolveLocalPath(storageKey));
      return { exists: true, sizeBytes: stat.size, url: this.publicUrl({ storageKey }) };
    } catch (error) {
      if (error.code === "ENOENT") return { exists: false };
      throw error;
    }
  },

  async deleteObject({ storageKey }) {
    try {
      await fs.unlink(resolveLocalPath(storageKey));
    } catch (error) {
      // Already gone is the desired end state, not an error.
      if (error.code !== "ENOENT") throw error;
    }
  },

  publicUrl({ storageKey }) {
    return `${env().APP_URL.replace(/\/$/, "")}/api/v1/media/file/${storageKey}`;
  },
};
