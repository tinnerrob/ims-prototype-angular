import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { WorkOrder, WORK_ORDER_STATUSES, WorkOrderPriority, WorkOrderStatus } from '../../core/models';

interface WoForm {
  itemId: string;
  title: string;
  serviceType: string;
  priority: WorkOrderPriority;
  notes: string;
}

@Component({
  selector: 'ims-maintenance',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './maintenance.component.html',
  styleUrl: './maintenance.component.scss',
})
export class MaintenanceComponent {
  readonly statuses = WORK_ORDER_STATUSES;

  formOpen = false;
  form: WoForm = this.emptyForm();

  constructor(readonly data: DataService) {}

  workOrders(): WorkOrder[] {
    return this.data.listWorkOrders();
  }

  serialized() {
    return this.data.listItems('serialized');
  }

  openForm(): void {
    this.form = this.emptyForm();
    this.formOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.title.trim() || !f.itemId) return;
    this.data.createWorkOrder({
      itemId: f.itemId,
      title: f.title,
      serviceType: f.serviceType || 'Repair',
      priority: f.priority,
      openedAt: new Date().toISOString().slice(0, 10),
      notes: f.notes,
    });
    this.formOpen = false;
  }

  setStatus(wo: WorkOrder, status: WorkOrderStatus): void {
    this.data.setWorkOrderStatus(wo.id, status);
  }

  remove(wo: WorkOrder): void {
    if (confirm(`Remove work order ${wo.id}?`)) this.data.removeWorkOrder(wo.id);
  }

  private emptyForm(): WoForm {
    return {
      itemId: this.serialized()[0]?.id ?? '',
      title: '',
      serviceType: 'Repair',
      priority: 'normal',
      notes: '',
    };
  }
}
