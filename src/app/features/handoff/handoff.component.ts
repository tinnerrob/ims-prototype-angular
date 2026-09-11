import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService, periodLabel } from '../../core/data.service';
import { Item, Movement, MovementKind, MOVEMENT_KIND_LABEL } from '../../core/models';
import { PageSearchService } from '../../core/page-search.service';
import { formChanged, snapshotForm } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { stampDayRange, stampISO, stampRange } from '../../shared/tip/tip-format';
import { assetTip, tip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

/** Board list shown at a time (one sub-tab each). */
type HandoffTab = 'outbound' | 'incoming' | 'custody' | 'log';

/** One unit to hand off on the selected day, derived from its order line. */
interface BoardRow {
  orderId: string;
  project: string;
  itemId: string;
  model: string;
  start: string;
  end: string;
  custodian: string;
  outAt: string | null;
  kind: 'out' | 'in';
  overdue: boolean;
}

/** Badge modifier per movement kind. */
const KIND_CLASS: Record<MovementKind, string> = {
  issue: 'st-out',
  return: 'st-available',
  receive: 'st-active',
  transfer: 'st-on',
  adjust: 'st-reorder',
};

/**
 * Item Hand-Off & Custody (core) — port of the prototype's `renderHandoff`
 * (js/pages/handoff.js): a per-day check-out / check-in dispatch board, the
 * units currently in a party's custody, and the immutable chain-of-custody log.
 *
 * Layout follows the other table views: one card, a sub-tab strip with counts,
 * a scrolling table per tab, row clicks opening the shared read-only viewer, and
 * a return editor that closes through `imsModalDismiss` (asking first when the
 * note is unsaved).
 */
@Component({
  selector: 'ims-handoff',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent, TipDirective],
  templateUrl: './handoff.component.html',
  styleUrl: './handoff.component.scss',
})
export class HandoffComponent {
  readonly kindLabel = MOVEMENT_KIND_LABEL;
  readonly tabs: { key: HandoffTab; label: string; icon: string }[] = [
    { key: 'outbound', label: 'Outbound', icon: 'bi-box-arrow-up-right' },
    { key: 'incoming', label: 'Incoming', icon: 'bi-box-arrow-in-down' },
    { key: 'custody', label: 'In Custody', icon: 'bi-person-badge' },
    { key: 'log', label: 'Custody Log', icon: 'bi-journal-text' },
  ];

  tab: HandoffTab = 'outbound';
  /** Selected board day (ISO) for the outbound / incoming lists. */
  day = new Date().toISOString().slice(0, 10);

  /** Return editor (prototype `hoCheckInModal`). */
  returnOpen = false;
  returnAssetId = '';
  returnNote = '';
  private returnSnap = '';

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;

  constructor(
    readonly data: DataService,
    readonly search: PageSearchService,
  ) {
    // The topbar search box is this page's search: one query for all four tabs,
    // so a search narrows whichever list is open and the pill counts matches.
    this.search.report(() => ({ shown: this.count(this.tab), total: this.totalCount(this.tab) }));
  }

  /* -------------------------------- day --------------------------------- */

  dayLabel(): string {
    return periodLabel('day', this.data.parseDT(this.day));
  }

  isToday(): boolean {
    return this.day === new Date().toISOString().slice(0, 10);
  }

  moveDay(n: number): void {
    const d = this.data.parseDT(this.day);
    d.setDate(d.getDate() + n);
    this.day = d.toISOString().slice(0, 10);
  }

  goToday(): void {
    this.day = new Date().toISOString().slice(0, 10);
  }

  /** The day stepper only applies to the two board lists. */
  boardTab(): boolean {
    return this.tab === 'outbound' || this.tab === 'incoming';
  }

  /** Switching tabs keeps the page search — it covers every list on this page. */
  selectTab(t: HandoffTab): void {
    this.tab = t;
  }

  count(t: HandoffTab): number {
    switch (t) {
      case 'outbound':
        return this.rows('out').length;
      case 'incoming':
        return this.rows('in').length;
      case 'custody':
        return this.custody().length;
      default:
        return this.movements().length;
    }
  }

  /** Unfiltered size of a tab — the pill shows the total, the label shows "N of M". */
  totalCount(t: HandoffTab): number {
    switch (t) {
      case 'outbound':
        return this.rows('out', false).length;
      case 'incoming':
        return this.rows('in', false).length;
      case 'custody':
        return this.data.custodyItems().length;
      default:
        return this.data.listMovements().length;
    }
  }

