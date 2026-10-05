import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { call } from "../api";
import { REGIONS } from "../components/apply/cluster";
import { isGuyanaPhone, PhoneInput } from "../components/PhoneInput";
import {
  coatOfArms,
  stockBarber,
  stockBasketWeaver,
  stockCafeOwner,
  stockMarketVendor,
  stockFactoryWorker,
  stockSeamstress,
  stockOnlineBusiness,
  gdbLogo,
  presidentPhoto,
} from "../components/site/assets";

/**
 * The public front door — what a citizen sees before they have an account.
 * Built to the "Home v3" design (Hanken Grotesk, navy and gold).
 *
 * It renders for a signed-out visitor by choice rather than as a gate, so it
 * carries no `useAuth`: nothing on it varies by who is reading. App.tsx
 * decides whether a visitor sees this or their dashboard. Every "apply" link
 * goes into the app, which asks a signed-out visitor to sign in first.
 *
 * `gdb-public` tells `index.css` to drop the application's fixed gradient so
 * this page's own background runs the full height of the document.
 */

const GOLD = "#f2c14e";

const GUTTER = "px-[clamp(16px,4vw,48px)]";
const SECTION_Y = "py-[clamp(56px,7vw,96px)]";
const WRAP = "mx-auto w-full max-w-[1320px]";
const EYEBROW =
  "text-[14px] font-bold uppercase tracking-[0.08em] text-[#b8860b]";
const H2 =
  "m-0 text-[clamp(34px,4vw,52px)] font-extrabold leading-[1.04] tracking-[-0.03em] text-[#0b2654] [text-wrap:balance]";
const PILL =
  "inline-flex items-center justify-center rounded-full font-bold no-underline transition-colors";

const QUICK_MAX = 300_000;
const SME_MAX = 3_000_000;
const MIN_AMOUNT = 50_000;

const gyd = (n: number) => "G$" + Math.round(n).toLocaleString("en-US");

/** The estimate slider: its left half is the Quick Loan's range (to G$300k),
 *  its right half the SME Loan's — so the small amounts get the room. */
const amountAt = (pos: number) =>
  pos <= 50
    ? Math.round(
        (MIN_AMOUNT + (pos / 50) * (QUICK_MAX - MIN_AMOUNT)) / 10_000,
      ) * 10_000
    : Math.round(
        (QUICK_MAX + ((pos - 50) / 50) * (SME_MAX - QUICK_MAX)) / 50_000,
      ) * 50_000;
const positionOf = (amount: number) =>
  amount <= QUICK_MAX
    ? ((amount - MIN_AMOUNT) / (QUICK_MAX - MIN_AMOUNT)) * 50
    : 50 + ((amount - QUICK_MAX) / (SME_MAX - QUICK_MAX)) * 50;

/** Each loan's own terms: a Quick Loan runs to 24 months, an SME Loan longer. */
const QUICK_TERMS = [6, 12, 18, 24];
const SME_TERMS = [12, 24, 36, 48];

// The identity documents sign-up accepts (tin_auth.DOCUMENT_KINDS).
const ID_LINE =
  "One valid ID to create your account: e-ID, National ID card, driver’s licence or passport";
const NEED_QUICK = [
  ID_LINE,
  "Phone number",
  "A short description of your business and what the loan is for",
  "Bank details must be provided before loan disbursement",
];
const NEED_SME = [
  ID_LINE,
  "Phone number",
  "Business registration and TIN",
  "Business details and location",
  "Market, customers and financial information",
  "How you’ll use the funds",
  "Bank details must be provided before loan disbursement",
];

const STEPS = [
  {
    n: "1",
    title: "Apply online",
    body: "Complete your application online. Your details are prefilled from your National ID record where possible.",
  },
  {
    n: "2",
    title: "Review",
    body: "A GDB credit officer reviews your application. You will be notified if additional information is required.",
  },
  {
    n: "3",
    title: "Accept your offer",
    body: "Receive a letter of offer with the amount, term and instalment. The letter of offer is accepted and signed online.",
  },
  {
    n: "4",
    title: "Loan disbursed",
    body: "Your loan is paid into your bank account. Repay as per your instalment cycle, with no interest.",
  },
];

const FAQS = [
  {
    q: "Is it really 0% interest?",
    a: "Yes. You repay only the amount you borrow — no interest is added. Your letter of offer shows the amount, term and monthly instalment before you accept.",
  },
  {
    q: "Do I have to repay the loan?",
    a: "Yes. This is a loan, not a grant. Repaying on time builds your credit history and can help you qualify for larger financing later.",
  },
  {
    q: "Which loan should I choose?",
    a: "If you need up to G$300,000 for a small business, choose the Quick Loan — it is shorter and faster. For larger amounts up to G$3,000,000, choose the SME Loan.",
  },
  {
    q: "Which forms of IDs are acceptable?",
    a: "E-ID, National ID Card, Driver's Licence and Passport.",
  },
  {
    q: "How do I check on my application?",
    a: "Sign in and open My applications. Each application shows its current status — under review, approved or declined, or loan disbursed — and any action we need from you.",
  },
  {
    q: "How will I receive the money?",
    a: "Funds are paid directly into your bank account. You provide your banking details in the application.",
  },
];

