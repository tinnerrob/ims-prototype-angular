import { DataService } from '../../core/data.service';
import { Item, Order, Party, Timesheet, WorkOrder, statusClass } from '../../core/models';
import { Tip, TipLine } from './tip.service';
import { stampAt, stampDate, stampRange } from './tip-format';

/* Domain content for the smart tooltips.

   These need `DataService` (rate money, order totals, segment labels), so this
   file is the one place in `shared/` that leans on `core/` — the builders are
   the shared definition of "what a tip about an order/asset/person looks like",
   and every page that shows those entities binds the same function, which is
   what keeps the tips identical page to page.

   Shape rules (keep them when adding more):
     - title  = the thing's identity, `CODE - Name`
     - line 1 = when it happens, as `8/1/26 10:00am → 8/1/26 4:30pm`
     - then one further fact per line, short label + value
     - no instructions ("drag to...", "double-click to...") — a tip states data */

/** Compose a tip from a title and lines, dropping empty ones. */
export function tip(title: string, lines: (TipLine | null | undefined)[], extra: Partial<Tip> = {}): Tip {
  const kept = lines.filter((l): l is TipLine => {
    if (!l) return false;
    return typeof l === 'string' ? l.trim().length > 0 : !!l.value;
  });
  return { title, lines: kept, ...extra };
}

/**
 * Scheduler order bar / order card: the code + project, then the window.
 * Deliberately just the two lines the calendar needs — the bar already prints
 * its value · items · days sub-line.
 */
export function orderTip(data: DataService, o: Order): Tip {
  return tip(`${o.orderId} - ${o.projectName}`, [
    stampRange(o.startDate, data.orderT0(o), o.endDate, data.orderT1(o)),
  ]);
}

/** Full order record (orders table, hand-off, dispatch rows). */
export function orderRecordTip(data: DataService, o: Order): Tip {
  return tip(
    `${o.orderId} - ${o.projectName}`,
    [
      stampRange(o.startDate, data.orderT0(o), o.endDate, data.orderT1(o)),
      { label: 'Customer', value: o.party },
      { label: 'Site', value: o.jobSite },
      { label: 'Items', value: `${o.lineItems.length}` },
      { label: 'Value', value: data.money(data.orderAmount(o)) },
    ],
    { badge: o.status, badgeClass: 'st-' + statusClass(o.status) },
  );
}

/**
 * Asset (item) tip — the pool cards, inventory rows, telemetry rows.
 * `extra` carries context the caller knows (a booking note, on-hand levels) and
 * is appended as further lines, so one asset always reads the same way.
 */
export function assetTip(data: DataService, item: Item, extra: (TipLine | null | undefined)[] = []): Tip {
  const model = [item.make, item.model].filter(Boolean).join(' ');
  return tip(
    `${item.id} - ${item.name}`,
    [
      { label: 'Type', value: item.type },
      { label: 'Category', value: item.category },
      item.serial ? { label: 'Serial', value: item.serial } : null,
      model ? { label: 'Model', value: model } : null,
      item.meterHours != null ? { label: 'Meter', value: `${data.int(item.meterHours)} h` } : null,
      item.rateDaily > 0 ? { label: 'Rate', value: `${data.money(item.rateDaily)}/day` } : null,
      ...extra,
      item.notes ? { label: 'Notes', value: item.notes } : null,
    ],
    { badge: item.status, badgeClass: 'st-' + statusClass(item.status) },
  );
}

/** Customer / vendor / site card. */
export function partyTip(data: DataService, p: Party): Tip {
  return tip(
    p.name,
    [
      p.contact ? { label: 'Contact', value: p.contact } : null,
      p.phone ? { label: 'Phone', value: p.phone } : null,
      p.email ? { label: 'Email', value: p.email } : null,
      p.billingCycle ? { label: 'Billing', value: p.billingCycle } : null,
      { label: 'Contracts', value: `${data.orderCount(p.id)}` },
      { label: 'Active now', value: `${data.activeOrderCount(p.id)}` },
    ],
    { subtitle: p.billingAddress || undefined, badge: p.active === false ? 'Inactive' : 'Active', badgeClass: p.active === false ? 'st-out' : 'st-active' },
  );
}

/**
 * Timesheet segment bar: what was clocked into, then the window, the duration
 * and who worked it — the same one-fact-per-line shape as the scheduler's, and
 * the same `CODE - Name` title (the bar itself only has room for a short label).
 */
export function segmentTip(data: DataService, ts: Timesheet): Tip {
  const employee = data.getItem('labor', ts.empId);
  const running = !ts.clockOut;
  const order = ts.targetType === 'order' && ts.targetId ? data.getOrder(ts.targetId) : undefined;
  const wo = ts.targetType === 'workorder' && ts.targetId ? data.getWorkOrder(ts.targetId) : undefined;
  const title = order
    ? `${order.orderId} - ${order.projectName}`
    : wo
      ? `${wo.id} - ${data.itemLabel('serialized', wo.itemId)}`
      : data.segmentLabel(ts);
  return tip(title, [
    running
      ? `${stampAt(ts.date, ts.clockIn)} → running`
      : stampRange(ts.date, ts.clockIn, ts.date, ts.clockOut),
    running ? 'In progress' : `${data.segmentHours(ts)} hr`,
    employee ? `${employee.id} - ${employee.name}` : ts.empId,
    employee?.role ?? '',
    ts.note ?? '',
  ]);
}

/**
 * Employee lane label: who they are, and how much of the visible window they
 * have logged. `logged` comes from the lane (already summed by the caller).
 */
export function employeeTip(data: DataService, emp: Item, logged: number): Tip {
  return tip(`${emp.id} - ${emp.name}`, [
    emp.role ? { label: 'Role', value: emp.role } : null,
    { label: 'Logged', value: `${logged} hr` },
    { label: 'Rate', value: `${data.money(emp.hourlyCost ?? emp.rateDaily)}/hr` },
  ]);
}

/** Service work order (timesheet chips, maintenance grid). */
export function workOrderTip(data: DataService, w: WorkOrder): Tip {
  const parts = w.parts
    .map((p) => data.itemLabel(p.kind === 'part' ? 'part' : 'consumable', p.refId))
    .filter(Boolean);
  return tip(
    `${w.id} - ${data.itemLabel('serialized', w.itemId)}`,
    [
      { label: 'Service', value: w.type },
      { label: 'Date', value: stampDate(w.date) },
      { label: 'Meter', value: `${data.int(w.meterReading)} h` },
      { label: 'Labor', value: `${w.laborHours} h` },
      { label: 'Parts', value: parts.length ? parts.join(', ') : 'none' },
      w.notes ?? '',
    ],
    { badge: w.status },
  );
}

/** A day column in the calendar (`8/1/26`, weekday). */
export function dayTip(date: Date, lines: TipLine[] = []): Tip {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return tip(
    stampDate(iso),
    [{ label: 'Weekday', value: date.toLocaleDateString('en-US', { weekday: 'long' }) }, ...lines],
  );
}
