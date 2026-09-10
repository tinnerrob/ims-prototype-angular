import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { CatalogType, CategoryOption } from '../../core/models';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';

interface CategoryTab {
  key: CatalogType;
  label: string;
  icon: string;
}

/** Tab strip from the prototype's `CAT_TYPES` (js/pages/categories.js). */
const CAT_TYPES: CategoryTab[] = [
  { key: 'serialized', label: 'Items (Serialized)', icon: 'bi-truck-front' },
  { key: 'bulk', label: 'Items (Bulk)', icon: 'bi-boxes' },
  { key: 'consumable', label: 'Consumables', icon: 'bi-capsule' },
  { key: 'labor', label: 'Labor / Employees', icon: 'bi-person-badge' },
  { key: 'part', label: 'Stock Inventory', icon: 'bi-wrench-adjustable' },
];

/**
 * Categories (core) — port of the prototype's `renderCategories`
 * (js/pages/categories.js): a type tab strip with counts, a category grid
 * (Active / Items / rename / remove) and the add + rename modals.
 */
@Component({
  selector: 'ims-categories',
  standalone: true,
  imports: [FormsModule, RecordViewComponent],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss',
})
export class CategoriesComponent {
  readonly tabs = CAT_TYPES;

  type: CatalogType = 'serialized';

  /** Add / rename modal state. */
  modalOpen = false;
  renameFrom: string | null = null;
  formName = '';
  formActive = true;

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;
  /** Record behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: CategoryOption | null = null;

  constructor(readonly data: DataService) {}

  records(): CategoryOption[] {
    return this.data.categoryRecordsFor(this.type);
  }

  label(): string {
    return this.tabs.find((t) => t.key === this.type)?.label ?? this.type;
  }

  count(): number {
    return this.records().length;
  }

  selectType(t: CatalogType): void {
    this.type = t;
    this.close();
    this.closeViewer();
  }

  itemsIn(name: string): number {
    return this.data.categoryCount(this.type, name);
  }

  openAdd(): void {
    this.renameFrom = null;
    this.formName = '';
    this.formActive = true;
    this.modalOpen = true;
  }

  openRename(c: CategoryOption): void {
    this.renameFrom = c.name;
    this.formName = c.name;
    this.formActive = c.active !== false;
    this.modalOpen = true;
  }

  save(): void {
    const name = this.formName.trim();
    if (!name) return;
    if (this.renameFrom) {
      this.data.renameCategory(this.type, this.renameFrom, name, this.formActive);
    } else {
      this.data.addCategory(this.type, name, this.formActive);
    }
    this.close();
  }

  remove(c: CategoryOption): void {
    this.data.removeCategory(this.type, c.name);
  }

  close(): void {
    this.modalOpen = false;
    this.renameFrom = null;
    this.formName = '';
    this.formActive = true;
  }

  /* --------------------------- record viewer ---------------------------- */

  /** Row click → read-only viewer (row actions keep their own click). */
  showView(e: Event, c: CategoryOption): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = c;
    this.viewer = {
      title: c.name,
      subtitle: this.label(),
      icon: this.tabs.find((t) => t.key === this.type)?.icon ?? 'bi-tags',
      badge: c.active !== false ? 'Active' : 'Inactive',
      badgeClass: c.active !== false ? 'st-active' : 'st-out',
      sections: [
        {
          fields: [
            { label: 'Category', value: c.name },
            { label: 'Item Type', value: this.label() },
            { label: 'Items Using It', value: String(this.itemsIn(c.name)) },
            { label: 'Available In Editors', value: c.active !== false ? 'Yes' : 'No' },
          ],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
    this.viewing = null;
  }

  /** Viewer footer Edit → reopen the rename editor for the shown category. */
  editFromViewer(): void {
    const c = this.viewing;
    this.closeViewer();
    if (c) this.openRename(c);
  }
}
