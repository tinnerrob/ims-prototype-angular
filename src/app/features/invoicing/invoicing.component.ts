import { Component } from '@angular/core';

import { DataService } from '../../core/data.service';
import { Invoice, InvoiceStatus } from '../../core/models';

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: 'Pending',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

@Component({
  selector: 'ims-invoicing',
  standalone: true,
  templateUrl: './invoicing.component.html',
  styleUrl: './invoicing.component.scss',
})
export class InvoicingComponent {
  readonly label = STATUS_LABEL;
  lastRun = 0;

  constructor(readonly data: DataService) {}

  invoices(): Invoice[] {
    return this.data.listInvoices();
  }

  run(): void {
    this.lastRun = this.data.generateInvoices();
  }

  markPaid(inv: Invoice): void {
    this.data.markInvoicePaid(inv.id);
  }

  remove(inv: Invoice): void {
    if (confirm(`Remove invoice ${inv.id}?`)) this.data.removeInvoice(inv.id);
  }
}
