import { Component } from '@angular/core';

import { DataService } from '../../core/data.service';
import { Timesheet } from '../../core/models';

interface TaskChip {
  key: string;
  label: string;
  orderId?: string;
  kind: 'order' | 'shop' | 'overhead';
}

@Component({
  selector: 'ims-timesheet',
  standalone: true,
  templateUrl: './timesheet.component.html',
  styleUrl: './timesheet.component.scss',
})
export class TimesheetComponent {
  draggingKey = '';

  constructor(readonly data: DataService) {}

  /** Task chips to drag onto an employee row. */
  tasks(): TaskChip[] {
    const orders = this.data
      .listOrders()
      .filter((o) => o.status === 'active')
      .map((o): TaskChip => ({ key: 'o:' + o.orderId, label: `${o.orderId} · ${o.projectName}`, orderId: o.orderId, kind: 'order' }));
    return [
      ...orders,
      { key: 'shop', label: 'Shop', kind: 'shop' },
      { key: 'overhead', label: 'Overhead', kind: 'overhead' },
    ];
  }

  employees() {
    return this.data.listItems('labor');
  }

  punches(): Timesheet[] {
    return this.data.listTimesheets();
  }

  empHours(empId: string): number {
    return this.data
      .listTimesheets()
      .filter((t) => t.empId === empId)
      .reduce((s, t) => s + t.hours, 0);
  }

  onDragStart(e: Event, chip: TaskChip): void {
    (e as DragEvent).dataTransfer?.setData('application/x-task', chip.key);
    (e as DragEvent).dataTransfer?.setData('text/plain', chip.key);
    this.draggingKey = chip.key;
  }

  onDragEnd(): void {
    this.draggingKey = '';
  }

  allowDrop(e: Event): void {
    e.preventDefault();
  }

  onDropEmp(e: Event, empId: string): void {
    e.preventDefault();
    const key = (e as DragEvent).dataTransfer?.getData('application/x-task') || (e as DragEvent).dataTransfer?.getData('text/plain');
    this.draggingKey = '';
    if (!key) return;
    const chip = this.tasks().find((t) => t.key === key);
    if (!chip) return;
    const order = chip.orderId ? this.data.getOrder(chip.orderId) : null;
    this.data.createTimesheet({
      empId,
      date: new Date().toISOString().slice(0, 10),
      hours: 8,
      orderId: order?.orderId ?? null,
      targetLabel: order ? `${order.orderId} · ${order.projectName}` : chip.kind === 'shop' ? 'Shop' : 'Overhead',
      note: 'Dropped via board',
    });
  }

  chipClass(chip: TaskChip): string {
    return 'chip-' + chip.kind;
  }

  remove(p: Timesheet): void {
    if (confirm(`Remove punch ${p.id}?`)) this.data.removeTimesheet(p.id);
  }

  empName(empId: string): string {
    return this.data.itemLabel('labor', empId);
  }
}
