import { CircleAlert, TriangleAlert } from "lucide-react";

/**
 * Problems that stop something working for customers, worst first.
 *
 * "Blocking" means an order cannot be completed; "warning" means it can, but
 * not as someone probably intended. Each carries its own icon and words, so
 * the severity is never colour alone.
 */
export default function HealthNotice({ issues }) {
  if (!issues?.length) return null;
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((issue) => {
        const blocking = issue.level === "blocking";
        const Icon = blocking ? CircleAlert : TriangleAlert;
        return (
          <li
            key={issue.message}
            className={`flex items-start gap-2 rounded-card px-5 py-3 text-body-md ${
              blocking ? "bg-error-container text-on-error-container" : "bg-warning-container text-on-warning-container"
            }`}
          >
            <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <span>
              <span className="font-bold">{blocking ? "Cannot be ordered: " : "Check: "}</span>
              {issue.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
