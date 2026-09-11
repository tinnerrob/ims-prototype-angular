import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService, PeriodView, periodLabel, periodPhrase } from '../../core/data.service';
import {
  Inspection,
  InspectionCheckKey,
  INSPECTION_CHECKS,
  INSPECTION_CHECK_LABEL,
  statusClass,
} from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { stampDate } from '../../shared/tip/tip-format';
import { tip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

/** Period filter of the inspection log. */
type LogRange = 'all' | 'day' | 'week' | 'month';

const LOG_RANGES: LogRange[] = ['all', 'day', 'week', 'month'];

const LOG_RANGE_LABEL: Record<LogRange, string> = {
  all: 'All',
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

/** Meter readings against the contract allowance (prototype `meterOverage`). */
interface Overage {
  used: number;
  allowed: number;
  overage: number;
}

/**
 * Receiving / Inspections (core) — port of the prototype's `renderYard`
 * (js/pages/yard.js): the inspection log, and the one editor it is worked from.
 *
 * The log narrows to a day / week / month around a cursor date (the scheduler's
 * period pattern: Monday-based weeks, ‹ › paging, "Today" reset), and clicking a
 * logged row opens the editor directly — the prototype's `inspectionModal` on the
 * `data-edit` row. The header's "Log Inspection" button opens that same editor on
 * a blank draft, so a new record is captured with the fields an edit exposes.
 */
@Component({
  selector: 'ims-inspections',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, TipDirective],
  templateUrl: './inspections.component.html',
  styleUrl: './inspections.component.scss',
})
export class InspectionsComponent {
  readonly checkKeys = INSPECTION_CHECKS;
  readonly checkLabel = INSPECTION_CHECK_LABEL;
  readonly logRanges = LOG_RANGES;
  readonly logRangeLabelOf = (v: LogRange): string => LOG_RANGE_LABEL[v];

  /** Log period filter + the cursor date the day/week/month window is built on. */
  logRange: LogRange = 'all';
  logAnchor = new Date();

  editOpen = false;
  /** The record in the editor: a logged row, or a draft while logging a new one. */
  editRecord: Inspection | null = null;
  /** Editor values as they were when it opened (drives the discard prompt). */
  private editSnap = '';

  constructor(readonly data: DataService) {}

  serialized() {
    return this.data.listItems('serialized');
  }

  orders() {
    return this.data.listOrders();
  }

  inspections(): Inspection[] {
    return this.data.listInspections();
  }

  badge(status: string): string {
    return 'badge-status st-' + statusClass(status);
  }

  /* --------------------------- inspection log --------------------------- */

  /** The period filter is narrowing the log. */
  logFiltered(): boolean {
    return this.logRange !== 'all';
  }

  /** Logged inspections inside the selected period (newest first). */
  logEntries(): Inspection[] {
    if (!this.logFiltered()) return this.inspections();
    const b = this.logBounds();
    return this.inspections().filter((r) => r.date >= b.start && r.date <= b.end);
  }

  logEmptyLabel(): string {
    if (!this.logFiltered()) return 'No inspections logged.';
    const w = this.logWindow();
    return `No inspections logged for ${periodPhrase(w.view, w.date)}.`;
  }

  /** Human label for the window the pager is paging through. */
  logRangeLabel(): string {
    const w = this.logWindow();
    return periodLabel(w.view, w.date);
  }

  /** View + first day of the window the log is showing (`all` has no pager, so it reads as a day). */
  private logWindow(): { view: PeriodView; date: Date } {
    const view: PeriodView = this.logRange === 'all' ? 'day' : this.logRange;
    return { view, date: new Date(this.logBounds().start + 'T00:00:00') };
  }

  /** Switch the log period, keeping the cursor date inside the new window. */
  setLogRange(v: LogRange): void {
    this.logRange = v;
    if (v === 'month') this.logAnchor = new Date(this.logAnchor.getFullYear(), this.logAnchor.getMonth(), 1);
    else if (v === 'week') this.logAnchor = this.mondayOf(this.logAnchor);
  }

  /** Page the log cursor one day / week / month (scheduler `shift`). */
  shiftLog(dir: number): void {
    const a = this.logAnchor;
    if (this.logRange === 'month') this.logAnchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
    else this.logAnchor = this.dayAt(a, dir * (this.logRange === 'week' ? 7 : 1));
  }

  /* ------------------------------- editor ------------------------------- */

  /** The "Log Inspection" button: the editor opens on a blank draft. */
  newInspection(): void {
    this.openEditor({
      id: '',
      itemId: '',
      orderId: null,
      direction: 'Check-Out',
      date: new Date().toISOString().slice(0, 10),
      meterOut: null,
      meterIn: null,
      fuelOut: null,
      fuelIn: null,
      checks: this.allChecks(true),
      photos: 0,
      status: 'Open',
    });
  }

  /** Log row click → the same editor the Log button opens (prototype `inspectionModal`). */
  openEdit(r: Inspection): void {
    // Edit a copy: the stored record only changes on Save.
    this.openEditor({ ...r, checks: { ...r.checks } });
  }

  /** True while the editor holds a draft that Save will create. */
  isNew(): boolean {
    return this.editRecord?.id === '';
  }

  private openEditor(r: Inspection): void {
    this.editRecord = r;
    this.editSnap = snapshotForm(r);
    this.editOpen = true;
  }

  /** True when the editor holds edits that Save has not written yet. */
  editDirty(): boolean {
    return formChanged(this.editRecord, this.editSnap);
  }

  /** Save the editor: create the draft, or patch the row it was opened on. */
  saveEdit(): void {
    const r = this.editRecord;
    if (!r) return;
    if (this.isNew()) {
      if (!r.itemId) return; // a new inspection needs an asset
      const rec = this.data.createInspection({
        itemId: r.itemId,
        orderId: r.orderId || null,
        direction: r.direction,
        date: r.date || new Date().toISOString().slice(0, 10),
        ...this.directionReadings(r),
        checks: { ...r.checks },
        photos: r.photos ?? 0,
        status: r.status,
      });
      // A check-out puts the unit on rent; a check-in frees it (prototype side-effect).
      if (rec.direction === 'Check-Out') {
        this.data.updateItem('serialized', rec.itemId, { status: 'On Rent', orderId: rec.orderId ?? null });
      } else {
        this.data.updateItem('serialized', rec.itemId, { status: 'Available', orderId: null });
      }
      // Follow the new record, so a narrowed log never hides what was just logged.
      this.logAnchor = new Date(rec.date + 'T00:00:00');
    } else {
      this.data.updateInspection(r.id, {
        itemId: r.itemId,
        orderId: r.orderId || null,
        direction: r.direction,
        date: r.date,
        status: r.status,
        meterOut: r.meterOut ?? null,
        meterIn: r.meterIn ?? null,
        fuelOut: r.fuelOut ?? null,
        fuelIn: r.fuelIn ?? null,
        checks: { ...r.checks },
      });
    }
    this.closeEdit();
  }

  closeEdit(): void {
    this.editOpen = false;
    this.editRecord = null;
    this.editSnap = '';
  }

  /* --------------------------- meter overage ---------------------------- */

  /** Overage badge for a logged row — only when it exceeds the allowance. */
  overageOf(r: Inspection): Overage | null {
    const o = this.reading(r);
    return o && o.overage > 0 ? o : null;
  }

  /** Live preview inside the editor (prototype `updateOveragePreview`). */
  editOverage(): Overage | null {
    return this.editRecord ? this.reading(this.editRecord) : null;
  }

  /** Used / allowed / overage for a Check-In that carries a meter-in reading. */
  private reading(r: Inspection): Overage | null {
    if (r.direction !== 'Check-In' || r.meterIn == null) return null;
    const allowed = this.data.allowedHours(r.orderId ? this.data.getOrder(r.orderId) : undefined);
    const used = Number(r.meterIn) - this.meterOutOf(r);
    return { used, allowed, overage: used - allowed };
  }

  /** The check-out side of the pair: the record's reading, else the asset's last one. */
  private meterOutOf(r: Inspection): number {
    return r.meterOut != null ? Number(r.meterOut) : this.data.lastMeter(r.itemId);
  }

  /** Readings a new record stores: only the side its direction captures. */
  private directionReadings(
    r: Inspection,
  ): Pick<Inspection, 'meterOut' | 'meterIn' | 'fuelOut' | 'fuelIn'> {
    const out = r.direction === 'Check-Out';
    return {
      meterOut: out ? r.meterOut ?? null : this.meterOutOf(r),
      meterIn: out ? null : r.meterIn ?? null,
      fuelOut: out ? r.fuelOut ?? null : null,
      fuelIn: out ? null : r.fuelIn ?? null,
    };
  }

  /* ------------------------------ utilities ----------------------------- */

  /** Inclusive ISO bounds of the selected log period. */
  private logBounds(): { start: string; end: string } {
    const a = this.logAnchor;
    if (this.logRange === 'month') {
      return {
        start: this.iso(new Date(a.getFullYear(), a.getMonth(), 1)),
        end: this.iso(new Date(a.getFullYear(), a.getMonth() + 1, 0)),
      };
    }
    if (this.logRange === 'week') {
      const start = this.mondayOf(a);
      return { start: this.iso(start), end: this.iso(this.dayAt(start, 6)) };
    }
    return { start: this.iso(a), end: this.iso(a) };
  }

  private dayAt(d: Date, days: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  }

  /** Monday of the week containing `d` (the scheduler's week convention). */
  private mondayOf(d: Date): Date {
    return this.dayAt(d, -((d.getDay() + 6) % 7));
  }

  private iso(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  private allChecks(v: boolean): Record<InspectionCheckKey, boolean> {
    return {
      tires: v,
      fluids: v,
      guards: v,
      lights: v,
      engine: v,
    };
  }

  /* ------------------------------ tooltips ------------------------------ */

  /** Inspection row: the asset, the direction, its meter/fuel readings, state. */
  tipInspection(r: Inspection): Tip {
    const out = r.meterOut != null || r.fuelOut != null;
    const back = r.meterIn != null || r.fuelIn != null;
    return tip(`${r.id} - ${this.data.itemLabel('serialized', r.itemId)}`, [
      stampDate(r.date),
      { label: 'Direction', value: r.direction },
      r.orderId ? { label: 'Order', value: r.orderId } : null,
      out ? { label: 'Out', value: `${this.data.int(r.meterOut ?? 0)} h · ${this.data.int(r.fuelOut ?? 0)} gal` } : null,
      back ? { label: 'In', value: `${this.data.int(r.meterIn ?? 0)} h · ${this.data.int(r.fuelIn ?? 0)} gal` } : null,
      { label: 'Photos', value: String(r.photos ?? 0) },
      r.notes ?? '',
    ], { badge: r.status });
  }
}