  emptyLabel(): string {
    switch (this.tab) {
      case 'outbound':
        return `No units to check out on ${this.dayLabel()}.`;
      case 'incoming':
        return `No units due back on ${this.dayLabel()}.`;
      case 'custody':
        return this.search.isBlank() ? 'Nothing is out right now.' : 'No matching units in custody.';
      default:
        return this.search.isBlank() ? 'No movements logged yet.' : 'No matching movements.';
    }
  }

  /* ------------------------------- lists -------------------------------- */

  /**
   * Case-insensitive filter over the visible columns of a tab — the shell's
   * topbar page search. One query covers all four tabs (board, custody, log), so
   * it survives a tab switch and every pill counts what matches it.
   */
  private matches(...parts: (string | null | undefined)[]): boolean {
    return this.search.matches(...parts);
  }

  /**
   * Board rows for one direction, derived from the active orders' serialized
   * lines (prototype `renderHandoff`): a unit is *outbound* while it is still in
   * the yard and its rental window covers the day; it is *incoming* once it is
   * with the party and its window has reached the day.
   */
  private rows(kind: 'out' | 'in', applySearch = true): BoardRow[] {
    const out: BoardRow[] = [];
    for (const order of this.data.activeOrders()) {
      for (const li of order.lineItems) {
        if (li.type !== 'serialized') continue;
        const start = (li.startDate ?? order.startDate).slice(0, 10);
        const end = (li.endDate ?? order.endDate).slice(0, 10);
        const item = this.data.getItem('serialized', li.refId);
        const custody = this.data.outInfo(li.refId);
        const base = {
          orderId: order.orderId,
          project: order.projectName,
          itemId: li.refId,
          model: this.data.mkName(item) || li.refId,
          start,
          end,
          custodian: this.data.partyName(order.partyId),
          outAt: custody?.at ?? null,
        };
        const isOutbound = kind === 'out' && !custody && start <= this.day && this.day <= end;
        const isIncoming = kind === 'in' && !!custody && end <= this.day;
        if (!isOutbound && !isIncoming) continue;
        if (applySearch && !this.matches(base.itemId, base.model, base.orderId, base.project, base.custodian)) {
          continue;
        }
        out.push({
          ...base,
          kind,
          overdue: isOutbound ? start < this.day : end < this.day,
        });
      }
    }
    return out;
  }

  outbound(): BoardRow[] {
    return this.rows('out');
  }

  incoming(): BoardRow[] {
    return this.rows('in');
  }

  /** Serialized units currently in a party's custody (prototype `assetOutInfo`). */
  custody(): Item[] {
    return this.data.custodyItems().filter((item) => {
      const info = this.data.outInfo(item.id);
      return this.matches(item.id, item.name, this.data.mkName(item), info?.orderId, info?.party);
    });
  }

  /** Chain-of-custody log, newest first. */
  movements(): Movement[] {
    return this.data
      .listMovements()
      .filter((m) =>
        this.matches(
          m.id,
          m.refId,
          this.kindLabel[m.kind],
          m.orderId,
          m.party,
          m.location,
          m.note,
          m.by,
        ),
      );
  }

  /* ------------------------------- badges ------------------------------- */

  kindClass(kind: MovementKind): string {
    return KIND_CLASS[kind] ?? 'st-on';
  }

  /** Board status chip: overdue reads amber, due-today reads red (`st-out`). */
  boardBadge(r: BoardRow): string {
    return r.overdue ? 'badge-status st-reorder' : 'badge-status st-out';
  }

  boardBadgeLabel(r: BoardRow): string {
    if (r.kind === 'out') return r.overdue ? 'Go out (overdue)' : 'Pick-up today';
    return r.overdue ? 'Overdue return' : 'Due back today';
  }

  /** Where a unit in custody went (prototype `outFor`). */
  outFor(item: Item): string {
    const info = this.data.outInfo(item.id);
    return info?.orderId ?? info?.party ?? '—';
  }

  outSince(item: Item): string {
    const info = this.data.outInfo(item.id);
    return info ? this.data.fmtDT(info.at) : '—';
  }

  /** Other units still out on the same order — shown in the return editor. */
  siblingsStillOut(contractId: string | null, excludeAssetId: string): string[] {
    if (!contractId) return [];
    return this.data
      .custodyItems()
      .filter((i) => i.id !== excludeAssetId && this.data.outInfo(i.id)?.orderId === contractId)
      .map((i) => i.id);
  }


