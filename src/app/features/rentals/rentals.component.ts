import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { RentalSub } from '../../core/models';

interface RentForm {
  itemId: string; // '' = no catalog mapping
  assetName: string;
  vendor: string;
  vendorCost: number;
  retailRate: number;
  qty: number;
  note: string;
}

@Component({
  selector: 'ims-rentals',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './rentals.component.html',
  styleUrl: './rentals.component.scss',
})
export class RentalsComponent {
  formOpen = false;
  form: RentForm = this.emptyForm();

  constructor(readonly data: DataService) {}

  rentals(): RentalSub[] {
    return this.data.listRentals();
  }

  catalog() {
    return this.data.listItems('serialized');
  }

  totalSpread(): number {
    return this.data.listRentals().reduce((s, r) => s + this.data.rentalSpread(r), 0);
  }

  openForm(): void {
    this.form = this.emptyForm();
    this.formOpen = true;
  }

  onItemChange(): void {
    const it = this.data.getItem('serialized', this.form.itemId);
    this.form.assetName = it ? `${it.id} · ${it.name}` : '';
  }

  save(): void {
    const f = this.form;
    const item = f.itemId ? this.data.getItem('serialized', f.itemId) : null;
    const assetName = item ? `${item.id} · ${item.name}` : f.assetName.trim();
    if (!assetName || !f.vendor.trim()) return;
    this.data.createRental({
      itemId: item?.id ?? null,
      assetName,
      vendor: f.vendor,
      vendorCost: f.vendorCost,
      retailRate: f.retailRate,
      qty: f.qty,
      note: f.note,
    });
    this.formOpen = false;
  }

  remove(r: RentalSub): void {
    if (confirm(`Remove sub-rental ${r.id}?`)) this.data.removeRental(r.id);
  }

  private emptyForm(): RentForm {
    return { itemId: '', assetName: '', vendor: '', vendorCost: 0, retailRate: 0, qty: 1, note: '' };
  }
}
