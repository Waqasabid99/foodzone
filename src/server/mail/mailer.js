import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Outbound email.
 *
 * SMTP rather than a provider SDK, so switching from Resend to SES, Postmark or
 * a client's own server is an env change instead of a code change. With Resend:
 * host `smtp.resend.com`, user `resend`, password = the API key.
 *
 * With no SMTP_HOST configured, mail is written to the console instead of sent.
 * That keeps local development and tests working without credentials, and makes
 * verification codes visible while building.
 */
let transporter = null;

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = env();
  if (!SMTP_HOST) return null;

  transporter ??= nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
    // Keep the connection warm: transactional bursts (an invite to ten staff)
    // otherwise pay a TLS handshake each time.
    pool: true,
    maxConnections: 3,
  });

  return transporter;
}

/** Test seam, and a way to force a reconnect after an env change. */
export function resetMailTransport() {
  transporter?.close?.();
  transporter = null;
}

export async function sendMail({ to, subject, html, text, replyTo }) {
  const { MAIL_FROM, MAIL_OVERRIDE_TO } = env();
  // Staging safety net: never let a test run reach a real customer.
  const recipient = MAIL_OVERRIDE_TO || to;

  const transport = getTransport();

  if (!transport) {
    logger.info("email (console driver, SMTP not configured)", {
      to: recipient,
      subject,
      // The body carries the code, which is exactly what a developer needs.
      preview: text?.slice(0, 400),
    });
    return { delivered: false, driver: "console" };
  }

  const info = await transport.sendMail({
    from: MAIL_FROM,
    to: recipient,
    subject,
    text,
    html,
    ...(replyTo ? { replyTo } : {}),
  });

  logger.info("email sent", { to: recipient, subject, messageId: info.messageId });
  return { delivered: true, driver: "smtp", messageId: info.messageId };
}

/**
 * Sends without letting a mail failure break the request.
 *
 * Registration must not fail because the SMTP provider is having a bad minute —
 * the user can always request the code again.
 */
export async function sendMailSafely(message) {
  try {
    return await sendMail(message);
  } catch (error) {
    logger.error("email delivery failed", { to: message.to, subject: message.subject, error: error.message });
    return { delivered: false, driver: "failed", error: error.message };
  }
}

/** Verifies the SMTP credentials — useful in a health check. */
export async function verifyMailTransport() {
  const transport = getTransport();
  if (!transport) return { configured: false };
  await transport.verify();
  return { configured: true };
}
