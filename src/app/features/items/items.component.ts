import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { PageSearchService } from '../../core/page-search.service';
import { CatalogType, ITEM_STATUSES, Item, needsReorder, statusClass } from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
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
  { key: 'serialized', label: 'Items (Serialized)', icon: 'bi-truck-front', addLabel: 'New Equipment' },
  { key: 'bulk', label: 'Items (Bulk)', icon: 'bi-boxes', addLabel: 'New Bulk Resource' },
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
    ['rateDaily', 'Daily', 'num'], ['status', 'Status'],
  ],
  bulk: [
    ['id', 'SKU'], ['name', 'Name'], ['category', 'Category'], ['totalOwned', 'Total Owned', 'num'],
    ['qtyAvailable', 'Available', 'num'], ['qtyOut', 'Out', 'num'], ['rateDaily', 'Daily', 'num'],
    ['baseMonthly', 'Monthly', 'num'],
  ],
  consumable: [
    ['id', 'SKU'], ['name', 'Name'], ['category', 'Category'], ['qtyOnHand', 'On Hand', 'num'],
    ['reorderPoint', 'Reorder Pt', 'num'], ['costPrice', 'Cost', 'num'], ['retailPrice', 'Retail', 'num'],
    ['status', 'Status'],
  ],
  part: [
    ['id', 'Part ID'], ['name', 'Description'], ['category', 'Category'], ['bin', 'Bin'],
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
    ['rateDaily', 'Rate', 'num'], ['status', 'Status'],
  ],
  attachment: [
    ['id', 'Acc ID'], ['name', 'Name'], ['category', 'Category'], ['qty', 'Qty', 'num'],
    ['rateDaily', 'Daily', 'num'], ['status', 'Status'],
  ],
};

const MONEY_KEYS = ['purchaseValue', 'rateDaily', 'baseMonthly', 'costPrice', 'retailPrice', 'hourlyCost', 'hourlyBillable'];

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
  bin: '',
  role: '',
  hourlyCost: 0,
  hourlyBillable: 0,
};

/**
 * Items & Stock (core) — port of the prototype's Inventory view
 * (js/pages/inventory.js): a vertical-driven tab strip with per-type record
 * counts and the per-type column set (fleet telemetry, stock levels, labor rates).
 */
@Component({
  selector: 'ims-items',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent, TipDirective],
  templateUrl: './items.component.html',
  styleUrl: './items.component.scss',
})
export class ItemsComponent {
  type: CatalogType = 'serialized';

  modalOpen = false;
  editingId: string | null = null;
  form = { ...BLANK_ITEM_FORM };
  /** Editor values as they were when it opened (drives the discard prompt). */
  private formSnap = '';

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;
  /** Record behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: Item | null = null;

  constructor(
    private readonly data: DataService,
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
   * One tab's records, narrowed by the page search. The search spans every tab
   * on this page: a query typed while "Items (Serialized)" is open also filters
   * the other types, so the tab counts say where the matches are.
   */
  private tabRows(type: CatalogType): Item[] {
    return this.data
      .listItems(type)
      .filter((i) =>
        this.search.matches(
          i.id,
          i.name,
          i.category,
          i.status,
          i.serial,
          i.make,
          i.model,
          i.role,
          i.bin,
          i.fuelType,
        ),
      );
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
          bin: item.bin ?? '',
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
        costPrice: Number(f.costPrice) || 0, retailPrice: Number(f.retailPrice) || 0, bin: f.bin,
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
            value: this.cell(item, c[0]),
            mono: c[0] === 'id',
          })),
        },
      ],
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

  /** Inventory row: the asset's specs, its stock and its reorder state. */
  tipItem(item: Item): Tip {
    return assetTip(this.data, item, [
      { label: 'On hand', value: String(item.qty) },
      item.baseWeekly ? { label: 'Weekly', value: this.data.money(item.baseWeekly) } : null,
      item.purchaseValue ? { label: 'Value', value: this.data.money(item.purchaseValue) } : null,
      this.reorder(item) ? 'Below the reorder point' : null,
    ]);
  }
}

