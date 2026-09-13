import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Order, ORDER_STATUS_LABEL, OrderLine, Party, statusBadge } from '../../core/models';
import { PageSearchService } from '../../core/page-search.service';
import { PrintMenuComponent } from '../../shared/print/print-menu.component';
import { PrintMode, PrintService } from '../../shared/print/print.service';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { orderRecordTip, partyTip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

const BILLING_CYCLES = ['daily', 'weekly', 'bi-weekly', 'monthly', 'quarterly'];

/**
 * Parties & Orders (core) — port of the prototype's `renderOrdersParties`
 * (js/pages/contracts.js): Parties / Orders sub-tabs with counts, the
 * active/closed order filter, and the party / order editors.
 */
import { TablePagerDirective } from '../../shared/table/table-pager.directive';

@Component({
  selector: 'ims-orders',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, PrintMenuComponent, RecordViewComponent, TipDirective, TablePagerDirective],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.scss',
})
export class OrdersComponent {
  readonly cycles = BILLING_CYCLES;
  readonly statusLabel = ORDER_STATUS_LABEL;

  tab: 'parties' | 'orders' = 'parties';
  filter: 'active' | 'closed' = 'active';

  customerOpen = false;
  editingCustomerId: string | null = null;
  customerForm = this.emptyCustomer();
  /** Editor values as they were when it opened (drives the discard prompt). */
  private customerSnap = '';

  orderOpen = false;
  orderForm = {
    partyId: '',
    projectName: '',
    jobSite: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
  };
  /** Editor values as they were when it opened (drives the discard prompt). */
  private orderSnap = '';
  detail: Order | null = null;

  /** Read-only record viewer (party rows; order rows reuse `detail`). */
  viewer: ViewModel | null = null;
  /** Customer behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: Party | null = null;

  constructor(
    readonly data: DataService,
    readonly search: PageSearchService,
    private readonly printer: PrintService,
  ) {
    // The topbar search box is this page's search: it spans both sub-tabs (and
    // the active/closed filter), so report what the open tab is showing.
    this.search.report(() => ({
      shown: this.tab === 'parties' ? this.parties().length : this.orderMatches().length,
      total: this.tab === 'parties' ? this.data.customerParties().length : this.data.listOrders().length,
    }));
  }

  /** Customers matching the page search (the sub-tab pill counts these). */
  parties(): Party[] {
    // Only partners carrying the customer role: a supplier is a row in the same
    // table (see `Party.kinds`) but it isn't someone you rent equipment to, so it
    // belongs on the Purchasing page, not in this picker or grid.
    return this.data.customerParties().filter((p) =>
      this.search.matches(
        p.id,
        p.name,
        p.contact,
        p.phone,
        p.email,
        p.billingAddress,
        p.billingCycle,
        p.notes,
        p.active === false ? 'Inactive' : 'Active',
      ),
    );
  }

  /**
   * Orders matching the page search, before the active/closed filter — so a
   * search reaches closed orders too and the pill says how many there are.
   */
  orderMatches(): Order[] {
    return this.data.listOrders().filter((o) =>
      this.search.matches(
        o.orderId,
        // The customer's name is a join, so the search reads it the same way the
        // grid prints it — a search for "Halstead" has to find the order.
        this.data.partyName(o.partyId),
        o.projectName,
        o.jobSite,
        this.statusLabel[o.status],
        o.startDate,
        o.endDate,
      ),
    );
  }

  /** Orders on the active/closed filter, narrowed by the page search. */
  orders(): Order[] {
    return this.orderMatches().filter((o) => o.status === this.filter);
  }

  /** Status chips render the one shared rule (`statusBadge`). */
  readonly badge = statusBadge;

  /* ------------------------------ customers ----------------------------- */

  openCustomer(p?: Party): void {
    this.editingCustomerId = p ? p.id : null;
    this.customerForm = p
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
      : this.emptyCustomer();
    this.customerSnap = snapshotForm(this.customerForm);
    this.customerOpen = true;
  }

  /** True when the customer editor holds edits that Save has not written yet. */
  customerDirty(): boolean {
    return formChanged(this.customerForm, this.customerSnap);
  }

  saveCustomer(): void {
    const f = this.customerForm;
    if (!f.name.trim()) return;
    const patch = {
      name: f.name,
      contact: f.contact,
      phone: f.phone,
      email: f.email,
      billingAddress: f.billingAddress,
      billingCycle: f.billingCycle,
      notes: f.notes,
    };
    if (this.editingCustomerId) this.data.updateParty(this.editingCustomerId, { ...patch, active: f.active });
    else this.data.createParty(patch);
    this.closeCustomer();
  }

