import { Component, Inject, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiAdapter, IMS_API } from '../../core/api';
import { PageSearchService } from '../../core/page-search.service';
import { CatalogType, ITEM_STATUSES, Item, MOVEMENT_KIND_LABEL, StockCountRefusal, StockMoveRefusal, isCountedStock, needsReorder, statusClass } from '../../core/models';
import { ColumnMeta, VerticalTabMeta } from '../../core/vertical-metadata';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, auditSections, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { assetTip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';


const MONEY_KEYS = ['purchaseValue', 'rateDaily', 'baseMonthly', 'costPrice', 'retailPrice', 'hourlyCost', 'hourlyBillable'];

/*
 * What the store's reasons say on the two stock corrections (C2). Both forms already
 * disable Save while the rule they can see fails (`moveReady()` / `countReady()`), so
 * these lines are for the case that gate cannot see: the shelf changed after the page
 * was drawn — somebody else moved it, or the row was removed — which is exactly why
 * the store, not the form, is the authority.
 */
const MOVE_REFUSAL: Record<StockMoveRefusal, string> = {
  missing: 'That row is already gone — it was removed somewhere else. Reload to see the catalog.',
  'not-stock': 'Labour is a person, not stock: there is no shelf to move it from.',
  'unknown-place': 'A move needs a place that exists on both ends.',
  'same-place': 'That is where the stock already is — a move to the same place records nothing.',
  'out-on-rent': 'That unit is out on a job, so it is not on a shelf. It comes back with the return movement.',
  'bad-quantity': 'Enter a positive whole number to move.',
  'not-held': 'That place does not hold that much — you can move what is there, never more.',
  'partial-unit': 'A kit or attachment is one row in one place, so it moves whole or not at all.',
};

const COUNT_REFUSAL: Record<StockCountRefusal, string> = {
  missing: 'That row is already gone — it was removed somewhere else. Reload to see the catalog.',
  'not-counted': 'A unit-held row is counted by its own row, not per place — edit the row instead.',
  'unknown-place': 'Count at a place that exists.',
  'bad-quantity': 'A count is a whole number, and never negative.',
  'no-change': 'The count matches what is recorded, so there is nothing to log.',
};

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
   * The item editor's Location field still re-homes a *unit* row, but quietly;
   * this is the action that says where the stock came from and how much of it
   * went, so a part split across two bins can be moved a bin at a time.
   */
  moveOpen = false;
  moveId = '';
  /** The place the stock leaves (one of the row's own places). */
  moveFrom = '';
  /** How much leaves it — up to everything that place holds. */
  moveQtyInput = 0;
  moveTo = '';
  moveNote = '';
  /** Why the store refused the last move (C2), printed in the move editor ('' = none). */
  moveRefusal = '';

  /** Count editor — a physical count *of one place* (an `adjust` movement). */
  countOpen = false;
  countId = '';
  /** The place that was counted. */
  countLocation = '';
  countQtyInput = 0;
  countNote = '';
  /** Why the store refused the last count (C2), printed in the count editor ('' = none). */
  countRefusal = '';

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;
  /** Record behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: Item | null = null;

  constructor(
    @Inject(IMS_API) readonly data: ApiAdapter,
    readonly search: PageSearchService,
  ) {
    // The page opens on the vertical's own first tab (Healthcare lands on
    // Supplies, a warehouse on stock), not on a hard-coded type.
    this.type = this.data.verticalMeta().defaultTab;
    // The store's revision moves on every write, so the tenant switching vertical
    // (Admin → Feature Modules) lands here: when the open tab isn't one this
    // vertical has, the page follows the tenant onto its default tab — no reload,
    // no vertical map, nothing to keep in step by hand.
    effect(() => {
      this.data.revision();
      const meta = this.data.verticalMeta();
      if (meta.tabs.some((t) => t.key === this.type)) return;
      // Only a *hidden* tab moves the page: every other write leaves the reader
      // where they are, viewer and all.
      this.type = meta.defaultTab;
      this.closeViewer();
    });
    // The topbar search box is this page's search: report how many of the active
    // tab's records survive it (the shell shows "shown of total" next to the box).
    this.search.report(() => ({
      shown: this.rows().length,
      total: this.data.listItems(this.type).length,
    }));
  }

  /**
   * The tabs this vertical exposes, in its own order, straight from the tenant's
   * registry (`core/vertical-metadata.ts` → `DataService.verticalMeta()`). The
   * page keeps no vertical map of its own: a new industry, a new tab order or a
   * re-worded tab is data on the tenant, not a conditional here.
   */
  tabs(): VerticalTabMeta[] {
    return this.data.verticalMeta().tabs;
  }

  activeTab(): VerticalTabMeta | undefined {
    return this.data.tabMeta(this.type);
  }

  /** What this vertical calls a catalog row ("Assets", "Supplies"). */
  noun(): string {
    return this.data.verticalMeta().noun;
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
            // raw id, so a location can be pasted in from the Locations grid. Every
            // *place* the row holds stock in, since a split row lives in several.
            ...this.data.placements(i).flatMap((p) => [this.data.locationPath(p.locationId), p.locationId]),
            i.locationId,
            i.fuelType,
          ),
      );
  }

  /**
   * Does the row fall inside the location scope? A location choice covers its
   * whole subtree (filtering by a warehouse shows its aisles' bins), which is
   * the question a stock count per place has to answer — and it is asked of the
   * row's *places*, so a part stocked in two bins shows up under either.
   */
  private inLocationScope(item: Item): boolean {
    const f = this.locationFilter;
    const places = this.data.placements(item);
    if (!f) return true;
    if (f === NO_LOCATION) return places.length === 0;
    const inScope = this.data.locationSubtreeIds(f);
    return places.some((p) => inScope.has(p.locationId));
  }

  /** Location choices for the scope select (indented, hierarchy order). */
  locationOptions(): { id: string; label: string }[] {
    return this.data.locationOptions();
  }

  /** Where the editor's current choice actually sits (the modal's echo line). */
  placePath(): string {
    return this.data.locationPath(this.form.locationId);
  }

  /**
   * True when the editor may *not* set the stock fields: a counted row that
   * already exists. Its quantities are its level rows' sum and its place is
   * their busiest holding (see `StockLevel`), so the editor shows them read-only
   * and Move / Count are the actions that change them — a form field that could
   * move stock would be a number nobody could account for later.
   */
  stockLocked(): boolean {
    return isCountedStock(this.type) && !!this.editingId;
  }

  /** The scope select's "not placed" value (a template can't read the const). */
  readonly noLocation = NO_LOCATION;

  /** How many of the active tab's records are unplaced (the scope select hint). */
  unplacedCount(): number {
    return this.data.listItems(this.type).filter((i) => this.data.placements(i).length === 0).length;
  }

  /** Tab-strip pill: matching records of that type (all of them when idle). */
  count(type: CatalogType): number {
    return this.tabRows(type).length;
  }

  /** Rows for the active tab, filtered by the page search. */
  rows(): Item[] {
    return this.tabRows(this.type);
  }

  columns(): ColumnMeta[] {
    return this.activeTab()?.columns ?? [];
  }

  /** Switching tabs keeps the page search — it spans every tab (see `tabRows`). */
  selectType(t: CatalogType): void {
    this.type = t;
    this.closeViewer();
  }

  /** Cell text for a column (template stays branch-free). */
  cell(item: Item, key: string): string {
    const raw = (item as unknown as Record<string, unknown>)[key];
    // The Location column reads the row's *place(s)*: the busiest one normally,
    // and "+N more" the moment the same stock sits somewhere else too — the grid
    // cannot show two places in one cell, so it says how many there are and the
    // tooltip and the record view spell each one out.
    if (key === 'locationId') return this.data.placeLabel(item);
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
      // Placement is written for every type that has a place (labour has none): an
      // empty choice clears the FK rather than storing an empty-string location,
      // so "unplaced" is one fact, not two. For counted stock this is the
      // *opening* place on a new row (and nothing at all on an existing one —
      // see `stockLocked`), because a placed quantity there is a level row.
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

  /**
   * Place & count (ledger) — the two corrections a stock row gets by hand, each
   * of which *writes* the store instead of quietly editing a field:
   *
   * - `moveStock()` moves a quantity from one place to another (part of a row,
   *   or the whole of it), logging a `transfer` at the destination.
   * - `adjustStock()` counts *one place*, logging the signed difference there.
   *
   * Both are per place because a counted row's stock is: `placesOf()` is what the
   * two modals offer, and the row's own record view reads the movements back.
   */

  /** Labor is a person, so it has no place to move and no count to correct. */
  movable(): boolean {
    return this.type !== 'labor';
  }

  /** Only counted stock is corrected in place — units arrive as whole rows. */
  countable(): boolean {
    return isCountedStock(this.type);
  }

  /** A row's stock as (place, qty) — one row per place for counted stock. */
  placesOf(item: Item | undefined): { locationId: string; qty: number; label: string }[] {
    if (!item) return [];
    return this.data.placements(item).map((p) => ({ ...p, label: this.data.locationPath(p.locationId) }));
  }

  openMove(item: Item): void {
    this.moveId = item.id;
    // Default to the row's biggest holding, and to *all* of what is there: a move
    // is usually "this whole bin goes over there", with a split as the exception.
    const first = this.placesOf(item)[0];
    this.moveFrom = first?.locationId ?? '';
    this.moveQtyInput = first?.qty ?? 0;
    this.moveTo = '';
    this.moveNote = '';
    this.moveRefusal = '';
    this.moveOpen = true;
  }

  moveRow(): Item | undefined {
    return this.data.getItem(this.type, this.moveId);
  }

  closeMove(): void {
    this.moveOpen = false;
    this.moveId = '';
    this.moveFrom = '';
    this.moveRefusal = '';
  }

  /** How much of the row sits at the chosen source place. */
  moveHeld(): number {
    const item = this.moveRow();
    return item ? this.data.stockAt(item, this.moveFrom) : 0;
  }

  /** A move needs a real destination, a real source, and a quantity that is there. */
  moveReady(): boolean {
    const item = this.moveRow();
    if (!item || !this.moveFrom || !this.moveTo || this.moveFrom === this.moveTo) return false;
    if (!this.data.getLocation(this.moveFrom) || !this.data.getLocation(this.moveTo)) return false;
    const n = Number(this.moveQtyInput);
    return Number.isFinite(n) && n > 0 && n <= this.moveHeld();
  }

  saveMove(): void {
    if (!this.moveReady()) return;
    // The form's own gate is what it can see; the store is the authority (C2), so its
    // refusal is printed rather than closing the dialog as if the move had happened.
    const moved = this.data.moveStock(this.type, this.moveId, this.moveFrom, this.moveTo, Number(this.moveQtyInput), this.moveNote.trim());
    if (!moved.ok) {
      this.moveRefusal = MOVE_REFUSAL[moved.reason];
      return;
    }
    this.closeMove();
  }

  openCount(item: Item): void {
    this.countId = item.id;
    // A count is per place and usually a small correction, so it starts at the
    // row's busiest place with *that place's* count — not the row's total, which
    // would read as "the whole row is here".
    const home = this.placesOf(item)[0];
    this.countLocation = home?.locationId ?? '';
    this.countQtyInput = home?.qty ?? 0;
    this.countNote = '';
    this.countRefusal = '';
    this.countOpen = true;
  }

  countRow(): Item | undefined {
    return this.data.getItem(this.type, this.countId);
  }

  closeCount(): void {
    this.countOpen = false;
    this.countId = '';
    this.countRefusal = '';
  }

  /** What the chosen place currently holds — the number the count compares to. */
  countOnRecord(): number {
    const item = this.countRow();
    return item ? this.data.stockAt(item, this.countLocation) : 0;
  }

  countDelta(): number {
    return (Number(this.countQtyInput) || 0) - this.countOnRecord();
  }

  /** A count of what is already recorded has nothing to log. */
  countReady(): boolean {
    return !!this.countRow() && !!this.data.getLocation(this.countLocation) && Number(this.countQtyInput) >= 0 && this.countDelta() !== 0;
  }

  saveCount(): void {
    if (!this.countReady()) return;
    const counted = this.data.adjustStock(this.type, this.countId, this.countLocation, Number(this.countQtyInput), this.countNote.trim());
    if (!counted.ok) {
      this.countRefusal = COUNT_REFUSAL[counted.reason];
      return;
    }
    this.closeCount();
  }

  /** Every location, for a count's place picker (stock can be found anywhere). */
  locationChoices(): { id: string; label: string }[] {
    return this.data.locationOptions();
  }

  /** The row the editor has open (the stock it shows read-only is this row's). */
  editingItem(): Item | undefined {
    return this.editingId ? this.data.getItem(this.type, this.editingId) : undefined;
  }

  /** The quantity the open move would relocate (what is at the chosen source). */
  moveQty(): number {
    return this.moveHeld();
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
            // The viewer has the room the grid doesn't: show where the stock
            // actually is, place by place ("… › Bay A-03: 24 · … › Bay A-07: 6"),
            // so a row split across two bins reads as two facts rather than one.
            value: c[0] === 'locationId' ? this.data.placeBreakdown(item) : this.cell(item, c[0]),
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

  /**
   * The blank editor: the data-free skeleton plus the *vertical's* defaults for
   * this tab (its status and opening count — a clinic's supply starts `In Stock`
   * with nothing on the shelf, an excavator starts `Available` and one of it) and
   * the first category the type offers. A new-record default is metadata for the
   * same reason a column is: it is what this industry's records *are*.
   */
  private emptyForm() {
    const tab = this.activeTab();
    return {
      ...BLANK_ITEM_FORM,
      status: tab?.defaults.status ?? BLANK_ITEM_FORM.status,
      qty: tab?.defaults.qty ?? BLANK_ITEM_FORM.qty,
      qtyOnHand: tab?.defaults.qty ?? BLANK_ITEM_FORM.qtyOnHand,
      category: this.data.categoriesFor(this.type)[0] ?? '',
    };
  }

  /* ------------------------------ tooltips ------------------------------ */

  /** Inventory row: the asset's specs, its stock, its place and its reorder state. */
  tipItem(item: Item): Tip {
    const places = this.data.placements(item);
    return assetTip(this.data, item, [
      { label: 'On hand', value: String(item.qty) },
      // A row in more than one place says so, and lists each with its count —
      // the tooltip is the only place a grid cell can be honest about two bins.
      places.length > 1
        ? { label: 'Stock places', value: this.data.placeBreakdown(item) }
        : item.locationId
          ? { label: 'Location', value: this.data.locationPath(item.locationId) }
          : null,
      item.baseWeekly ? { label: 'Weekly', value: this.data.money(item.baseWeekly) } : null,
      item.purchaseValue ? { label: 'Value', value: this.data.money(item.purchaseValue) } : null,
      this.reorder(item) ? 'Below the reorder point' : null,
    ]);
  }
}

