"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { CUSTOMER_FIELDS, customerFormValues, customerPayload, phoneChangeWarning } from "@/lib/customer-form";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * A customer's own details, as staff may change them.
 *
 * The email address is shown but not editable: it is how they sign in and how a
 * password reset reaches them, so moving it is a verification flow, not a text
 * box a staff member overwrites while on the phone.
 */
export default function CustomerProfileForm({ customer, readOnly = false }) {
  const router = useRouter();
  const [form, setForm] = useState(() => customerFormValues(customer));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const warning = phoneChangeWarning(form, customer);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || readOnly) return;
    const { body, errors: local } = customerPayload(form, { original: customer });
    if (Object.keys(local).length) {
      setErrors(local);
      setFormError(local.form ?? "Some fields need attention.");
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api.patch(`/admin/customers/${customer.id}`, body);
      toast.success("Customer saved.");
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: CUSTOMER_FIELDS, conflictField: "phone" });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Section title="Details" description={readOnly ? "You can view these but not change them." : "Correct a name or phone number they gave over the phone."}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <FormAlert>{formError}</FormAlert>

        <fieldset disabled={readOnly} className="flex flex-col gap-5">
          <Field id="customer-name" label="Name" required value={form.name} onChange={update("name")} error={errors.name} />
          <Field
            id="customer-phone"
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={update("phone")}
            error={errors.phone}
            hint={warning ?? (customer.phoneVerifiedAt ? "Confirmed by the customer." : "Not confirmed yet.")}
          />
          <Field
            id="customer-email"
            label="Email"
            value={customer.email ?? "—"}
            onChange={() => {}}
            readOnly
            disabled
            hint={
              customer.email
                ? customer.emailVerifiedAt
                  ? "Confirmed. Changing a sign-in address is done by the customer from their account."
                  : "Not confirmed yet. Changing a sign-in address is done by the customer from their account."
                : "This customer signed up without an email address."
            }
          />
        </fieldset>

        {readOnly ? null : (
          <div className="min-w-48 max-w-xs">
            <SubmitButton pending={pending} pendingLabel="Saving…">Save details</SubmitButton>
          </div>
        )}
      </form>
    </Section>
  );
}
