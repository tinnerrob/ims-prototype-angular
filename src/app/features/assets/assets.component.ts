import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { PageSearchService } from '../../core/page-search.service';
import { CatalogType, ITEM_STATUSES, Item, MOVEMENT_KIND_LABEL, isCountedStock, needsReorder, statusClass } from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, auditSections, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { assetTip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

interface InvTab {
  key: CatalogType;
  label: string;
  icon: string;
  addLabel: string;
}

/** Tab strip (prototype `INV_TABS`). */
const INV_TABS: InvTab[] = [
  { key: 'serialized', label: 'Assets (Serialized)', icon: 'bi-truck-front', addLabel: 'New Equipment' },
  { key: 'bulk', label: 'Assets (Bulk)', icon: 'bi-boxes', addLabel: 'New Bulk Resource' },
  { key: 'consumable', label: 'Consumables', icon: 'bi-capsule', addLabel: 'New Consumable' },
  { key: 'part', label: 'Stock Inventory', icon: 'bi-wrench-adjustable', addLabel: 'New Part' },
  { key: 'labor', label: 'Labor / Employees', icon: 'bi-person-badge', addLabel: 'New Labor Item' },
  { key: 'kit', label: 'Kits', icon: 'bi-boxes', addLabel: 'New Kit' },
  { key: 'attachment', label: 'Attachments', icon: 'bi-puzzle', addLabel: 'New Attachment' },
];

/** Which tabs a vertical exposes (prototype `VERTICAL_INV_TABS`). */
const VERTICAL_TABS: Record<string, CatalogType[]> = {
  HeavyEquipment: ['serialized', 'bulk', 'consumable', 'part', 'labor', 'attachment', 'kit'],
  Rental: ['serialized', 'bulk', 'consumable', 'part', 'labor', 'kit'],
  Healthcare: ['bulk', 'consumable', 'part', 'labor'],
  Lumberyard: ['bulk', 'consumable', 'part', 'labor'],
  Warehouse: ['bulk', 'consumable', 'part', 'labor'],
};

/** [key, header, align] — per-type column set (prototype grid descriptors). */
type Col = [string, string, ('num' | 'text-end')?];

const COLUMNS: Record<string, Col[]> = {
  serialized: [
    ['id', 'Item ID'], ['serial', 'Serial / VIN'], ['name', 'Name / Model'], ['category', 'Category'],
    ['meterHours', 'Meter Hrs', 'num'], ['fuelType', 'Fuel'], ['purchaseValue', 'Purchase Value', 'num'],
    ['rateDaily', 'Daily', 'num'], ['locationId', 'Location'], ['status', 'Status'],
  ],
  bulk: [
    ['id', 'SKU'], ['name', 'Name'], ['category', 'Category'], ['totalOwned', 'Total Owned', 'num'],
    ['qtyAvailable', 'Available', 'num'], ['qtyOut', 'Out', 'num'], ['locationId', 'Location'],
    ['rateDaily', 'Daily', 'num'], ['baseMonthly', 'Monthly', 'num'],
  ],
  consumable: [
    ['id', 'SKU'], ['name', 'Name'], ['category', 'Category'], ['qtyOnHand', 'On Hand', 'num'],
    ['reorderPoint', 'Reorder Pt', 'num'], ['costPrice', 'Cost', 'num'], ['retailPrice', 'Retail', 'num'],
    ['locationId', 'Location'], ['status', 'Status'],
  ],
  part: [
    ['id', 'Part ID'], ['name', 'Description'], ['category', 'Category'], ['locationId', 'Location'],
    ['qtyOnHand', 'On Hand', 'num'], ['reorderPoint', 'Reorder Pt', 'num'], ['costPrice', 'Cost', 'num'],
    ['status', 'Status'],
  ],
  labor: [
    ['id', 'Emp ID'], ['name', 'Name'], ['role', 'Role'], ['category', 'Category'],
    ['hourlyCost', 'Cost / hr', 'num'], ['hourlyBillable', 'Billable / hr', 'num'],
    ['spread', 'Spread / hr', 'num'], ['status', 'Status'],
  ],
  kit: [
    ['id', 'Kit ID'], ['name', 'Name'], ['category', 'Category'], ['qty', 'Qty', 'num'],
    ['rateDaily', 'Rate', 'num'], ['locationId', 'Location'], ['status', 'Status'],
  ],
  attachment: [
    ['id', 'Acc ID'], ['name', 'Name'], ['category', 'Category'], ['qty', 'Qty', 'num'],
    ['rateDaily', 'Daily', 'num'], ['locationId', 'Location'], ['status', 'Status'],
  ],
};

const MONEY_KEYS = ['purchaseValue', 'rateDaily', 'baseMonthly', 'costPrice', 'retailPrice', 'hourlyCost', 'hourlyBillable'];

/**
 * Sentinel for the location scope's "not placed yet" choice. A real location id
 * is never this, so the select's value can be compared directly.
 */
const NO_LOCATION = '__none__';

/**
 * Data-free blank editor form. Class field initializers run *before* the
 * constructor assigns parameter properties, so the initial value must not read
 * `this.data` — `emptyForm()` layers the data-derived defaults on top when the
 * editor opens.
 */
const BLANK_ITEM_FORM = {
  name: '',
  category: '',
  status: 'Available' as Item['status'],
  qty: 1,
  rateDaily: 0,
  make: '',
  model: '',
  serial: '',
  meterHours: 0,
  fuelType: '',
  purchaseValue: 0,
  qtyOnHand: 0,
  reorderPoint: 0,
  costPrice: 0,
  retailPrice: 0,
  locationId: '',
  role: '',
  hourlyCost: 0,
  hourlyBillable: 0,
};

/**
 * Assets (core) — port of the prototype's Inventory view
 * (js/pages/inventory.js): a vertical-driven tab strip with per-type record
 * counts and the per-type column set (fleet telemetry, stock levels, labor rates).
 */
@Component({
  selector: 'ims-assets',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent, TipDirective],
  templateUrl: './assets.component.html',
  styleUrl: './assets.component.scss',
})
export class AssetsComponent {
  type: CatalogType = 'serialized';

