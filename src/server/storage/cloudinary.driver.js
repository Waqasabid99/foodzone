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