  toggleActive(p: Party): void {
    this.data.togglePartyActive(p.id);
  }

  removeCustomer(p: Party): void {
    this.data.removeParty(p.id);
  }

  /** Why this customer cannot be removed — the grid's disabled Remove button. */
  customerRemoveTitle(p: Party): string {
    const blockers = this.data.partyRemovalBlockers(p.id);
    return blockers.length ? 'Remove — blocked: ' + blockers.join(' and ') : 'Remove';
  }

  customerRemoveBlocked(p: Party): boolean {
    return this.data.partyRemovalBlockers(p.id).length > 0;
  }

  closeCustomer(): void {
    this.customerOpen = false;
    this.editingCustomerId = null;
    this.customerSnap = '';
  }

  /* ------------------------------- orders ------------------------------ */

  newOrder(): void {
    const party = this.data.customerParties()[0];
    this.orderForm = {
      partyId: party?.id ?? '',
      projectName: '',
      jobSite: party?.billingAddress ?? '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
    };
    this.orderSnap = snapshotForm(this.orderForm);
    this.orderOpen = true;
  }

  /** True when the order editor holds edits that Save has not written yet. */
  orderDirty(): boolean {
    return formChanged(this.orderForm, this.orderSnap);
  }

  saveOrder(): void {
    const f = this.orderForm;
    const party = this.data.getParty(f.partyId);
    if (!party || !f.projectName.trim()) return;
    this.data.createOrder({
      partyId: party.id,
      projectName: f.projectName,
      jobSite: f.jobSite || party.billingAddress || '—',
      startDate: f.startDate,
      endDate: f.endDate || f.startDate,
    });
    this.closeOrderForm();
  }

  closeOrderForm(): void {
    this.orderOpen = false;
    this.orderSnap = '';
  }

  openDetail(o: Order): void {
    this.detail = o;
  }

  closeDetail(): void {
    this.detail = null;
  }

  /* ------------------------------- printing ----------------------------- */

  /**
   * Build the printable order and open the print dialog.
   *
   * The lines, the rate beside each one and the Gross all come from the same
   * readers the detail modal uses, so the sheet and the screen cannot disagree.
   */
  printOrder(o: Order, mode: PrintMode = 'print'): void {
    const party = this.data.getParty(o.partyId);
    const money = (n: number) => this.data.money(n);
    this.printer.print({
      heading: 'Order',
      number: o.orderId,
      status: this.statusLabel[o.status],
      party: {
        title: 'Customer',
        name: this.data.partyName(o.partyId),
        lines: [party?.contact, party?.email, party?.billingAddress].filter((l): l is string => !!l),
      },
      meta: [
        { label: 'Project', value: o.projectName },
        { label: 'Job Site', value: o.jobSite || '—' },
        { label: 'Start', value: this.data.fmtDate(o.startDate) },
        { label: 'Expected Return', value: this.data.fmtDate(o.endDate) },
        { label: 'Rate Card', value: this.rateCardNote(o) },
      ],
      columns: ['Item', 'Type', 'Qty', 'Rate', 'Amount'],
      align: ['left', 'left', 'right', 'right', 'right'],
      rows: o.lineItems.map((li) => [
        this.data.itemLabel(li.type, li.refId),
        li.type,
        this.data.int(li.qty),
        money(this.lineRate(li, o)),
        money(this.data.lineTotal(li, o)),
      ]),
      totals: [{ label: 'Order Gross', value: money(this.gross(o)), strong: true }],
      notes: 'Rates are read from the customer’s price card in force on the booking date.',
    }, mode);
  }

  /** Switch sub-tab — closing any open viewer/detail so a stale modal can't linger. */
  setTab(t: 'parties' | 'orders'): void {
    this.tab = t;
    this.closeViewer();
    this.closeDetail();
  }

  /* --------------------------- record viewer ---------------------------- */