export function Landing() {
  // TEMPORARY — "Coming soon" until the public launch. Remove this line (and
  // the ComingSoon component below) to release the full landing page.
  // return <ComingSoon />;

  return (
    <div
      className="gdb-public flex min-h-screen flex-col bg-[#faf8f4] text-[#17161d] antialiased"
      style={{ fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}
    >
      <GovStrip />
      <Header />
      <LaunchBanner />
      <main id="top" className="flex-1">
        <Hero />
        <Loans />
        <HowItWorks />
        <President />
        <About />
        <Faqs />
        <Appointment />
        <ReadyBand />
      </main>
      <Footer />
    </div>
  );
}

/** TEMPORARY: the pre-launch page. Delete with the early return above. */
export function ComingSoon() {
  return (
    <div
      className="gdb-public flex min-h-screen flex-col items-center justify-center gap-8 bg-[#faf8f4] px-4 text-center text-[#17161d] antialiased"
      style={{ fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}
    >
      <div className="flex items-center">
        <img
          src={coatOfArms}
          alt="Coat of Arms of Guyana"
          className="block h-12 w-auto flex-none sm:h-16"
        />
        <span className="mx-4 h-12 w-px flex-none bg-[#e7e3da]" aria-hidden />
        <img
          src={gdbLogo}
          alt="Guyana Development Bank"
          className="block h-auto max-h-12 w-auto min-w-0 max-w-full sm:max-h-16"
        />
      </div>
      <h1 className="m-0 text-[clamp(44px,7vw,88px)] font-extrabold leading-[0.95] tracking-[-0.04em] text-[#0b2654]">
        Coming soon
      </h1>
      <p className="m-0 max-w-[32em] text-[clamp(17px,1.5vw,20px)] leading-[1.5] text-[#3d3a4a]">
        The Guyana Development Bank loan portal is almost ready. Please check
        back soon.
      </p>
    </div>
  );
}

function GovStrip() {
  return (
    <div
      className={`flex flex-wrap justify-between gap-3 bg-black py-2 text-[13px] text-[#e4eaf5] ${GUTTER}`}
    >
      <span>
        An official website of the Government of the Co-operative Republic of
        Guyana
      </span>
      <a
        href="https://finance.gov.gy"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold tracking-[0.02em] text-[#f2c14e] underline hover:text-[#f5cd6a]"
      >
        <span className="normal-case">finance.gov.gy</span> · Ministry of
        Finance ↗
      </a>
    </div>
  );
}

function Header() {
  const nav = [
    ["#loans", "Loans"],
    ["#how", "How it works"],
    ["#about", "About the Bank"],
    ["#help", "FAQs"],
  ];
  // Phones get a menu button; the navy bar of sections shows from md up.
  const [open, setOpen] = useState(false);
  const link =
    "rounded-full px-4 py-2 text-[15px] font-semibold text-white no-underline transition-colors hover:bg-white/10 hover:text-white";
  return (
    <header
      className={`sticky top-0 z-20 border-b border-[#e7e3da] bg-white/95 py-3 backdrop-blur ${GUTTER}`}
    >
      <div className="flex items-center justify-between gap-4">
        <a
          href="#top"
          className="flex min-w-0 items-center no-underline"
          aria-label="Guyana Development Bank — home"
        >
          <img
            src={coatOfArms}
            alt="Coat of Arms of Guyana"
            className="block h-10 w-auto flex-none sm:h-12"
          />
          <span
            className="mx-3 h-9 w-px flex-none bg-[#e7e3da] sm:mx-4"
            aria-hidden
          />
          <img
            src={gdbLogo}
            alt="Guyana Development Bank"
            className="block h-auto max-h-10 w-auto min-w-0 max-w-full sm:max-h-12"
          />
        </a>

        <nav
          aria-label="Sections"
          className="hidden items-center gap-1 rounded-2xl bg-[#0b2654] px-2 py-1.5 shadow-sm lg:flex"
        >
          {nav.map(([href, label]) => (
            <a key={href} href={href} className={link}>
              {label}
            </a>
          ))}
        </nav>

        <div className="flex flex-none items-center gap-2">
          <Link
            to="/signup"
            className="hidden items-center justify-center rounded-full px-4 py-2.5 text-[15px] font-semibold text-[#123a7a] no-underline transition-colors hover:bg-[#123a7a]/5 sm:inline-flex"
          >
            Sign up
          </Link>
          <Link
            to="/apply/new"
            className={`${PILL} bg-[#123a7a] px-[18px] py-2.5 text-[15px] font-semibold text-white hover:bg-[#0b2654]`}
          >
            Apply
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid h-11 w-11 place-items-center rounded-xl bg-[#0b2654] text-white lg:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden
            >
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="site-menu"
          aria-label="Sections"
          className="mt-3 flex flex-col gap-1 rounded-2xl bg-[#0b2654] p-2 shadow-lg lg:hidden"
        >
          {nav.map(([href, label]) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`${link} py-3`}
            >
              {label}
            </a>
          ))}
          <Link
            to="/signup"
            onClick={() => setOpen(false)}
            className="mt-1 rounded-full border border-white/25 px-4 py-3 text-center text-[15px] font-semibold text-white no-underline hover:bg-white/10 sm:hidden"
          >
            Sign up
          </Link>
        </nav>
      )}
    </header>
  );
}

