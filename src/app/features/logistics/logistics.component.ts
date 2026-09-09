import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { DISPATCH_STATUSES, Dispatch, DispatchStatus } from '../../core/models';

interface DspForm {
  orderId: string;
  vehicleId: string;
  status: DispatchStatus;
}

@Component({
  selector: 'ims-logistics',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './logistics.component.html',
  styleUrl: './logistics.component.scss',
})
export class LogisticsComponent {
  readonly statuses = DISPATCH_STATUSES;

  formOpen = false;
  form: DspForm = this.emptyForm();

  constructor(readonly data: DataService) {}

  dispatches(): Dispatch[] {
    return this.data.listDispatches();
  }

  vehicles() {
    return this.data.listVehicles();
  }

  orders() {
    return this.data.listOrders().filter((o) => o.status === 'active');
  }

  openForm(): void {
    this.form = { orderId: '', vehicleId: '', status: 'Staged' };
    this.formOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.orderId || !f.vehicleId) return;
    this.data.createDispatch({ orderId: f.orderId, vehicleId: f.vehicleId, status: f.status });
    this.formOpen = false;
  }

  setStatus(d: Dispatch, status: DispatchStatus): void {
    this.data.setDispatchStatus(d.id, status);
  }

  remove(d: Dispatch): void {
    if (confirm(`Remove dispatch ${d.id}?`)) this.data.removeDispatch(d.id);
  }

  private emptyForm(): DspForm {
    return { orderId: '', vehicleId: '', status: 'Staged' };
  }
}
