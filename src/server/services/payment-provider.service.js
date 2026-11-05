import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { recordAudit } from "@/server/utils/audit";
import { isProduction } from "@/lib/env";
import { getProvider, listProviders } from "@/server/payments/providers";
import { activeKeyId } from "@/server/utils/secret-box";
import {
  assertReadyToEnable,
  credentialFields,
  maskCredentials,
  mergeCredentialUpdate,
  openCredentials,
  requiresConfiguration,
  providerDescription,
  providerLabel,
  sealCredentials,
  validateCredentials,
} from "@/server/payments/credentials";

/**
 * Which gateways a branch can take money through, and with whose account.
 *
 * Every restaurant brings its own merchant account, so this is the table that
 * decides where a customer's money actually lands. That makes it the highest
 * value row in the database to an attacker: changing one `apiKey` redirects a
 * branch's entire takings. Hence the rules below, each of which exists because
 * the alternative is somebody quietly getting paid instead of the restaurant.
 *
 *   * credentials are never returned, not even partially masked
 *   * every write is audited by field name, never by value
 *   * a gateway cannot be switched on until it is completely configured
 *   * a sandbox gateway cannot take real money in production
 */

const SELECT = {
  id: true,
  branchId: true,
  provider: true,
  isEnabled: true,
  sortOrder: true,
  displayName: true,
  mode: true,
  credentials: true,
  keyId: true,
  lastVerifiedAt: true,
  lastVerifyError: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Every gateway the system knows, with this branch's configuration folded in.
 *
 * Unconfigured gateways are included rather than hidden. The screen's job is
 * "here is what you could turn on", and a list that only shows what is already
 * set up has no way to add the first one.
 */
export async function listBranchProviders({ branchId }) {
  if (!branchId) throw ApiError.validation("A branch is required", { branchId: ["Required"] });

  const rows = await prisma.branchPaymentProvider.findMany({ where: { branchId }, select: SELECT });
  const byProvider = new Map(rows.map((row) => [row.provider, row]));

  return listProviders().map((provider) => {
    const row = byProvider.get(provider.name) ?? null;
    const stored = row?.credentials ?? {};

    return {
      provider: provider.name,
      supportsOnline: provider.supportsOnline,
      supportsRefund: provider.supportsRefund,
      methods: provider.methods,
      // What to print, and separately what the branch typed — the form needs
      // an empty box when nothing was overridden, not the default echoed back
      // as though somebody had chosen it.
      label: providerLabel(provider.name, row?.displayName),
      displayName: row?.displayName ?? "",
      description: providerDescription(provider.name),
      isConfigured: Boolean(row),
      isEnabled: row?.isEnabled ?? false,
      sortOrder: row?.sortOrder ?? 0,
      mode: row?.mode ?? "SANDBOX",
      lastVerifiedAt: row?.lastVerifiedAt ?? null,
      lastVerifyError: row?.lastVerifyError ?? null,
      updatedById: row?.updatedById ?? null,
      updatedAt: row?.updatedAt ?? null,
      // The only credential information that crosses the wire: which fields
      // exist, and whether each one is filled in.
      credentials: maskCredentials({ provider: provider.name, stored }),
      /**
       * The exact URL this branch must paste into the gateway's own dashboard.
       * It carries the branch because a callback has to be verified against
       * *this* restaurant's signing secret, and the body cannot be parsed to
       * find out whose it is until after the signature has been checked.
       */
      webhookUrl: webhookUrlFor({ branchId, provider: provider.name }),
    };
  });
}

export function webhookUrlFor({ branchId, provider }) {
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/v1/webhooks/payments/${provider}/${branchId}`;
}

/**
 * Creates or updates a branch's configuration for one gateway.
 *
 * Credentials are merged rather than replaced: the form renders empty boxes
 * over secrets it cannot display, so a blank field means "unchanged". See
 * `mergeCredentialUpdate` for why that direction is the safe one.
 */
export async function saveBranchProvider({
  branchId,
  provider,
  credentials = {},
  mode = null,
  isEnabled = null,
  sortOrder = null,
  displayName = undefined,
  actor = null,
}) {
  if (!branchId) throw ApiError.validation("A branch is required", { branchId: ["Required"] });

  // Throws for a name no provider is registered under, before anything is
  // written, so a typo cannot create a row nothing will ever read.
  getProvider(provider);

  const existing = await prisma.branchPaymentProvider.findUnique({
    where: { branchId_provider: { branchId, provider } },
    select: SELECT,
  });

  // Validate only what was actually supplied. Running the full schema over a
  // merge would reject an edit that touches one field of an otherwise complete
  // set, because the untouched secrets arrive as blanks.
  const supplied = Object.fromEntries(
    Object.entries(credentials ?? {}).filter(([, value]) => value != null && String(value).trim() !== ""),
  );
  if (Object.keys(supplied).length) validateCredentials(provider, supplied, { partial: true });

  /*
   * Sealing skips blanks, so only values somebody actually typed become
   * envelopes. Explicit nulls are carried across separately: they mean "clear
   * this", and sealing one would store the text "null" as a credential.
   */
  const cleared = Object.fromEntries(
    Object.entries(credentials ?? {})
      .filter(([, value]) => value === null)
      .map(([key]) => [key, null]),
  );

  const { values: sealed, changed } = mergeCredentialUpdate({
    fields: credentialFields(provider),
    existing: existing?.credentials ?? {},
    // Sealed before merging, so the comparison is envelope-to-envelope and a
    // re-paste of the same secret still counts as a change — two seals of the
    // same plaintext differ, which is the point of the random nonce.
    submitted: { ...sealCredentials({ branchId, provider, values: credentials ?? {} }), ...cleared },
  });

  const nextMode = mode ?? existing?.mode ?? "SANDBOX";
  const nextEnabled = isEnabled ?? existing?.isEnabled ?? false;

  if (nextEnabled) {
    assertReadyToEnable({ provider, values: sealed });
    assertModeIsSafe({ provider, mode: nextMode });
  }

  const data = {
    isEnabled: nextEnabled,
    sortOrder: sortOrder ?? existing?.sortOrder ?? 0,
    mode: nextMode,
    // An empty box means "use the provider's own name", so it is stored as
    // null rather than as an empty string nobody can tell apart from unset.
    ...(displayName === undefined ? {} : { displayName: String(displayName).trim() || null }),
    credentials: sealed,
    keyId: Object.keys(sealed).length ? activeKeyId() : null,
    updatedById: actor?.userId ?? null,
    // A credential change invalidates whatever the last test proved.
    ...(changed.length ? { lastVerifiedAt: null, lastVerifyError: null } : {}),
  };

  const row = await prisma.branchPaymentProvider.upsert({
    where: { branchId_provider: { branchId, provider } },
    create: { branchId, provider, ...data },
    update: data,
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId,
    action: existing ? "payment_provider.update" : "payment_provider.configure",
    entityType: "BranchPaymentProvider",
    entityId: row.id,
    changes: {
      provider,
      // Field names only. A value here would be a second copy of the
      // credential, in a table more people can read than the one it came from.
      credentialsChanged: changed,
      ...(existing?.isEnabled !== row.isEnabled ? { isEnabled: { before: existing?.isEnabled ?? false, after: row.isEnabled } } : {}),
      ...(existing?.mode !== row.mode ? { mode: { before: existing?.mode ?? null, after: row.mode } } : {}),
    },
  });

  return shape(row);
}

/**
 * A sandbox gateway in production takes no money but reports success, so every
 * order it touches is free food. Refused rather than warned about.
 */
function assertModeIsSafe({ provider, mode }) {
  if (isProduction() && mode === "SANDBOX") {
    throw ApiError.validation(`${provider} is still in sandbox mode and cannot be switched on in production`, {
      mode: ["Switch this gateway to LIVE credentials before enabling it"],
    });
  }
}

export async function removeBranchProvider({ branchId, provider, actor = null }) {
  const existing = await prisma.branchPaymentProvider.findUnique({
    where: { branchId_provider: { branchId, provider } },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound("This gateway is not configured for this branch");

  await prisma.branchPaymentProvider.delete({ where: { id: existing.id } });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId,
    action: "payment_provider.remove",
    entityType: "BranchPaymentProvider",
    entityId: existing.id,
    changes: { provider },
  });

  return { removed: true, provider };
}

/**
 * The plaintext configuration a provider is called with.
 *
 * Deliberately not exported through any route. The only legitimate callers are
 * the payment, refund and webhook services, at the moment they are about to
 * talk to the gateway — nothing holds the result, and nothing logs it.
 *
 * `requireEnabled` is false for webhook verification: a gateway switched off a
 * minute ago will still deliver callbacks for payments it already took, and
 * refusing to verify those would strand real money in an unknown state.
 */
export async function resolveProviderConfig({ branchId, provider, requireEnabled = true }) {
  /*
   * A gateway that declares no credential it actually needs must resolve
   * without a row: cash has nothing to authenticate against, and the fake
   * gateway falls back to the deployment's secret. Requiring a row for those
   * would mean no branch could take a counter sale until somebody visited a
   * settings screen.
   */
  if (!requiresConfiguration(provider)) {
    const optional = await prisma.branchPaymentProvider.findUnique({
      where: { branchId_provider: { branchId, provider } },
      select: SELECT,
    });
    return {
      config: optional ? openCredentials({ branchId, provider, stored: optional.credentials ?? {} }) : {},
      mode: optional?.mode ?? "LIVE",
      row: optional ? shape(optional) : null,
    };
  }

  const row = await prisma.branchPaymentProvider.findUnique({
    where: { branchId_provider: { branchId, provider } },
    select: SELECT,
  });

  if (!row) {
    throw ApiError.conflict(`${provider} is not set up for this branch`, {
      provider: ["Add this gateway's credentials in Settings before taking payments through it"],
    });
  }
  if (requireEnabled && !row.isEnabled) {
    throw ApiError.conflict(`${provider} is switched off for this branch`);
  }

  return {
    config: openCredentials({ branchId, provider, stored: row.credentials ?? {} }),
    mode: row.mode,
    row: shape(row),
  };
}

/** The gateways a customer may actually choose, in the order they are offered. */
export async function enabledProviders({ branchId }) {
  const rows = await prisma.branchPaymentProvider.findMany({
    where: { branchId, isEnabled: true },
    select: { provider: true, sortOrder: true, mode: true },
    orderBy: [{ sortOrder: "asc" }, { provider: "asc" }],
  });

  return rows.map((row) => ({
    provider: row.provider,
    mode: row.mode,
    methods: getProvider(row.provider).methods ?? [],
  }));
}

/**
 * Tries the stored credentials against the gateway and records the result.
 *
 * A gateway that has never been verified is the most likely thing to be
 * quietly broken: a mistyped key looks identical to a correct one on screen,
 * and the first evidence otherwise is a customer who cannot pay.
 *
 * The failure is stored as the gateway's own message, trimmed. It is shown to
 * an operator who needs to know whether they pasted the wrong key or the
 * account is not enabled, and those are very different fixes.
 */
export async function verifyBranchProvider({ branchId, provider, actor = null }) {
  const adapter = getProvider(provider);
  if (typeof adapter.verifyCredentials !== "function") {
    throw ApiError.validation(`${provider} has nothing to test`, {
      provider: ["This gateway is settled outside the system, so there is no connection to check"],
    });
  }

  const { config, mode } = await resolveProviderConfig({ branchId, provider, requireEnabled: false });

  try {
    const result = await adapter.verifyCredentials({ config, mode });
    await recordVerification({ branchId, provider, ok: true });
    await recordAudit({
      actorId: actor?.userId ?? null,
      branchId,
      action: "payment_provider.verify",
      entityType: "BranchPaymentProvider",
      changes: { provider, ok: true },
    });
    return { ok: true, mode, detail: result?.detail ?? null };
  } catch (error) {
    await recordVerification({ branchId, provider, ok: false, error: error.message });
    await recordAudit({
      actorId: actor?.userId ?? null,
      branchId,
      action: "payment_provider.verify",
      entityType: "BranchPaymentProvider",
      changes: { provider, ok: false },
    });
    // Returned rather than thrown: a failed test is a result the screen should
    // show, not a broken request.
    return { ok: false, mode, detail: error.message?.slice(0, 500) ?? "The gateway refused the credentials" };
  }
}

/**
 * What a customer may be offered at checkout.
 *
 * A deliberately narrow projection of `enabledProviders`, because this one is
 * read by anybody who can load the site. It carries the gateway's name and the
 * methods it covers — never the mode, the merchant key, or whether a
 * credential is set. A customer has no use for any of that, and "which
 * environment is this branch in" is not a question the public should be able
 * to ask.
 */
export async function publicPaymentOptions({ branchId }) {
  if (!branchId) return [];

  const rows = await prisma.branchPaymentProvider.findMany({
    where: { branchId, isEnabled: true },
    select: { provider: true, sortOrder: true, displayName: true },
    orderBy: [{ sortOrder: "asc" }, { provider: "asc" }],
  });

  return rows
    .filter((row) => {
      // A gateway with no online flow cannot be paid through a browser, so it
      // must never appear as a "pay now" option however it was configured.
      try {
        return getProvider(row.provider).supportsOnline === true;
      } catch {
        // Configured under a name no provider is registered under any more.
        return false;
      }
    })
    .map((row) => ({
      provider: row.provider,
      label: providerLabel(row.provider, row.displayName),
      description: providerDescription(row.provider),
      methods: getProvider(row.provider).methods ?? [],
    }));
}

/** Records the outcome of a connection test. Never stores what was sent. */
export async function recordVerification({ branchId, provider, ok, error = null }) {
  await prisma.branchPaymentProvider.update({
    where: { branchId_provider: { branchId, provider } },
    data: {
      lastVerifiedAt: ok ? new Date() : null,
      lastVerifyError: ok ? null : String(error ?? "").slice(0, 500),
    },
  });
}

/** Strips the credential column on the way out. Nothing above this sees it. */
function shape(row) {
  const { credentials, ...rest } = row;
  return {
    ...rest,
    label: providerLabel(row.provider, row.displayName),
    description: providerDescription(row.provider),
    credentials: maskCredentials({ provider: row.provider, stored: credentials ?? {} }),
    webhookUrl: webhookUrlFor({ branchId: row.branchId, provider: row.provider }),
  };
}
