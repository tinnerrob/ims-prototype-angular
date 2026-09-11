import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiAdapter, IMS_API } from '../../core/api';
import { PeriodView, dayAt, mondayOf, periodBounds, periodLabel, periodPhrase } from '../../core/data.service';
import {
  CatalogType,
  Party,
  PURCHASABLE_TYPES,
  PURCHASE_ORDER_STATUSES,
  PO_STATUS_LABEL,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  Receipt,
  isUnitStock,
  statusClass,
} from '../../core/models';
import { PageSearchService } from '../../core/page-search.service';
import { formChanged, snapshotForm } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel, auditSections } from '../../shared/record-view/record-view.component';
import { tip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

/** Which of the page's three sub-tables is showing. */
type Tab = 'suppliers' | 'orders' | 'receipts';

/** The two lists that carry dates, and so carry a period filter. */
type DatedTab = 'orders' | 'receipts';

/** Period filter of a dated list — the inspection log's All/Day/Week/Month chips. */
type ListRange = 'all' | 'day' | 'week' | 'month';

const LIST_RANGES: ListRange[] = ['all', 'day', 'week', 'month'];

const LIST_RANGE_LABEL: Record<ListRange, string> = {
  all: 'All',
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

/** One list's filter: the period chosen, and the cursor its window is built on. */
interface ListFilter {
  range: ListRange;
  anchor: Date;
}

/** One PO line as the editor holds it (the store assigns ids and numbers). */
interface LineForm {
  id: string;
  type: CatalogType;
  refId: string;
  description: string;
  qty: number;
  unitCost: number;
  rateDaily: number;
}

const BLANK_SUPPLIER = {
  name: '',
  contact: '',
  phone: '',
  email: '',
  billingAddress: '',
  billingCycle: 'net-30',
  notes: '',
  active: true,
};

const BLANK_LINE: LineForm = {
  id: '',
  type: 'part',
  refId: '',
  description: '',
  qty: 1,
  unitCost: 0,
  rateDaily: 0,
};

/**
 * Purchasing & Receiving (core) — the buying side of the inventory spine, in
 * three sub-tables behind a tab strip:
 *
 * - **Suppliers**: the partners carrying the `supplier` role (a row in the same
 *   `parties` table the customers live in — see `Party.kinds`).
 * - **Purchase Orders**: what was ordered, with its lines and the *derived*
 *   delivery status (no stored "received" column to go stale).
 * - **Receipts**: the posted documents that brought stock in. Read-only on
 *   purpose: a receipt moved quantities and placed rows, so it is append-only.
 *
 * The "Receive" action on a PO row posts a receipt through
 * `DataService.receiveAgainst()` — the same call the seed uses — which is what
 * makes `qtyOnHand`, the units in the pool and the custody ledger agree.
 *
 * Both document lists also narrow to a **period**: the inspection log's
 * All/Day/Week/Month chips with its `‹ range ›` pager, reading purchase orders by
 * the day they were raised and receipts by the instant they were posted. Each
 * list keeps its own window, because those are two different dates.
 */
@Component({
  selector: 'ims-purchasing',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent, TipDirective],
  templateUrl: './purchasing.component.html',
  styleUrl: './purchasing.component.scss',
})
export class PurchasingComponent {
  readonly statusLabel = PO_STATUS_LABEL;
  readonly statuses = PURCHASE_ORDER_STATUSES;
  readonly purchasable = PURCHASABLE_TYPES;
  readonly tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'suppliers', label: 'Suppliers', icon: 'bi-building' },
    { key: 'orders', label: 'Purchase Orders', icon: 'bi-clipboard-check' },
    { key: 'receipts', label: 'Receipts', icon: 'bi-box-arrow-in-down' },
  ];

  tab: Tab = 'suppliers';

  /** The period-filter chips, and their labels (the inspection log's pair). */
  readonly ranges = LIST_RANGES;
  readonly rangeLabelOf = (v: ListRange): string => LIST_RANGE_LABEL[v];

  /**
   * The period filter of each dated list, with the cursor date its day/week/month
   * window is built on. Suppliers carries no date, so it has none; the two
   * document lists keep their own window, since "what did we order?" is asked of
   * `orderedAt` and "what arrived?" of the receipt's posting instant.
   */
  private readonly listFilters: Record<DatedTab, ListFilter> = {
    orders: { range: 'all', anchor: new Date() },
    receipts: { range: 'all', anchor: new Date() },
  };

  /** Supplier editor (a party row with the supplier role). */
  supplierOpen = false;
  editingSupplierId: string | null = null;
  supplierForm = { ...BLANK_SUPPLIER };
  private supplierSnap = '';

  /** Purchase-order editor. */
  poOpen = false;
  editingPoId: string | null = null;
  poForm = this.emptyPo();
  private poSnap = '';
  /**
   * The cost we last put on a line (A11's default), so a later supplier or item
   * change can recognise a figure *we* supplied and re-default it, while a cost the
   * buyer typed is left alone. Keyed by the form line, and reset with the form.
   */
  private seededCost = new WeakMap<LineForm, number>();

  /** Receiving editor (posts against one PO). */
  receiveOpen = false;
  receivePoId = '';
  receiveLocationId = '';
  receiveNote = '';
  /** Quantity to receive *now*, per PO line id. */
  receiveQty: Record<string, number> = {};

  /** Read-only record viewer (opened by clicking a row). */
  viewer: ViewModel | null = null;

  constructor(
    @Inject(IMS_API) readonly data: ApiAdapter,
    readonly search: PageSearchService,
  ) {
    // One topbar search covers all three sub-tables, so the pill counts what the
    // open one is showing.
    this.search.report(() => ({ shown: this.count(this.tab), total: this.totalCount(this.tab) }));
  }

  /* ------------------------------- shell -------------------------------- */

  selectTab(t: Tab): void {
    this.tab = t;
    this.closeSupplier();
    this.closePo();
    this.closeReceive();
    this.closeViewer();
  }

  count(t: Tab): number {
    if (t === 'suppliers') return this.suppliers().length;
    if (t === 'orders') return this.orders().length;
    return this.receipts().length;
  }

  totalCount(t: Tab): number {
    if (t === 'suppliers') return this.data.supplierParties().length;
    if (t === 'orders') return this.data.listPurchaseOrders().length;
    return this.data.listReceipts().length;
  }

  emptyLabel(t: Tab): string {
    if (t === 'suppliers') return 'No suppliers match.';
    const f = this.filterOf(t);
    // The period is named only when it is the reason — a filtered list that says
    // merely "none" reads as "there are none", which is a different statement.
    if (f && f.range !== 'all' && this.search.isBlank()) {
      const w = periodPhrase(f.range, f.anchor);
      return t === 'orders' ? `No purchase orders ordered for ${w}.` : `No receipts posted for ${w}.`;
    }
    return t === 'orders' ? 'No purchase orders match.' : 'No receipts posted yet.';
  }

  /** Shared badge class for a status string (PO rows derive their own). */
  badge(status: string): string {
    return 'badge-status st-' + statusClass(status);
  }

  /* --------------------------- list period filter ------------------------ */

  /** The filter of a list, or `null` for the undated one (suppliers). */
  private filterOf(t: Tab): ListFilter | null {
    return t === 'orders' || t === 'receipts' ? this.listFilters[t] : null;
  }

  /** The period chip the open list has chosen (the template ticks it). */
  activeRange(): ListRange {
    return this.filterOf(this.tab)?.range ?? 'all';
  }

  /** Is this list narrowed to a day / week / month? */
  rangeFiltered(t: Tab = this.tab): boolean {
    return (this.filterOf(t)?.range ?? 'all') !== 'all';
  }

  /** Label of the open list's window — the pager only renders when filtered. */
  rangeLabel(): string {
    const f = this.filterOf(this.tab);
    if (!f) return '';
    // `All` is never labelled (the pager is hidden), so it reads as the cursor's day.
    const view: PeriodView = f.range === 'all' ? 'day' : f.range;
    return periodLabel(view, f.anchor);
  }

  /**
   * Switch the open list's period, keeping the cursor inside the new window — a
   * week anchors on its Monday and a month on its 1st, so the label names the
   * first day of the period it is about to show (the log's `setLogRange`).
   */
  setRange(v: ListRange): void {
    const f = this.filterOf(this.tab);
    if (!f) return;
    f.range = v;
    if (v === 'month') f.anchor = new Date(f.anchor.getFullYear(), f.anchor.getMonth(), 1);
    else if (v === 'week') f.anchor = mondayOf(f.anchor);
  }

  /** Page the open list's window one day / week / month. */
  shiftRange(dir: number): void {
    const f = this.filterOf(this.tab);
    if (!f || f.range === 'all') return;
    f.anchor =
      f.range === 'month'
        ? new Date(f.anchor.getFullYear(), f.anchor.getMonth() + dir, 1)
        : dayAt(f.anchor, dir * (f.range === 'week' ? 7 : 1));
  }

  /**
   * Does a document fall inside its list's window? `date` is the ISO day the list
   * reads the document by — a receipt carries a full instant, so its caller
   * passes the day it landed on.
   */
  private inRange(t: DatedTab, date: string): boolean {
    const f = this.listFilters[t];
    if (f.range === 'all') return true;
    const b = periodBounds(f.range, f.anchor);
    return date >= b.start && date <= b.end;
  }

  /* ----------------------------- suppliers ------------------------------ */

  suppliers(): Party[] {
    return this.data.supplierParties().filter((p) =>
      this.search.matches(p.id, p.name, p.contact, p.phone, p.email, p.billingAddress, p.billingCycle, p.notes),
    );
  }

  openSupplier(p?: Party): void {
    this.editingSupplierId = p ? p.id : null;
    this.supplierForm = p
      ? {
          name: p.name,
          contact: p.contact,
          phone: p.phone,
          email: p.email,
          billingAddress: p.billingAddress,
          billingCycle: p.billingCycle,
          notes: p.notes,
          active: p.active !== false,
        }
      : { ...BLANK_SUPPLIER };
    this.supplierSnap = snapshotForm(this.supplierForm);
    this.supplierOpen = true;
  }

  supplierDirty(): boolean {
    return formChanged(this.supplierForm, this.supplierSnap);
  }

  saveSupplier(): void {
    const f = this.supplierForm;
    if (!f.name.trim()) return;
    const patch = { ...f, name: f.name.trim() };
    if (this.editingSupplierId) {
      this.data.updateParty(this.editingSupplierId, patch);
    } else {
      // The one role this page knows how to create. A partner that is also a
      // customer keeps its `customer` kind and gains this one.
      this.data.createParty({ ...patch, kinds: ['supplier'] });
    }
    this.closeSupplier();
  }

  removeSupplier(p: Party): void {
    this.data.removeParty(p.id);
  }

  /** Orders placed with a supplier (blocks removal — the PO holds the FK). */
  supplierOrders(p: Party): number {
    return this.data.supplierOrderCount(p.id);
  }

  closeSupplier(): void {
    this.supplierOpen = false;
    this.editingSupplierId = null;
    this.supplierSnap = '';
  }

  /* -------------------------- purchase orders --------------------------- */

  orders(): PurchaseOrder[] {
    return this.data.listPurchaseOrders().filter(
      (po) =>
        // A PO is dated by the day it was raised — the field the list sorts on.
        this.inRange('orders', po.orderedAt) &&
        this.search.matches(
          po.id,
          this.data.partyName(po.supplierId),
          this.data.poStatusLabel(po),
          po.reference,
          po.orderedAt,
          po.expectedAt,
          po.notes,
          ...po.lines.map((l) => `${l.description} ${l.refId ?? ''}`),
        ),
    );
  }

  private emptyPo() {
    return {
      supplierId: '',
      status: 'draft' as PurchaseOrderStatus,
      orderedAt: new Date().toISOString().slice(0, 10),
      expectedAt: '',
      reference: '',
      notes: '',
      lines: [{ ...BLANK_LINE }] as LineForm[],
    };
  }

  openPo(po?: PurchaseOrder): void {
    this.editingPoId = po ? po.id : null;
    this.poForm = po
      ? {
          supplierId: po.supplierId,
          status: po.status,
          orderedAt: po.orderedAt,
          expectedAt: po.expectedAt,
          reference: po.reference ?? '',
          notes: po.notes ?? '',
          lines: po.lines.map((l) => ({
            id: l.id,
            type: l.type,
            refId: l.refId ?? '',
            description: l.description,
            qty: l.qty,
            unitCost: l.unitCost,
            rateDaily: l.rateDaily ?? 0,
          })),
        }
      : { ...this.emptyPo(), supplierId: this.data.supplierParties()[0]?.id ?? '' };
    this.seededCost = new WeakMap<LineForm, number>();
    this.poSnap = snapshotForm(this.poForm);
    this.poOpen = true;
  }

  poDirty(): boolean {
    return formChanged(this.poForm, this.poSnap);
  }

  /** Catalog rows offered for a line of the chosen type (quantity stock only). */
  lineOptions(type: CatalogType): { id: string; label: string }[] {
    return this.data.listItems(type).map((i) => ({ id: i.id, label: `${i.id} · ${i.name}` }));
  }

  isUnit(type: CatalogType): boolean {
    return isUnitStock(type);
  }

  addLine(): void {
    this.poForm.lines = [...this.poForm.lines, { ...BLANK_LINE, type: this.poForm.lines[0]?.type ?? 'part' }];
  }

  removeLine(i: number): void {
    this.poForm.lines = this.poForm.lines.filter((_, n) => n !== i);
  }

  /** Keep a line's description/cost in step with the catalog row it restocks. */
  syncLine(line: LineForm): void {
    const item = line.refId ? this.data.getItem(line.type, line.refId) : undefined;
    if (!item) return;
    line.description = item.name;
    // The supplier's own negotiated price comes before the catalog's (A11) — the
    // card is the cost side's default, and once the PO is raised its stored
    // `unitCost` is the document's fact, so this only ever replaces a *default*:
    // a blank, or a figure we put there ourselves (`seededCost`), never one a
    // person typed. That is what lets a supplier picked *after* the lines were
    // entered still reach them.
    if (this.costIsDefault(line)) this.seedCost(line);
    if (this.isUnit(line.type) && !line.rateDaily) line.rateDaily = item.rateDaily;
  }

  /**
   * Re-default the lines when the supplier changes: a price negotiated with the
   * previous counterparty is no longer this document's starting point, so every
   * line still holding a figure *we* supplied moves to the new supplier's (or back
   * to the catalog). Lines costing what a person typed are left alone — that
   * number is the buyer's, and the change of supplier is not evidence against it.
   *
   * Bound to the select rather than `[(ngModel)]` so the old supplier is still
   * readable in `poForm.supplierId` when the handler runs.
   */
  onSupplierChange(supplierId: string): void {
    const changed = supplierId !== this.poForm.supplierId;
    this.poForm.supplierId = supplierId;
    if (!changed) return;
    for (const line of this.poForm.lines) {
      if (line.refId && this.costIsDefault(line)) this.seedCost(line);
    }
  }

  /** Was this line's cost a figure the form supplied, rather than one typed? */
  private costIsDefault(line: LineForm): boolean {
    return !line.unitCost || line.unitCost === this.seededCost.get(line);
  }

  private seedCost(line: LineForm): void {
    line.unitCost = this.data.poLineCostFor(this.poForm.supplierId, line.type, line.refId);
    this.seededCost.set(line, line.unitCost);
  }

  savePo(): void {
    const f = this.poForm;
    if (!f.supplierId) return;
    const lines: PurchaseOrderLine[] = f.lines.map((l) => ({
      id: l.id,
      type: l.type,
      refId: this.isUnit(l.type) ? undefined : l.refId,
      description: l.description,
      qty: Number(l.qty) || 1,
      unitCost: Number(l.unitCost) || 0,
      rateDaily: this.isUnit(l.type) ? Number(l.rateDaily) || 0 : undefined,
    }));
    const header = {
      supplierId: f.supplierId,
      status: f.status,
      orderedAt: f.orderedAt,
      expectedAt: f.expectedAt || f.orderedAt,
      reference: f.reference,
      notes: f.notes,
      lines,
    };
    if (this.editingPoId) this.data.updatePurchaseOrder(this.editingPoId, header);
    else this.data.createPurchaseOrder(header);
    this.closePo();
  }

  closePo(): void {
    this.poOpen = false;
    this.editingPoId = null;
    this.poSnap = '';
  }

  /** Delivery state of a PO — derived from the receipts (see the store). */
  poLabel(po: PurchaseOrder): string {
    return this.data.poStatusLabel(po);
  }

  poBadge(po: PurchaseOrder): string {
    return 'badge-status ' + this.data.poStatusClass(po);
  }

  /** Share of the ordered value that has arrived (progress bar width). */
  poProgressPct(po: PurchaseOrder): number {
    const total = this.data.poValue(po);
    return total > 0 ? Math.round((this.data.poReceivedValue(po) / total) * 100) : 0;
  }

  /** Lines still to come — the receiving editor's rows. */
  receivable(po: PurchaseOrder): { line: PurchaseOrderLine; outstanding: number }[] {
    return this.data.receivableLines(po);
  }

  /** A PO can be received against while it is ordered and something is missing. */
  canReceive(po: PurchaseOrder): boolean {
    return po.status === 'ordered' && this.receivable(po).length > 0;
  }

  removeTitle(po: PurchaseOrder): string {
    const blockers = this.data.purchaseOrderRemovalBlockers(po.id);
    return blockers.length ? 'Remove — blocked: ' + blockers.join(' and ') : 'Remove';
  }

  removeBlocked(po: PurchaseOrder): boolean {
    return this.data.purchaseOrderRemovalBlockers(po.id).length > 0;
  }

  removePo(po: PurchaseOrder): void {
    this.data.removePurchaseOrder(po.id);
  }

  /* ------------------------------ receiving ----------------------------- */

  /** Open the receiving editor for a PO. */
  openReceive(po: PurchaseOrder): void {
    this.receivePoId = po.id;
    // Default the destination from the first line's own place (restock a SKU
    // where it lives) and every quantity to "all of it" — the usual delivery.
    const first = po.lines[0];
    this.receiveLocationId = (first?.refId ? this.data.getItem(first.type, first.refId)?.locationId : '') ?? '';
    this.receiveQty = {};
    for (const { line, outstanding } of this.receivable(po)) this.receiveQty[line.id] = outstanding;
    this.receiveNote = '';
    this.receiveOpen = true;
  }

  receivePo(): PurchaseOrder | undefined {
    return this.receivePoId ? this.data.getPurchaseOrder(this.receivePoId) : undefined;
  }

  /** Value of what this posting is about to receive. */
  receiveValue(): number {
    const po = this.receivePo();
    if (!po) return 0;
    return this.receivable(po).reduce(
      (sum, { line }) => sum + (Number(this.receiveQty[line.id]) || 0) * line.unitCost,
      0,
    );
  }

  /** How many rows this posting lands (units are rows; quantity stock is a top-up). */
  receiveRows(): number {
    const po = this.receivePo();
    if (!po) return 0;
    return this.receivable(po).reduce((sum, { line }) => {
      const qty = Number(this.receiveQty[line.id]) || 0;
      if (qty <= 0) return sum;
      return sum + (this.isUnit(line.type) ? qty : 1);
    }, 0);
  }

  /** Something positive, and never more than is outstanding. */
  receiveReady(): boolean {
    const po = this.receivePo();
    if (!po || !this.receiveLocationId) return false;
    const sane = this.receivable(po).every(({ line, outstanding }) => {
      const qty = Number(this.receiveQty[line.id]) || 0;
      return qty >= 0 && qty <= outstanding;
    });
    return sane && this.receiveRows() > 0;
  }

  /** Post the receipt — the one call that changes stock. */
  confirmReceive(): void {
    const po = this.receivePo();
    if (!po || !this.receiveReady()) return;
    const qty: Record<string, number> = {};
    for (const { line } of this.receivable(po)) {
      const n = Math.floor(Number(this.receiveQty[line.id]) || 0);
      if (n > 0) qty[line.id] = n;
    }
    const posted = this.data.receiveAgainst({
      poId: po.id,
      locationId: this.receiveLocationId,
      qty,
      note: this.receiveNote.trim(),
    });
    if (posted.ok) {
      this.closeReceive();
      this.showReceipt(posted.value);
    }
  }

  closeReceive(): void {
    this.receiveOpen = false;
    this.receivePoId = '';
    this.receiveLocationId = '';
    this.receiveQty = {};
    this.receiveNote = '';
  }

  /* ------------------------------- receipts ----------------------------- */

  receipts(): Receipt[] {
    return this.data.listReceipts().filter(
      (r) =>
        // A receipt is dated by the instant it was posted; `at` is a full
        // timestamp, so the window test reads its day.
        this.inRange('receipts', r.at.slice(0, 10)) &&
        this.search.matches(
          r.id,
          r.poId,
          this.data.partyName(r.supplierId),
          this.data.locationPath(r.locationId),
          r.note,
          ...r.lines.map((l) => l.refId),
        ),
    );
  }

  /** What a receipt is worth / how much it landed (grid cells). */
  receiptQty(r: Receipt): number {
    return this.data.receiptQty(r);
  }

  receiptValue(r: Receipt): number {
    return this.data.receiptValue(r);
  }

  /* --------------------------- record viewer ---------------------------- */

  showSupplierView(e: Event, p: Party): void {
    if (isInteractiveTarget(e)) return;
    this.viewer = {
      title: p.name,
      subtitle: p.id,
      icon: 'bi-building',
      badge: 'Supplier',
      badgeClass: 'st-on',
      sections: [
        {
          title: 'Contact',
          fields: [
            { label: 'Supplier ID', value: p.id, mono: true },
            { label: 'Roles', value: this.data.partyKindLabel(p) },
            { label: 'Contact', value: p.contact || '—' },
            { label: 'Phone', value: p.phone || '—' },
            { label: 'Email', value: p.email || '—' },
          ],
        },
        {
          title: 'Commercial',
          fields: [
            { label: 'Address', value: p.billingAddress || '—' },
            { label: 'Terms', value: p.billingCycle || '—' },
            { label: 'Purchase Orders', value: String(this.data.supplierOrderCount(p.id)) },
            { label: 'Open Orders', value: String(this.data.supplierOpenOrderCount(p.id)) },
            // Sub-rentals point at this same partner row (`RentalSub.supplierId`),
            // so "what have we taken from them?" is a join, not a name match.
            { label: 'Sub-Rentals', value: String(this.data.rentalsFromSupplier(p.id).length) },
            { label: 'Notes', value: p.notes || '—' },
          ],
        },
        ...auditSections(p, (id) => this.data.userName(id), (iso) => this.data.fmtDT(iso)),
      ],
    };
  }

  showPoView(e: Event, po: PurchaseOrder): void {
    if (isInteractiveTarget(e)) return;
    this.viewer = {
      title: `Purchase Order ${po.id}`,
      subtitle: this.data.partyName(po.supplierId),
      icon: 'bi-clipboard-check',
      badge: this.poLabel(po),
      badgeClass: this.data.poStatusClass(po),
      sections: [
        {
          title: 'Order',
          fields: [
            { label: 'PO', value: po.id, mono: true },
            { label: 'Supplier', value: this.data.partyName(po.supplierId) },
            { label: 'Status', value: this.poLabel(po) },
            { label: 'Ordered', value: this.data.fmtDate(po.orderedAt), mono: true },
            { label: 'Expected', value: this.data.fmtDate(po.expectedAt), mono: true },
            { label: 'Supplier Ref', value: po.reference || '—' },
            { label: 'Ordered Value', value: this.data.money(this.data.poValue(po)) },
            { label: 'Received Value', value: this.data.money(this.data.poReceivedValue(po)) },
            { label: 'Notes', value: po.notes || '—' },
          ],
        },
        {
          // How much of each line arrived is summed from the receipts at read
          // time — the order stores no copy of it.
          title: 'Lines',
          fields: po.lines.map((l) => ({
            label: l.description,
            value: `${this.data.poLineReceived(l.id)} of ${l.qty} received @ ${this.data.money(l.unitCost)}`,
          })),
        },
        ...auditSections(po, (id) => this.data.userName(id), (iso) => this.data.fmtDT(iso)),
      ],
    };
  }

  /** A receipt opens in the viewer — it is immutable, so there is no editor. */
  showReceipt(r: Receipt): void {
    this.viewer = {
      title: `Receipt ${r.id}`,
      subtitle: `${this.data.partyName(r.supplierId)} · ${r.poId}`,
      icon: 'bi-box-arrow-in-down',
      badge: 'Posted',
      badgeClass: 'st-available',
      sections: [
        {
          title: 'Receipt',
          fields: [
            { label: 'Receipt', value: r.id, mono: true },
            { label: 'Purchase Order', value: r.poId, mono: true },
            { label: 'Supplier', value: this.data.partyName(r.supplierId) },
            { label: 'Put Away At', value: this.data.locationPath(r.locationId) },
            { label: 'Posted', value: this.data.fmtDT(r.at), mono: true },
            { label: 'Posted By', value: `${this.data.userName(r.createdBy)} (${r.createdBy})` },
            { label: 'Items', value: String(this.receiptQty(r)) },
            { label: 'Value', value: this.data.money(this.receiptValue(r)) },
            { label: 'Note', value: r.note || '—' },
          ],
        },
        {
          // Each line names the *row* the stock landed on — the receive-side of
          // the item ↔ location spine.
          title: 'Stock Landed',
          fields: r.lines.map((l) => ({
            label: this.data.itemLabel(l.type, l.refId),
            value: `${l.qty} @ ${this.data.money(l.unitCost)} → ${this.data.locationPath(r.locationId)}`,
          })),
        },
        {
          title: 'Ledger',
          fields: [
            {
              label: 'Movements',
              value: String(this.data.listMovements().filter((m) => m.receiptId === r.id).length),
            },
            { label: 'Kind', value: 'Receive — one per landed row' },
          ],
        },
        ...auditSections(r, (id) => this.data.userName(id), (iso) => this.data.fmtDT(iso)),
      ],
    };
  }

  showReceiptView(e: Event, r: Receipt): void {
    if (isInteractiveTarget(e)) return;
    this.showReceipt(r);
  }

  closeViewer(): void {
    this.viewer = null;
  }

  /* ------------------------------ tooltips ------------------------------ */

  /** Supplier row: who they are, and what is on order with them. */
  tipSupplier(p: Party): Tip {
    return tip(p.name, [
      { label: 'Supplier ID', value: p.id },
      { label: 'Contact', value: p.contact || '—' },
      { label: 'Phone', value: p.phone || '—' },
      { label: 'Email', value: p.email || '—' },
      { label: 'Terms', value: p.billingCycle || '—' },
      { label: 'POs', value: String(this.data.supplierOrderCount(p.id)) },
      { label: 'Open', value: String(this.data.supplierOpenOrderCount(p.id)) },
      { label: 'Sub-rentals', value: String(this.data.rentalsFromSupplier(p.id).length) },
    ]);
  }

  /** PO row: the order, its value, and how much of it has arrived. */
  tipPo(po: PurchaseOrder): Tip {
    return tip(`${po.id} - ${this.data.partyName(po.supplierId)}`, [
      { label: 'Status', value: this.poLabel(po) },
      { label: 'Ordered', value: this.data.fmtDate(po.orderedAt) },
      { label: 'Expected', value: this.data.fmtDate(po.expectedAt) },
      { label: 'Lines', value: `${po.lines.length} (${this.receivable(po).length} outstanding)` },
      { label: 'Ordered value', value: this.data.money(this.data.poValue(po)) },
      { label: 'Received value', value: this.data.money(this.data.poReceivedValue(po)) },
      po.reference ? { label: 'Supplier ref', value: po.reference } : null,
    ]);
  }

  /** Receipt row: what arrived, where it went, against what. */
  tipReceipt(r: Receipt): Tip {
    return tip(`${r.id} - ${this.data.partyName(r.supplierId)}`, [
      { label: 'PO', value: r.poId },
      { label: 'Put away at', value: this.data.locationPath(r.locationId) },
      { label: 'Items', value: String(this.receiptQty(r)) },
      { label: 'Value', value: this.data.money(this.receiptValue(r)) },
      { label: 'Posted', value: this.data.fmtDT(r.at) },
      { label: 'By', value: this.data.userName(r.createdBy) },
    ]);
  }
}