  /** Location scope for the table: '' = anywhere, `NO_LOCATION` = not placed. */
  locationFilter = '';

  modalOpen = false;
  editingId: string | null = null;
  form = { ...BLANK_ITEM_FORM };
  /** Editor values as they were when it opened (drives the discard prompt). */
  private formSnap = '';

  /**
   * Move editor — the ledger-writing placement change (a `transfer` movement).
   * The item editor's Location field still re-homes a row, but quietly; this is
   * the action that says where it came from, for stock that walks between bins.
   */
  moveOpen = false;
  moveId = '';
  moveTo = '';
  moveNote = '';

  /** Count editor — a physical count correction (an `adjust` movement). */
  countOpen = false;
  countId = '';
  countQtyInput = 0;
  countNote = '';

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;
  /** Record behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: Item | null = null;

  constructor(
    readonly data: DataService,
    readonly search: PageSearchService,
  ) {
    // The topbar search box is this page's search: report how many of the active
    // tab's records survive it (the shell shows "shown of total" next to the box).
    this.search.report(() => ({
      shown: this.rows().length,
      total: this.data.listItems(this.type).length,
    }));
  }

  /** Tabs for the active vertical (prototype `invTabKeys()`). */
  tabs(): InvTab[] {
    const allowed = VERTICAL_TABS[this.data.vertical] ?? VERTICAL_TABS['HeavyEquipment'];
    return INV_TABS.filter((t) => allowed.includes(t.key));
  }

  activeTab(): InvTab | undefined {
    return this.tabs().find((t) => t.key === this.type);
  }

  /**
   * One tab's records, narrowed by the location scope and the page search. The
   * search spans every tab on this page: a query typed while "Assets (Serialized)"
   * is open also filters the other types, so the tab counts say where the
   * matches are.
   */
  private tabRows(type: CatalogType): Item[] {
    return this.data
      .listItems(type)
      .filter(
        (i) =>
          this.inLocationScope(i) &&
          this.search.matches(
            i.id,
            i.name,
            i.category,
            i.status,
            i.serial,
            i.make,
            i.model,
            i.role,
            // The whole path, so "Aisle 1" finds the bays' stock as well — and the
            // raw id, so a location can be pasted in from the Locations grid.
            this.data.locationPath(i.locationId),
            i.locationId,
            i.fuelType,
          ),
      );
  }