function LaunchBanner() {
  return (
    <Link
      to="/apply/new"
      className={`flex flex-wrap items-center justify-center gap-2.5 bg-[#f2c14e] py-2.5 text-center text-[15px] font-semibold text-[#0b2654] no-underline hover:bg-[#f5cd6a] ${GUTTER}`}
    >
      <span>
        Now accepting applications, with zero-interest financing up to
        G$3,000,000.
      </span>
      <span className="underline">Apply online →</span>
    </Link>
  );
}

function Photo({
  src,
  alt,
  className = "",
  focus = "object-center",
}: {
  src: string;
  alt: string;
  className?: string;
  /** Where the crop centres (an object-position class) — on the person. */
  focus?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[20px] bg-[#e4dfd2] ${className}`}
    >
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 h-full w-full object-cover ${focus}`}
      />
    </div>
  );
}

function Hero() {
  return (
    <section className={`py-[clamp(40px,6vw,88px)] ${GUTTER}`}>
      <div className={`${WRAP} flex flex-col gap-[clamp(36px,5vw,64px)]`}>
        <div className="grid items-end gap-[clamp(24px,4vw,64px)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr))]">
          <h1 className="m-0 text-[clamp(44px,6vw,88px)] font-extrabold leading-[0.95] tracking-[-0.04em] text-[#0b2654] [text-wrap:balance]">
            Let us help you to{" "}
            <span className="bg-[linear-gradient(transparent_62%,#f2c14e_62%,#f2c14e_92%,transparent_92%)] px-[0.04em]">
              grow
            </span>{" "}
            your business
          </h1>
          <div className="flex flex-col gap-6 pb-2.5">
            <p className="m-0 max-w-[30em] text-[clamp(18px,1.5vw,21px)] leading-[1.5] text-[#3d3a4a] [text-wrap:pretty]">
              The Guyana Development Bank gives small and medium businesses the
              capital to start up, sustain, scale and grow, with zero-interest
              loans up to G$3,000,000.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="#loans"
                className={`${PILL} bg-[#123a7a] px-[26px] py-4 text-[17px] text-white hover:bg-[#0b2654]`}
              >
                Apply now
              </a>
              <a
                href="#appointment"
                className={`${PILL} border-[1.5px] border-[#123a7a] px-[26px] py-4 text-[17px] text-[#123a7a] hover:bg-[#123a7a]/5`}
              >
                Schedule an appointment
              </a>
            </div>
          </div>
        </div>
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr))]">
          <div className="grid min-h-[460px] grid-cols-[1.2fr_1fr] grid-rows-2 gap-5">
            <Photo
              src={stockMarketVendor}
              alt="A vendor at her produce stall in Stabroek Market, Georgetown"
              className="row-span-2"
              focus="object-[48%_center]"
            />
            <Photo
              src={stockBasketWeaver}
              alt="A craftswoman weaving a basket by the river"
              focus="object-[38%_center]"
            />
            <Photo
              src={stockBarber}
              alt="A barber cutting a customer's hair in his shop"
              focus="object-[28%_center]"
            />
          </div>
          <Estimator />
        </div>
      </div>
    </section>
  );
}

