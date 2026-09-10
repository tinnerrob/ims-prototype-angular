import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { RentalSub } from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';

/**
 * Data-free blank sub-rental form. Class field initializers run *before* the
 * constructor assigns parameter properties, so the initial value must not read
 * `this.data` — `emptyForm()` layers the contract default on top when the
 * editor opens.
 */
const BLANK_RENT_FORM = {
  itemId: '',
  assetName: '',
  orderId: '',
  vendor: '',
  vendorCost: 0,
  retailRate: 0,
  qty: 1,
};

/**
 * Rentals / Sub-Rentals (module) — port of the prototype's `renderRerents`
 * (js/pages/rerents.js): vendor wholesale / retail revenue / net spread KPIs
 * plus the sub-rental ledger and the New Sub-Rental modal.
 */
@Component({
  selector: 'ims-rentals',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent],
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

  constructor(readonly data: DataService) {}

  rentals(): RentalSub[] {
    return this.data.listRentals();
  }

  catalog() {
    return this.data.listItems('serialized');
  }

  orders() {
    return this.data.listOrders();
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
    if (!assetName || !f.vendor.trim()) return;
    this.data.createRental({
      itemId: item?.id ?? null,
      assetName,
      orderId: f.orderId || null,
      vendor: f.vendor,
      vendorCost: Number(f.vendorCost) || 0,
      retailRate: Number(f.retailRate) || 0,
      qty: Number(f.qty) || 1,
    });
    this.closeForm();
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
            { label: 'Contract', value: r.orderId || '—', mono: true },
            { label: 'Vendor Source', value: r.vendor },
            { label: 'Quantity', value: String(r.qty) },
          ],
        },
        {
          title: 'Commercials',
          fields: [
            { label: 'Vendor Cost / day', value: this.data.money(r.vendorCost) },
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
}
