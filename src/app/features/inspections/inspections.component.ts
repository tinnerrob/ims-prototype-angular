import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import {
  Inspection,
  InspectionCheckKey,
  INSPECTION_CHECKS,
  INSPECTION_CHECK_LABEL,
  InspectionDirection,
  statusClass,
} from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';

/** Period filter of the inspection log. */
type LogRange = 'all' | 'day' | 'week' | 'month';

const LOG_RANGES: LogRange[] = ['all', 'day', 'week', 'month'];

const LOG_RANGE_LABEL: Record<LogRange, string> = {
  all: 'All',
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

/**
 * Receiving / Inspections (core) — port of the prototype's `renderYard`
 * (js/pages/yard.js): the asset in/out inspection form (telemetry verification
 * switches, meter + fuel) with the live overage preview, plus the inspection log.
 *
 * The log narrows to a day / week / month around a cursor date (the scheduler's
 * period pattern: Monday-based weeks, ‹ › paging, "Today" reset), and clicking a
 * logged inspection opens the editor directly — the prototype's
 * `inspectionModal` on the `data-edit` row — so a record is one click from edit.
 */
@Component({
  selector: 'ims-inspections',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective],
  templateUrl: './inspections.component.html',
  styleUrl: './inspections.component.scss',
})
export class InspectionsComponent {
  readonly checkKeys = INSPECTION_CHECKS;
  readonly checkLabel = INSPECTION_CHECK_LABEL;
  readonly logRanges = LOG_RANGES;
  readonly logRangeLabelOf = (v: LogRange): string => LOG_RANGE_LABEL[v];

  direction: InspectionDirection = 'Check-Out';
  itemId = '';
  orderId = '';
  date = new Date().toISOString().slice(0, 10);
  meter = 0;
  fuel = 100;
  checks: Record<InspectionCheckKey, boolean> = this.allChecks(true);

  /** Log period filter + the cursor date the day/week/month window is built on. */
  logRange: LogRange = 'all';
  logAnchor = new Date();

  editOpen = false;
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

  /** Live meter-overage preview for a Check-In (prototype `updateOveragePreview`). */
  overage(): { used: number; allowed: number; overage: number } | null {
    if (this.direction !== 'Check-In') return null;
    const meterIn = Number(this.meter) || 0;
    const meterOut = this.data.lastMeter(this.itemId);
    const allowed = this.data.allowedHours(this.orderId ? this.data.getOrder(this.orderId) : undefined);
    const used = meterIn - meterOut;
    const over = used - allowed;
    return { used, allowed, overage: over > 0 ? over : 0 };
  }

  /** Log the in/out inspection (prototype `#inspSave`). */
  logInspection(): void {
    if (!this.itemId) return;
    const isOut = this.direction === 'Check-Out';
    const meter = Number(this.meter) || 0;
    const fuel = Number(this.fuel) || 0;
    const rec = this.data.createInspection({
      itemId: this.itemId,
      orderId: this.orderId || null,
      direction: this.direction,
      date: this.date,
      meterOut: isOut ? meter : this.data.lastMeter(this.itemId),
      meterIn: isOut ? null : meter,
      fuelOut: isOut ? fuel : null,
      fuelIn: isOut ? null : fuel,
      checks: { ...this.checks },
      photos: 0,
      status: 'Open',
    });
    // A check-out puts the unit on rent; a check-in frees it (prototype side-effect).
    if (isOut) {
      this.data.updateItem('serialized', this.itemId, { status: 'On Rent', orderId: this.orderId || null });
    } else {
      this.data.updateItem('serialized', this.itemId, { status: 'Available', orderId: null });
    }
    // Follow the new record, so a narrowed log never hides what was just logged.
    this.logAnchor = new Date(rec.date + 'T00:00:00');
    this.meter = 0;
    this.fuel = 100;
    this.checks = this.allChecks(true);
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

  /** Visible count, plus the total while a filter is narrowing the log. */
  logCountLabel(): string {
    const shown = this.logEntries().length;
    return this.logFiltered() ? `${shown} / ${this.inspections().length}` : String(shown);
  }

  logEmptyLabel(): string {
    if (!this.logFiltered()) return 'No inspections logged.';
    return `No inspections logged for ${this.logRangeLabel()}.`;
  }

  /** Human label for the window the pager is paging through. */
  logRangeLabel(): string {
    if (this.logRange === 'month') {
      return new Date(this.logBounds().start + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });
    }
    if (this.logRange === 'week') {
      const b = this.logBounds();
      return 'Week of ' + this.span(b.start) + ' – ' + this.span(b.end);
    }
    return new Date(this.logBounds().start + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  /** Switch the log period, keeping the cursor date inside the new window. */
  setLogRange(v: LogRange): void {
    this.logRange = v;
    if (v === 'month') this.logAnchor = new Date(this.logAnchor.getFullYear(), this.logAnchor.getMonth(), 1);
    else if (v === 'week') this.logAnchor = this.mondayOf(this.logAnchor);
  }

  logToday(): void {
    this.logAnchor = new Date();
  }

  /** Page the log cursor one day / week / month (scheduler `shift`). */
  shiftLog(dir: number): void {
    const a = this.logAnchor;
    if (this.logRange === 'month') this.logAnchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
    else this.logAnchor = this.dayAt(a, dir * (this.logRange === 'week' ? 7 : 1));
  }

  /* ------------------------------- editor ------------------------------- */

  /** Log row click → the same editor the Edit action opens (prototype `inspectionModal`). */
  openEdit(r: Inspection): void {
    // Edit a copy: the stored record only changes on Save.
    this.editRecord = { ...r, checks: { ...r.checks } };
    this.editSnap = snapshotForm(this.editRecord);
    this.editOpen = true;
  }

  /** True when the editor holds edits that Save has not written yet. */
  editDirty(): boolean {
    return formChanged(this.editRecord, this.editSnap);
  }

  saveEdit(): void {
    const r = this.editRecord;
    if (!r) return;
    this.data.updateInspection(r.id, {
      itemId: r.itemId,
      direction: r.direction,
      status: r.status,
      meterOut: r.meterOut,
      meterIn: r.meterIn,
      fuelOut: r.fuelOut,
      fuelIn: r.fuelIn,
      checks: { ...r.checks },
    });
    this.closeEdit();
  }

  closeEdit(): void {
    this.editOpen = false;
    this.editRecord = null;
    this.editSnap = '';
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

  /** 'Sep 7' — short date for the week-range label. */
  private span(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
}
