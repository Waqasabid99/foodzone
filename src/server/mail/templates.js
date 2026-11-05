import { env } from "@/lib/env";

/**
 * Email bodies.
 *
 * Every message is sent as both HTML and plain text: some clients block HTML,
 * and a verification code that cannot be read is a support ticket. Layout is
 * inline-styled and table-free — nothing here is complex enough to need more,
 * and inline styles are the only thing every mail client agrees on.
 */
function layout({ title, intro, code, outro, footer }) {
  const { APP_NAME } = env();

  const html = `
<div style="margin:0;padding:24px;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a8a8f;">${escapeHtml(APP_NAME)}</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#18181b;">${escapeHtml(title)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">${escapeHtml(intro)}</p>
    ${
      code
        ? `<div style="margin:0 0 20px;padding:16px;background:#f4f4f5;border-radius:10px;text-align:center;">
             <span style="font-size:30px;font-weight:700;letter-spacing:.28em;color:#18181b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(code)}</span>
           </div>`
        : ""
    }
    ${outro ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">${escapeHtml(outro)}</p>` : ""}
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e7;font-size:13px;line-height:1.6;color:#8a8a8f;">${escapeHtml(footer)}</p>
  </div>
</div>`.trim();

  const text = [title, "", intro, code ? `\n${code}\n` : "", outro, "", footer].filter(Boolean).join("\n");

  return { html, text };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

export function verificationEmail({ name, code, ttlMinutes }) {
  const { APP_NAME } = env();
  return {
    subject: `${code} is your ${APP_NAME} verification code`,
    ...layout({
      title: "Verify your email",
      intro: `Hi ${name || "there"}, enter this code to confirm your email address.`,
      code,
      outro: `The code expires in ${ttlMinutes} minutes.`,
      footer: "If you did not create an account, you can safely ignore this email.",
    }),
  };
}

export function passwordResetEmail({ name, code, ttlMinutes }) {
  const { APP_NAME } = env();
  return {
    subject: `${code} is your ${APP_NAME} password reset code`,
    ...layout({
      title: "Reset your password",
      intro: `Hi ${name || "there"}, use this code to set a new password.`,
      code,
      outro: `The code expires in ${ttlMinutes} minutes. Resetting your password signs you out on every device.`,
      footer: "If you did not request this, ignore this email — your password will not change.",
    }),
  };
}

export function staffInviteEmail({ name, email, code, inviterName, roleNames, ttlHours }) {
  const { APP_NAME, APP_URL } = env();
  const roles = roleNames?.length ? roleNames.join(", ") : "team member";
  // The address goes in the link so the form arrives filled in. It is the one
  // field the recipient cannot guess wrong but can easily mistype, and it is
  // already in their inbox — this reveals nothing they do not have.
  const href = email ? `${APP_URL}/invite?email=${encodeURIComponent(email)}` : `${APP_URL}/invite`;

  return {
    subject: `You have been invited to ${APP_NAME}`,
    ...layout({
      title: `Join ${APP_NAME}`,
      intro: `${inviterName || "An administrator"} invited you to ${APP_NAME} as ${roles}. Use this code to set your password and activate your account.`,
      code,
      outro: `Accept at ${href} — the code expires in ${ttlHours} hours.`,
      footer: "If you were not expecting this invitation, ignore this email.",
    }),
  };
}

export function passwordChangedEmail({ name, at }) {
  const { APP_NAME } = env();
  return {
    subject: `Your ${APP_NAME} password was changed`,
    ...layout({
      title: "Your password was changed",
      intro: `Hi ${name || "there"}, your password was changed on ${at}. Every other device has been signed out.`,
      footer: "If this was not you, reset your password immediately and contact support.",
    }),
  };
}

/**
 * Tells someone an administrator issued them a temporary password.
 *
 * The password itself is deliberately not in here: it is handed over in
 * person, and an email that carries it turns a mailbox into a way into the
 * account. This is the alarm — if they did not ask for it, someone should hear.
 */
export function temporaryPasswordEmail({ name, at, byName }) {
  const { APP_NAME } = env();
  return {
    subject: `A temporary ${APP_NAME} password was set for you`,
    ...layout({
      title: "A temporary password was set",
      intro: `Hi ${name || "there"}, ${byName ? `${byName} ` : "an administrator "}set a temporary password on your account on ${at}, and every device has been signed out. You will be asked to choose your own password the next time you sign in.`,
      footer: "If you did not ask for this, tell your manager straight away — someone else can sign in as you until you change it.",
    }),
  };
}

export function accountStatusEmail({ name, status, reason }) {
  const { APP_NAME } = env();
  const suspended = status === "SUSPENDED";
  return {
    subject: `Your ${APP_NAME} account has been ${suspended ? "suspended" : "reactivated"}`,
    ...layout({
      title: suspended ? "Account suspended" : "Account reactivated",
      intro: suspended
        ? `Hi ${name || "there"}, your account has been suspended and you have been signed out.${reason ? ` Reason: ${reason}` : ""}`
        : `Hi ${name || "there"}, your account is active again. You can sign in as usual.`,
      footer: "Reply to this email if you believe this is a mistake.",
    }),
  };
}
