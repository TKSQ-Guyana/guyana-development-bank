import { useEffect, useState } from "react";
import { isGuyanaPhone, PhoneInput } from '../../components/PhoneInput';
import { call } from "../../api";
import { REGIONS } from "../../components/apply/cluster";
import { formatDate } from "../../utils";
import { BUSINESS_TYPES, CALL_TIMES } from "./model/quickLoan";
import {
  Banner,
  Card,
  Chips,
  Footer,
  Hero,
  inputClass,
  Modal,
  PageIntro,
  Panel,
  Pill,
  QButton,
  QField,
  QSelect,
} from "../../components/portal/ui";

/** "I need help from a field officer": who to call, where and when
 *  (gdb_bank.api.request_field_officer). The officer completes the Quick Loan
 *  with the applicant; the applicant still checks and submits it themselves. */
interface FieldOfficerRequestRow {
  name: string;
  applicant_name: string;
  phone: string;
  business_type: string;
  region: string;
  best_time: string | null;
  status: "Waiting" | "Accepted" | "Visit booked" | "Cancelled" | string;
  requested_on: string;
}

type Field = "name" | "phone" | "type" | "other" | "region";

/** Still with GDB: in the regional pool, or with an officer working it. */
const OPEN = ["Waiting", "Accepted", "Visit booked"];

export function FieldOfficerRequest({
  defaultName,
  defaultPhone,
  onBack,
  onApplySelf,
}: {
  defaultName: string;
  defaultPhone: string;
  onBack: () => void;
  onApplySelf: () => void;
}) {
  const [request, setRequest] = useState<
    FieldOfficerRequestRow | null | undefined
  >(undefined);
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [type, setType] = useState("");
  const [other, setOther] = useState("");
  const [region, setRegion] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    call<FieldOfficerRequestRow | null>("gdb_bank.api.my_field_officer_request")
      .then((r) => setRequest(r && OPEN.includes(r.status) ? r : null))
      .catch(() => setRequest(null));
  }, []);

  const send = async () => {
    const e: Partial<Record<Field, string>> = {};
    if (!name.trim()) e.name = "Enter your name.";
    if (!isGuyanaPhone(phone)) e.phone = "Enter your 7-digit phone number.";
    if (!type) e.type = "Choose the type of business.";
    if (type === "Something else" && !other.trim())
      e.other = "Tell us the type of business.";
    if (!region) e.region = "Choose a region.";
    setErrs(e);
    setError(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      setRequest(
        await call<FieldOfficerRequestRow>(
          "gdb_bank.api.request_field_officer",
          {
            applicant_name: name,
            phone,
            business_type: type === "Something else" ? other : type,
            region,
            best_time: time,
            product: "Quick",
          },
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Nothing was sent. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!request) return;
    setAsking(false);
    setBusy(true);
    try {
      setRequest(
        await call<FieldOfficerRequestRow>(
          "gdb_bank.api.cancel_field_officer_request",
          { name: request.name },
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not cancel the request",
      );
    } finally {
      setBusy(false);
    }
  };

  if (request === undefined) return <p className="text-ql-muted">Loading…</p>;

  if (request) {
    const cancelled = request.status === "Cancelled";
    return (
      <Panel>
        {cancelled ? (
          <Hero kind="warn" title="Request cancelled">
            No field officer will call you about this request.
          </Hero>
        ) : (
          <Hero title="Request sent">
            A GDB field officer for {request.region.split(" — ")[0]} will call
            you on {request.phone}
            {request.best_time
              ? `, in the ${request.best_time.toLowerCase()}`
              : ""}
            .
          </Hero>
        )}
        {error && <Banner kind="error" title={error} />}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <b className="font-semibold">Request record</b>
            <div className="mt-1 text-[13px] text-ql-ink2">
              {request.applicant_name} · {request.business_type} ·{" "}
              {request.region}
              <br />
              Sent {formatDate(request.requested_on)} ·{" "}
              <b className="font-semibold">{request.name}</b>
              <br />
              Quote this number if you contact GDB.
            </div>
          </Card>
          {!cancelled && (
            <Card tone="soft">
              <b className="font-semibold">What happens next</b>
              <div className="mt-1.5 overflow-hidden rounded-xl border border-ql-line bg-white">
                {[
                  "The field officer calls to arrange a time.",
                  "You go through the application together, in person or by phone.",
                  "You check the answers and submit from your account. Nothing goes to GDB until you do.",
                ].map((x, i) => (
                  <div
                    key={x}
                    className={`flex items-start gap-3 px-4 py-3.5 text-[13px] ${i ? "border-t border-ql-line" : ""}`}
                  >
                    <Pill tone="blue">{i + 1}</Pill>
                    <span>{x}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <QButton kind="secondary" onClick={onBack}>
            Back to start
          </QButton>
          {cancelled ? (
            <QButton onClick={onApplySelf}>Apply myself instead</QButton>
          ) : request.status !== "Waiting" ? null : (
            <QButton
              kind="ghost"
              disabled={busy}
              onClick={() => setAsking(true)}
            >
              Cancel request
            </QButton>
          )}
        </div>
        {asking && (
          <Modal
            title="Cancel this request?"
            actions={
              <>
                <QButton kind="secondary" onClick={() => setAsking(false)}>
                  Keep request
                </QButton>
                <QButton kind="danger" onClick={() => void cancel()}>
                  Cancel request
                </QButton>
              </>
            }
          >
            <p className="text-[13px] text-ql-ink2">
              No field officer will call you. You can still apply yourself, or
              send a new request later.
            </p>
          </Modal>
        )}
      </Panel>
    );
  }

  return (
    <Panel>
      <PageIntro title="Get help from a field officer">
        A GDB field officer calls you and completes the application with you.
        You check it and submit it from your account.
      </PageIntro>
      {error && (
        <Banner kind="error" title="We could not send your request">
          {error}
        </Banner>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <QField label="Your name" required error={errs.name}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass(Boolean(errs.name))}
          />
        </QField>
        <QField
          label="Phone number"
          required
          help="The field officer calls this number."
          error={errs.phone}
        >
          <PhoneInput value={phone} onChange={setPhone} invalid={Boolean(errs.phone)} className={inputClass(Boolean(errs.phone))} />
        </QField>
        <QField label="Type of business" required error={errs.type}>
          <QSelect
            value={type}
            onChange={setType}
            options={BUSINESS_TYPES}
            placeholder="Choose a type"
            bad={Boolean(errs.type)}
          />
        </QField>
        <QField label="Region" required error={errs.region}>
          <QSelect
            value={region}
            onChange={setRegion}
            options={REGIONS}
            placeholder="Choose a region"
            bad={Boolean(errs.region)}
          />
        </QField>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {type === "Something else" && (
          <QField
            label="Tell us the type of business"
            required
            error={errs.other}
          >
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="For example: fishing, baking"
              className={inputClass(Boolean(errs.other))}
            />
          </QField>
        )}
        <QField label="Best time to call (optional)">
          <Chips
            label="Best time to call"
            options={CALL_TIMES}
            value={time}
            onChange={setTime}
          />
        </QField>
      </div>
      <Footer>
        <QButton kind="secondary" back onClick={onBack}>
          Back
        </QButton>
        <QButton disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send request"}
        </QButton>
      </Footer>
    </Panel>
  );
}
