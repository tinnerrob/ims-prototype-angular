/* Shared "smart tooltip" system.
   ---------------------------------------------------------------------------
   The app used native `title` attributes, so every tooltip was styled by the
   OS, could not be condensed to a fixed shape, and (in the scheduler) carried
   the same instruction sentence on every bar. This module replaces them with one
   rendered-everywhere tooltip whose content is DATA, one datum per line:

     scheduler `.tl-block`        -> [imsTip]="orderTip(o)"
     scheduler resource card      -> [imsTip]="assetTip(it)"
     timesheet segment bar        -> [imsTip]="segmentTip(ts)"

   See `tip.service.ts` for the host/directive wiring. */

/** Lowercase am/pm, no leading zero on the hour: `10:00am`, `4:30pm`. */
function ampm(h: number, m: number): string {
  const suffix = h < 12 ? 'am' : 'pm';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')}${suffix}`;
}

/** `M/D/YY` — the compact stamp every tooltip uses (`8/1/26`). */
export function stampDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${m}/${d}/${String(y).slice(2)}`;
}

/** Minutes past midnight -> `10:00am`. */
export function stampMinutes(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return '';
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return ampm(Math.floor(t / 60), t % 60);
}

/** `"HH:mm"` -> `10:00am`. */
export function stampHM(hm: string | null | undefined): string {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return ampm(h, Number.isNaN(m) ? 0 : m);
}

/** One end of a range: date + time-of-day (`8/1/26 10:00am`). */
export function stampAt(iso: string, hmOrMinutes?: string | number | null): string {
  const time = typeof hmOrMinutes === 'number' ? stampMinutes(hmOrMinutes) : stampHM(hmOrMinutes);
  return time ? `${stampDate(iso)} ${time}` : stampDate(iso);
}

/** The shared range line: `8/1/26 10:00am → 8/1/26 4:30pm`. */
export function stampRange(
  startISO: string,
  startTime?: string | number | null,
  endISO?: string | null,
  endTime?: string | number | null,
): string {
  const from = stampAt(startISO, startTime);
  const to = stampAt(endISO ?? startISO, endTime);
  return `${from} → ${to}`;
}

/** Full ISO timestamp (`2026-08-01T10:00` or `...T10:00:00Z`) -> `8/1/26 10:00am`. */
export function stampISO(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [day, time] = iso.split('T');
  if (!time) return stampDate(day);
  const [h, m] = time.split(':').map(Number);
  return `${stampDate(day)} ${ampm(h, Number.isNaN(m) ? 0 : m)}`;
}

/** Date-only range (`8/1/26 → 8/5/26`) for windows shown without a time. */
export function stampDayRange(startISO: string, endISO?: string | null): string {
  return `${stampDate(startISO)} → ${stampDate(endISO ?? startISO)}`;
}
