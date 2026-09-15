import crypto from "node:crypto";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/api";

/**
 * What may be uploaded, how large, and how the client should compress it first.
 *
 * With direct-to-provider uploads the file never passes through our server, so
 * we cannot compress it on the way past. Compression therefore happens in two
 * places, and the policy below is what makes both consistent:
 *
 *   * the client compresses before uploading, following `compression` here
 *     (Expo: expo-image-manipulator / expo-video-compressor; web: canvas or
 *     WebCodecs)
 *   * Cloudinary additionally applies an incoming transformation, so what is
 *     stored is already re-encoded — see the cloudinary driver
 *
 * Neither is trusted: `confirmUpload` reads the object's real size back from
 * the provider and rejects anything over the ceiling, so a client that skips
 * compression simply fails.
 */

export const UploadKind = {
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
  DOCUMENT: "DOCUMENT",
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const DOCUMENT_TYPES = ["application/pdf", "text/csv", "text/plain"];

export function uploadPolicies() {
  const config = env();

  return {
    [UploadKind.IMAGE]: {
      kind: UploadKind.IMAGE,
      mimeTypes: IMAGE_TYPES,
      maxBytes: config.MAX_IMAGE_UPLOAD_BYTES,
      // Long edge 2000px covers a full-bleed hero on a 2x display; 0.82 JPEG
      // quality is the point where artefacts stop being visible while file size
      // drops by roughly two thirds.
      compression: {
        required: true,
        maxWidth: 2000,
        maxHeight: 2000,
        quality: 0.82,
        preferredFormat: "webp",
        note: "Resize so the longest edge is at most 2000px, then encode at ~0.82 quality before uploading.",
      },
    },
    [UploadKind.VIDEO]: {
      kind: UploadKind.VIDEO,
      mimeTypes: VIDEO_TYPES,
      maxBytes: config.MAX_VIDEO_UPLOAD_BYTES,
      // 720p/2.5Mbps keeps a 30-second creator video near 10MB, which uploads
      // reliably over mobile data.
      compression: {
        required: true,
        maxWidth: 1280,
        maxHeight: 1280,
        maxBitrateKbps: 2500,
        preferredFormat: "mp4",
        note: "Transcode to H.264 mp4, longest edge at most 1280px, around 2.5 Mbps, before uploading.",
      },
    },
    [UploadKind.DOCUMENT]: {
      kind: UploadKind.DOCUMENT,
      mimeTypes: DOCUMENT_TYPES,
      maxBytes: config.MAX_DOCUMENT_UPLOAD_BYTES,
      compression: { required: false },
    },
  };
}

export function resolveKind(mimeType) {
  if (IMAGE_TYPES.includes(mimeType)) return UploadKind.IMAGE;
  if (VIDEO_TYPES.includes(mimeType)) return UploadKind.VIDEO;
  if (DOCUMENT_TYPES.includes(mimeType)) return UploadKind.DOCUMENT;
  return null;
}

/** Validates a requested upload against the policy, before any signing happens. */
export function assertUploadAllowed({ mimeType, sizeBytes }) {
  const kind = resolveKind(mimeType);
  if (!kind) {
    throw ApiError.validation("That file type is not supported", {
      mimeType: [`Allowed: ${[...IMAGE_TYPES, ...VIDEO_TYPES, ...DOCUMENT_TYPES].join(", ")}`],
    });
  }

  const policy = uploadPolicies()[kind];
  if (sizeBytes > policy.maxBytes) {
    throw ApiError.validation(
      `That file is too large. The limit for ${kind.toLowerCase()}s is ${formatBytes(policy.maxBytes)}.`,
      { sizeBytes: [`Maximum ${policy.maxBytes} bytes`] },
    );
  }

  return policy;
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "text/csv": "csv",
  "text/plain": "txt",
};

export function extensionFor(mimeType) {
  return EXTENSIONS[mimeType] ?? "bin";
}

/**
 * Date-partitioned, random object keys.
 *
 * Random rather than derived from the filename: a predictable key lets someone
 * guess another customer's receipt URL, and a user-supplied name is a path
 * traversal waiting to happen.
 */
export function buildStorageKey({ ownerType, mimeType }) {
  const now = new Date();
  const folder = String(ownerType ?? "misc")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = crypto.randomBytes(16).toString("hex");

  return `${folder || "misc"}/${year}/${month}/${id}.${extensionFor(mimeType)}`;
}
