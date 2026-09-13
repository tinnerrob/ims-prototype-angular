import { countWeekdays, daysBetween } from './period';
import type { OrderLine } from './models';

/**
 * IMS — pure money, cost and billing-cycle helpers.
 *
 * Lifted out of `data.service.ts` (B1). These are the figures the pricing engine
 * and the invoice read; they are pure functions of their arguments, so they live
 * beside the period helpers rather than on the store.
 */

/** Money helper — round to 2dp (prototype `round2`). */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Moving-average unit cost after receiving `qty` at `unitCost` — what a receipt
 * does to a stocked row's cost, so a screen can show one cost per SKU without
 * storing a cost history (the receipts *are* the history).
 */
export function movingCost(onHand: number, current: number | undefined, qty: number, unitCost: number): number {
  if (!current || onHand <= 0) return round2(unitCost);
  return round2((onHand * current + qty * unitCost) / (onHand + qty));
}

/** Billable days in a day range, honouring a line's weekend policy (prototype `billableDays`). */
export function billableDaysBetween(policy: OrderLine['weekendPolicy'], a: string, b: string): number {
  if (policy === 'skip') return countWeekdays(a, b);
  if (policy === 'overtime') return daysBetween(a, b) * 1.5;
  return daysBetween(a, b);
}

/** A party's billing cadence -> the length of one cycle, in days (prototype `BILLING_CYCLES`). */
export const BILLING_CYCLES: Record<string, number> = {
  daily: 1,
  weekly: 7,
  'bi-weekly': 14,
  monthly: 28,
  quarterly: 84,
};

/**
 * Whole rate units (weeks or months) of a booking that bill inside the day range
 * `[sDay, eDay]` — the prototype's `wholeUnitsBilled()`. A rental on the weekly or
 * monthly basis bills in **whole units**, never `rate x days`, so every unit has to
 * land in exactly one billing cycle: a unit is billed by the cycle that holds the
 * majority of its days, decided by the unit's upper-median day (the tie going to
 * the later cycle, which is what "run the next cycle" means). Every unit lands in
 * exactly one cycle, so summing cycles never double-bills and always adds up to
 * the line's own `lineTotal()`.
 *
 * @param sDay first day of the cycle, as an index from the line's first day
 * @param eDay last day of the cycle, as an index from the line's first day
 * @param unitDays 7 for the weekly basis, 28 for the monthly
 * @param totalDays the line's own length in days
 */
export function wholeUnitsBilled(sDay: number, eDay: number, unitDays: number, totalDays: number): number {
  if (eDay < sDay) return 0;
  const units = Math.ceil(totalDays / unitDays);
  let billed = 0;
  for (let k = 0; k < units; k++) {
    const unitStart = k * unitDays;
    const unitEnd = Math.min((k + 1) * unitDays - 1, totalDays - 1);
    if (unitEnd < sDay) continue;
    const billDay = unitStart + Math.ceil((unitEnd - unitStart) / 2);
    if (billDay >= sDay && billDay <= eDay) billed++;
  }
  return billed;
}
