"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import Chip from "@/components/dashboard/inventory/Chip";

/**
 * One gateway's setup for one branch.
 *
 * The restaurant holds its own merchant account, so what is entered here
 * decides where its money lands. Three rules this form exists to enforce:
 *
 *   * **A blank secret box means "unchanged", never "clear".** The form cannot
 *     display a stored secret, so it renders an empty box over one that is
 *     already set. If blank cleared it, saving an unrelated change on this
 *     screen would silently break a live gateway and the next customer would
 *     be the one to find out. Clearing is a separate, deliberate button.
 *   * **Nothing is switched on half-configured**, because the alternative is
 *     a customer discovering it after they have chosen their food.
 *   * **The callback URL is shown, not described.** It has to be pasted into
 *     the gateway's own dashboard exactly, and a URL retyped from a screenshot
 *     is a support ticket.
 */
export default function GatewaySetup({ gateway, branchId, canEdit }) {
  const router = useRouter();
  const blank = Object.fromEntries(gateway.credentials.map((field) => [field.key, ""]));

  const [values, setValues] = useState(blank);
  const [mode, setMode] = useState(gateway.mode ?? "SANDBOX");
  const [displayName, setDisplayName] = useState(gateway.displayName ?? "");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tested, setTested] = useState(null);

  const needsSetup = gateway.credentials.some((field) => field.required && !field.isSet);
  const dirty =
    Object.values(values).some((value) => value.trim() !== "") ||
    mode !== gateway.mode ||
    displayName !== (gateway.displayName ?? "");

  async function save(patch = {}) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // Only fields actually typed into are sent. An untouched box must not
      // reach the server at all, so it cannot be mistaken for an instruction.
      const typed = Object.fromEntries(
        Object.entries(values)
          .filter(([, value]) => value.trim() !== "")
          .map(([key, value]) => [key, value.trim()]),
      );

      await api.put(`/admin/payment-providers/${branchId}/${gateway.provider}`, {
        credentials: typed,
        mode,
        displayName,
        ...patch,
      });
      setValues(blank);
      toast.success(`${gateway.label ?? gateway.provider} saved.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function clearField(key) {
    if (!window.confirm(`Clear the ${key}? Payments through this gateway will stop until a new one is entered.`)) return;
    await save({ credentials: { [key]: null }, isEnabled: false });
  }

  async function forget() {
    if (!window.confirm(`Forget every ${gateway.provider} credential for this branch? This cannot be undone.`)) return;
    setPending(true);
    try {
      await api.delete(`/admin/payment-providers/${branchId}/${gateway.provider}`);
      toast.success(`${gateway.provider} removed.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be removed.");
    } finally {
      setPending(false);
    }
  }

  async function test() {
    if (pending) return;
    setPending(true);
    setError(null);
    setTested(null);
    try {
      // A refused key answers 200 with ok:false — a result to show, not a
      // broken request.
      setTested(await api.post(`/admin/payment-providers/${branchId}/${gateway.provider}/verify`, {}));
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "The test could not be run.");
    } finally {
      setPending(false);
    }
  }

  function copyUrl() {
    navigator.clipboard?.writeText(gateway.webhookUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setError("Could not copy — select the address and copy it by hand."),
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-field bg-surface-container-low p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-label-bold text-on-surface">{gateway.label ?? gateway.provider}</span>
          {gateway.isEnabled ? (
            <Chip tone="bg-success-container text-on-success-container">On</Chip>
          ) : (
            <Chip>Off</Chip>
          )}
          {gateway.isConfigured ? (
            <Chip tone={gateway.mode === "LIVE" ? "bg-error-container text-on-error-container" : undefined}>
              {gateway.mode === "LIVE" ? "Live money" : "Sandbox"}
            </Chip>
          ) : null}
          {gateway.supportsRefund ? null : <Chip>No refunds</Chip>}
        </p>

        {canEdit && gateway.isConfigured ? (
          <button
            type="button"
            onClick={forget}
            disabled={pending}
            className="rounded-field px-3 py-1.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Forget it
          </button>
        ) : null}
      </div>

      <FormAlert>{error}</FormAlert>

      {gateway.credentials.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">
          Nothing to configure — this one is settled outside the system.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {gateway.credentials.map((field) => (
              <div key={field.key} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field
                    id={`${gateway.provider}-${field.key}`}
                    label={field.label}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    value={field.secret ? values[field.key] : (values[field.key] || field.value || "")}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                    disabled={!canEdit || pending}
                    hint={
                      field.secret && field.isSet
                        ? `${field.hint ?? ""} Already set — leave empty to keep it.`.trim()
                        : (field.hint ?? undefined)
                    }
                  />
                </div>
                {canEdit && field.secret && field.isSet ? (
                  <button
                    type="button"
                    onClick={() => clearField(field.key)}
                    disabled={pending}
                    className="mb-1 rounded-field px-3 py-2 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <Field
            id={`${gateway.provider}-display-name`}
            label="What customers see this called"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={!canEdit || pending}
            autoComplete="off"
            placeholder={gateway.label ?? gateway.provider}
            hint={`Optional. Left empty it reads "${gateway.label ?? gateway.provider}". Worth setting if you offer more than one — "Card / Easypaisa / JazzCash" means more to a diner than a gateway's brand name.`}
          />

          <SelectField
            id={`${gateway.provider}-mode`}
            label="Which account these keys belong to"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            disabled={!canEdit || pending}
            options={[
              { value: "SANDBOX", label: "Sandbox — test keys, no real money" },
              { value: "LIVE", label: "Live — real money" },
            ]}
            hint="Gateways issue separate keys per environment. Sandbox keys on a live site take no money but report success."
          />

          <div className="rounded-field bg-surface-container px-3 py-2.5">
            <p className="text-label-bold text-on-surface">Paste this into {gateway.provider}&rsquo;s dashboard</p>
            <p className="mt-0.5 text-body-md text-on-surface-variant">
              Its webhook or callback URL. It names this branch, because a callback is checked against this
              branch&rsquo;s own signing secret.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-field bg-surface-container-lowest px-2 py-1.5 text-body-sm text-on-surface">
                {gateway.webhookUrl}
              </code>
              <button
                type="button"
                onClick={copyUrl}
                className="rounded-field bg-surface-container-high px-3 py-1.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {tested ? (
            <p
              className={`rounded-field px-3 py-2 text-body-md ${tested.ok ? "bg-success-container text-on-success-container" : "bg-error-container text-on-error-container"}`}
            >
              {tested.ok ? "The gateway accepted these keys." : "The gateway refused these keys."}
              {tested.detail ? ` ${tested.detail}` : ""}
            </p>
          ) : gateway.lastVerifyError ? (
            <p className="rounded-field bg-error-container px-3 py-2 text-body-md text-on-error-container">
              Last test failed: {gateway.lastVerifyError}
            </p>
          ) : gateway.lastVerifiedAt ? (
            <p className="text-body-md text-on-surface-variant">
              Last tested {new Date(gateway.lastVerifiedAt).toLocaleString()} — the gateway accepted these keys.
            </p>
          ) : gateway.isConfigured ? (
            <p className="text-body-md text-on-surface-variant">
              Never tested. A mistyped key looks the same on screen as a correct one.
            </p>
          ) : null}

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => save()}
                disabled={pending || !dirty}
                className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {pending ? "Saving…" : "Save"}
              </button>

              <button
                type="button"
                onClick={() => save({ isEnabled: !gateway.isEnabled })}
                disabled={pending || (!gateway.isEnabled && needsSetup)}
                title={!gateway.isEnabled && needsSetup ? "Enter every required credential first" : undefined}
                className="rounded-field px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {gateway.isEnabled ? "Switch off" : "Switch on"}
              </button>

              <button
                type="button"
                onClick={test}
                disabled={pending || needsSetup}
                title={needsSetup ? "Enter every required credential first" : undefined}
                className="rounded-field px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {pending ? "Testing…" : "Test the connection"}
              </button>

              {!gateway.isEnabled && needsSetup ? (
                <span className="text-body-md text-on-surface-variant">
                  Needs {gateway.credentials.filter((f) => f.required && !f.isSet).map((f) => f.label).join(", ")}.
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
