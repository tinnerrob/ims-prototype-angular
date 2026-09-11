import { Component } from '@angular/core';

import { DataService } from '../../core/data.service';
import { Invoice, InvoiceStatus, INVOICE_STATUS_LABEL } from '../../core/models';
import { PageSearchService } from '../../core/page-search.service';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget } from '../../shared/record-view/record-view.component';
import { stampDayRange } from '../../shared/tip/tip-format';
import { tip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

/**
 * Billing & Invoicing (module) — port of the prototype's `renderInvoicing`
 * (js/pages/invoicing.js): KPI tiles, the invoice ledger with a status filter,
 * "Run Next Cycle", CSV export and the per-invoice detail breakdown.
 */
@Component({
  selector: 'ims-invoicing',
  standalone: true,
  imports: [ModalDismissDirective, TipDirective],
  templateUrl: './invoicing.component.html',
  styleUrl: './invoicing.component.scss',
})
export class InvoicingComponent {
  readonly label = INVOICE_STATUS_LABEL;
  readonly statuses: InvoiceStatus[] = ['pending', 'invoiced', 'paid'];

  filter: 'all' | InvoiceStatus = 'all';
  detail: Invoice | null = null;
  lastRun = 0;

  constructor(
    readonly data: DataService,
    readonly search: PageSearchService,
  ) {
    // The topbar search box is this page's search: report how much of the ledger
    // survives it (the shell shows "shown of total" next to the box).
    this.search.report(() => ({
      shown: this.invoices().length,
      total: this.data.listInvoices().length,
    }));
  }

  /** Invoices on the active status filter, narrowed by the page search. */
  invoices(): Invoice[] {
    const all = this.data.listInvoices().filter((i) => this.searchHits(i));
    return this.filter === 'all' ? all : all.filter((i) => i.status === this.filter);
  }

  /** Does the topbar page search match this invoice (its contract, customer)? */
  private searchHits(inv: Invoice): boolean {
    const o = this.data.getOrder(inv.orderId);
    return this.search.matches(
      inv.id,
      inv.orderId,
      o?.projectName,
      o?.jobSite,
      o ? this.data.partyName(o.partyId) : null,
      this.label[inv.status],
      inv.cycle,
      inv.cycleStart,
      inv.cycleEnd,
    );
  }

  /** Empty-ledger wording — the page search is the likely reason nothing shows. */
  emptyLabel(): string {
    return this.search.isBlank() ? 'No invoices.' : 'No invoices match your search.';
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

  /**
   * Run the next billing cycle: every active order gets the period that follows
   * its last one, at its own party's cadence. The store decides it all
   * (`runNextCycle()`) — including that a period with nothing left to bill is not
   * raised — and this only reports how many invoices it produced.
   */
  runNextCycle(): void {
    const count = this.data.runNextCycle();
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

  /* ------------------------------ tooltips ------------------------------ */

  /** Invoice row: the customer, its cycle window, the breakdown and the total. */
  tipInvoice(inv: Invoice): Tip {
    const t = this.totals(inv);
    return tip(`${inv.id} - ${this.customer(inv)}`, [
      stampDayRange(inv.cycleStart, inv.cycleEnd),
      { label: 'Contract', value: inv.orderId },
      { label: 'Cycle', value: String(inv.cycle) },
      { label: 'Base', value: this.data.money(t.base) },
      inv.envFeePct ? { label: 'Environmental', value: this.data.money(t.envFee) } : null,
      inv.damageWaiver ? { label: 'Damage waiver', value: this.data.money(t.waiver) } : null,
      inv.fuelCharge ? { label: 'Fuel', value: this.data.money(t.fuel) } : null,
      { label: 'Tax', value: this.data.money(t.tax) },
      { label: 'Total', value: this.data.money(t.total) },
    ], { badge: this.label[inv.status] });
  }
}
