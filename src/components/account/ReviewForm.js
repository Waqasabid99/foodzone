"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Star } from "lucide-react";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { STAR_LABELS } from "@/lib/account";

/**
 * Writing a review for something you ate.
 *
 * The rating is real buttons rather than a star widget built from mouse
 * positions: a five-point scale is five choices, and making it a radio group
 * means it works from a keyboard and reads correctly to a screen reader
 * without any extra work.
 *
 * The comment is optional on purpose. A rating with no words is still worth
 * having, and demanding a sentence is how you end up with "good" ten thousand
 * times.
 */
export default function ReviewForm({ order, item = null, onDone = null }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const subject = item?.nameSnapshot ?? `order ${order.orderNumber}`;

  async function submit(event) {
    event.preventDefault();
    if (pending || !rating) return;
    setPending(true);
    setError(null);
    try {
      await api.post("/me/reviews", {
        orderId: order.id,
        ...(item?.productId ? { productId: item.productId } : {}),
        rating,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      toast.success("Thank you — a person reads every review before it goes up.");
      setRating(0);
      setComment("");
      onDone?.();
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
      <FormAlert>{error}</FormAlert>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-label-bold text-on-surface">How was {subject}?</legend>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              aria-pressed={rating === value}
              aria-label={`${value} out of 5 — ${STAR_LABELS[value]}`}
              className={`flex items-center gap-1 rounded-field px-3 py-2 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${rating >= value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"}`}
            >
              <Star aria-hidden="true" className={`size-4 ${rating >= value ? "fill-current" : ""}`} />
              {value}
            </button>
          ))}
        </div>
        {rating ? <p className="text-body-md text-on-surface-variant">{STAR_LABELS[rating]}</p> : null}
      </fieldset>

      <Field
        id={`review-comment-${item?.id ?? order.id}`}
        label="Anything you want to add?"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={2000}
        hint="Optional."
        autoComplete="off"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || !rating}
          className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Sending…" : "Leave the review"}
        </button>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
          >
            Not now
          </button>
        ) : null}
      </div>
    </form>
  );
}
