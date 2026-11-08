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

  /**
   * Writes bytes we produced ourselves.
   *
   * The upload flow has no path for this: it signs a target for a *client* to
   * send to. A PDF rendered on the server has no client, so every driver needs
   * one way to put bytes somewhere directly.
   */
  async putObject({ storageKey, buffer }) {
    const result = await this.writeObject({ storageKey, buffer });
    return { ...result, url: this.publicUrl({ storageKey }) };
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

  /**
   * Everything in the upload root, for the orphan sweep.
   *
   * `mtime` rather than `birthtime`: not every filesystem records a creation
   * time, and the ones that do not report it as the epoch — which would make
   * every file look ancient to a sweep that deletes by age.
   *
   * A missing root is an empty listing, not an error: a fresh install has
   * never taken an upload.
   */
  async listObjects({ limit = 1000 } = {}) {
    const base = root();
    const objects = [];

    async function walk(directory) {
      if (objects.length >= limit) return;

      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }

      for (const entry of entries) {
        if (objects.length >= limit) return;
        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;

        const stat = await fs.stat(full);
        objects.push({
          // Posix separators, because that is the shape of a storage key on
          // every other driver and the sweep compares keys as strings.
          storageKey: path.relative(base, full).split(path.sep).join("/"),
          uploadedAt: stat.mtime,
          sizeBytes: stat.size,
        });
      }
    }

    await walk(base);
    return { objects, cursor: null };
  },

  publicUrl({ storageKey }) {
    return `${env().APP_URL.replace(/\/$/, "")}/api/v1/media/file/${storageKey}`;
  },
};
