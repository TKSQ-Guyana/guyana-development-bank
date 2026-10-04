import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useEligibility } from "../../shared/eligibility";

/** The way into a new application. One loan at a time (services/eligibility):
 *  while a case is open it is a disabled button whose tooltip says why, not a
 *  link to a form the server would refuse. */
export function ApplyLink({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const eligibility = useEligibility();
  const reason =
    eligibility &&
    !eligibility.quick.can_apply &&
    !eligibility.standard.can_apply
      ? (eligibility.quick.message ?? eligibility.standard.message)
      : null;
  if (reason) {
    return (
      <span title={reason} className="inline-flex">
        <button
          type="button"
          disabled
          aria-label={`${typeof children === "string" ? children : "Apply"} — ${reason}`}
          className={`${className} cursor-not-allowed opacity-50 hover:translate-y-0`}
        >
          {children}
        </button>
      </span>
    );
  }
  return (
    <Link to="/apply/new" className={className}>
      {children}
    </Link>
  );
}
