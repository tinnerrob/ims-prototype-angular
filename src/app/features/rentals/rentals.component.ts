import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { RentalSub } from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { PrintMenuComponent } from '../../shared/print/print-menu.component';
import { PrintMode, PrintService } from '../../shared/print/print.service';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { tip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

/**
 * Data-free blank sub-rental form. Class field initializers run *before* the
 * constructor assigns parameter properties, so the initial value must not read
 * `this.data` — `emptyForm()` layers the order default on top when the
 * editor opens.
 */
const BLANK_RENT_FORM = {
  itemId: '',
  assetName: '',
  orderId: '',
  supplierId: '',
  vendorCost: 0,
  retailRate: 0,
  qty: 1,
  /** The window we hold it for (`YYYY-MM-DD`; blank = an open end). */
  rentFrom: '',
  rentTo: '',
};

/**
 * Rentals / Sub-Rentals (module) — port of the prototype's `renderRerents`
 * (js/pages/rerents.js): supplier wholesale / retail revenue / net spread KPIs
 * plus the sub-rental ledger and the New Sub-Rental modal.
 */
import { TablePagerDirective } from '../../shared/table/table-pager.directive';

@Component({
  selector: 'ims-rentals',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, PrintMenuComponent, RecordViewComponent, TipDirective, TablePagerDirective],
  templateUrl: './rentals.component.html',
  styleUrl: './rentals.component.scss',
})
export class RentalsComponent {
  modalOpen = false;
  form = { ...BLANK_RENT_FORM };
  /** Editor values as they were when it opened (drives the discard prompt). */
  private formSnap = '';

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;

  constructor(
    readonly data: DataService,
    private readonly printer: PrintService,
  ) {}

  rentals(): RentalSub[] {
    return this.data.listRentals();
  }

  catalog() {
    return this.data.listItems('serialized');
  }

  orders() {
    return this.data.listOrders();
  }

  /** Suppliers we sub-rent from — the partner table's suppliers (see `Party.kinds`). */
  suppliers() {
    return this.data.supplierParties();
  }

  /** Who a sub-rental came from, resolved from its supplier FK. */
  supplierName(r: RentalSub): string {
    return this.data.rentalSupplier(r);
  }

  totalCost(): number {
    return this.rentals().reduce((s, r) => s + r.vendorCost * r.qty, 0);
  }

  totalRetail(): number {
    return this.rentals().reduce((s, r) => s + r.retailRate * r.qty, 0);
  }

  totalSpread(): number {
    return this.rentals().reduce((s, r) => s + this.data.rentalSpread(r), 0);
  }

  margin(): number {
    const retail = this.totalRetail();
    return retail ? (this.totalSpread() / retail) * 100 : 0;
  }

  openForm(): void {
    this.form = this.emptyForm();
    this.formSnap = snapshotForm(this.form);
    this.modalOpen = true;
  }

  save(): void {
    const f = this.form;
    const item = f.itemId ? this.data.getItem('serialized', f.itemId) : null;
    const assetName = item ? item.name : f.assetName.trim();
    // A sub-rental needs an asset and a supplier: without the supplier there is
    // nothing to pay, so the store refuses it too (see `createRental`).
    if (!assetName || !f.supplierId) return;
    this.data.createRental({
      itemId: item?.id ?? null,
      assetName,
      orderId: f.orderId || null,
      supplierId: f.supplierId,
      vendorCost: Number(f.vendorCost) || 0,
      retailRate: Number(f.retailRate) || 0,
      qty: Number(f.qty) || 1,
      // An empty date input is an open end, not a null date — the store keeps
      // `undefined` for "no limit", and the two mean the same thing here.
      rentFrom: f.rentFrom || undefined,
      rentTo: f.rentTo || undefined,
    });
    this.closeForm();
  }

  /** Send it back to the supplier: the row records the day it went. */
  returnRow(r: RentalSub): void {
    this.data.returnRental(r.id);
  }

  /** The window we hold it for, as text (`Open` at an unset end). */
  windowLabel(r: RentalSub): string {
    const from = r.rentFrom ? this.data.fmtDate(r.rentFrom) : 'Open';
    const to = r.rentTo ? this.data.fmtDate(r.rentTo) : 'Open';
    return `${from} → ${to}`;
  }

  /** `Out`, `Overdue`, or `Returned <date>` — the row's rental state. */
  statusLabel(r: RentalSub): string {
    if (!this.data.rentalOut(r)) return `Returned ${this.data.fmtDate(r.returnedAt)}`;
    return this.data.rentalOverdue(r) ? 'Overdue' : 'Out';
  }

  statusBadge(r: RentalSub): string {
    if (!this.data.rentalOut(r)) return 'badge-status st-available';
    return this.data.rentalOverdue(r) ? 'badge-status st-out' : 'badge-status st-onrent';
  }

  remove(r: RentalSub): void {
    this.data.removeRental(r.id);
  }

