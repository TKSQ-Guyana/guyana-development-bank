import { isGuyanaPhone } from "../../../components/PhoneInput";
import {
  isEidFormat,
  officerReview,
  type EmployerCategory,
} from "../../../shared/declarations";
import type { LoanApplication } from "../../../types";

/** Money as the Quick Loan screens state it: "GYD 300,000". */
export const gyd = (n: number) =>
  `GYD ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

/** The Quick Loan — an informal trader's loan, applied for on its own short form.
 *
 *  This module is the form's rules and nothing else: which steps there are, what
 *  stops each one, and the shape sent to `gdb_bank.api.save_application`. No
 *  React, so every rule is testable on its own. None of it is the enforcement —
 *  the server refuses the same things for its own reasons (the ceiling is the
 *  Loan Product's, the term limit is policy) — it is what lets the applicant be
 *  told before a round trip, in words about THEIR answer. */

/** What the server says a Quick Loan is (`gdb_bank.api.quick_loan_terms`). The
 *  ceiling and term are read from there, never written into the bundle. */
export interface QuickLoanTerms {
  ceiling: number;
  max_term: number;
  /** The only terms, in months, a Quick Loan may be repaid over — ascending. */
  term_options: number[];
  /** The moratoria, in months, a borrower may choose from. */
  moratorium_options?: number[];
  rate_of_interest: number;
  trade_locations: string[];
  trading_since: string[];
  /** GDB's industries (gdb_bank.api.industry_options): a sub-sector is asked
   *  only of an industry that has some. */
  industries?: {
    sector: string;
    sub_sectors: { name: string; label: string }[];
  }[];
}

/** Whether this industry has sub-sectors to choose from. */
export const hasSubSectors = (terms: QuickLoanTerms, sector: string) =>
  (terms.industries?.find((i) => i.sector === sector)?.sub_sectors.length ??
    0) > 0;

/** `confirm` is the separate submit page after Review — not a step on the rail.
 *  "About you" shows who is applying (their account and profile) and asks what
 *  the account cannot know: whether they have an E-ID, and their employment.
 *  No identity document and no business photos are asked for anywhere in the
 *  journey. */
export type QuickStepId =
  "eligibility" | "about" | "business" | "loan" | "bank" | "review" | "confirm";

/** The server opens a draft only once there is an amount, term and purpose, so
 *  the answers before Loan details are first saved with it. */
export const QUICK_STEPS: { id: QuickStepId; title: string; blurb: string }[] =
  [
    {
      id: "eligibility",
      title: "Before you start",
      blurb: "For small businesses",
    },
    {
      id: "about",
      title: "About you",
      blurb: "Your E-ID and your employment.",
    },
    {
      id: "business",
      title: "Business description",
      blurb:
        "What your business does, where it is, and two people who know it.",
    },
    {
      id: "loan",
      title: "Loan details",
      blurb: "GDB decides the approved amount.",
    },
    {
      id: "bank",
      title: "Bank information",
      blurb:
        "If your loan is approved, payment goes through the Ministry of Finance to this account. It must be in your name.",
    },
    { id: "review", title: "Review", blurb: "Review your application" },
  ];

/** The steps on the rail. "Before you start" is its own page ahead of them. */
export const RAIL_STEPS = QUICK_STEPS.filter((s) => s.id !== "eligibility");

/** The field officer request form's closed choices, from the prototype. */
export const BUSINESS_TYPES = [
  "Market vendor",
  "Small service",
  "Home-based business",
  "Mobile trade",
  "Something else",
];
export const CALL_TIMES = ["Morning", "Afternoon", "Evening"];

/** Someone who knows the applicant and their trade, and how to reach them. */
export interface SupportContact {
  name: string;
  relationship: string;
  phone: string;
}

/** The payout account types (install.BANK_ACCOUNT_TYPES). */
export const ACCOUNT_TYPES = ["Checking", "Savings"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** The answer to each yes/no declaration — '' until chosen. */
export const YES_NO = ["Yes", "No"] as const;
export type YesNo = (typeof YES_NO)[number] | "";

const EMPTY_CONTACT: SupportContact = { name: "", relationship: "", phone: "" };

export interface QuickAnswers {
  /** "How would you like to apply?" — null until chosen. */
  how: "self" | "help" | null;
  /** From the profile; asked on About you only when it is missing. */
  dob: string;
  phone: string;
  /** "Do you have an E-ID?" — the number is asked only on a Yes. */
  hasEid: YesNo;
  /** Typed by the applicant as xxx-xxxx-xxxx; prefilled from an account opened by e-ID. */
  eid: string;
  /** "Are you employed?" — the three follow-ups are asked only on a Yes. */
  employed: YesNo;
  employerCategory: EmployerCategory;
  employerName: string;
  /** One of shared/declarations.INCOME_BANDS. */
  incomeBand: string;
  businessName: string;
  /** The industry (a GDB Sector) and sub-sector (a GDB Sub Sector's name). */
  sector: string;
  subSector: string;
  tradeActivity: string;
  region: string;
  tradingSince: string;
  tradeLocation: string;
  /** Where the business is, pinned on the map. */
  lat: number | null;
  lng: number | null;
  /** What the map search named, or the applicant's own description. */
  place: string;
  /** Exactly two, asked on the business step. */
  contacts: [SupportContact, SupportContact];
  amount: string;
  purpose: string;
  term: string;
  /** Months after release before the first instalment; '' — optional — for none. */
  moratorium: string;
  /** The applicant's own declaration, on the loan step. */
  residesInGuyana: boolean;
  bank: string;
  /** A GDB Bank Branch of `bank` (gdb_bank.api.bank_branches). */
  branch: string;
  accountType: AccountType | "";
  accountNo: string;
  /** Typed rather than picked from the accounts the switch knows about. */
  manualAccount: boolean;
  holder: string;
  confirmNo: string;
  /** "I don't have a bank account" — the Help Desk instead of the account
   *  fields; never a reason to stop. */
  noBankAccount: boolean;
  /** Review's two statements (shared/consent.ts): the consent to collect and
   *  share information, credit bureaus included, and the false-information
   *  warning. Both are ticked before anything is submitted. */
  consentGiven: boolean;
}

export const EMPTY_ANSWERS: QuickAnswers = {
  how: null,
  dob: "",
  phone: "",
  hasEid: "",
  eid: "",
  employed: "",
  employerCategory: "",
  employerName: "",
  incomeBand: "",
  businessName: "",
  sector: "",
  subSector: "",
  tradeActivity: "",
  region: "",
  tradingSince: "",
  tradeLocation: "",
  lat: null,
  lng: null,
  place: "",
  contacts: [EMPTY_CONTACT, EMPTY_CONTACT],
  amount: "",
  purpose: "",
  term: "6",
  moratorium: "",
  residesInGuyana: false,
  bank: "",
  branch: "",
  accountType: "",
  accountNo: "",
  manualAccount: false,
  holder: "",
  confirmNo: "",
  noBankAccount: false,
  consentGiven: false,
};

const digits = (s: string) => s.replace(/[\s-]/g, "");

/** The one thing stopping this step, in words about the applicant's own
 *  answer — or null when they may go on. */
export function blockerFor(
  step: QuickStepId,
  a: QuickAnswers,
  terms: QuickLoanTerms,
): string | null {
  switch (step) {
    case "eligibility":
      if (!a.how) return "Choose how you would like to apply.";
      return null;
    case "about":
      if (!a.dob) return "Enter your date of birth.";
      if (!a.hasEid) return "Tell us whether you have an E-ID.";
      if (a.hasEid === "Yes") {
        if (!a.eid.trim()) return "Enter your E-ID.";
        if (!isEidFormat(a.eid))
          return "Enter your E-ID in the format xxx-xxxx-xxxx.";
      }
      if (!a.employed) return "Tell us whether you are employed.";
      if (a.employed === "Yes") {
        if (!a.employerCategory)
          return "Choose your employer category: Public Sector or Private Sector.";
        if (!a.employerName.trim()) return "Enter your employer's name.";
        if (!a.incomeBand) return "Choose your monthly income.";
      }
      return null;
    case "business":
      if (!a.sector) return "Choose your industry.";
      if (!a.subSector && hasSubSectors(terms, a.sector))
        return "Choose your sub-sector.";
      if (!a.tradeActivity.trim())
        return "Tell us what your business sells or does.";
      if (!a.region) return "Choose the region you do business in.";
      if (!a.tradingSince) return "Tell us how long you have been in business.";
      if (!a.tradeLocation) return "Choose your business location.";
      if (a.lat == null || a.lng == null)
        return "Pin your business on the map.";
      for (const [i, c] of a.contacts.entries()) {
        const which = i === 0 ? "first" : "second";
        if (!c.name.trim())
          return `Enter the name of your ${which} supporting contact.`;
        if (!c.relationship.trim())
          return `Enter how your ${which} supporting contact knows you.`;
        // Seven digits after +592 — the server's rule too (services/application.py).
        if (!isGuyanaPhone(c.phone))
          return `Enter a 7-digit phone number for your ${which} supporting contact.`;
      } // Two people, two numbers: the same number twice is one contact.
      if (
        a.contacts[0].phone.replace(/\D/g, "").slice(-7) ===
        a.contacts[1].phone.replace(/\D/g, "").slice(-7)
      )
        return "Your two supporting contacts need different phone numbers.";

      return null;
    case "loan": {
      const amount = Number(a.amount);
      if (!a.amount.trim() || !Number.isFinite(amount) || amount <= 0)
        return "Enter how much you need — an amount greater than zero.";
      if (amount > terms.ceiling)
        return `Exceeds the ${gyd(terms.ceiling)} limit. Enter ${gyd(terms.ceiling)} or less.`;
      if (!a.purpose.trim()) return "Tell us what the loan is for.";
      if (!terms.term_options.includes(Number(a.term)))
        return `Choose a term of ${termList(terms.term_options)} months.`;
      // The moratorium is optional (2026-10-05); one chosen must be one GDB offers.
      if (
        Number(a.moratorium) &&
        !(terms.moratorium_options ?? [1, 2, 3]).includes(Number(a.moratorium))
      )
        return "Choose your moratorium — how long to wait before your first instalment.";
      if (!a.residesInGuyana)
        return "Confirm you have been residing in Guyana for the last 12 months or more.";
      return null;
    }
    case "bank":
      if (a.noBankAccount) return null;
      if (!a.bank || !a.accountNo.trim())
        return "Tell us the bank account GDB should pay you into.";
      if (!a.accountType)
        return "Choose the type of account — Checking or Savings.";
      if (a.manualAccount) {
        if (!a.branch) return "Choose your branch.";
        if (!a.holder.trim()) return "Enter the account holder name.";
        if (digits(a.confirmNo) !== digits(a.accountNo))
          return "The account numbers do not match.";
      }
      return null;
    case "confirm":
      return Object.values(confirmErrors(a))[0] ?? null;
    default:
      // Review only leads on to the submit page.
      return null;
  }
}

/** Review's two statements, each with its own message so each box can say
 *  what it is missing. */
export function confirmErrors(
  a: QuickAnswers,
): Partial<Record<"consentGiven", string>> {
  return a.consentGiven
    ? {}
    : { consentGiven: "Tick the declaration to submit." };
}

/** A public-sector employee earning GYD 200,000 a month or more: their case is
 *  routed to a Loan Officer (the server sets the flag; this only says so). */
export const needsOfficerReview = (a: QuickAnswers) =>
  officerReview(a.employed, a.employerCategory, a.incomeBand);

/** "6, 12, 18 or 24" — the allowed terms as a sentence fragment. */
export function termList(options: number[]): string {
  return options.length > 1
    ? `${options.slice(0, -1).join(", ")} or ${options[options.length - 1]}`
    : String(options[0] ?? "");
}

/** The body for `gdb_bank.api.save_application`. `name` only once a draft exists. */
export function toSavePayload(a: QuickAnswers, name?: string) {
  const employed = a.employed === "Yes";
  return {
    ...(name ? { name } : {}),
    product: "quick" as const,
    loan_amount: Number(a.amount),
    purpose: a.purpose.trim(),
    term_months: Number(a.term),
    phone: a.phone,
    business_name: a.businessName.trim(),
    sections: {
      sector: a.sector,
      sub_sector: a.subSector,
      trade_activity: a.tradeActivity.trim(),
      trade_region: a.region,
      trading_since: a.tradingSince,
      trade_location: a.tradeLocation,
      trade_latitude: a.lat,
      trade_longitude: a.lng,
      trade_address: a.place.trim(),
      support_1_name: a.contacts[0].name.trim(),
      support_1_relationship: a.contacts[0].relationship.trim(),
      support_1_phone: a.contacts[0].phone.trim(),
      support_2_name: a.contacts[1].name.trim(),
      support_2_relationship: a.contacts[1].relationship.trim(),
      support_2_phone: a.contacts[1].phone.trim(),
      resides_in_guyana: a.residesInGuyana ? 1 : 0,
      moratorium_months: Number(a.moratorium) || 0,
      has_eid: a.hasEid,
      // The number belongs to a Yes; the server clears it on a No too.
      applicant_eid: a.hasEid === "Yes" ? a.eid.trim() : "",
      employed: a.employed,
      employer_category: employed ? a.employerCategory : "",
      employer_name: employed ? a.employerName.trim() : "",
      income_band: employed ? a.incomeBand : "",
      no_bank_account: a.noBankAccount ? 1 : 0,
    },
  };
}

const yesNo = (value: string): YesNo =>
  value === "Yes" || value === "No" ? value : "";

/** A saved draft's answers, for resuming it. A draft exists only for someone
 *  who chose to apply themselves. */
export function fromDraft(loan: LoanApplication): Partial<QuickAnswers> {
  const text = (key: string) => {
    const value = loan.sections?.[key];
    return value == null ? "" : String(value);
  };
  const category = text("employer_category");
  return {
    how: "self",
    phone: loan.phone ?? "",
    businessName: loan.business_name ?? "",
    sector: text("sector"),
    subSector: text("sub_sector"),
    tradeActivity: text("trade_activity"),
    region: text("trade_region"),
    tradingSince: text("trading_since"),
    tradeLocation: text("trade_location"),
    lat: loan.sections?.trade_latitude
      ? Number(loan.sections.trade_latitude)
      : null,
    lng: loan.sections?.trade_longitude
      ? Number(loan.sections.trade_longitude)
      : null,
    place: text("trade_address"),
    contacts: [1, 2].map((n) => ({
      name: text(`support_${n}_name`),
      relationship: text(`support_${n}_relationship`),
      phone: text(`support_${n}_phone`),
    })) as [SupportContact, SupportContact],
    residesInGuyana: Number(loan.sections?.resides_in_guyana ?? 0) === 1,
    // A draft from before the question: a number given means Yes.
    hasEid: yesNo(text("has_eid")) || (text("applicant_eid") ? "Yes" : ""),
    eid: text("applicant_eid"),
    employed: yesNo(text("employed")),
    employerCategory:
      category === "Public Sector" || category === "Private Sector"
        ? category
        : "",
    employerName: text("employer_name"),
    incomeBand: text("income_band"),
    noBankAccount: Number(loan.sections?.no_bank_account ?? 0) === 1,
    amount: loan.loan_amount ? String(loan.loan_amount) : "",
    purpose: loan.purpose ?? "",
    term: loan.term_months ? String(loan.term_months) : EMPTY_ANSWERS.term,
    moratorium: Number(loan.sections?.moratorium_months)
      ? String(loan.sections?.moratorium_months)
      : "",
  };
}
