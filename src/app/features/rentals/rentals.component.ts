import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { RentalSub } from '../../core/models';

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
  imports: [FormsModule],
  templateUrl: './rentals.component.html',
  styleUrl: './rentals.component.scss',
})
export class RentalsComponent {
  modalOpen = false;
  form = { ...BLANK_RENT_FORM };

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

  closeForm(): void {
    this.modalOpen = false;
  }

  private emptyForm() {
    return { ...BLANK_RENT_FORM, orderId: this.data.listOrders()[0]?.orderId ?? '' };
  }
}