  /**
   * Does the row fall inside the location scope? A location choice covers its
   * whole subtree (filtering by a warehouse shows its aisles' bins), which is
   * the question a stock count per place has to answer.
   */
  private inLocationScope(item: Item): boolean {
    const f = this.locationFilter;
    if (!f) return true;
    if (f === NO_LOCATION) return !item.locationId;
    return !!item.locationId && this.data.locationSubtreeIds(f).has(item.locationId);
  }

  /** Location choices for the scope select (indented, hierarchy order). */
  locationOptions(): { id: string; label: string }[] {
    return this.data.locationOptions();
  }

  /** Where the editor's current choice actually sits (the modal's echo line). */
  placePath(): string {
    return this.data.locationPath(this.form.locationId);
  }

  /** The scope select's "not placed" value (a template can't read the const). */
  readonly noLocation = NO_LOCATION;

  /** How many of the active tab's records are unplaced (the scope select hint). */
  unplacedCount(): number {
    return this.data.listItems(this.type).filter((i) => !i.locationId).length;
  }

  /** Tab-strip pill: matching records of that type (all of them when idle). */
  count(type: CatalogType): number {
    return this.tabRows(type).length;
  }

  /** Rows for the active tab, filtered by the page search. */
  rows(): Item[] {
    return this.tabRows(this.type);
  }

  columns(): Col[] {
    return COLUMNS[this.type] ?? COLUMNS['attachment'];
  }

  /** Switching tabs keeps the page search — it spans every tab (see `tabRows`). */
  selectType(t: CatalogType): void {
    this.type = t;
    this.closeViewer();
  }

  /** Cell text for a column (template stays branch-free). */
  cell(item: Item, key: string): string {
    const raw = (item as unknown as Record<string, unknown>)[key];
    if (key === 'locationId') return this.data.locationLabel(item.locationId);
    if (key === 'spread') {
      return this.data.money((item.hourlyBillable ?? 0) - (item.hourlyCost ?? 0));
    }
    if (MONEY_KEYS.includes(key)) {
      return raw ? this.data.money(raw as number) : '—';
    }
    if (raw === undefined || raw === null || raw === '') return '—';
    if (typeof raw === 'number') return this.data.int(raw);
    return String(raw);
  }

  isStatus(key: string): boolean {
    return key === 'status';
  }

  badge(item: Item): string {
    return 'badge-status st-' + statusClass(item.status);
  }

  /** Low-stock highlight for consumables / parts (prototype reorder warning). */
  reorder(item: Item): boolean {
    return needsReorder(item);
  }

  categories(): string[] {
    return this.data.categoriesFor(this.type);
  }

  /** Status options offered for the active type (prototype `ITEM_STATUSES`). */
  statusesForType(): Item['status'][] {
    return ITEM_STATUSES[this.type];
  }

  /* ------------------------------- editor ------------------------------- */

