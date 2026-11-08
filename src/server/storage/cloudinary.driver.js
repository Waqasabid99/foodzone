import { env } from "@/lib/env";
import { ApiError } from "@/lib/api";
import { UploadKind } from "@/server/storage/policy";

/**
 * Cloudinary, via signed direct upload.
 *
 * The client POSTs the file straight to Cloudinary with a signature we
 * generate, so the bytes never touch our server. The signed parameters include
 * an **incoming transformation**, which means Cloudinary re-encodes the file
 * *before storing it* — this is what satisfies "compress before it reaches the
 * bucket" for this driver. `q_auto:good` is Cloudinary's perceptual quality
 * target: visually indistinguishable, typically 40-70% smaller.
 */
let cachedSdk = null;

async function sdk() {
  const config = env();
  if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
    throw ApiError.internal("Cloudinary is not configured");
  }

  if (!cachedSdk) {
    // Imported lazily so the SDK is not loaded when another driver is selected.
    const { v2 } = await import("cloudinary");
    v2.config({
      cloud_name: config.CLOUDINARY_CLOUD_NAME,
      api_key: config.CLOUDINARY_API_KEY,
      api_secret: config.CLOUDINARY_API_SECRET,
      secure: true,
    });
    cachedSdk = v2;
  }

  return cachedSdk;
}

/** Cloudinary's own notion of type, which changes the endpoint and the API calls. */
function resourceType(kind) {
  if (kind === UploadKind.VIDEO) return "video";
  if (kind === UploadKind.DOCUMENT) return "raw";
  return "image";
}

/** The public id is the storage key without its extension. */
function toPublicId(storageKey) {
  const withFolder = `${env().CLOUDINARY_FOLDER}/${storageKey}`;
  return withFolder.replace(/\.[^./]+$/, "");
}

export const cloudinaryDriver = {
  name: "cloudinary",
  supportsDirectUpload: true,

  async createUploadTarget({ storageKey, kind }) {
    const cloudinary = await sdk();
    const config = env();
    const publicId = toPublicId(storageKey);
    const timestamp = Math.floor(Date.now() / 1000);

    // Only these are signed; api_key, file, resource_type and cloud_name are not.
    const params = {
      public_id: publicId,
      timestamp,
      // Incoming transformation: what gets stored is the compressed version.
      ...(kind === UploadKind.DOCUMENT ? {} : { transformation: "q_auto:good" }),
    };

    const signature = cloudinary.utils.api_sign_request(params, config.CLOUDINARY_API_SECRET);

    return {
      provider: "cloudinary",
      method: "POST",
      url: `https://api.cloudinary.com/v1_1/${config.CLOUDINARY_CLOUD_NAME}/${resourceType(kind)}/upload`,
      // Sent as multipart/form-data alongside the `file` field.
      fields: { ...params, api_key: config.CLOUDINARY_API_KEY, signature },
      fileField: "file",
    };
  },

  /**
   * Writes bytes we produced ourselves — a rendered PDF, not a client upload.
   *
   * Sent as a data URI because the SDK's buffer path is a stream API, and the
   * documents here are tens of kilobytes. `resource_type: raw` for anything
   * that is not an image: Cloudinary would otherwise try to decode a PDF as a
   * picture and rasterise page one.
   */
  async putObject({ storageKey, buffer, mimeType = "application/octet-stream", kind }) {
    const cloudinary = await sdk();
    const type = resourceType(kind);

    const result = await cloudinary.uploader.upload(`data:${mimeType};base64,${buffer.toString("base64")}`, {
      public_id: toPublicId(storageKey),
      resource_type: type,
      overwrite: true,
      invalidate: true,
    });

    return { sizeBytes: Number(result.bytes ?? buffer.byteLength), url: result.secure_url };
  },

  async statObject({ storageKey, kind }) {
    const cloudinary = await sdk();
    try {
      const resource = await cloudinary.api.resource(toPublicId(storageKey), {
        resource_type: resourceType(kind),
      });
      return {
        exists: true,
        sizeBytes: resource.bytes,
        width: resource.width ?? null,
        height: resource.height ?? null,
        durationSeconds: resource.duration ? Math.round(resource.duration) : null,
        url: resource.secure_url,
      };
    } catch (error) {
      if (error?.http_code === 404 || error?.error?.http_code === 404) return { exists: false };
      throw error;
    }
  },

  async deleteObject({ storageKey, kind }) {
    const cloudinary = await sdk();
    await cloudinary.uploader.destroy(toPublicId(storageKey), {
      resource_type: resourceType(kind),
      invalidate: true,
    });
  },

  /**
   * One page of our folder, for the orphan sweep.
   *
   * Cloudinary partitions by resource type — an image, a video and a raw file
   * live in three separate listings — so a complete sweep has to walk all
   * three. The cursor carries both which listing we are in and Cloudinary's
   * own position inside it, so the caller still sees a single paged stream.
   *
   * The listing is narrowed to `CLOUDINARY_FOLDER`. A cloud shared with
   * another app therefore never appears here at all, which is one more layer
   * between the sweep and somebody else's files.
   */
  async listObjects({ limit = 500, cursor = null } = {}) {
    const cloudinary = await sdk();
    const config = env();
    const types = ["image", "video", "raw"];

    const [cursorType, cursorNext = null] = cursor ? String(cursor).split("|") : [];
    const type = types.includes(cursorType) ? cursorType : types[0];

    const result = await cloudinary.api.resources({
      type: "upload",
      resource_type: type,
      prefix: `${config.CLOUDINARY_FOLDER}/`,
      // Cloudinary's own ceiling for this call.
      max_results: Math.min(limit, 500),
      ...(cursorNext ? { next_cursor: cursorNext } : {}),
    });

    const prefix = `${config.CLOUDINARY_FOLDER}/`;
    const objects = (result.resources ?? []).map((resource) => {
      const publicId = String(resource.public_id ?? "");
      // Reverse of `toPublicId`: drop our folder, put the extension back.
      // Anything that is not under our folder is handed back untouched, so the
      // sweep's own key check is what refuses it.
      const withoutFolder = publicId.startsWith(prefix) ? publicId.slice(prefix.length) : publicId;
      const format = resource.format ? String(resource.format) : null;
      const storageKey = format && !withoutFolder.endsWith(`.${format}`) ? `${withoutFolder}.${format}` : withoutFolder;

      return {
        storageKey,
        uploadedAt: resource.created_at ? new Date(resource.created_at) : null,
        sizeBytes: Number(resource.bytes ?? 0),
      };
    });

    // Finish this listing, then move to the next type, then stop.
    const nextInType = result.next_cursor ? `${type}|${result.next_cursor}` : null;
    const nextType = types[types.indexOf(type) + 1] ?? null;

    return { objects, cursor: nextInType ?? nextType };
  },

  publicUrl({ storageKey, kind, width, quality = "auto" }) {
    const config = env();
    // Built by hand rather than through the SDK so this stays synchronous.
    const transforms = [`q_${quality}`, "f_auto", ...(width ? [`w_${width}`, "c_limit"] : [])].join(",");
    const type = resourceType(kind);
    const publicId = toPublicId(storageKey);

    if (type === "raw") {
      return `https://res.cloudinary.com/${config.CLOUDINARY_CLOUD_NAME}/raw/upload/${publicId}`;
    }
    return `https://res.cloudinary.com/${config.CLOUDINARY_CLOUD_NAME}/${type}/upload/${transforms}/${publicId}`;
  },
};
