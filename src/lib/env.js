import { z } from "zod";

/**
 * Validated environment access.
 *
 * Reading `process.env` directly means a missing secret surfaces as a confusing
 * runtime failure on some unlucky request at 3am. Parsing it once, here, turns
 * that into a loud startup error naming the variable.
 *
 * Values are read lazily (not at module load) so that importing this file
 * during a build — where runtime secrets are absent — does not fail.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters — generate one with `openssl rand -base64 48`"),
  /// Comma-separated browser origins allowed to call /api/* with credentials.
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 15),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  /// Turns off rate limiting entirely. Intended for tests, never for production.
  RATE_LIMIT_DISABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /// How long a resolved permission set is cached in memory, in seconds.
  PERMISSION_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(30),

  /// Public origin of the site, used in emails.
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("FoodZone"),

  /// SMTP. With Resend: host smtp.resend.com, port 587, user "resend",
  /// password = the Resend API key. Left unset, mail is written to the console
  /// instead of sent, so local development needs no credentials.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default("FoodZone <onboarding@resend.dev>"),
  /// Redirects every outgoing email to this address. For staging, so a test run
  /// can never mail a real customer.
  MAIL_OVERRIDE_TO: z.string().optional(),

  /// Verification and reset codes.
  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  /// Minimum gap between two sends of the same kind of code.
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
  /// How long a staff invitation stays valid.
  INVITE_TTL_HOURS: z.coerce.number().int().positive().default(168),

  // --- storage -------------------------------------------------------------
  /// Which storage driver serves uploads. `local` writes to disk and therefore
  /// only works on a persistent filesystem (Docker/VPS), never on serverless.
  STORAGE_DRIVER: z.enum(["cloudinary", "s3", "local"]).default("local"),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  /// Optional folder prefix inside the Cloudinary account.
  CLOUDINARY_FOLDER: z.string().default("foodzone"),

  /// S3 and every S3-compatible provider (Cloudflare R2, Backblaze, MinIO).
  /// For R2, set S3_ENDPOINT to https://<account>.r2.cloudflarestorage.com.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /// Public base URL files are served from (a CDN or the bucket's public host).
  S3_PUBLIC_URL: z.string().optional(),
  /// Path-style addressing: required by MinIO, optional for R2.
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  /// Local driver only: where files are written.
  UPLOAD_DIR: z.string().default("./storage/uploads"),

  /// Upload ceilings, enforced when the upload ticket is issued AND again at
  /// confirm against the object's real size.
  MAX_IMAGE_UPLOAD_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  MAX_VIDEO_UPLOAD_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  MAX_DOCUMENT_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  /// How long an upload ticket stays valid.
  UPLOAD_TICKET_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // --- background work ------------------------------------------------------
  /// Shared secret for the internal cron endpoints. Required in production.
  CRON_SECRET: z.string().optional(),
  /// Runs the outbox drain inside the app process. Correct for a long-lived
  /// Node server (Docker/VPS); must stay false on serverless, where a cron
  /// hitting the internal route does the same job.
  WORKER_IN_PROCESS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(20),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),

  // --- push -----------------------------------------------------------------
  /// Expo push. Off by default: device tokens are collected either way, so
  /// turning this on later needs no migration.
  EXPO_PUSH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /// Optional; only needed if the Expo project enforces push security.
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // --- documentation ---------------------------------------------------------
  /// Serves Swagger UI and the OpenAPI document at /api/docs. Always on outside
  /// production; off in production unless set, because the document enumerates
  /// every endpoint, permission key and payload shape — a map of the system for
  /// anyone probing it.
  API_DOCS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

let cached = null;

export function env() {
  if (cached) return cached;

  const result = schema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  cached = result.data;
  return cached;
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function isTest() {
  return process.env.NODE_ENV === "test";
}

/** Test seam: forces the next `env()` call to re-read `process.env`. */
export function resetEnvCache() {
  cached = null;
}
