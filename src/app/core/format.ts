/* Value + date formatting, on its own (P6/1 — see `angular-refactor-log.md`).
   ---------------------------------------------------------------------------
   Six pure functions: money, int, pct, and the three date stamps every page prints.
   They began as `DataService` methods and were the store's only section with **no store
   state** and **no inbound calls** from any other section — nothing else in the store
   read them, and 187 call sites outside it did. So they moved here: formatting is now a
   module of pure functions, and the harnesses can drive it directly. It borrows one
   primitive, `pad2`, from `./period` — that module has no imports either, so the two
   cannot cycle.

   `DataService` keeps thin delegates (`data.money(…)`, `data.fmtDate(…)`), because that
   is what every page already calls — no call site outside the store changed. */

import { pad2 } from './period';

/**
 * `$1,234.56`. Two decimals always, so a column of money lines up, and `null`/
 * `undefined` read as `$0.00` rather than `$NaN`.
 */
export function money(n: number | null | undefined): string {
  return '$' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `1,234` — grouped, no decimals (counts, days, quantities). */
export function int(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('en-US');
}

/** `12.3%` — one decimal, as the pricing screens print margins. */
export function pct(n: number | null | undefined): string {
  return (Number(n) || 0).toFixed(1) + '%';
}

/** Parse a date / ISO string; date-only strings are local midnight (prototype `parseDT`). */
export function parseDT(s: string | Date): Date {
  if (s instanceof Date) return new Date(s.getTime());
  const str = String(s).replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(str);
}

/** MM/DD/YYYY (prototype `fmtDate`). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = parseDT(iso);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}

/** MM/DD/YYYY HH:mm (prototype `fmtDT`). */
export function fmtDT(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = parseDT(iso);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}


/* id padding: `PO-2026-003`, `CAT-001` — the store and the seed modules both build ids. */
/** `pad3` — id-generator formatting (`PO-2026-003`, `RC-2026-001`, `INSP-001`). */
export const pad3 = (n: number) => String(n).padStart(3, '0');
