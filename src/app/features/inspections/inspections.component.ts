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

/**
 * Receiving / Inspections (core) — port of the prototype's `renderYard`
 * (js/pages/yard.js): the asset in/out inspection form (telemetry verification
 * switches, meter + fuel) with the live overage preview, plus the inspection log.
 */
@Component({
  selector: 'ims-inspections',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './inspections.component.html',
  styleUrl: './inspections.component.scss',
})
export class InspectionsComponent {
  readonly checkKeys = INSPECTION_CHECKS;
  readonly checkLabel = INSPECTION_CHECK_LABEL;

  direction: InspectionDirection = 'Check-Out';
  itemId = '';
  orderId = '';
  date = new Date().toISOString().slice(0, 10);
  meter = 0;
  fuel = 100;
  checks: Record<InspectionCheckKey, boolean> = this.allChecks(true);

  editOpen = false;
  editRecord: Inspection | null = null;

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
  log(): void {
    if (!this.itemId) return;
    const isOut = this.direction === 'Check-Out';
    const meter = Number(this.meter) || 0;
    const fuel = Number(this.fuel) || 0;
    this.data.createInspection({
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
    this.meter = 0;
    this.fuel = 100;
    this.checks = this.allChecks(true);
  }

  openEdit(r: Inspection): void {
    this.editRecord = r;
    this.editOpen = true;
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