  openForm(item?: Item): void {
    this.editingId = item ? item.id : null;
    this.form = item
      ? {
          name: item.name,
          category: item.category,
          status: item.status,
          qty: item.qty,
          rateDaily: item.rateDaily,
          make: item.make ?? '',
          model: item.model ?? '',
          serial: item.serial ?? '',
          meterHours: item.meterHours ?? 0,
          fuelType: item.fuelType ?? '',
          purchaseValue: item.purchaseValue ?? 0,
          qtyOnHand: item.qtyOnHand ?? item.qty,
          reorderPoint: item.reorderPoint ?? 0,
          costPrice: item.costPrice ?? 0,
          retailPrice: item.retailPrice ?? 0,
          locationId: item.locationId ?? '',
          role: item.role ?? '',
          hourlyCost: item.hourlyCost ?? 0,
          hourlyBillable: item.hourlyBillable ?? 0,
        }
      : this.emptyForm();
    this.formSnap = snapshotForm(this.form);
    this.modalOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.name.trim()) return;
    const patch: Record<string, unknown> = {
      name: f.name,
      category: f.category,
      status: f.status,
      qty: Number(f.qty) || 0,
      rateDaily: Number(f.rateDaily) || 0,
      // Placement is written for every type that has a place (labour has none):
      // an empty choice clears the FK rather than storing an empty-string
      // location, so "unplaced" is one fact, not two.
      locationId: f.locationId || undefined,
    };
    if (this.type === 'serialized') {
      Object.assign(patch, {
        make: f.make, model: f.model, serial: f.serial,
        meterHours: Number(f.meterHours) || 0, fuelType: f.fuelType,
        purchaseValue: Number(f.purchaseValue) || 0,
      });
    }
    if (this.type === 'consumable' || this.type === 'part') {
      Object.assign(patch, {
        qtyOnHand: Number(f.qtyOnHand) || 0, reorderPoint: Number(f.reorderPoint) || 0,
        costPrice: Number(f.costPrice) || 0, retailPrice: Number(f.retailPrice) || 0,
      });
    }
    if (this.type === 'labor') {
      Object.assign(patch, {
        role: f.role, hourlyCost: Number(f.hourlyCost) || 0, hourlyBillable: Number(f.hourlyBillable) || 0,
      });
    }
    if (this.editingId) this.data.updateItem(this.type, this.editingId, patch as Partial<Item>);
    else this.data.createItem(this.type, patch as unknown as Omit<Item, 'type' | 'id'>);
    this.closeForm();
  }

  remove(item: Item): void {
    this.data.removeItem(this.type, item.id);
  }

  /* ------------------------- place & count (ledger) --------------------- */

  /**
   * The two corrections a stock row gets by hand, each of which *writes* the
   * ledger through the store (`moveStock` / `adjustStock`) instead of quietly
   * editing a field: an item's place and its count both have a history, and the
   * row's own record view reads that history back (see `ledgerFields`).
   */

  /** Labor is a person, so it has no place to move and no count to correct. */
  movable(): boolean {
    return this.type !== 'labor';
  }

  /** Only counted stock is corrected in place — units arrive as whole rows. */
  countable(): boolean {
    return isCountedStock(this.type);
  }

  openMove(item: Item): void {
    this.moveId = item.id;
    this.moveTo = '';
    this.moveNote = '';
    this.moveOpen = true;
  }

  moveRow(): Item | undefined {
    return this.data.getItem(this.type, this.moveId);
  }

  closeMove(): void {
    this.moveOpen = false;
    this.moveId = '';
  }

  /** A move needs a destination that is real and differs from the current one. */
  moveReady(): boolean {
    const item = this.moveRow();
    return !!item && !!this.moveTo && this.moveTo !== item.locationId && !!this.data.getLocation(this.moveTo);
  }

  saveMove(): void {
    if (!this.moveReady()) return;
    this.data.moveStock(this.type, this.moveId, this.moveTo, this.moveNote.trim());
    this.closeMove();
  }

  openCount(item: Item): void {
    this.countId = item.id;
    // Prefill with what the row holds now: a count is usually a small correction,
    // and an empty box would read as "counted zero".
    this.countQtyInput = this.cellQty(item);
    this.countNote = '';
    this.countOpen = true;
  }

  countRow(): Item | undefined {
    return this.data.getItem(this.type, this.countId);
  }

  closeCount(): void {
    this.countOpen = false;
    this.countId = '';
  }

  countDelta(): number {
    const item = this.countRow();
    return item ? (Number(this.countQtyInput) || 0) - this.cellQty(item) : 0;
  }

  /** A count of what is already recorded has nothing to log. */
  countReady(): boolean {
    return !!this.countRow() && Number(this.countQtyInput) >= 0 && this.countDelta() !== 0;
  }

  saveCount(): void {
    if (!this.countReady()) return;
    this.data.adjustStock(this.type, this.countId, Number(this.countQtyInput), this.countNote.trim());
    this.closeCount();
  }

  /** The number a count compares against — the row's live quantity. */
  cellQty(item: Item): number {
    return item.type === 'bulk' ? item.qtyAvailable ?? item.totalOwned ?? item.qty : item.qtyOnHand ?? item.qty;
  }

  /** Quantity the open move would relocate (the whole row's count). */
  moveQty(): number {
    const item = this.moveRow();
    return item ? this.cellQty(item) : 0;
  }

  /** What the open count compares against, for the modal's read-only field. */
  countOnRecord(): number {
    const item = this.countRow();
    return item ? this.cellQty(item) : 0;
  }

  /** True when the editor holds edits that Save has not written yet. */
  formDirty(): boolean {
    return formChanged(this.form, this.formSnap);
  }

  closeForm(): void {
    this.modalOpen = false;
    this.editingId = null;
    this.formSnap = '';
  }

  /* --------------------------- record viewer ---------------------------- */

  /**
   * Row click → read-only viewer. The fields mirror the table's per-type column
   * set, so the viewer shows exactly what the row showed (plus the low-stock
   * warning) without duplicating the formatting rules.
   */
  showView(e: Event, item: Item): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = item;
    this.viewer = {
      title: item.name,
      subtitle: `${item.id} · ${item.category}`,
      icon: this.activeTab()?.icon ?? 'bi-box-seam',
      badge: item.status,
      badgeClass: 'st-' + statusClass(item.status),
      sections: [
        {
          title: this.activeTab()?.label ?? 'Record',
          fields: this.columns().map((c) => ({
            label: c[1],
            // The viewer has the room the grid doesn't: show the full path
            // ("Warehouse 1 › Aisle 1 › Bay A-03") so the place is unambiguous.
            value: c[0] === 'locationId' ? this.data.locationPath(item.locationId) : this.cell(item, c[0]),
            mono: c[0] === 'id',
          })),
        },
        // Who set the record up and who last touched it — the two facts the store
        // stamps on every write, so the screen that produces them can read them.
        ...auditSections(item, (id) => this.data.userName(id), (iso) => this.data.fmtDT(iso)),
        this.ledgerSection(item),
      ],
    };
  }

  /**
   * The row's ledger — every movement this item is on, newest first. It is here
   * because a count correction and a move are *movements* (see `moveStock` /
   * `adjustStock`), so the record that produced one can show it: without this the
   * only proof a count ever happened would be a number that changed.
   */
  private ledgerSection(item: Item): ViewModel['sections'][number] {
    const moves = this.data.movementsFor(item.type, item.id).slice(0, 6);
    return {
      title: 'Ledger',
      fields: moves.length
        ? moves.map((m) => ({
            label: `${MOVEMENT_KIND_LABEL[m.kind]} · ${m.qty > 0 ? '+' : ''}${m.qty}`,
            value: `${this.data.fmtDT(m.at)} · ${this.data.locationPath(m.locationId)} · ${this.data.userName(m.byUserId)}${
              m.note ? ` · ${m.note}` : ''
            }`,
          }))
        : [{ label: 'Movements', value: 'None — this row has not moved yet.' }],
    };
  }

  closeViewer(): void {
    this.viewer = null;
    this.viewing = null;
  }

  /** Viewer footer Edit → reopen the item editor for the shown record. */
  editFromViewer(): void {
    const item = this.viewing;
    this.closeViewer();
    if (item) this.openForm(item);
  }

  private emptyForm() {
    return { ...BLANK_ITEM_FORM, category: this.data.categoriesFor(this.type)[0] ?? '' };
  }

  /* ------------------------------ tooltips ------------------------------ */

  /** Inventory row: the asset's specs, its stock, its place and its reorder state. */
  tipItem(item: Item): Tip {
    return assetTip(this.data, item, [
      { label: 'On hand', value: String(item.qty) },
      item.locationId ? { label: 'Location', value: this.data.locationPath(item.locationId) } : null,
      item.baseWeekly ? { label: 'Weekly', value: this.data.money(item.baseWeekly) } : null,
      item.purchaseValue ? { label: 'Value', value: this.data.money(item.purchaseValue) } : null,
      this.reorder(item) ? 'Below the reorder point' : null,
    ]);
  }
}