function Estimator() {
  const [amount, setAmount] = useState(250_000);
  const [term, setTerm] = useState(24);
  const quick = amount <= QUICK_MAX;
  const terms = quick ? QUICK_TERMS : SME_TERMS;
  // A term the other loan offers is moved to this loan's nearest one.
  const shown = terms.includes(term)
    ? term
    : terms.reduce((a, b) => (Math.abs(b - term) < Math.abs(a - term) ? b : a));

  return (
    <div className="flex flex-col gap-6 rounded-[24px] bg-black p-[clamp(28px,3vw,40px)] text-[#faf8f4]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-[24px] font-extrabold tracking-[-0.01em]">
          How much does your business need?
        </h2>
        <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#f2c14e]">
          Estimate
        </span>
      </div>
      <div className="flex flex-col gap-3.5">
        <output
          htmlFor="gdb-estimate"
          className="text-[clamp(44px,5vw,64px)] font-extrabold leading-none tracking-[-0.035em] text-[#f2c14e]"
        >
          {gyd(amount)}
        </output>
        <input
          id="gdb-estimate"
          type="range"
          min={0}
          max={100}
          step={1}
          value={positionOf(amount)}
          onChange={(e) => setAmount(amountAt(Number(e.target.value)))}
          aria-label="Loan amount"
          aria-valuetext={gyd(amount)}
          className="h-7 w-full cursor-pointer"
          style={{ accentColor: GOLD }}
        />
        <div className="flex justify-between text-[13px] text-[#c9d6ec]">
          <span>G$50,000</span>
          <span>G$300,000</span>
          <span>G$3,000,000</span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="text-[14px] font-semibold text-[#c9d6ec]">
          Repay over
        </span>
        <div
          className="grid grid-cols-4 gap-2"
          role="radiogroup"
          aria-label="Repay over"
        >
          {terms.map((t) => {
            const on = t === shown;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTerm(t)}
                className={`h-11 cursor-pointer rounded-[10px] border-[1.5px] text-[15px] transition-colors ${
                  on
                    ? "border-[#f2c14e] bg-[#f2c14e] font-bold text-[#0b2654]"
                    : "border-[#3a3a3a] bg-transparent font-semibold text-[#faf8f4] hover:border-[#f2c14e]/60"
                }`}
              >
                {t} mo
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[14px] bg-[#2a2a2a]">
        {[
          ["Loan", quick ? "Quick Loan" : "SME Loan", ""],
          ["Monthly", gyd(amount / shown), ""],
          ["Interest", "G$0", "text-[#f2c14e]"],
        ].map(([label, value, tone]) => (
          <div key={label} className="flex flex-col gap-1 bg-[#141414] p-4">
            <span className="text-[13px] text-[#c9d6ec]">{label}</span>
            <span className={`text-[18px] font-extrabold ${tone}`}>
              {value}
            </span>
          </div>
        ))}
      </div>
      <p className="m-0 text-[14px] leading-[1.5] text-[#c9d6ec]">
        {quick
          ? "Short application for small businesses. Apply online in a few short steps."
          : "For small and medium businesses. You will list how you will use the funds."}
      </p>
      <Link
        to={quick ? "/apply/quick" : "/apply/new/sme"}
        className={`${PILL} mt-auto bg-[#f2c14e] px-6 py-4 text-center text-[17px] text-[#0b2654] hover:bg-[#f5cd6a]`}
      >
        Apply for {quick ? "a Quick Loan" : "an SME Loan"}
      </Link>
      <p className="m-0 text-[12px] text-[#86a3d4]">
        Illustrative only. Your final amount, term and instalment are set in
        your letter of offer.
      </p>
    </div>
  );
}

function Needs({ items, tone }: { items: string[]; tone: "gold" | "navy" }) {
  const gold = tone === "gold";
  return (
    <div
      className={`flex flex-col gap-3 border-t pt-5 ${gold ? "border-[#e6dcbf]" : "border-[#3a3a3a]"}`}
    >
      <span
        className={`text-[13px] font-bold uppercase tracking-[0.08em] ${gold ? "text-[#b8860b]" : "text-[#f2c14e]"}`}
      >
        What you'll need
      </span>
      {items.map((item) => (
        <div
          key={item}
          className={`flex gap-2.5 text-[15px] leading-[1.45] ${gold ? "text-[#2c2a38]" : "text-[#eaf0f9]"}`}
        >
          <span
            className={`font-extrabold ${gold ? "text-[#b8860b]" : "text-[#f2c14e]"}`}
          >
            ✓
          </span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function Dashes({ items, tone }: { items: string[]; tone: "gold" | "navy" }) {
  const gold = tone === "gold";
  return (
    <ul
      className={`m-0 flex list-none flex-col gap-2.5 p-0 text-[16px] ${gold ? "text-[#2c2a38]" : "text-[#eaf0f9]"}`}
    >
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <span
            className={`font-extrabold ${gold ? "text-[#b8860b]" : "text-[#f2c14e]"}`}
          >
            —
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function Loans() {
  return (
    <section
      id="loans"
      className={`scroll-mt-20 border-y border-[#ece8de] bg-white ${SECTION_Y} ${GUTTER}`}
    >
      <div className={`${WRAP} flex flex-col gap-10`}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-[640px] flex-col gap-3">
            <span className={EYEBROW}>Our loans</span>
            <h2 className={H2}>Two loans. Similar conditions.</h2>
          </div>
          <p className="m-0 max-w-[26em] text-[17px] leading-[1.5] text-[#5e5b6b]">
            Both loans are zero-interest financing, so you repay only what you
            borrow. If we can’t fetch your details automatically, you can type
            them in or upload a document.
          </p>
        </div>

        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
          <article className="flex flex-col gap-6 rounded-[24px] bg-[#f7f1df] p-[clamp(28px,3vw,40px)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span className="rounded-full bg-[#f2c14e] px-3 py-1.5 text-[15px] font-bold text-[#0b2654]">
                Quick Loan
              </span>
              <span className="text-[14px] font-medium text-[#6b5a2a]">
                For small businesses
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] text-[#5e5b6b]">Borrow up to</span>
              <span className="text-[clamp(44px,5vw,64px)] font-extrabold leading-none tracking-[-0.03em] text-[#0b2654]">
                G$300,000
              </span>
            </div>
            <p className="m-0 text-[18px] leading-[1.5] text-[#2c2a38] [text-wrap:pretty]">
              For small businesses — market vendors, salons, barbershops, food
              sellers, seamstresses, mechanics and more. Apply with a short
              description of your business and what the loan is for.
            </p>
            <Dashes
              tone="gold"
              items={[
                "Short application you can finish on your phone",
                "Prefer help in person? Book an appointment with GDB",
              ]}
            />
            <Needs items={NEED_QUICK} tone="gold" />
            <div className="mt-auto flex flex-wrap gap-2.5">
              <Link
                to="/apply/quick"
                className={`${PILL} bg-[#0b2654] px-[22px] py-3.5 text-[16px] text-white hover:bg-[#123a7a]`}
              >
                Start Quick Loan application
              </Link>
              <a
                href="#appointment"
                className={`${PILL} border-[1.5px] border-[#0b2654] px-[22px] py-3.5 text-[16px] text-[#0b2654] hover:bg-[#0b2654]/5`}
              >
                Book an appointment
              </a>
            </div>
          </article>

          <article className="flex flex-col gap-6 rounded-[24px] bg-black p-[clamp(28px,3vw,40px)] text-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span className="rounded-full bg-white px-3 py-1.5 text-[15px] font-bold text-[#123a7a]">
                SME Loan
              </span>
              <span className="text-[14px] font-medium text-[#c9d6ec]">
                For small &amp; medium businesses
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] text-[#c9d6ec]">Borrow up to</span>
              <span className="text-[clamp(44px,5vw,64px)] font-extrabold leading-none tracking-[-0.03em] text-[#f2c14e]">
                G$3,000,000
              </span>
            </div>
            <p className="m-0 text-[18px] leading-[1.5] text-[#eaf0f9] [text-wrap:pretty]">
              For small and medium enterprises — in agriculture,
              agro-processing, manufacturing, tourism, services, technology, the
              creative industries and more.
            </p>
            <Dashes
              tone="navy"
              items={[
                "Details prefilled from your National ID record where available",
                "List how you'll use the funds",
                "Track every step in My application and uplifted commerce",
              ]}
            />
            <Needs items={NEED_SME} tone="navy" />
            <div className="mt-auto flex flex-wrap gap-2.5">
              <Link
                to="/apply/new/sme"
                className={`${PILL} bg-[#f2c14e] px-[22px] py-3.5 text-[16px] text-[#0b2654] hover:bg-[#f5cd6a]`}
              >
                Start SME Loan application
              </Link>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      id="how"
      className={`scroll-mt-20 bg-[#0b2654] text-white ${SECTION_Y} ${GUTTER}`}
    >
      <div className={`${WRAP} flex flex-col gap-12`}>
        <div className="flex max-w-[640px] flex-col gap-3">
          <span className="text-[14px] font-bold uppercase tracking-[0.08em] text-[#f2c14e]">
            How it works
          </span>
          <h2 className="m-0 text-[clamp(34px,4vw,52px)] font-extrabold leading-[1.04] tracking-[-0.03em] [text-wrap:balance]">
            From application to money in your account.
          </h2>
        </div>
        <ol className="m-0 grid list-none gap-0.5 overflow-hidden rounded-[20px] bg-[#284c86] p-0 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="flex min-h-[220px] flex-col gap-3.5 bg-[#0f3068] p-7"
            >
              <span className="text-[28px] font-extrabold leading-none text-[#f2c14e]">
                {s.n}
              </span>
              <h3 className="m-0 text-[22px] font-bold">{s.title}</h3>
              <p className="m-0 text-[16px] leading-[1.5] text-[#d0dcef]">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function President() {
  return (
    <section id="president" className={`${SECTION_Y} ${GUTTER}`}>
      <div
        className={`${WRAP} flex flex-wrap overflow-hidden rounded-[28px] border border-[#e7e3da] bg-white`}
      >
        <div className="relative aspect-[554/672] max-w-full flex-[1_1_320px] bg-[#e4dfd2]">
          <img
            src={presidentPhoto}
            alt="H.E. Dr. Mohamed Irfaan Ali"
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        </div>
        <div className="flex flex-[1.6_1_420px] flex-col justify-center gap-6 p-[clamp(32px,5vw,64px)]">
          <span className={EYEBROW}>From the President</span>
          <blockquote className="m-0 text-[clamp(26px,2.8vw,38px)] font-bold leading-[1.2] tracking-[-0.02em] text-[#0b2654] [text-wrap:pretty]">
            “You don't have to own anything. You just have to have an idea that
            we will help you develop, that we will help you to nurture.”
          </blockquote>
          <div className="flex flex-col gap-1 border-t border-[#efece5] pt-[18px]">
            <span className="text-[17px] font-bold text-[#17161d]">
              H.E. Dr. Mohamed Irfaan Ali
            </span>
            <span className="text-[15px] text-[#5e5b6b]">
              President of the Co-operative Republic of Guyana
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Some of the businesses GDB lends to, as the About section shows them. */
const SERVED = [
  {
    src: stockFactoryWorker,
    label: "Manufacturing",
    alt: "A smiling foreman in a hard hat and high-visibility vest on a factory floor",
  },
  {
    src: stockOnlineBusiness,
    label: "Online and home businesses",
    alt: "A woman running her small business from a laptop",
  },
  {
    src: stockSeamstress,
    label: "Tailors and seamstresses",
    alt: "A smiling seamstress at her sewing machine in a colourful tailor shop",
  },
];

function About() {
  const cards = [
    [
      "Our mission",
      "To provide Guyanese small and medium enterprises with affordable capital and support to start up, sustain, scale and grow.",
    ],
    [
      "Our vision",
      "A Guyana where every business with the will to grow has access to the capital to do it.",
    ],
    [
      "Who we serve",
      "Farmers, vendors, manufacturers, service providers, enterprises and so much more.",
    ],
  ];
  return (
    <section
      id="about"
      className={`scroll-mt-20 border-t border-[#ece8de] bg-white ${SECTION_Y} ${GUTTER}`}
    >
      <div className={`${WRAP} flex flex-col gap-12`}>
        <div className="grid items-end gap-[clamp(32px,5vw,72px)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
          <div className="flex flex-col gap-3">
            <span className={EYEBROW}>About the Bank</span>
            <h2 className={H2}>
              A bank built for the businesses that develop Guyana.
            </h2>
          </div>
          <p className="m-0 text-[18px] leading-[1.55] text-[#3d3a4a] [text-wrap:pretty]">
            A Government of Guyana institution under the Ministry of Finance,
            serving small and medium businesses.
          </p>
        </div>
        <ul className="m-0 grid list-none gap-5 p-0 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
          {SERVED.map((s) => (
            <li key={s.label} className="flex flex-col gap-3">
              <Photo
                src={s.src}
                alt={s.alt}
                className="aspect-[4/3]"
                focus="object-[center_18%]"
              />
              <span className="text-[17px] font-bold text-[#0b2654]">
                {s.label}
              </span>
            </li>
          ))}
        </ul>
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
          {cards.map(([title, body]) => (
            <div
              key={title}
              className="flex flex-col gap-3 rounded-[20px] bg-[#faf8f4] p-8"
            >
              <span className="text-[14px] font-bold text-[#b8860b]">
                {title}
              </span>
              <p className="m-0 text-[21px] font-semibold leading-[1.4] text-[#0b2654] [text-wrap:pretty]">
                {body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faqs() {
  const [open, setOpen] = useState(0);
  return (
    <section id="help" className={`scroll-mt-20 ${SECTION_Y} ${GUTTER}`}>
      <div className="mx-auto flex max-w-[960px] flex-col gap-8">
        <h2 className={H2}>FAQs</h2>
        <div className="flex flex-col border-t border-[#e1ddd2]">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q} className="border-b border-[#e1ddd2]">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`faq-${i}`}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  className="flex w-full cursor-pointer items-center justify-between gap-5 border-0 bg-transparent py-6 text-left text-[19px] font-bold text-[#0b2654]"
                >
                  <span>{f.q}</span>
                  <span
                    aria-hidden
                    className="flex-none text-[26px] font-normal text-[#b8860b]"
                  >
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                {isOpen && (
                  <p
                    id={`faq-${i}`}
                    className="m-0 mb-6 max-w-[46em] text-[17px] leading-[1.6] text-[#3d3a4a]"
                  >
                    {f.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Booking help in person. A field officer request belongs to a signed-in
 *  citizen (services/quick_loan.request_field_officer) — the officer's queue,
 *  consent and assisted draft all hang off that account — so the card takes a
 *  visitor there rather than collecting details the page could not send. */
/** GDB's industries, from gdb_bank.api.industry_options (the desk's list). */
interface Industry {
  sector: string;
  sub_sectors: { name: string; label: string }[];
}

const APPT_INPUT =
  "mt-1.5 w-full rounded-xl border border-[#d9d4c7] bg-white px-4 py-3 text-[15px] text-[#17161d] placeholder:text-[#9a97a6] focus:border-transparent focus:outline-2 focus:outline-offset-1 focus:outline-[#123a7a]";
const APPT_LABEL = "block text-[14px] font-bold text-[#0b2654]";
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Book appointment": a contact form, not a sign-up (GDB, 2026-10-05). It
 *  goes to the GDB Representative's queue (gdb_bank.tin_auth.request_appointment)
 *  and the person gets a text saying it arrived. On a phone only the form is
 *  shown — the photograph and its heading take the screen without helping. */
function Appointment() {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    region: "",
    industry_sector: "",
  });
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    call<Industry[]>("gdb_bank.api.industry_options")
      .then((rows) => setIndustries(rows ?? []))
      .catch(() => setIndustries([]));
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const set = (key: keyof typeof form) => (value: string) => {
    setError(null);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim()) return setError("Enter your first name.");
    if (!form.last_name.trim()) return setError("Enter your last name.");
    if (!isGuyanaPhone(form.phone))
      return setError("Enter your phone number, e.g. 600 1234.");
    if (form.email.trim() && !EMAIL_SHAPE.test(form.email.trim()))
      return setError("Enter a valid email address, or leave it blank.");
    if (!form.region) return setError("Choose your region.");
    if (!form.industry_sector) return setError("Choose your industry sector.");
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ name: string }>(
        "gdb_bank.tin_auth.request_appointment",
        {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone,
          email: form.email.trim() || undefined,
          region: form.region,
          industry_sector: form.industry_sector,
          reason: "Book appointment",
        },
      );
      setSent(res.name);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Your request could not be sent. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="appointment" className={`scroll-mt-20 ${SECTION_Y} ${GUTTER}`}>
      <div
        className={`${WRAP} grid items-center gap-[clamp(32px,5vw,72px)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]`}
      >
        <div className="hidden flex-col gap-5 md:flex">
          <span className={EYEBROW}>Book an appointment</span>
          <h2 className={H2}>Prefer to apply with a GDB team member?</h2>
          <p className="m-0 max-w-[32em] text-[18px] leading-[1.55] text-[#3d3a4a] [text-wrap:pretty]">
            Book an appointment and a member of the GDB team will confirm a time
            with you and help you complete your loan application.
          </p>
          <div className="relative aspect-video overflow-hidden rounded-[20px] bg-[#e4dfd2]">
            <img
              src={stockCafeOwner}
              alt="The owner of Guyana Flavours café smiling behind his counter"
              className="absolute inset-0 h-full w-full object-cover object-[center_25%]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-5 rounded-[24px] border border-[#e7e3da] bg-white p-[clamp(24px,3vw,40px)] shadow-[0_20px_50px_rgba(11,38,84,0.06)]">
          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 text-[24px] font-extrabold text-[#0b2654]">
              {sent ? "Request sent" : "Book an appointment"}
            </h3>
            <p className="m-0 text-[15px] text-[#5e5b6b]">
              {sent
                ? "Thank you. A GDB representative will contact you soon."
                : "Tell us how to reach you. We will contact you within two working days."}
            </p>
          </div>

          {sent ? (
            <div className="flex flex-col gap-4">
              <p className="m-0 text-[15px] leading-[1.55] text-[#3d3a4a]">
                We will call you on{" "}
                <b>+592 {form.phone.replace(/^\+592/, "")}</b>. Your reference
                is{" "}
                <span className="font-mono font-bold text-[#0b2654]">
                  {sent}
                </span>
                .
              </p>
              <p className="m-0 text-[13px] leading-[1.5] text-[#6b6878]">
                Please bring a valid ID to your appointment.
              </p>
            </div>
          ) : (
            <form
              onSubmit={(e) => void submit(e)}
              noValidate
              className="flex flex-col gap-4"
            >
              {error && (
                <p
                  ref={errorRef}
                  tabIndex={-1}
                  role="alert"
                  className="m-0 rounded-xl bg-red-50 px-4 py-3 text-[14px] font-medium text-red-700 outline-none"
                >
                  {error}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={APPT_LABEL}>
                  First name <span className="text-red-600">*</span>
                  <input
                    value={form.first_name}
                    onChange={(e) => set("first_name")(e.target.value)}
                    autoComplete="given-name"
                    className={APPT_INPUT}
                  />
                </label>
                <label className={APPT_LABEL}>
                  Last name <span className="text-red-600">*</span>
                  <input
                    value={form.last_name}
                    onChange={(e) => set("last_name")(e.target.value)}
                    autoComplete="family-name"
                    className={APPT_INPUT}
                  />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={APPT_LABEL}>
                  Phone <span className="text-red-600">*</span>
                  <PhoneInput
                    value={form.phone}
                    onChange={set("phone")}
                    className={APPT_INPUT}
                  />
                </label>
                <label className={APPT_LABEL}>
                  Email{" "}
                  <span className="font-normal text-[#6b6878]">(optional)</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email")(e.target.value)}
                    autoComplete="email"
                    className={APPT_INPUT}
                  />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={APPT_LABEL}>
                  Region <span className="text-red-600">*</span>
                  <select
                    value={form.region}
                    onChange={(e) => set("region")(e.target.value)}
                    className={APPT_INPUT}
                  >
                    <option value="">Choose your region</option>
                    {REGIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={APPT_LABEL}>
                  Industry sector <span className="text-red-600">*</span>
                  <select
                    value={form.industry_sector}
                    onChange={(e) => set("industry_sector")(e.target.value)}
                    className={APPT_INPUT}
                  >
                    <option value="">Choose your industry</option>
                    {industries.map((i) => (
                      <option key={i.sector} value={i.sector}>
                        {i.sector}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="submit"
                disabled={busy}
                className={`${PILL} h-14 w-full border-0 bg-[#123a7a] px-6 text-[17px] text-white hover:bg-[#0b2654] disabled:opacity-60`}
              >
                {busy ? "Sending…" : "Book appointment"}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function ReadyBand() {
  return (
    <section className={`pb-[clamp(56px,7vw,96px)] ${GUTTER}`}>
      <div
        className={`${WRAP} flex flex-wrap items-center justify-between gap-7 rounded-[28px] bg-[#f2c14e] p-[clamp(32px,5vw,64px)]`}
      >
        <h2 className="m-0 max-w-[16em] text-[clamp(30px,3.6vw,46px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-[#0b2654] [text-wrap:balance]">
          Ready to grow? Your application takes minutes to start.
        </h2>
        <div className="flex flex-wrap gap-3">
          <a
            href="#loans"
            className={`${PILL} bg-[#0b2654] px-[26px] py-4 text-[17px] text-white hover:bg-[#123a7a]`}
          >
            Apply for a loan
          </a>
          <Link
            to="/apply"
            className={`${PILL} border-[1.5px] border-[#0b2654] px-[26px] py-4 text-[17px] text-[#0b2654] hover:bg-[#0b2654]/5`}
          >
            Check my application
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const link = "text-[#c9d6ec] hover:text-white";
  return (
    <footer className={`bg-[#0b2654] pt-14 text-[#c9d6ec] ${GUTTER}`}>
      <div className={`${WRAP} flex flex-col gap-10`}>
        <div className="grid gap-8 [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))]">
          <div className="flex flex-col gap-3">
            <span className="text-[18px] font-bold text-white">
              Guyana Development Bank
            </span>
            <span className="text-[15px] leading-[1.5]">
              Zero-interest financing for Guyanese small and medium businesses.
              Government of Guyana · Ministry of Finance.
            </span>
          </div>
          <div className="flex flex-col gap-2.5 text-[15px]">
            <span className="font-bold text-white">Loans</span>
            <Link to="/apply/quick" className={link}>
              Quick Loan
            </Link>
            <Link to="/apply/new/sme" className={link}>
              SME Loan
            </Link>
            <a href="#appointment" className={link}>
              Book an appointment
            </a>
          </div>
          <div className="flex flex-col gap-2.5 text-[15px]">
            <span className="font-bold text-white">Your account</span>
            <Link to="/login" className={link}>
              Sign in
            </Link>
            <Link to="/apply" className={link}>
              My applications
            </Link>
            <Link to="/signup" className={link}>
              Create an account
            </Link>
          </div>
          <div className="flex flex-col gap-2.5 text-[15px]">
            <span className="font-bold text-white">The Bank</span>
            <a href="#about" className={link}>
              About
            </a>
            <a href="#help" className={link}>
              Help &amp; FAQs
            </a>
            <a href="#appointment" className={link}>
              Contact
            </a>
          </div>
        </div>
      </div>
      {/* The © line alone sits on black, the full width of the page. */}
      <div className="mt-10 -mx-[clamp(16px,4vw,48px)] bg-black px-[clamp(16px,4vw,48px)] py-6 text-[13px]">
        <div className={`${WRAP} flex flex-wrap justify-between gap-4`}>
          <span>© 2026 Guyana Development Bank</span>
          <span className="flex gap-5">
            <span>Privacy</span>
            <span>Terms</span>
            <span>Accessibility</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
