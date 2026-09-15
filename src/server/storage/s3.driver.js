import { env } from "@/lib/env";
import { ApiError } from "@/lib/api";

/**
 * S3 and every S3-compatible provider — AWS, Cloudflare R2, Backblaze B2,
 * MinIO — through one presigned-PUT flow.
 *
 * Unlike Cloudinary there is no server-side transformation, so compression is
 * entirely the client's job, following the directives in the upload policy. The
 * confirm step reads the object's real size back with a HEAD and rejects
 * anything that came in over the limit, which is what stops a client from
 * skipping it.
 */
let cachedClient = null;

async function client() {
  const config = env();
  if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw ApiError.internal("S3 storage is not configured");
  }

  if (!cachedClient) {
    const { S3Client } = await import("@aws-sdk/client-s3");
    cachedClient = new S3Client({
      region: config.S3_REGION,
      // R2 and MinIO need an explicit endpoint; AWS derives it from the region.
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  return cachedClient;
}

export const s3Driver = {
  name: "s3",
  supportsDirectUpload: true,

  async createUploadTarget({ storageKey, mimeType, sizeBytes }) {
    const config = env();
    const [{ PutObjectCommand }, { getSignedUrl }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);

    const command = new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: storageKey,
      ContentType: mimeType,
      // Signed into the URL: the upload is rejected if the client sends a
      // different length than it declared.
      ContentLength: sizeBytes,
    });

    const url = await getSignedUrl(await client(), command, {
      expiresIn: config.UPLOAD_TICKET_TTL_SECONDS,
    });

    return {
      provider: "s3",
      method: "PUT",
      url,
      // The client must send these exact headers or the signature will not match.
      headers: { "content-type": mimeType, "content-length": String(sizeBytes) },
    };
  },

  async statObject({ storageKey }) {
    const config = env();
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");

    try {
      const result = await (await client()).send(
        new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: storageKey }),
      );
      return {
        exists: true,
        sizeBytes: Number(result.ContentLength ?? 0),
        url: this.publicUrl({ storageKey }),
      };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return { exists: false };
      throw error;
    }
  },

  async deleteObject({ storageKey }) {
    const config = env();
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await client()).send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: storageKey }));
  },

  publicUrl({ storageKey }) {
    const config = env();
    // A CDN in front of the bucket is the norm; fall back to the bucket host.
    const base =
      config.S3_PUBLIC_URL ??
      (config.S3_ENDPOINT ? `${config.S3_ENDPOINT}/${config.S3_BUCKET}` : `https://${config.S3_BUCKET}.s3.amazonaws.com`);

    return `${base.replace(/\/$/, "")}/${storageKey}`;
  },
};
