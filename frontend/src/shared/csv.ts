/** CSV serialisation and download, shared by every export in the portal.
 *
 *  Extracted from the disbursement payment file, which had the only copy. A
 *  second export written from scratch would have quoted its fields slightly
 *  differently, and two CSV dialects out of one bank is how a downstream
 *  import starts silently dropping rows.
 *
 *  Nothing here formats money. An export carries the raw number so a
 *  spreadsheet reads it as one; the screen is where G$ belongs.
 */

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row plus body rows, CRLF-terminated — Excel's dialect. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
