import { Component } from '@angular/core';

import { DataService } from '../../core/data.service';
import { Invoice, InvoiceStatus, INVOICE_STATUS_LABEL } from '../../core/models';
import { isInteractiveTarget } from '../../shared/record-view/record-view.component';

/**
 * Billing & Invoicing (module) — port of the prototype's `renderInvoicing`
 * (js/pages/invoicing.js): KPI tiles, the invoice ledger with a status filter,
 * "Run Next Cycle", CSV export and the per-invoice detail breakdown.
 */
@Component({
  selector: 'ims-invoicing',
  standalone: true,
  templateUrl: './invoicing.component.html',
  styleUrl: './invoicing.component.scss',
})
export class InvoicingComponent {
  readonly label = INVOICE_STATUS_LABEL;
  readonly statuses: InvoiceStatus[] = ['pending', 'invoiced', 'paid'];

  filter: 'all' | InvoiceStatus = 'all';
  detail: Invoice | null = null;
  lastRun = 0;

  constructor(readonly data: DataService) {}

  invoices(): Invoice[] {
    const all = this.data.listInvoices();
    return this.filter === 'all' ? all : all.filter((i) => i.status === this.filter);
  }

  countBy(status: InvoiceStatus): number {
    return this.data.listInvoices().filter((i) => i.status === status).length;
  }

  orderLabel(inv: Invoice): string {
    const o = this.data.getOrder(inv.orderId);
    return o ? `${o.orderId} · ${o.projectName}` : inv.orderId;
  }

  customer(inv: Invoice): string {
    const o = this.data.getOrder(inv.orderId);
    return o ? this.data.partyName(o.partyId) : '—';
  }

  totals(inv: Invoice) {
    return this.data.invoiceTotals(inv);
  }

  totalBilled(): number {
    return this.data.totalBilled();
  }

  unpaidTotal(): number {
    return this.data
      .listInvoices()
      .filter((i) => i.status !== 'paid')
      .reduce((s, inv) => s + this.totals(inv).total, 0);
  }

  badge(status: InvoiceStatus): string {
    const cls = status === 'paid' ? 'st-active' : status === 'invoiced' ? 'st-onrent' : 'st-out';
    return 'badge-status ' + cls;
  }

  /** One invoice status change (detail modal "Save Status"). */
  setStatus(inv: Invoice, status: string): void {
    this.data.setInvoiceStatus(inv.id, status as InvoiceStatus);
  }

  /** Run the next billing cycle: roll every unpaid invoice forward one period. */
  runNextCycle(): void {
    const count = this.data.generateInvoices();
    this.lastRun = count;
  }

  markPaid(inv: Invoice): void {
    this.data.markInvoicePaid(inv.id);
  }

  remove(inv: Invoice): void {
    this.data.removeInvoice(inv.id);
  }

  openDetail(inv: Invoice): void {
    this.detail = inv;
  }

  /** Row click → the page's existing read-only invoice detail modal. */
  showInvoiceView(e: Event, inv: Invoice): void {
    if (isInteractiveTarget(e)) return;
    this.openDetail(inv);
  }

  closeDetail(): void {
    this.detail = null;
  }

  /** Line-level breakdown for the detail modal. */
  detailLines(inv: Invoice) {
    const order = this.data.getOrder(inv.orderId);
    if (!order) return [];
    return order.lineItems.map((li) => {
      const item = this.data.getItem(li.type, li.refId);
      const basis = item ? this.data.rateBasis(li, item, order) : { basis: '—', rate: 0 };
      return {
        label: this.data.itemLabel(li.type, li.refId),
        type: li.type,
        qty: li.qty,
        basis,
        amount: this.data.lineAmountForPeriod(order, li, inv.cycleStart, inv.cycleEnd),
      };
    });
  }

  /** Download the invoice detail CSV (prototype `invoiceDetailCSV` + `downloadCSV`). */
  exportCsv(): void {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Invoice', 'Contract', 'Customer', 'Project', 'Cycle', 'Period', 'Status',
      'Item Type', 'Item', 'Qty', 'Rate', 'Amount',
    ].map(esc).join(',');
    const lines: string[] = [];
    for (const inv of this.invoices()) {
      const order = this.data.getOrder(inv.orderId);
      const t = this.totals(inv);
      const period = `${this.data.fmtDate(inv.cycleStart)} to ${this.data.fmtDate(inv.cycleEnd)}`;
      const base = [inv.id, inv.orderId, order ? this.data.partyName(order.partyId) : '', order?.projectName ?? '', inv.cycle, period, this.label[inv.status]];
      for (const li of this.detailLines(inv)) {
        lines.push([...base, li.type, li.label, li.qty, `${li.basis.basis} @ ${li.basis.rate}`, li.amount].map(esc).join(','));
      }
      lines.push([...base, 'Adjustment', 'Environmental Fee', '', '', t.envFee].map(esc).join(','));
      lines.push([...base, 'Adjustment', 'Fuel Charge', '', '', t.fuel].map(esc).join(','));
      lines.push([...base, 'Adjustment', 'Damage Waiver', '', '', t.waiver].map(esc).join(','));
      lines.push([...base, 'Adjustment', 'Tax', '', '', t.tax].map(esc).join(','));
    }
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoice-details.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
