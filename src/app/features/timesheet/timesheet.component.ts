import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Timesheet } from '../../core/models';

interface PunchForm {
  empId: string;
  date: string;
  hours: number;
  orderId: string; // '' = shop/overhead
  note: string;
}

@Component({
  selector: 'ims-timesheet',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './timesheet.component.html',
  styleUrl: './timesheet.component.scss',
})
export class TimesheetComponent {
  formOpen = false;
  form: PunchForm = this.emptyForm();

  constructor(readonly data: DataService) {}

  punches(): Timesheet[] {
    return this.data.listTimesheets();
  }

  labor() {
    return this.data.listItems('labor');
  }

  orders() {
    return this.data.listOrders().filter((o) => o.status === 'active');
  }

  openForm(): void {
    this.form = this.emptyForm();
    this.form.date = new Date().toISOString().slice(0, 10);
    this.formOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.empId || !f.hours || f.hours <= 0) return;
    const order = f.orderId ? this.data.getOrder(f.orderId) : null;
    this.data.createTimesheet({
      empId: f.empId,
      date: f.date,
      hours: f.hours,
      orderId: order?.orderId ?? null,
      targetLabel: order ? `${order.orderId} · ${order.projectName}` : 'Shop',
      note: f.note,
    });
    this.formOpen = false;
  }

  remove(p: Timesheet): void {
    if (confirm(`Remove punch ${p.id}?`)) this.data.removeTimesheet(p.id);
  }

  empName(empId: string): string {
    return this.data.itemLabel('labor', empId);
  }

  private emptyForm(): PunchForm {
    return { empId: '', date: '', hours: 8, orderId: '', note: '' };
  }
}
