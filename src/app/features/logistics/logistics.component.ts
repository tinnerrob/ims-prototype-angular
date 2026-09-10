import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Dispatch, DISPATCH_STATUSES, DispatchStatus, statusClass } from '../../core/models';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';

/**
 * Logistics & Dispatch (module) — port of the prototype's `renderLogistics`
 * (js/pages/logistics.js): a pending-dispatch board beside the driver /
 * truck / status assignment grid with an "Apply Assignments" commit.
 */
@Component({
  selector: 'ims-logistics',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent],
  templateUrl: './logistics.component.html',
  styleUrl: './logistics.component.scss',
})
export class LogisticsComponent {
  readonly statuses = DISPATCH_STATUSES;

  modalOpen = false;
  form = this.emptyForm();

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;

  /** Staged (uncommitted) edits from the assignment grid, keyed by dispatch id. */
  private draft: Record<string, { driverId: string; vehicleId: string; status: DispatchStatus }> = {};

  constructor(readonly data: DataService) {}

  dispatches(): Dispatch[] {
    return this.data.listDispatches();
  }

  staged(): Dispatch[] {
    return this.dispatches().filter((d) => d.status === 'Staged');
  }

  drivers() {
    return this.data.cdlDrivers();
  }

  vehicles() {
    return this.data.listVehicles();
  }

  orders() {
    return this.data.activeOrders();
  }

  siteOf(d: Dispatch): string {
    return this.data.getOrder(d.orderId)?.projectName ?? '';
  }

  jobSiteOf(d: Dispatch): string {
    return this.data.getOrder(d.orderId)?.jobSite ?? '';
  }

  coords(d: Dispatch): string {
    const o = this.data.getOrder(d.orderId);
    if (!o?.siteLat || !o?.siteLng) return '';
    return `${o.siteLat.toFixed(4)}, ${o.siteLng.toFixed(4)}`;
  }

  badge(status: string): string {
    return 'badge-status st-' + statusClass(status);
  }

  driverValue(d: Dispatch): string {
    return this.draft[d.id]?.driverId ?? d.driverId ?? '';
  }

  vehicleValue(d: Dispatch): string {
    return this.draft[d.id]?.vehicleId ?? d.vehicleId ?? '';
  }

  statusValue(d: Dispatch): DispatchStatus {
    return this.draft[d.id]?.status ?? d.status;
  }

  onDriver(d: Dispatch, value: string): void {
    this.patch(d.id, { driverId: value });
  }

  onVehicle(d: Dispatch, value: string): void {
    this.patch(d.id, { vehicleId: value });
  }

  onStatus(d: Dispatch, value: string): void {
    this.patch(d.id, { status: value as DispatchStatus });
  }

  private patch(id: string, part: Partial<{ driverId: string; vehicleId: string; status: DispatchStatus }>): void {
    const d = this.dispatches().find((x) => x.id === id);
    if (!d) return;
    this.draft[id] = {
      driverId: this.driverValue(d),
      vehicleId: this.vehicleValue(d),
      status: this.statusValue(d),
      ...part,
    };
  }

  /** Commit every grid edit (prototype `#dspSave`). */
  applyAssignments(): void {
    for (const d of this.dispatches()) {
      const draft = this.draft[d.id];
      if (!draft) continue;
      this.data.updateDispatch(d.id, {
        driverId: draft.driverId || null,
        vehicleId: draft.vehicleId || null,
        status: draft.status,
      });
    }
    this.draft = {};
  }

  /** Assign the first CDL driver + move a staged dispatch en route. */
  assign(d: Dispatch): void {
    const first = this.drivers()[0];
    this.data.updateDispatch(d.id, {
      driverId: d.driverId || first?.id || null,
      status: d.status === 'Staged' ? 'En Route' : d.status,
    });
  }

  openForm(): void {
    this.form = this.emptyForm();
    this.modalOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.orderId || !f.vehicleId) return;
    this.data.createDispatch({
      orderId: f.orderId,
      vehicleId: f.vehicleId,
      status: f.status,
    });
    this.closeForm();
  }

  remove(d: Dispatch): void {
    this.data.removeDispatch(d.id);
  }

  closeForm(): void {
    this.modalOpen = false;
  }

  /* --------------------------- record viewer ---------------------------- */

  /**
   * Dispatch row click → read-only viewer. The grid's selects keep their own
   * click (the row handler ignores interactive targets); the viewer shows the
   * *staged* assignment values, i.e. what the grid currently displays.
   */
  showView(e: Event, d: Dispatch): void {
    if (isInteractiveTarget(e)) return;
    const driverId = this.driverValue(d);
    const vehicleId = this.vehicleValue(d);
    const driver = this.drivers().find((x) => x.id === driverId);
    const vehicle = this.vehicles().find((x) => x.id === vehicleId);
    this.viewer = {
      title: `Dispatch ${d.id}`,
      subtitle: `${this.siteOf(d) || d.orderId} · route ${d.routeSeq}`,
      icon: 'bi-truck',
      badge: this.statusValue(d),
      badgeClass: 'st-' + statusClass(this.statusValue(d)),
      sections: [
        {
          title: 'Route',
          fields: [
            { label: 'Dispatch ID', value: d.id, mono: true },
            { label: 'Route Sequence', value: String(d.routeSeq) },
            { label: 'Asset', value: d.assetId || '—', mono: true },
            { label: 'Contract', value: d.orderId, mono: true },
            { label: 'Site', value: this.siteOf(d) || '—' },
            { label: 'Job Site', value: this.jobSiteOf(d) || '—' },
            { label: 'Coordinates', value: this.coords(d) || '—', mono: true },
          ],
        },
        {
          title: 'Assignment',
          fields: [
            { label: 'Driver (CDL)', value: driver ? `${driver.id} — ${driver.name}` : '— none —' },
            { label: 'Truck', value: vehicle ? `${vehicle.id} — ${vehicle.name}` : '— none —' },
            { label: 'Status', value: this.statusValue(d) },
          ],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
  }

  private emptyForm() {
    return { orderId: '', vehicleId: '', status: 'Staged' as DispatchStatus };
  }
}