  /* ----------------------------- hand-off ------------------------------- */

  /** Check a unit out to its order and append the custody event. */
  checkOut(row: BoardRow): void {
    this.data.logMovement({
      type: 'serialized',
      refId: row.itemId,
      kind: 'issue',
      qty: 1,
      orderId: row.orderId,
      party: row.custodian,
      note: `Checked out to ${row.orderId}`,
    });
  }

  /* --------------------------- return editor ---------------------------- */

  /** Open the return editor for one asset (prototype `hoCheckInModal`). */
  openReturn(assetId: string): void {
    this.returnAssetId = assetId;
    this.returnNote = '';
    this.returnSnap = snapshotForm({ note: this.returnNote });
    this.returnOpen = true;
  }

  /** Return editor can also be opened from a board row (Incoming list). */
  openReturnForRow(row: BoardRow): void {
    this.openReturn(row.itemId);
  }

  /** Unsaved-note check, wired to `imsModalDismiss`. */
  returnDirty(): boolean {
    return formChanged({ note: this.returnNote }, this.returnSnap);
  }

  closeReturn(): void {
    this.returnOpen = false;
    this.returnAssetId = '';
    this.returnNote = '';
  }

  /** Write the return movement and close the editor. */
  confirmReturn(): void {
    const assetId = this.returnAssetId;
    if (!assetId) return;
    this.data.logMovement({
      type: 'serialized',
      refId: assetId,
      kind: 'return',
      qty: 1,
      party: 'Main yard',
      note: this.returnNote.trim() || 'Returned to yard / available.',
    });
    this.closeReturn();
  }

  /** Asset backing the open return editor. */
  returnItem(): Item | undefined {
    return this.returnAssetId ? this.data.getItem('serialized', this.returnAssetId) : undefined;
  }

  /** Custody record for the asset being returned. */
  returnCustody(): { orderId: string | null; party: string; at: string } | null {
    return this.returnAssetId ? this.data.outInfo(this.returnAssetId) : null;
  }

  /** Units still out on the same order, excluding the one being returned. */
  returnSiblings(): string[] {
    const info = this.returnCustody();
    return this.siblingsStillOut(info?.orderId ?? null, this.returnAssetId);
  }

  /* --------------------------- record viewer ---------------------------- */

  /** Board row click → read-only view of that unit's hand-off. */
  showBoardView(e: Event, r: BoardRow): void {
    if (isInteractiveTarget(e)) return;
    const item = this.data.getItem('serialized', r.itemId);
    const info = this.data.outInfo(r.itemId);
    this.viewer = {
      title: r.itemId,
      subtitle: `${r.model} · ${r.orderId}`,
      icon: r.kind === 'out' ? 'bi-box-arrow-up-right' : 'bi-box-arrow-in-down',
      badge: this.boardBadgeLabel(r),
      badgeClass: r.overdue ? 'st-reorder' : 'st-out',
      sections: [
        {
          title: 'Hand-Off',
          fields: [
            { label: 'Asset', value: r.itemId, mono: true },
            { label: 'Model', value: r.model || '—' },
            { label: 'Direction', value: r.kind === 'out' ? 'Check-Out' : 'Check-In' },
            { label: 'Board Day', value: this.data.fmtDate(this.day), mono: true },
            { label: 'Overdue', value: r.overdue ? 'Yes' : 'No' },
          ],
        },
        {
          title: 'Order',
          fields: [
            { label: 'Order', value: r.orderId, mono: true },
            { label: 'Project', value: r.project || '—' },
            { label: 'Custodian', value: r.custodian || '—' },
            { label: 'Rental Window', value: `${this.data.fmtDate(r.start)} → ${this.data.fmtDate(r.end)}`, mono: true },
            { label: 'Out Since', value: r.outAt ? this.data.fmtDT(r.outAt) : '—', mono: true },
          ],
        },
        {
          title: 'Asset Status',
          fields: [
            { label: 'Catalog Name', value: item ? item.name : '—' },
            { label: 'Service Status', value: item?.status ?? '—' },
            { label: 'Current Custody', value: info?.orderId ?? info?.party ?? 'In yard' },
            { label: 'Meter Hours', value: this.data.int(item?.meterHours ?? 0) },
          ],
        },
      ],
    };
  }

