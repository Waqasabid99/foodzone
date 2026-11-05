import { api } from "@/lib/api-client";

/**
 * Uploading an image from the browser, through whichever storage driver the
 * server is configured with.
 *
 * Three steps, and the file never passes through our API except on the local
 * driver:
 *
 *   1. ask for a signed target        POST /media/uploads
 *   2. send the bytes to it           PUT (S3, R2, local) or multipart POST (Cloudinary)
 *   3. confirm it landed              POST /media/uploads/confirm
 *
 * The server's policy says to compress first, and confirm rejects anything over
 * the ceiling, so compression is not optional polish: a 9MB photo straight off
 * a phone is simply refused. It happens here, before step 1, so the size we
 * declare is the size we send — S3 signs the length into the URL and rejects a
 * mismatch.
 */

/** Longest edge and quality, matching `uploadPolicies().IMAGE.compression`. */
export const IMAGE_MAX_EDGE = 2000;
export const IMAGE_QUALITY = 0.82;

/** Scales `width × height` to fit inside a square of `maxEdge`, never enlarging. */
export function fitWithin(width, height, maxEdge = IMAGE_MAX_EDGE) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class UploadError extends Error {}

async function compress(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC above all: iPhones produce it and most desktop browsers cannot
    // decode it. Better said plainly than as a failed upload later.
    throw new UploadError("This image format can't be read in this browser. Use a JPEG, PNG or WebP.");
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", IMAGE_QUALITY));
  // Safari before 17 cannot encode WebP and hands back PNG or nothing; JPEG is
  // universal.
  if (blob?.type === "image/webp") return blob;
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", IMAGE_QUALITY));
  if (!jpeg) throw new UploadError("The image could not be prepared for upload.");
  return jpeg;
}

/**
 * Sends the bytes where the ticket points.
 *
 * Exported because video uploads need exactly this and nothing else from the
 * image path: a presigned target may be a PUT or a form POST depending on the
 * driver, and a caller that only handles PUT works until the day storage
 * changes.
 */
export async function sendBytes(target, blob) {
  let response;

  if (target.method === "POST") {
    const form = new FormData();
    for (const [key, value] of Object.entries(target.fields ?? {})) form.append(key, value);
    form.append(target.fileField ?? "file", blob);
    response = await fetch(target.url, { method: "POST", body: form });
  } else {
    // `content-length` is a forbidden header in browsers; fetch sets it from
    // the blob, which is the size we declared.
    const headers = Object.fromEntries(
      Object.entries(target.headers ?? {}).filter(([name]) => name.toLowerCase() !== "content-length"),
    );
    response = await fetch(target.url, { method: "PUT", headers, body: blob });
  }

  if (!response.ok) throw new UploadError("The image could not be uploaded. Try again.");
}

/**
 * Compresses, uploads and confirms one image. Resolves to the stored asset,
 * whose `url` is what a record's `imageUrl` should hold.
 */
export async function uploadImage(file, { ownerType = null, ownerId = null } = {}) {
  if (!file?.type?.startsWith("image/")) throw new UploadError("Choose an image file.");

  const blob = await compress(file);

  const ticket = await api.post("/media/uploads", {
    mimeType: blob.type,
    sizeBytes: blob.size,
    ownerType,
    ownerId,
  });

  await sendBytes(ticket.upload, blob);

  return api.post("/media/uploads/confirm", { ticket: ticket.ticket });
}

/**
 * Uploads a file as-is — no compression, no image check.
 *
 * `uploadImage` re-encodes before sending, which is right for a photo and
 * destroys a video. This is the same three-step flow without that step:
 * ticket, bytes, confirm.
 */
export async function uploadFile(file, { ownerType = null, ownerId = null } = {}) {
  const ticket = await api.post("/media/uploads", {
    mimeType: file.type,
    sizeBytes: file.size,
    ownerType,
    ownerId,
  });

  await sendBytes(ticket.upload, file);

  return api.post("/media/uploads/confirm", { ticket: ticket.ticket });
}
