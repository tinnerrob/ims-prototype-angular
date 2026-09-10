import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import {
  SERVICE_TYPES,
  statusClass,
  WorkOrder,
  WORK_ORDER_STATUSES,
  WorkOrderPart,
  WorkOrderStatus,
} from '../../core/models';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';

/**
 * Data-free blank work-order form. Class field initializers run *before* the
 * constructor assigns parameter properties, so the initial value must not read
 * `this.data` — `emptyForm()` layers the data-derived defaults on top when the
 * editor opens.
 */
const BLANK_WO_FORM = {
  itemId: '',
  type: 'Repair',
  meterReading: 0,
  status: 'In Progress' as WorkOrderStatus,
  laborHours: 1,
  consumableId: '',
  consumableQty: 0,
  partId: '',
  partQty: 0,
  technicianId: '',
};

/**
 * Field Service & Maintenance (module) — port of the prototype's
 * `renderMaintenance` (js/pages/maintenance.js): the work-order cost grid
 * (parts + labour roll-up), a status filter and the New Work Order modal that
 * books parts and moves the asset into the shop.
 */
@Component({
  selector: 'ims-maintenance',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent],
  templateUrl: './maintenance.component.html',
  styleUrl: './maintenance.component.scss',
})
export class MaintenanceComponent {
  readonly statuses = WORK_ORDER_STATUSES;
  readonly serviceTypes = SERVICE_TYPES;

  filter: 'all' | WorkOrderStatus = 'all';
  modalOpen = false;
  form = { ...BLANK_WO_FORM };

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;

  constructor(readonly data: DataService) {}

  workOrders(): WorkOrder[] {
    const all = this.data.listWorkOrders();
    return this.filter === 'all' ? all : all.filter((w) => w.status === this.filter);
  }

  count(status: WorkOrderStatus): number {
    return this.data.listWorkOrders().filter((w) => w.status === status).length;
  }

  serialized() {
    return this.data.listItems('serialized');
  }

  /** Consumables + stock parts available to book against a work order. */
  consumables() {
    return this.data.listItems('consumable');
  }

  parts() {
    return this.data.listItems('part');
  }

  technicians() {
    return this.data.listItems('labor').filter((e) => e.role === 'Technician');
  }

  cost(w: WorkOrder) {
    return this.data.workOrderCost(w);
  }

  assetLabel(w: WorkOrder): string {
    const a = this.data.getItem('serialized', w.itemId);
    return a ? `${a.id} ${this.data.mkName(a)}` : w.itemId;
  }

  partLabel(p: WorkOrderPart): string {
    return `${p.refId} ×${p.qty}`;
  }

  badge(status: string): string {
    return 'badge-status st-' + statusClass(status);
  }

  openForm(): void {
    this.form = this.emptyForm();
    this.modalOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.itemId || !f.type) return;
    const parts: WorkOrderPart[] = [];
    if (Number(f.consumableQty) > 0 && f.consumableId) {
      parts.push({ kind: 'consumable', refId: f.consumableId, qty: Number(f.consumableQty) });
    }
    if (Number(f.partQty) > 0 && f.partId) {
      parts.push({ kind: 'part', refId: f.partId, qty: Number(f.partQty) });
    }
    this.data.createWorkOrder({
      itemId: f.itemId,
      type: f.type,
      meterReading: Number(f.meterReading) || 0,
      status: f.status,
      parts,
      laborHours: Number(f.laborHours) || 0,
      date: new Date().toISOString().slice(0, 10),
    });
    this.closeForm();
  }

  setStatus(w: WorkOrder, status: string): void {
    this.data.setWorkOrderStatus(w.id, status as WorkOrderStatus);
  }

  remove(w: WorkOrder): void {
    this.data.removeWorkOrder(w.id);
  }

  closeForm(): void {
    this.modalOpen = false;
  }

  /* --------------------------- record viewer ---------------------------- */

  /**
   * Work-order row click → read-only viewer. The page's New Work Order modal can
   * only create, so the viewer is read-only (status changes stay in the grid).
   */
  showView(e: Event, w: WorkOrder): void {
    if (isInteractiveTarget(e)) return;
    const c = this.cost(w);
    this.viewer = {
      title: `Work Order ${w.id}`,
      subtitle: `${this.assetLabel(w)} · ${w.type}`,
      icon: 'bi-tools',
      badge: w.status,
      badgeClass: 'st-' + statusClass(w.status),
      sections: [
        {
          title: 'Work Order',
          fields: [
            { label: 'WO #', value: w.id, mono: true },
            { label: 'Asset', value: this.assetLabel(w) },
            { label: 'Service Type', value: w.type },
            { label: 'Meter Reading', value: this.data.int(w.meterReading) },
            { label: 'Status', value: w.status },
            { label: 'Date', value: this.data.fmtDate(w.date), mono: true },
          ],
        },
        {
          title: 'Parts & Labor',
          fields: [
            { label: 'Parts Used', value: w.parts.length ? w.parts.map((p) => this.partLabel(p)).join(', ') : '—' },
            { label: 'Parts Cost', value: this.data.money(c.partsCost) },
            { label: 'Labor Hours', value: String(w.laborHours) },
            { label: 'Labor Rate / hr', value: this.data.money(c.laborRate) },
            { label: 'Labor Cost', value: this.data.money(c.laborCost) },
            { label: 'Total Cost', value: this.data.money(c.total) },
          ],
        },
        {
          title: 'Notes',
          fields: [{ label: 'Notes', value: w.notes || '—' }],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
  }

  private emptyForm() {
    const asset =
      this.serialized().find((a) => a.status === 'In Shop')?.id ?? this.serialized()[0]?.id ?? '';
    return {
      ...BLANK_WO_FORM,
      itemId: asset,
      consumableId: this.consumables()[0]?.id ?? '',
      partId: this.parts()[0]?.id ?? '',
      technicianId: this.technicians()[0]?.id ?? '',
    };
  }
}
