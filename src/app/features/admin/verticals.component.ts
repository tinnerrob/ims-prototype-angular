import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import {
  ASSET_BEHAVIOURS,
  ASSET_BEHAVIOUR_LABEL,
  AssetBehaviour,
  Category,
  duplicateFieldKeys,
  FormField,
  Vertical,
} from '../../core/models';
import { formChanged, snapshotForm } from '../../shared/confirm/unsaved-changes';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { FieldEditorComponent } from '../../shared/field-editor/field-editor.component';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { tip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

/** A deep-enough copy of a field list, so an unsaved edit never touches the row. */
const copyFields = (fields: FormField[]): FormField[] =>
  (fields ?? []).map((f) => ({ ...f, options: f.options ? [...f.options] : undefined }));

const BLANK_CATEGORY = { name: '', icon: 'bi-box', behaviour: 'quantity' as AssetBehaviour, active: true };

/**
 * The Bootstrap Icons a category tab can carry — a curated set (the library has
 * ~2000), grouped by what a catalog tends to hold, so the picker is a dropdown
 * rather than a class name typed from memory.
 */
const CATEGORY_ICONS: string[] = [
  'bi-box',
  'bi-boxes',
  'bi-box-seam',
  'bi-stack',
  'bi-archive',
  'bi-basket',
  'bi-tags',
  'bi-truck-front',
  'bi-truck',
  'bi-wrench-adjustable',
  'bi-tools',
  'bi-nut',
  'bi-gear',
  'bi-puzzle',
  'bi-cpu',
  'bi-hdd-stack',
  'bi-lightning-charge',
  'bi-battery-half',
  'bi-plug',
  'bi-fuel-pump',
  'bi-droplet',
  'bi-fire',
  'bi-thermometer',
  'bi-tree',
  'bi-water',
  'bi-capsule',
  'bi-band-aid',
  'bi-heart-pulse',
  'bi-clipboard-check',
  'bi-clipboard2-pulse',
  'bi-shield-check',
  'bi-person-badge',
  'bi-people',
  'bi-building',
  'bi-diagram-3',
  'bi-grid',
];

/**
 * Administration → Verticals & Categories (Phase C, C4).
 *
 * The authoring screen for the tenant's catalog: create **verticals**, add
 * **categories** to one (its tabs — name, behaviour, icon, order) and edit the
 * **fields** a category carries, plus the **stock set** that applies to every asset.
 * The Assets page reads exactly these rows, so this is where the catalog is defined.
 */
@Component({
  selector: 'ims-admin-verticals',
  standalone: true,
  imports: [FieldEditorComponent, FormsModule, ModalDismissDirective, TipDirective],
  templateUrl: './verticals.component.html',
  styleUrl: './verticals.component.scss',
})
export class VerticalsComponent {
  readonly behaviours = ASSET_BEHAVIOURS;
  readonly behaviourLabel = ASSET_BEHAVIOUR_LABEL;
  readonly icons = CATEGORY_ICONS;

  /**
   * Why the last action was refused, shown inline. `disabled` buttons are not an
   * option inside a clickable row: a disabled button fires no click at all, so the
   * click falls through to the row and opens the editor (see `removeCategory`).
   */
  notice = '';

  /** The same, for a category action — the two cards each say their own reason. */
  categoryNotice = '';

  /** Category editor (add when `categoryId` is null). */
  categoryOpen = false;
  categoryId: string | null = null;
  categoryForm = { ...BLANK_CATEGORY };
  categoryFields: FormField[] = [];
  private categorySnap = '';

  /** Business-type editor: `''` = adding a type, an id = editing that row. */
  verticalOpen = false;
  verticalFormId = '';
  verticalForm = { name: '', slug: '' };

  /** Stock-set editor. */
  stockOpen = false;
  stockFields: FormField[] = [];
  private stockSnap = '';

  constructor(
    readonly data: DataService,
    private readonly confirm: ConfirmService,
  ) {}

  /**
   * **Start clean** (Phase C): wipe the sample catalog so a workspace defines its
   * own categories and fields from nothing. Confirmed, because it is destructive;
   * the workspace itself (locations, partners, settings, business type) is kept.
   */
  async startClean(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Start clean?',
      message:
        'Removes every asset, category and stock field — and the orders, receipts, inspections and other records that name them — so you can define your own catalog. Locations, partners and settings are kept.',
      confirmLabel: 'Start clean',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    this.notice = '';
    this.categoryNotice = '';
    this.data.resetCatalog();
  }

  /* ---------------------------- business type ---------------------------- */

  /** The catalog of business types a workspace can *be*. */
  verticals(): Vertical[] {
    return this.data.listVerticals();
  }

  /** The one this workspace is — its categories are the ones below. */
  myVertical(): Vertical | undefined {
    return this.data.activeVertical();
  }

  isMine(v: Vertical): boolean {
    return this.myVertical()?.id === v.id;
  }

  /** How many items the type's categories hold (its removal guard, and a cell). */
  verticalItemCount(v: Vertical): number {
    const ids = new Set(this.data.categoriesForVertical(v.id).map((c) => c.id));
    return this.data.allItems().filter((i) => i.categoryId && ids.has(i.categoryId)).length;
  }

  /** Why a type cannot be removed — empty when it can. */
  removeBlockers(v: Vertical): string[] {
    return this.data.verticalRemovalBlockers(v.id);
  }

  /**
   * Use a type (a workspace has exactly one). Confirmed, because it changes which
   * tabs the Assets page shows.
   */
  async chooseVertical(v: Vertical): Promise<void> {
    if (this.isMine(v)) return;
    const ok = await this.confirm.ask({
      title: `Use ${v.name}?`,
      message: `Your Assets page will show ${v.name}'s categories. The categories authored under ${this.myVertical()?.name ?? 'your current type'} are kept, and come back if you switch back.`,
      confirmLabel: 'Use this type',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    this.notice = '';
    this.data.setActiveVertical(v.id);
  }

  openAddVertical(): void {
    this.verticalFormId = '';
    this.verticalForm = { name: '', slug: '' };
    this.verticalOpen = true;
  }

  /** Edit a business type's name / handle — the pencil on its row. */
  openEditVertical(v: Vertical): void {
    this.notice = '';
    this.verticalFormId = v.id;
    this.verticalForm = { name: v.name, slug: v.slug };
    this.verticalOpen = true;
  }

  /**
   * The URL handle follows the name while a type is being **added**. An *edit*
   * leaves it alone: a seeded type's slug is what the compiled registry key derives
   * from (`DataService.vertical`), so re-slugging a rename would move its grid's
   * columns and statuses onto the default catalog. Changing the handle stays
   * possible — by typing one — because that is a deliberate act.
   */
  syncSlug(): void {
    if (this.verticalFormId) return;
    this.verticalForm.slug = this.verticalForm.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * A **new** type becomes the workspace's type (it has no categories yet to show);
   * an **edit** just renames the row — the categories hang off its id, so nothing
   * else moves.
   */
  saveVertical(): void {
    const name = this.verticalForm.name.trim();
    const slug = (this.verticalForm.slug || name).trim().toLowerCase();
    if (!name || !slug) return;
    if (this.verticalFormId) {
      this.data.updateVertical(this.verticalFormId, { name, slug });
    } else {
      const v = this.data.createVertical({ name, slug, active: true, isDefault: false });
      this.notice = '';
      this.data.setActiveVertical(v.id);
    }
    this.verticalOpen = false;
  }

  /**
   * Remove a business type, with its categories. Refused while rows still name one
   * of its categories or it is the last type left — and the refusal is *said*, not
   * swallowed (the button stays live: a `disabled` button fires no click, so the
   * click would fall through to the row and switch the workspace instead).
   *
   * Removing the type the workspace is **on** is fine: the store moves it onto the
   * default type, and the categories card below follows.
   */
  removeVertical(v: Vertical): void {
    const blockers = this.removeBlockers(v);
    if (blockers.length) {
      const holdsRows = blockers.some((b) => b.includes('item'));
      this.notice = `${v.name} cannot be removed — it is ${blockers.join(' and ')}. ${
        holdsRows ? 'Move or delete its assets first, or use Start clean.' : 'Add another business type first.'
      }`;
      return;
    }
    this.notice = '';
    this.data.removeVertical(v.id);
  }

  /** Hover text for the remove button (why it will refuse, before it does). */
  removeTitle(v: Vertical): string {
    const blockers = this.removeBlockers(v);
    return blockers.length ? `Cannot be removed — it is ${blockers.join(' and ')}` : `Remove ${v.name}`;
  }

  /* ------------------------------- categories ------------------------------ */

  /** The workspace's type's categories — the tabs the Assets page shows. */
  myCategories(): Category[] {
    return this.data.categoriesForVertical(this.myVertical()?.id ?? '');
  }

  openAddCategory(): void {
    this.categoryNotice = '';
    this.categoryId = null;
    this.categoryForm = { ...BLANK_CATEGORY };
    this.categoryFields = [];
    this.categorySnap = snapshotForm({ ...this.categoryForm, fields: this.categoryFields });
    this.categoryOpen = true;
  }

  openEditCategory(c: Category): void {
    this.categoryId = c.id;
    this.categoryForm = { name: c.name, icon: c.icon, behaviour: c.behaviour, active: c.active };
    this.categoryFields = copyFields(c.fields);
    this.categorySnap = snapshotForm({ ...this.categoryForm, fields: this.categoryFields });
    this.categoryOpen = true;
  }

  categoryDirty(): boolean {
    return formChanged({ ...this.categoryForm, fields: this.categoryFields }, this.categorySnap);
  }

  saveCategory(): void {
    const name = this.categoryForm.name.trim();
    if (!name) return;
    const fields = copyFields(this.categoryFields);
    if (this.categoryId) {
      this.data.updateCategory(this.categoryId, { ...this.categoryForm, name, fields });
    } else {
      const vertical = this.myVertical();
      if (!vertical) return;
      this.data.createCategory(vertical.id, { ...this.categoryForm, name, fields });
    }
    this.closeCategory();
  }

  closeCategory(): void {
    this.categoryOpen = false;
    this.categoryId = null;
    this.categoryFields = [];
    this.categorySnap = '';
  }

  /** Reorder, ignoring a click at either end rather than writing a no-op save. */
  moveCategory(c: Category, delta: number): void {
    const to = c.sort + delta;
    if (to < 0 || to >= this.myCategories().length) return;
    this.data.moveCategory(c.id, to);
  }

  /**
   * A field list can be saved when every key is **named and stated once** — a key
   * identifies a field within its list (see `duplicateFieldKeys`), so two fields
   * sharing one would be two definitions of one fact. The editor marks the rows; the
   * Save buttons below are disabled while any row is bad.
   */
  fieldsValid(fields: FormField[]): boolean {
    return fields.every((f) => !!f.key.trim()) && duplicateFieldKeys(fields).length === 0;
  }

  /**
   * Row tooltip: what the retired Categories viewer showed — the facts about the
   * row and who added / last changed it — without leaving the table.
   */
  categoryTip(c: Category): Tip {
    return tip(
      c.name,
      [
        { label: 'Behaviour', value: this.behaviourLabel[c.behaviour] },
        { label: 'Fields', value: String(c.fields.length) },
        { label: 'Items', value: String(this.data.categoryItemCount(c.id)) },
        { label: 'Added', value: `${this.data.userName(c.createdBy)} · ${this.data.fmtDT(c.createdAt)}` },
        { label: 'Last changed', value: `${this.data.userName(c.updatedBy)} · ${this.data.fmtDT(c.updatedAt)}` },
      ],
      { badge: c.active ? 'Active' : 'Inactive', badgeClass: c.active ? 'st-active' : 'st-out' },
    );
  }

  categoryBlocked(c: Category): boolean {
    return this.data.categoryItemCount(c.id) > 0;
  }

  /**
   * Remove a category. Refused while rows still name it — and the refusal is
   * *said*, not swallowed: the button stays live (a `disabled` button fires no
   * click, so the click would fall through to the row and open the editor).
   */
  removeCategory(c: Category): void {
    const used = this.data.categoryItemCount(c.id);
    if (used > 0) {
      this.categoryNotice = `${c.name} cannot be removed — ${used} asset(s) are still in it. Change their category on the Assets page first.`;
      return;
    }
    this.categoryNotice = '';
    this.data.removeAssetCategory(c.id);
  }

  /* ------------------------------- stock set ------------------------------ */

  openStock(): void {
    this.stockFields = copyFields(this.data.stockSchema().fields);
    this.stockSnap = snapshotForm(this.stockFields);
    this.stockOpen = true;
  }

  stockDirty(): boolean {
    return formChanged(this.stockFields, this.stockSnap);
  }

  saveStock(): void {
    this.data.updateStockSchema(copyFields(this.stockFields));
    this.closeStock();
  }

  closeStock(): void {
    this.stockOpen = false;
    this.stockFields = [];
    this.stockSnap = '';
  }
}
