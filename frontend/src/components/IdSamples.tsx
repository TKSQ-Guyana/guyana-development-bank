import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import driversLicence from "../assets/id-samples/drivers-licence.jpg";
import eId from "../assets/id-samples/e-id.jpg";
import nationalId from "../assets/id-samples/national-id.jpg";
import passport from "../assets/id-samples/passport.jpg";

/** What each identity document looks like, and where its number is.
 *
 *  The images are SAMPLES — "Alex Doe", every number zeroed — made for this
 *  help, not copies of anybody's document. `spot` is where the number sits on
 *  the sample, in percent of the image, so the popup can ring it. */
interface IdSample {
  image: string;
  title: string;
  what: string;
  numberLabel: string;
  numberWhere: string;
  example: string;
  spot: { left: number; top: number; width: number; height: number };
}

export const ID_SAMPLES: Record<string, IdSample> = {
  "National ID Card": {
    image: nationalId,
    title: "Guyana Identification Card",
    what: "The national ID card with your photo, name and date of birth.",
    numberLabel: "Identity No.",
    numberWhere: "bottom right of the card",
    example: "9 digits, e.g. 123456789",
    spot: { left: 56, top: 83, width: 34, height: 9 },
  },
  Passport: {
    image: passport,
    title: "Republic of Guyana Passport",
    what: "The photo page of your Guyana passport.",
    numberLabel: "Passport No.",
    numberWhere: "top right of the photo page",
    example: "letters then digits, e.g. RE0123456",
    spot: { left: 73, top: 10, width: 16, height: 11 },
  },
  "Driver's Licence": {
    image: driversLicence,
    title: "Republic of Guyana Driver Licence",
    what: "Your driver licence card, front side.",
    numberLabel: "TIN",
    numberWhere: "bottom right, under your photo",
    example: "9 digits, e.g. 123456789",
    spot: { left: 69, top: 81, width: 20, height: 8 },
  },
  "e-ID": {
    image: eId,
    title: "Citizen Identity Card (e-ID)",
    what: "The newer Citizen Identity Card with a chip and your GUIN.",
    numberLabel: "GUIN",
    numberWhere: "under your date of birth",
    example: "3-4-4 digits, e.g. 592-2001-0101",
    spot: { left: 34, top: 69, width: 21, height: 10 },
  },
};

const article = (kind: string) =>
  /^[AEIOU]/i.test(kind) || kind === "e-ID" ? "an" : "a";

/** "What is a Passport?" — opens the sample of that document. Renders nothing
 *  for a kind with no sample. */
export function IdSampleLink({
  kind,
  className = "",
  children,
}: {
  kind: string;
  className?: string;
  /** The link's own words instead of "What is a … ?" — no "?" badge then. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sample = ID_SAMPLES[kind];
  if (!sample) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 text-xs font-bold text-brand hover:underline ${className}`}
      >
        {children ?? (
          <>
            <span
              aria-hidden
              className="grid h-4 w-4 place-items-center rounded-full bg-brand/10 text-[10px] font-black"
            >
              ?
            </span>
            What is {article(kind)} {kind}?
          </>
        )}
      </button>
      {open && (
        <IdSampleDialog
          kind={kind}
          sample={sample}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function IdSampleDialog({
  kind,
  sample,
  onClose,
}: {
  kind: string;
  sample: IdSample;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // At the page root: it may open from inside another dialog or a page form.
  // React still bubbles a portal's events up the component tree, so none may
  // leave: a `close` reaching the upload dialog would cancel the upload.
  return createPortal(
    <dialog
      ref={ref}
      onClose={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onCancel={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="id-sample-title"
      className="m-auto w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/50"
    >
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">
            What is {article(kind)} {kind}?
          </p>
          <h2
            id="id-sample-title"
            className="mt-1 text-lg font-black tracking-tight text-slate-900"
          >
            {sample.title}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">{sample.what}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div className="px-5">
        <figure className="relative overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
          <img
            src={sample.image}
            alt={`Sample ${sample.title}`}
            className="block w-full"
          />
          {/* Where the number is, ringed on the sample. */}
          <span
            aria-hidden
            className="absolute animate-pulse rounded-lg ring-4 ring-amber-400 ring-offset-2 ring-offset-transparent"
            style={{
              left: `${sample.spot.left}%`,
              top: `${sample.spot.top}%`,
              width: `${sample.spot.width}%`,
              height: `${sample.spot.height}%`,
            }}
          />
          <figcaption className="absolute left-2 top-2 rounded-md bg-slate-900/75 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            Sample
          </figcaption>
        </figure>
      </div>

      <div className="m-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <span
          aria-hidden
          className="mt-0.5 h-3 w-3 flex-none rounded-full ring-4 ring-amber-400"
        />
        <p className="text-sm text-amber-950">
          Your number is the <strong>{sample.numberLabel}</strong>,{" "}
          {sample.numberWhere} — {sample.example}. Type it exactly as printed.
        </p>
      </div>
    </dialog>,
    document.body,
  );
}

/** "What is a National ID | Passport | E-ID Number" — one line, each its own
 *  sample (sign-up, where any of the three may be typed). */
export function IdSampleLinks({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-x-1.5 text-xs font-bold text-gdb-ink/60 ${className}`}
    >
      <span
        aria-hidden
        className="grid h-4 w-4 place-items-center rounded-full bg-brand/10 text-[10px] font-black text-brand"
      >
        ?
      </span>
      <span>What is a</span>
      <IdSampleLink kind="National ID Card">National ID</IdSampleLink>
      <span aria-hidden>|</span>
      <IdSampleLink kind="Passport">Passport</IdSampleLink>
      <span aria-hidden>|</span>
      <IdSampleLink kind="e-ID">E-ID Number</IdSampleLink>
    </span>
  );
}
