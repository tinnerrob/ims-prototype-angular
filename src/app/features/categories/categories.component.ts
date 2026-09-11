import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { CatalogType, CategoryOption } from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { tip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

interface CategoryTab {
  key: CatalogType;
  label: string;
  icon: string;
}

/**
 * The types this page manages categories for (the prototype's `CAT_TYPES`): the
 * five a workspace actually groups its stock by — a kit or an attachment is
 * described by what it is, not by a category. The *names* and icons come from the
 * tenant's vertical registry (one source for "Assets (Serialized)" or "Bulk
 * Stock"), so this page cannot drift from the Assets tab strip it feeds.
 */
const CATEGORY_TYPES: CatalogType[] = ['serialized', 'bulk', 'consumable', 'part', 'labor'];

/**
 * Categories (core) — port of the prototype's `renderCategories`
 * (js/pages/categories.js): a type tab strip with counts, a category grid
 * (Active / Items / rename / remove) and the add + rename modals.
 */
@Component({
  selector: 'ims-categories',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent, TipDirective],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss',
})
export class CategoriesComponent {
  type: CatalogType = 'serialized';

  /** Add / rename modal state. */
  modalOpen = false;
  renameFrom: string | null = null;
  formName = '';
  formActive = true;
  /** Editor values as they were when it opened (drives the discard prompt). */
  private formSnap = '';

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;
  /** Record behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: CategoryOption | null = null;

  constructor(readonly data: DataService) {
    // Open on a tab this vertical actually has: a warehouse has no serialized tab.
    this.type = this.tabs()[0].key;
  }

  /**
   * The tab strip: this page's five types, named and iconed by the tenant's
   * vertical (see `core/vertical-metadata.ts`), so a vertical that doesn't carry a
   * type at all (a warehouse has no machines) doesn't leave an empty tab here.
   */
  tabs(): CategoryTab[] {
    const meta = this.data.verticalMeta();
    return meta.tabs
      .filter((t) => CATEGORY_TYPES.includes(t.key))
      .map((t) => ({ key: t.key, label: t.label, icon: t.icon }));
  }

  records(): CategoryOption[] {
    return this.data.categoryRecordsFor(this.type);
  }

  label(): string {
    return this.tabs().find((t) => t.key === this.type)?.label ?? this.type;
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
    this.formSnap = snapshotForm(this.formValues());
    this.modalOpen = true;
  }

  openRename(c: CategoryOption): void {
    this.renameFrom = c.name;
    this.formName = c.name;
    this.formActive = c.active !== false;
    this.formSnap = snapshotForm(this.formValues());
    this.modalOpen = true;
  }

  /** True when the editor holds edits that Save has not written yet. */
  formDirty(): boolean {
    return formChanged(this.formValues(), this.formSnap);
  }

  /** The editor's values, as compared against the open-time snapshot. */
  private formValues(): { name: string; active: boolean } {
    return { name: this.formName, active: this.formActive };
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
    this.formSnap = '';
  }

  /* --------------------------- record viewer ---------------------------- */

  /** Row click → read-only viewer (row actions keep their own click). */
  showView(e: Event, c: CategoryOption): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = c;
    this.viewer = {
      title: c.name,
      subtitle: this.label(),
      icon: this.tabs().find((t) => t.key === this.type)?.icon ?? 'bi-tags',
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

  /* ------------------------------ tooltips ------------------------------ */

  /** Category row: which catalog type it belongs to and how much uses it. */
  tipCategory(c: CategoryOption): Tip {
    return tip(c.name, [
      { label: 'Catalog', value: this.label() },
      { label: 'Items', value: String(this.itemsIn(c.name)) },
    ], { badge: c.active === false ? 'Inactive' : 'Active', badgeClass: c.active === false ? 'st-out' : 'st-active' });
  }
}