  /** True when the editor holds edits that Save has not written yet. */
  formDirty(): boolean {
    return formChanged(this.form, this.formSnap);
  }

  closeForm(): void {
    this.modalOpen = false;
    this.formSnap = '';
  }

  /* --------------------------- record viewer ---------------------------- */

  /**
   * Row click → read-only viewer. Sub-rentals have no editor (only Remove), so
   * the viewer is read-only.
   */
  showView(e: Event, r: RentalSub): void {
    if (isInteractiveTarget(e)) return;
    this.viewer = {
      title: r.assetName,
      subtitle: r.itemId ? `Sub-rental · ${r.itemId}` : 'Sub-rental',
      icon: 'bi-box-arrow-in-down-left',
      sections: [
        {
          title: 'Asset',
          fields: [
            { label: 'Sub-Rental ID', value: r.id, mono: true },
            { label: 'Asset', value: r.assetName },
            { label: 'Catalog Item', value: r.itemId || '—', mono: true },
            { label: 'Order', value: r.orderId || '—', mono: true },
            { label: 'Supplier', value: this.supplierName(r) },
            { label: 'Rented From', value: r.rentFrom ? this.data.fmtDate(r.rentFrom) : 'Open', mono: true },
            { label: 'Due Back', value: r.rentTo ? this.data.fmtDate(r.rentTo) : 'Open', mono: true },
            { label: 'Returned', value: r.returnedAt ? this.data.fmtDate(r.returnedAt) : 'Still with us' },
            { label: 'Status', value: this.statusLabel(r) },
            { label: 'Quantity', value: String(r.qty) },
          ],
        },
        {
          title: 'Commercials',
          fields: [
            { label: 'Supplier Cost / day', value: this.data.money(r.vendorCost) },
            { label: 'Retail Rate / day', value: this.data.money(r.retailRate) },
            { label: 'Net Spread', value: this.data.money(this.data.rentalSpread(r)) },
            { label: 'Note', value: r.note || '—' },
          ],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
  }

  private emptyForm() {
    return { ...BLANK_RENT_FORM, orderId: this.data.listOrders()[0]?.orderId ?? '' };
  }

  /* ------------------------------ tooltips ------------------------------ */

  /**
   * Sub-rental row: the source, the window and the spread it earns.
   *
   * The window leads, because that is the point of a sub-rental: the unit is held
   * from `rentFrom` to `rentTo` so it can be re-let inside it.
   */
  tipRental(r: RentalSub): Tip {
    const spread = r.retailRate - r.vendorCost;
    return tip(r.assetName, [
      this.windowLabel(r),
      { label: 'Status', value: this.statusLabel(r) },
      { label: 'Supplier', value: this.supplierName(r) },
      r.orderId ? { label: 'Order', value: r.orderId } : null,
      { label: 'Supplier cost', value: `${this.data.money(r.vendorCost)}/day` },
      { label: 'Retail', value: `${this.data.money(r.retailRate)}/day` },
      { label: 'Spread', value: `${this.data.money(spread)}/day` },
      { label: 'Qty', value: String(r.qty) },
      r.note ?? '',
    ]);
  }

  /* ------------------------------- printing ----------------------------- */

  /**
   * Build the printable **sub-rental register** and open the print dialog: what we
   * rent in, from whom, over which window, and whether it is back — the ledger as
   * the page shows it.
   */
  printRegister(mode: PrintMode = 'print'): void {
    const rows = this.rentals();
    const money = (n: number) => this.data.money(n);
    this.printer.print({
      heading: 'Sub-Rental Register',
      number: 'All sub-rentals',
      meta: [
        { label: 'Sub-rentals', value: String(rows.length) },
        { label: 'Still Out', value: String(rows.filter((r) => this.data.rentalOut(r)).length) },
        { label: 'Overdue', value: String(rows.filter((r) => this.data.rentalOverdue(r)).length) },
      ],
      columns: ['Sub-Rental', 'Asset', 'Supplier', 'Order', 'From', 'Due Back', 'Returned', 'Status', 'Qty', 'Cost/day', 'Retail/day', 'Spread'],
      align: ['left', 'left', 'left', 'left', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'right'],
      rows: rows.map((r) => [
        r.id,
        r.assetName,
        this.supplierName(r),
        r.orderId || '—',
        r.rentFrom ? this.data.fmtDate(r.rentFrom) : '—',
        r.rentTo ? this.data.fmtDate(r.rentTo) : '—',
        r.returnedAt ? this.data.fmtDate(r.returnedAt) : '—',
        this.statusLabel(r),
        this.data.int(r.qty),
        money(r.vendorCost),
        money(r.retailRate),
        money(this.data.rentalSpread(r)),
      ]),
      notes: 'A sub-rental is taken from a supplier to be re-let on a customer order; the window is what ties the two together.',
    }, mode);
  }
}
