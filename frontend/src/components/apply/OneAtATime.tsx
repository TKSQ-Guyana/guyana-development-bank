import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  type OpenCase,
  openCaseLink,
  type ProductKey,
  useEligibility,
} from "../../shared/eligibility";

const NAMES: Record<ProductKey, string> = {
  standard: "SME Loan",
  quick: "Quick Loan",
};

/** Whether a NEW application of this kind is blocked, and the notice that
 *  says so. Used inside the forms rather than around their routes, so a form
 *  that has started (its URL changes on the first save) is never remounted.
 *  While the check is loading the form shows as normal: the server is the
 *  backstop. */
export function useOneAtATime(
  product: ProductKey,
  isNew: boolean,
): ReactNode | null {
  const eligibility = useEligibility();
  if (!isNew || !eligibility) return null;
  const mine = eligibility[product];
  if (mine.can_apply || !mine.open_case) return null;
  return (
    <OpenCaseNotice
      product={product}
      message={mine.message}
      openCase={mine.open_case}
    />
  );
}

function OpenCaseNotice({
  product,
  message,
  openCase,
}: {
  product: ProductKey;
  message: string | null;
  openCase: OpenCase;
}) {
  const link = openCaseLink(product, openCase);
  const mine = { message, open_case: openCase };

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-amber-50 to-white px-6 py-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">
            One loan at a time
          </p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">
            {mine.open_case.kind === "draft"
              ? "You have already started one"
              : `You already have ${product === "standard" ? "an" : "a"} ${NAMES[product]}`}
          </h2>
        </div>
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm leading-relaxed text-slate-600">
            {mine.message}
          </p>
          <p className="text-xs text-slate-500">
            Each citizen may have one loan with GDB at a time — a Quick Loan or
            an SME Loan. Once it is fully repaid you can apply for another.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to={link.to}
              className="inline-flex items-center rounded-xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-[#262626]"
            >
              {link.label}
            </Link>
            <Link
              to="/apply/new"
              className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Choose another loan
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