  /** Customer row click → read-only viewer (row actions keep their own click). */
  showView(e: Event, p: Party): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = p;
    this.viewer = {
      title: p.name,
      subtitle: p.id,
      icon: 'bi-person-badge',
      badge: p.active === false ? 'Inactive' : 'Active',
      badgeClass: p.active === false ? 'st-out' : 'st-active',
      sections: [
        {
          title: 'Contact',
          fields: [
            { label: 'Customer ID', value: p.id, mono: true },
            { label: 'Contact', value: p.contact || '—' },
            { label: 'Phone', value: p.phone || '—' },
            { label: 'Email', value: p.email || '—' },
          ],
        },
        {
          title: 'Commercial',
          fields: [
            { label: 'Billing Address', value: p.billingAddress || '—' },
            { label: 'Billing Cycle', value: p.billingCycle },
            { label: 'Orders', value: String(this.data.orderCount(p.id)) },
            { label: 'Active Orders', value: String(this.data.activeOrderCount(p.id)) },
            { label: 'Notes', value: p.notes || '—' },
          ],
        },
        // The rates agreed with this partner, on the screen that owns the party —
        // the card itself is edited on Pricing (A11).
        { title: 'Rate Card', fields: this.rateCardFields(p) },
      ],
    };
  }

  /** Order row click → the page's existing read-only order detail modal. */
  showOrderView(e: Event, o: Order): void {
    if (isInteractiveTarget(e)) return;
    this.openDetail(o);
  }

  closeViewer(): void {
    this.viewer = null;
    this.viewing = null;
  }

  /** Viewer footer Edit → reopen the customer editor for the shown record. */
  editFromViewer(): void {
    const p = this.viewing;
    this.closeViewer();
    if (p) this.openCustomer(p);
  }

  gross(o: Order): number {
    return this.data.orderAmount(o);
  }

  /**
   * The rate a booking's row prints. It comes from `rateBasis()` — the same
   * reader the invoice multiplies and `lineTotal()` adds up — so the figure beside
   * a line cannot disagree with the Gross above it (A11: the customer's card is
   * read here, not a stored copy of it).
   */
  lineRate(li: OrderLine, order: Order): number {
    const item = this.data.getItem(li.type, li.refId);
    return item ? this.data.rateBasis(li, item, order).rate : 0;
  }

  /** True when the customer's card, not the catalog, set that rate. */
  lineOnCard(li: OrderLine, order: Order): boolean {
    const item = this.data.getItem(li.type, li.refId);
    return !!item && this.data.cardRateFor(order.partyId, item, this.data.lineStart(li, order)).source === 'card';
  }

  /** The rate cell's tooltip: the basis, the figure, and who set it. */
  lineRateTitle(li: OrderLine, order: Order): string {
    const item = this.data.getItem(li.type, li.refId);
    if (!item) return '';
    const basis = this.data.rateBasis(li, item, order);
    if (!this.lineOnCard(li, order)) {
      return `${basis.basis} rate ${this.data.money(basis.rate)} — catalog`;
    }
    const card = this.data.priceCardFor(order.partyId, this.data.lineStart(li, order));
    return `${basis.basis} rate ${this.data.money(basis.rate)} — ${card?.name ?? 'rate card'}`;
  }

  /**
   * The card this order prices at, named on the detail modal. It is read on the
   * order's *own* start date, the way the Gross was, so the note can never name a
   * different agreement from the one the money came from.
   */
  rateCardNote(o: Order): string {
    const card = this.data.priceCardFor(o.partyId, o.startDate);
    return card ? `Rate card: ${card.name}` : 'Catalog rates — no card in force';
  }

  /** The customer viewer's rate-card section (what is agreed, and since when). */
  private rateCardFields(p: Party): { label: string; value: string; mono?: boolean }[] {
    const card = this.data.priceCardFor(p.id);
    const onFile = this.data.priceCardsForParty(p.id);
    if (!card) {
      return [
        { label: 'Negotiated Rates', value: onFile.length ? 'None in force' : 'None on file' },
        { label: 'Cards On File', value: String(onFile.length) },
      ];
    }
    const from = card.effectiveFrom ? this.data.fmtDate(card.effectiveFrom) : 'Open';
    const to = card.effectiveTo ? this.data.fmtDate(card.effectiveTo) : 'Open';
    return [
      { label: 'Agreement', value: card.name },
      { label: 'In Force', value: `${from} → ${to}`, mono: true },
      { label: 'Negotiated Rates', value: `${card.lines.length} item(s)` },
      { label: 'Cards On File', value: String(onFile.length) },
    ];
  }

  private emptyCustomer() {
    return {
      name: '',
      contact: '',
      phone: '',
      email: '',
      billingAddress: '',
      billingCycle: 'monthly',
      notes: '',
      active: true,
    };
  }

  /* ------------------------------ tooltips ------------------------------ */

  /** Customer row: contact details and how much business is live with them. */
  tipCustomer(p: Party): Tip {
    return partyTip(this.data, p);
  }

  /** Order row: the whole order record — window, site, size and value. */
  tipOrder(o: Order): Tip {
    return orderRecordTip(this.data, o);
  }
}
