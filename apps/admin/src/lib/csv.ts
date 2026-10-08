/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). Returns rows of strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export type Cell = string | number | null | undefined;

/** Text that a spreadsheet would evaluate as a formula (OWASP "CSV injection"). Numbers are never text. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Strictly phone-shaped (E.164-ish with separators): a spreadsheet reads it as a number, not a formula, and it must stay importable. */
const PHONE = /^\+[\d\s().-]+$/;

/**
 * RFC-4180 CSV. Text cells that start with = + - @ (or tab/CR) get a leading apostrophe so Excel,
 * Sheets and Numbers show them as text instead of running them: guest names and phone numbers are
 * typed by hosts and guests, so they are untrusted.
 */
export function toCsv(rows: Array<Array<Cell>>): string {
  const esc = (v: Cell) => {
    let s = v == null ? "" : String(v);
    if (typeof v === "string" && FORMULA_START.test(s) && !PHONE.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

/** A downloadable CSV body: UTF-8 BOM first so Excel detects UTF-8 (Telugu/Hindi names). */
export function csvFile(rows: Array<Array<Cell>>): string {
  return `﻿${toCsv(rows)}`;
}

/** Header-keyed records; header names normalised to snake_case lowercase. */
export function csvRecords(text: string): { headers: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const records = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, records };
}
