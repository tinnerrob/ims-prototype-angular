import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import {
  CatalogType,
  CATALOG_TYPES,
  ITEM_STATUSES,
  Item,
  ItemStatus,
} from '../../core/models';

interface ItemForm {
  name: string;
  category: string;
  status: ItemStatus;
  qty: number;
  rateDaily: number;
  notes: string;
}

@Component({
  selector: 'ims-items',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './items.component.html',
  styleUrl: './items.component.scss',
})
export class ItemsComponent {
  readonly types = CATALOG_TYPES;
  readonly statuses = ITEM_STATUSES;

  type: CatalogType = 'serialized';

  formOpen = false;
  editingId: string | null = null;
  form: ItemForm = this.emptyForm();

  constructor(readonly data: DataService) {}

  items(): Item[] {
    return this.data.listItems(this.type);
  }

  categories(): string[] {
    return this.data.categoriesFor(this.type);
  }

  openForm(it?: Item): void {
    this.editingId = it ? it.id : null;
    const f = it
      ? {
          name: it.name,
          category: it.category,
          status: it.status,
          qty: it.qty,
          rateDaily: it.rateDaily,
          notes: it.notes ?? '',
        }
      : { ...this.emptyForm(), category: this.categories()[0] ?? '' };
    this.form = f;
    this.formOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.name.trim()) return;
    const patch = {
      name: f.name,
      category: f.category,
      status: f.status,
      qty: f.qty,
      rateDaily: f.rateDaily,
      notes: f.notes,
    };
    if (this.editingId) {
      this.data.updateItem(this.type, this.editingId, patch);
    } else {
      this.data.createItem(this.type, patch);
    }
    this.closeForm();
  }

  closeForm(): void {
    this.formOpen = false;
    this.editingId = null;
  }

  remove(it: Item): void {
    if (confirm(`Remove "${it.id} · ${it.name}"?`)) {
      this.data.removeItem(this.type, it.id);
    }
  }

  private emptyForm(): ItemForm {
    return {
      name: '',
      category: '',
      status: ITEM_STATUSES[this.type][0],
      qty: 1,
      rateDaily: 0,
      notes: '',
    };
  }
}
