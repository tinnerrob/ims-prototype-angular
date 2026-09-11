import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
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
    readonly data: DataService,
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
    if (t === 'orders') return 'No purchase orders match.';
    return 'No receipts posted yet.';
  }

  /** Shared badge class for a status string (PO rows derive their own). */
  badge(status: string): string {
    return 'badge-status st-' + statusClass(status);
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
    return this.data.listPurchaseOrders().filter((po) =>
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
    if (!line.unitCost) line.unitCost = item.costPrice ?? item.purchaseValue ?? 0;
    if (this.isUnit(line.type) && !line.rateDaily) line.rateDaily = item.rateDaily;
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
    const rec = this.data.receiveAgainst({
      poId: po.id,
      locationId: this.receiveLocationId,
      qty,
      note: this.receiveNote.trim(),
    });
    if (rec) {
      this.closeReceive();
      this.showReceipt(rec);
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
    return this.data.listReceipts().filter((r) =>
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

