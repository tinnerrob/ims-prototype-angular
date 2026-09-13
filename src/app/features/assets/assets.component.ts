import { Component, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { FormError, FormsService } from '../../core/forms.service';
import { PageSearchService } from '../../core/page-search.service';
import { CatalogType, Category, FormSchema, ITEM_STATUSES, Item, MOVEMENT_KIND_LABEL, isCountedStock, needsReorder, statusClass } from '../../core/models';
import { ColumnMeta, VerticalTabMeta } from '../../core/vertical-metadata';
import { DynamicFormComponent } from '../../shared/dynamic-form/dynamic-form.component';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, auditSections, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { assetTip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';
import { TablePagerDirective } from '../../shared/table/table-pager.directive';


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
  /** The tenant category row it belongs to (Phase C) — the picker's value. */
  categoryId: '',
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
  /** The schema-captured fields (B2). Always replaced per editor (never shared). */
  attributes: {} as Record<string, unknown>,
};

/**
 * Assets (core) — port of the prototype's Inventory view
 * (js/pages/inventory.js): a category-driven tab strip (Phase C) with per-tab
 * record counts, the per-type column set (fleet telemetry, stock levels, labor
 * rates) and the fields the open category carries.
 */
@Component({
  selector: 'ims-assets',
  standalone: true,
  imports: [FormsModule, DynamicFormComponent, ModalDismissDirective, RecordViewComponent, TipDirective, TablePagerDirective],
  templateUrl: './assets.component.html',
  styleUrl: './assets.component.scss',
})
export class AssetsComponent {
  /**
   * The open **tab** — a category row, not a spine type (Phase C). A business type
   * may hold two categories of the same type ("Pumps" and "Compressors" are both
   * serialized), so the page is keyed on the *category*: selecting one must never
   * select the other.
   */
  categoryId = '';

  /**
   * The spine type behind the open category — what the store's calls take
   * (`listItems`, `createItem`, `isCountedStock`). **Derived**, never a second piece
   * of state: the category is what the reader selected, the type follows it.
   */
  get type(): CatalogType {
    return this.activeCategory()?.type ?? this.data.verticalMeta().defaultTab;
  }

  /** Location scope for the table: '' = anywhere, `NO_LOCATION` = not placed. */
  locationFilter = '';

  modalOpen = false;
  editingId: string | null = null;
  form = { ...BLANK_ITEM_FORM };
  /** Editor values as they were when it opened (drives the discard prompt). */
  private formSnap = '';
  /** Schema-validation errors from the last save attempt (shown by `<ims-dynamic-form>`). */
  formErrors: FormError[] = [];

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

  /** Count editor — a physical count *of one place* (an `adjust` movement). */
  countOpen = false;
  countId = '';
  /** The place that was counted. */
  countLocation = '';
  countQtyInput = 0;
  countNote = '';

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;
  /** Record behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: Item | null = null;

  constructor(
    readonly data: DataService,
    readonly forms: FormsService,
    readonly search: PageSearchService,
  ) {
    // The page opens on the tenant vertical's **first category** (Phase C): the tab
    // strip is the vertical's categories, so the opening tab is a row, not a type.
    this.categoryId = this.tabs()[0]?.id ?? '';
    // The store's revision moves on every write, so the tenant switching business
    // type lands here: when the open tab isn't one this type has, the page follows
    // onto its first category — no reload, no map, nothing to keep in step by hand.
    effect(() => {
      this.data.revision();
      const cats = this.tabs();
      if (cats.some((c) => c.id === this.categoryId)) return;
      // Only a *hidden* tab moves the page: every other write leaves the reader
      // where they are, viewer and all.
      this.categoryId = cats[0]?.id ?? '';
      this.closeViewer();
    });
    // The topbar search box is this page's search: report how many of the active
    // tab's records survive it (the shell shows "shown of total" next to the box).
    this.search.report(() => ({
      shown: this.rows().length,
      total: this.categoryItems(this.activeCategory()).length,
    }));
  }

  /**
   * The tab strip: the **tenant's categories** for the active vertical, in the
   * order the tenant put them (Phase C). The page keeps no map of its own — a new
   * category, a new order or a re-worded tab is a row on the tenant, and the
   * heading below reads the category, not a registry.
   */
  tabs(): Category[] {
    return this.data.categoriesForVertical(this.data.activeVertical()?.id ?? '', true);
  }

  /** The category the open tab is — its icon, label, fields and `type` come from here. */
  activeCategory(): Category | undefined {
    return this.tabs().find((c) => c.id === this.categoryId);
  }

  /**
   * The catalog tab this type's *grid* still reads for its **columns** and
   * **statuses** (Phase C, C6): those become tenant data next, so until then the
   * page reads the registry's tab meta. The **strip**, the **editor's fields** and
   * the **"add" wording** (`addLabel()`) already come from the tenant's categories.
   */
  activeTab(): VerticalTabMeta | undefined {
    return this.data.tabMeta(this.type);
  }

  /** What this vertical calls a catalog row ("Assets", "Supplies"). */
  noun(): string {
    return this.data.verticalMeta().noun;
  }

  /**
   * What the "add" action is called: **`New <title>`**, where the title is the open
   * tab's own — the tenant's category name, so renaming a category renames its
   * button. The registry's fixed `addLabel` ("New Equipment") is only the fallback
   * for a business type that doesn't carry the open type at all.
   */
  addLabel(): string {
    const title = this.activeCategory()?.name ?? this.activeTab()?.label;
    return title ? `New ${title}` : 'Add';
  }

  /**
   * Every row filed under a category, before the grid narrows it (its base — the
   * tab pill counts and the unplaced hint read this).
   */
  private categoryItems(category: Category | undefined): Item[] {
    if (!category) return [];
    return this.data.listItems(category.type).filter((i) => this.inCategory(i, category));
  }

  /**
   * Is the row filed under this category? A row the editor left as "— none —" (or
   * one that predates categories) belongs to the **first** category of its type, so
   * a tab never hides a row that has one.
   */
  private inCategory(item: Item, category: Category): boolean {
    if (item.categoryId) return item.categoryId === category.id;
    return this.tabs().find((c) => c.type === category.type)?.id === category.id;
  }

  /**
   * One tab's records, narrowed by the location scope and the page search. The
   * search spans every tab on this page: a query typed while "Assets (Serialized)"
   * is open also filters the other tabs, so the tab counts say where the matches
   * are.
   */
  private tabRows(category: Category | undefined): Item[] {
    return this.categoryItems(category).filter((i) => this.inLocationScope(i) && this.matchesSearch(i));
  }

  /** The page search's predicate — the fields a row is found by. */
  private matchesSearch(i: Item): boolean {
    return this.search.matches(
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
   * The placement field's label: a counted row's *opening* place while it is new
   * (after that its shelves are written by Move and Count), a person's **home
   * base**, and a plain place for everything else.
   */
  placeFieldLabel(): string {
    if (this.countable() && !this.editingId) return 'Opening place';
    return this.type === 'labor' ? 'Home base' : 'Location';
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
    return this.categoryItems(this.activeCategory()).filter((i) => this.data.placements(i).length === 0).length;
  }

  /** Tab-strip pill: the tab's matching records (its own, all of them when idle). */
  count(category: Category): number {
    return this.tabRows(category).length;
  }

  /** Rows for the active tab, filtered by the location scope and the page search. */
  rows(): Item[] {
    return this.tabRows(this.activeCategory());
  }

  columns(): ColumnMeta[] {
    return this.activeTab()?.columns ?? [];
  }

  /** Switching tabs keeps the page search — it spans every tab (see `tabRows`). */
  selectCategory(category: Category): void {
    this.categoryId = category.id;
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

  /**
   * The categories an item of the open type can be in (Phase C): the active
   * vertical's category rows of that type — the tenant's own rows, not the legacy
   * per-type name list the old picker read.
   */
  categoryOptions(): Category[] {
    return this.tabs().filter((c) => c.type === this.type);
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
          categoryId: item.categoryId ?? '',
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
          attributes: { ...(item.attributes ?? {}) },
        }
      : this.emptyForm();
    this.formSnap = snapshotForm(this.form);
    this.formErrors = [];
    this.modalOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.name.trim()) return;
    // The schema's fields are coerced (typed, undeclared keys dropped) and
    // validated *before* anything is written; a required field blocks the save
    // and shows its message inline (see `docs/PLAN-B.md`, B2).
    const schema = this.itemSchema();
    const attributes = this.forms.coerce(schema, f.attributes);
    this.formErrors = this.forms.validate(schema, attributes);
    if (this.formErrors.length) return;
    const chosen = this.categoryOptions().find((c) => c.id === f.categoryId);
    const patch: Record<string, unknown> = {
      name: f.name,
      // The category row is the join (Phase C); `category` keeps the name the older
      // readers still print, derived from the row so the two cannot disagree.
      category: chosen?.name ?? f.category,
      categoryId: f.categoryId || undefined,
      status: f.status,
      qty: Number(f.qty) || 0,
      rateDaily: Number(f.rateDaily) || 0,
      // Placement is written for **every** type: an empty choice clears the FK
      // rather than storing an empty-string location, so "unplaced" is one fact,
      // not two. For counted stock this is the *opening* place on a new row (and
      // nothing at all on an existing one — see `stockLocked`), because a placed
      // quantity there is a level row. A person's is their home base.
      locationId: f.locationId || undefined,
      attributes,
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

  /**
   * A place to move *stock* between, and a count to correct. A person is neither:
   * labour is not level-tracked (no shelves to split) and has no quantity to
   * count, so their base is set on the row — the editor's Placement field.
   */
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
    this.moveOpen = true;
  }

  moveRow(): Item | undefined {
    return this.data.getItem(this.type, this.moveId);
  }

  closeMove(): void {
    this.moveOpen = false;
    this.moveId = '';
    this.moveFrom = '';
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
    this.data.moveStock(this.type, this.moveId, this.moveFrom, this.moveTo, Number(this.moveQtyInput), this.moveNote.trim());
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
    this.countOpen = true;
  }

  countRow(): Item | undefined {
    return this.data.getItem(this.type, this.countId);
  }

  closeCount(): void {
    this.countOpen = false;
    this.countId = '';
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
    this.data.adjustStock(this.type, this.countId, this.countLocation, Number(this.countQtyInput), this.countNote.trim());
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
    this.formErrors = [];
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
      icon: this.activeCategory()?.icon ?? this.activeTab()?.icon ?? 'bi-box-seam',
      badge: item.status,
      badgeClass: 'st-' + statusClass(item.status),
      sections: [
        {
          title: this.activeCategory()?.name ?? this.activeTab()?.label ?? 'Record',
          fields: this.columns().map((c) => ({
            label: c[1],
            // The viewer has the room the grid doesn't: show where the stock
            // actually is, place by place ("… › Bay A-03: 24 · … › Bay A-07: 6"),
            // so a row split across two bins reads as two facts rather than one.
            value: c[0] === 'locationId' ? this.data.placeBreakdown(item) : this.cell(item, c[0]),
            mono: c[0] === 'id',
          })),
        },
        this.schemaSection(item),
        this.evidenceSection(item),
        // Who set the record up and who last touched it — the two facts the store
        // stamps on every write, so the screen that produces them can read them.
        ...auditSections(item, (id) => this.data.userName(id), (iso) => this.data.fmtDT(iso)),
        this.ledgerSection(item),
      ],
    };
  }

  /** Evidence attached to the record (B8), read through the documents table. */
  private evidenceSection(item: Item): ViewModel['sections'][number] {
    const docs = this.data.documentsFor('item', item.id);
    return {
      title: 'Evidence',
      fields: docs.length
        ? docs.map((doc) => ({ label: doc.kind, value: doc.caption || '—' }))
        : [{ label: 'Documents', value: 'None attached.' }],
    };
  }

  /**
   * A record's schema-captured fields (B2), each read through the schema so the
   * *label* and the *unit* come from the row that declared them. Absent when the
   * type has no schema or the record captured nothing — an empty "Custom fields"
   * heading would be noise.
   */
  private schemaSection(item: Item): ViewModel['sections'][number] {
    // The row's **own** category is what its fields were captured with, so a
    // re-labelled or re-fielded category reads back correctly.
    const category = item.categoryId ? this.data.getCategory(item.categoryId) : undefined;
    const schema = this.itemSchemaFor(category) ?? this.forms.schemaFor('item', item.type) ?? null;
    const fields = (schema?.fields ?? [])
      .filter((f) => item.attributes?.[f.key] !== undefined)
      .map((f) => ({
        label: f.label,
        value: f.kind === 'multiselect'
          ? (Array.isArray(item.attributes?.[f.key]) ? (item.attributes?.[f.key] as unknown[]).join(', ') : String(item.attributes?.[f.key]))
          : `${String(item.attributes?.[f.key])}${f.unit ? ' ' + f.unit : ''}`,
      }));
    return {
      title: 'Custom fields',
      fields: fields.length ? fields : [{ label: 'Captured', value: 'None recorded.' }],
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
      category: '',
      // A new row lands in the tab that is open — that is where the reader asked
      // for it — falling back to the first category the type offers.
      categoryId: this.categoryId || this.categoryOptions()[0]?.id || '',
      // A fresh object every time: the editor writes into it, so it must not be
      // the shared `BLANK_ITEM_FORM.attributes`.
      attributes: {} as Record<string, unknown>,
    };
  }

  /**
   * The item schema a **category** reads: the tenant's stock set unioned with the
   * category's own fields, with the legacy type-scoped schema as the fallback for a
   * type the workspace has no category for. One place, so the editor and a row's
   * viewer can never read different field sets.
   */
  private itemSchemaFor(category: Category | undefined): FormSchema | null {
    if (!category) return null;
    return this.forms.schemaForCategory(category.id) ?? this.forms.schemaFor('item', category.type) ?? null;
  }

  /** The item schema the open tab's editor renders (B2/B3, Phase C). */
  itemSchema(): FormSchema | null {
    return this.itemSchemaFor(this.activeCategory());
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

