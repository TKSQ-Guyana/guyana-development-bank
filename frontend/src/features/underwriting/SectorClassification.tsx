import { useEffect, useState } from "react";
import { call } from "../../api";
import { useAuth } from "../../auth";
import { SelectField } from "../../components/apply/fields";
import { Button } from "../../components/ui/Button";
import { Card, CardLabel } from "../../components/ui/Card";
import type { LoanApplication } from "../../types";

interface SectorOption {
  sector: string;
  sub_sectors: { name: string; label: string }[];
}

/** The underwriter's sector and sub-sector for a case, on the Credit risk tab.
 *
 *  GDB's own classification, never the applicant's. Set while the case is in
 *  review; read-only once it is decided, and for staff who do not decide. The
 *  list is the desk's (GDB Sector / GDB Sub Sector), so it is read from the
 *  server rather than written here. */
export function SectorClassification({
  loan,
  onSaved,
}: {
  loan: LoanApplication;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [options, setOptions] = useState<SectorOption[]>([]);
  const [sector, setSector] = useState(loan.credit_sector ?? "");
  const [subSector, setSubSector] = useState(loan.credit_sub_sector ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const editable = Boolean(user?.is_underwriter) && loan.stage === "Review";

  useEffect(() => {
    call<SectorOption[]>("gdb_bank.api.sector_options")
      .then(setOptions)
      .catch(() => setOptions([]));
  }, []);

  useEffect(() => {
    setSector(loan.credit_sector ?? "");
    setSubSector(loan.credit_sub_sector ?? "");
  }, [loan.credit_sector, loan.credit_sub_sector]);

  const subs = options.find((o) => o.sector === sector)?.sub_sectors ?? [];
  const subLabel = (name: string | null | undefined) =>
    options
      .flatMap((o) => o.sub_sectors)
      .find((s) => s.name === name)?.label ??
    name?.split(" - ").slice(1).join(" - ") ??
    "";
  const changed =
    sector !== (loan.credit_sector ?? "") ||
    subSector !== (loan.credit_sub_sector ?? "");

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await call("gdb_bank.api.set_credit_sector", {
        application: loan.name,
        sector,
        sub_sector: subSector,
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4">
      <CardLabel>Sector classification</CardLabel>
      {editable ? (
        <>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Sector"
              value={sector}
              onChange={(v) => {
                setSector(v);
                setSubSector("");
                setSaved(false);
              }}
              options={options.map((o) => o.sector)}
            />
            <SelectField
              label="Sub-sector"
              value={subSector}
              onChange={(v) => {
                setSubSector(v);
                setSaved(false);
              }}
              options={subs.map((s) => [s.name, s.label] as [string, string])}
              disabled={!sector}
              placeholder={sector ? "Select…" : "Choose a sector first"}
            />
          </div>
          {error && (
            <p
              className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {error}
            </p>
          )}
          <div className="mt-3 flex items-center justify-end gap-3">
            {saved && !changed && (
              <span className="text-xs font-semibold text-emerald-700">
                Saved
              </span>
            )}
            <Button
              onClick={() => void save()}
              disabled={busy || !sector || !subSector || !changed}
            >
              {busy ? "Saving…" : "Save classification"}
            </Button>
          </div>
        </>
      ) : (
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Sector</dt>
            <dd className="font-semibold text-slate-900">
              {loan.credit_sector || "Not classified"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Sub-sector</dt>
            <dd className="font-semibold text-slate-900">
              {subLabel(loan.credit_sub_sector) || "—"}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
