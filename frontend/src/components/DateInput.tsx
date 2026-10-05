import { useEffect, useMemo, useState } from "react";

/** The portal's date picker: Day, Month and Year as three dropdowns.
 *
 *  Replaces the browser's own date box everywhere (GDB, 2026-10-05). That box
 *  looks different in every browser, shows "mm/dd/yyyy" to people who write
 *  dates day-first, and on a phone makes a date of birth forty years back a
 *  long scroll. Three dropdowns read the same everywhere and reach any year in
 *  one tap.
 *
 *  Controlled like an <input type="date">: `value` and `onChange` carry the ISO
 *  date ("2026-10-05"), or "" until all three parts are chosen. `min` / `max`
 *  (ISO) bound the years offered, and a day outside them is not offered. */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (year: number, month: number) =>
  new Date(year || 2000, month, 0).getDate();

function parts(value: string): [string, string, string] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return m ? [String(Number(m[3])), String(Number(m[2])), m[1]] : ["", "", ""];
}

export interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  /** Read out with each part: "Date of birth — day". */
  label?: string;
  invalid?: boolean;
  /** The select's look; the portal's input style by default. */
  className?: string;
  id?: string;
}

const SELECT =
  "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-sm text-slate-900 " +
  "transition-colors hover:border-slate-400 focus:border-brand focus:outline-none focus:ring-4 " +
  "focus:ring-emerald-100 disabled:bg-slate-50 disabled:text-slate-500";

export function DateInput({
  value,
  onChange,
  min,
  max,
  disabled,
  label = "Date",
  invalid,
  className = SELECT,
  id,
}: DateInputProps) {
  const [day, setDay] = useState(() => parts(value)[0]);
  const [month, setMonth] = useState(() => parts(value)[1]);
  const [year, setYear] = useState(() => parts(value)[2]);

  // A value set from outside (a restored draft, a reset) shows.
  useEffect(() => {
    const [d, m, y] = parts(value);
    if (value || (day && month && year)) {
      setDay(d);
      setMonth(m);
      setYear(y);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const thisYear = new Date().getFullYear();
  const lowYear = min ? Number(min.slice(0, 4)) : thisYear - 100;
  const highYear = max ? Number(max.slice(0, 4)) : thisYear + 10;
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = highYear; y >= lowYear; y--) out.push(y);
    return out;
  }, [lowYear, highYear]);

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  const emit = (d: string, m: string, y: string) => {
    if (!d || !m || !y) {
      if (value) onChange("");
      return;
    }
    const last = daysIn(Number(y), Number(m));
    const iso = `${y}-${pad(Number(m))}-${pad(Math.min(Number(d), last))}`;
    onChange(inRange(iso) ? iso : "");
  };

  const maxDay = daysIn(Number(year), Number(month) || 1);
  const days = Array.from({ length: month ? maxDay : 31 }, (_, i) => i + 1);
  const ring = invalid ? " border-rose-400 ring-2 ring-rose-100" : "";

  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-[minmax(4.5rem,0.8fr)_minmax(5.25rem,1.2fr)_minmax(5.25rem,1fr)] gap-2"
    >
      <select
        id={id}
        aria-label={`${label} — day`}
        value={day}
        disabled={disabled}
        onChange={(e) => {
          setDay(e.target.value);
          emit(e.target.value, month, year);
        }}
        className={className + ring}
      >
        <option value="">Day</option>
        {days.map((d) => {
          const iso =
            month && year ? `${year}-${pad(Number(month))}-${pad(d)}` : "";
          return (
            <option key={d} value={d} disabled={!!iso && !inRange(iso)}>
              {d}
            </option>
          );
        })}
      </select>
      <select
        aria-label={`${label} — month`}
        value={month}
        disabled={disabled}
        onChange={(e) => {
          setMonth(e.target.value);
          emit(day, e.target.value, year);
        }}
        className={className + ring}
      >
        <option value="">Month</option>
        {MONTHS.map((name, i) => {
          const first = year ? `${year}-${pad(i + 1)}-01` : "";
          const last = year
            ? `${year}-${pad(i + 1)}-${pad(daysIn(Number(year), i + 1))}`
            : "";
          const out =
            !!year && ((!!max && first > max) || (!!min && last < min));
          return (
            <option key={name} value={i + 1} disabled={out}>
              {name}
            </option>
          );
        })}
      </select>
      <select
        aria-label={`${label} — year`}
        value={year}
        disabled={disabled}
        onChange={(e) => {
          setYear(e.target.value);
          emit(day, month, e.target.value);
        }}
        className={className + ring}
      >
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

/** ISO date `years` before today — e.g. the latest birth date for an 18-year-old. */
export function yearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today, as ISO. */
export function todayIso(): string {
  return yearsAgo(0);
}
