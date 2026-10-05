import { useEffect, useState } from "react";
import { call } from "../api";

/** The applicant's declarations asked on both loan forms (GDB, 2026-10-05):
 *  "Do you have an E-ID?", "Are you employed?" and the industry the business
 *  is in. The server's lists are install.EMPLOYER_CATEGORIES / INCOME_BANDS,
 *  and gdb_bank.api.industry_options for the industries. */

export const EMPLOYER_CATEGORIES = ["Public Sector", "Private Sector"] as const;
export type EmployerCategory = (typeof EMPLOYER_CATEGORIES)[number] | "";

/** Value -> what the applicant reads. */
export const INCOME_BANDS = [
  { value: "Less than $200K", label: "Less than $200K" },
  { value: "Between $200K and $500K", label: "Between $200K and $500K" },
  { value: "Above $500K", label: "Above $500K" },
] as const;

/** A public-sector employee in these bands is routed to a Loan Officer
 *  (services/application.REVIEW_BANDS — the server decides; this only says so). */
export const REVIEW_BANDS: string[] = [
  "Between $200K and $500K",
  "Above $500K",
];

export const officerReview = (
  employed: string,
  category: string,
  band: string,
) =>
  employed === "Yes" &&
  category === "Public Sector" &&
  REVIEW_BANDS.includes(band);

/** E-ID, typed into one box: digits only, dashes put in as they go —
 *  "59220010101" reads "592-2001-0101". */
export function typedEid(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  return [d.slice(0, 3), d.slice(3, 7), d.slice(7)].filter(Boolean).join("-");
}

export const EID_FORMAT_HINT = "E-ID Format: xxx-xxxx-xxxx";
export const isEidFormat = (value: string) =>
  /^\d{3}-\d{4}-\d{4}$/.test(value.trim());

/** GDB's industries and their sub-sectors (gdb_bank.api.industry_options). */
export interface Industry {
  sector: string;
  sub_sectors: { name: string; label: string }[];
}

export function useIndustries(): Industry[] {
  const [rows, setRows] = useState<Industry[]>([]);
  useEffect(() => {
    let live = true;
    call<Industry[]>("gdb_bank.api.industry_options")
      .then((r) => live && setRows(r ?? []))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, []);
  return rows;
}

/** "Agriculture - Crop farming" -> "Crop farming": a sub-sector as it reads. */
export const subSectorLabel = (name: string) => name.replace(/^.*? - /, "");