  /** Custody row click → read-only view of the unit in custody. */
  showCustodyView(e: Event, item: Item): void {
    if (isInteractiveTarget(e)) return;
    const info = this.data.outInfo(item.id);
    const order = info?.orderId ? this.data.getOrder(info.orderId) : undefined;
    this.viewer = {
      title: item.id,
      subtitle: item.name,
      icon: 'bi-person-badge',
      badge: 'On Site',
      badgeClass: 'st-out',
      sections: [
        {
          title: 'Custody',
          fields: [
            { label: 'Asset', value: item.id, mono: true },
            { label: 'Model', value: this.data.mkName(item) || '—' },
            { label: 'Custodian', value: info?.party || '—' },
            { label: 'Checked Out', value: info ? this.data.fmtDT(info.at) : '—', mono: true },
          ],
        },
        {
          title: 'Order',
          fields: [
            { label: 'Order', value: info?.orderId ?? '—', mono: true },
            { label: 'Project', value: order?.projectName ?? '—' },
            {
              label: 'Rental Window',
              value: order
                ? `${this.data.fmtDate(order.startDate)} → ${this.data.fmtDate(order.endDate)}`
                : '—',
              mono: true,
            },
          ],
        },
        {
          title: 'Asset Status',
          fields: [
            { label: 'Service Status', value: item.status },
            { label: 'Meter Hours', value: this.data.int(item.meterHours ?? 0) },
            { label: 'Category', value: item.category || '—' },
          ],
        },
      ],
    };
  }

  /** Log row click → read-only view of that movement. */
  showMovementView(e: Event, m: Movement): void {
    if (isInteractiveTarget(e)) return;
    this.viewer = {
      title: `Movement ${m.id}`,
      subtitle: `${this.kindLabel[m.kind]} · ${m.refId}`,
      icon: 'bi-journal-text',
      badge: this.kindLabel[m.kind],
      badgeClass: this.kindClass(m.kind),
      sections: [
        {
          fields: [
            { label: 'Movement ID', value: m.id, mono: true },
            { label: 'Kind', value: this.kindLabel[m.kind] },
            { label: 'Item Type', value: m.type },
            { label: 'Item', value: m.refId, mono: true },
            { label: 'Quantity', value: String(m.qty) },
            { label: 'Order', value: m.orderId || '—', mono: true },
            { label: 'Party', value: m.party || '—' },
            { label: 'Location', value: m.location || '—' },
            { label: 'Recorded At', value: this.data.fmtDT(m.at), mono: true },
            { label: 'Recorded By', value: m.by || '—' },
            { label: 'Note', value: m.note || '—' },
          ],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
  }

  /* ------------------------------ tooltips ------------------------------ */

  /** Board row (outbound / incoming): the unit, its contract, window, custodian. */
  tipBoard(r: BoardRow): Tip {
    const order = this.data.getOrder(r.orderId);
    const window = order
      ? stampRange(r.start, this.data.orderT0(order), r.end, this.data.orderT1(order))
      : stampDayRange(r.start, r.end);
    return tip(`${r.itemId} - ${r.model}`, [
      window,
      { label: 'Order', value: `${r.orderId} - ${r.project}` },
      { label: 'Custodian', value: r.custodian },
      r.outAt ? { label: 'Out since', value: stampISO(r.outAt) } : null,
      r.overdue ? 'Overdue' : null,
    ]);
  }

  /** In-custody row: the asset, plus who has it and for how long. */
  tipCustody(item: Item): Tip {
    const out = this.data.outInfo(item.id);
    return assetTip(this.data, item, [
      out?.party ? { label: 'Customer', value: out.party } : null,
      { label: 'Out for', value: this.outFor(item) },
      { label: 'Since', value: this.outSince(item) },
    ]);
  }

  /** Chain-of-custody row: what moved, when, against what, and by whom. */
  tipMovement(m: Movement): Tip {
    return tip(`${MOVEMENT_KIND_LABEL[m.kind]} - ${this.data.itemLabel(m.type, m.refId)}`, [
      stampISO(m.at),
      m.orderId ? { label: 'Order', value: m.orderId } : null,
      m.party ? { label: 'Party', value: m.party } : null,
      m.location ? { label: 'Location', value: m.location } : null,
      { label: 'Qty', value: String(m.qty) },
      { label: 'By', value: m.by },
      m.note ?? '',
    ]);
  }
}

