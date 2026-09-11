import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import {
  CATALOG_TYPE_KEYS,
  CATALOG_TYPES,
  CatalogType,
  Item,
  OVERHEAD_CATEGORIES,
  OVERHEAD_CHARGE_TYPES,
  Overhead,
  Party,
  PriceCard,
  PriceCardLine,
  PricingSettings,
  RiskPremiumKey,
  TaxSchedule,
  WEEKEND_POLICIES,
} from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';

/**
 * One rate card as the editor holds it. A card's window is two date inputs, which
 * cannot hold "open" — the modal keeps `''` for that and `saveCard()` turns it
 * back into `undefined` (the store's absent bound).
 */
interface CardForm {
  id: string;
  partyId: string;
  name: string;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string;
  note: string;
  lines: PriceCardLine[];
}

/** How a card's standing reads on the grid (see `DataService.cardStatus`). */
const CARD_STATUS_LABEL: Record<ReturnType<DataService['cardStatus']>, string> = {
  'in-force': 'In force',
  scheduled: 'Scheduled',
  expired: 'Expired',
  inactive: 'Inactive',
};

const CARD_STATUS_CLASS: Record<ReturnType<DataService['cardStatus']>, string> = {
  'in-force': 'st-active',
  scheduled: 'st-onrent',
  expired: 'st-closed',
  inactive: 'st-out',
};

/**
 * Pricing & Policies (administration) — port of the prototype's `renderPricing`
 * (js/pages/pricing.js): the pricing rules engine form, the overhead / service
 * fee configuration grid, the sales-tax schedule grid and the counterparty rate
 * cards (A11, which the prototype had no equivalent of).
 */
@Component({
  selector: 'ims-pricing',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent],
  templateUrl: './pricing.component.html',
  styleUrl: './pricing.component.scss',
})
export class PricingComponent {
  readonly weekendPolicies = WEEKEND_POLICIES;
  readonly overheadCategories = OVERHEAD_CATEGORIES;
  readonly overheadChargeTypes = OVERHEAD_CHARGE_TYPES;
  readonly catalogTypes = CATALOG_TYPES;
  readonly catalogTypeKeys = CATALOG_TYPE_KEYS;

  /** Working copy of the pricing rules form (saved on demand, as in the prototype). */
  form: PricingSettings;

  overheadOpen = false;
  overheadEditingId: string | null = null;
  /** Blank until `openOverhead()` fills it (field initializers run before `data`). */
  overheadForm: Omit<Overhead, 'id'> & { id: string } = {
    id: '',
    name: '',
    category: 'Freight/Logistics',
    chargeType: 'Flat Fee',
    pct: 0,
    cost: 0,
    retail: 0,
    locked: false,
  };
  /** Editor values as they were when it opened (drives the discard prompt). */
  private overheadSnap = '';

  taxOpen = false;
  taxEditingCode: string | null = null;
  taxForm: TaxSchedule = this.emptyTax();
  /** Editor values as they were when it opened (drives the discard prompt). */
  private taxSnap = '';

  cardsOpen = false;
  cardEditingId: string | null = null;
  /** Blank until `openCard()` fills it (field initializers run before `data`). */
  cardForm: CardForm = this.emptyCard();
  /** Editor values as they were when it opened (drives the discard prompt). */
  private cardSnap = '';

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;
  /** Record behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: { kind: 'overhead' | 'tax' | 'card'; id: string } | null = null;

  constructor(readonly data: DataService) {
    this.form = { ...data.pricing, riskPremiums: { ...data.pricing.riskPremiums } };
  }

  riskKeys(): RiskPremiumKey[] {
    return Object.keys(this.data.pricing.riskPremiums) as RiskPremiumKey[];
  }

  riskPct(key: RiskPremiumKey): number {
    return Math.round((this.data.pricing.riskPremiums[key] ?? 0) * 100);
  }

  overheads(): Overhead[] {
    return this.data.listOverheads();
  }

  taxes(): TaxSchedule[] {
    return this.data.listTaxSchedules();
  }

  savePricing(): void {
    this.data.updatePricing({
      dailyMinHours: Number(this.form.dailyMinHours) || 0,
      weeklyHours: Number(this.form.weeklyHours) || 0,
      cycleDays: Number(this.form.cycleDays) || 0,
      envFeePct: Number(this.form.envFeePct) || 0,
      depreciationAnnual: Number(this.form.depreciationAnnual) || 0,
      weekendPolicyDefault: this.form.weekendPolicyDefault,
    });
  }

  /* ---------------------------- overhead fees --------------------------- */

  openOverhead(o?: Overhead): void {
    this.overheadEditingId = o ? o.id : null;
    this.overheadForm = o
      ? { id: o.id, name: o.name, category: o.category, chargeType: o.chargeType, pct: o.pct, cost: o.cost, retail: o.retail, locked: o.locked }
      : this.emptyOverhead();
    this.overheadSnap = snapshotForm(this.overheadForm);
    this.overheadOpen = true;
  }

  saveOverhead(): void {
    const f = this.overheadForm;
    if (!f.name.trim()) return;
    const patch = {
      name: f.name,
      category: f.category,
      chargeType: f.chargeType,
      pct: Number(f.pct) || 0,
      cost: Number(f.cost) || 0,
      retail: Number(f.retail) || 0,
      locked: !!f.locked,
    };
    if (this.overheadEditingId) this.data.updateOverhead(this.overheadEditingId, patch);
    else this.data.createOverhead(patch);
    this.closeOverhead();
  }

  removeOverhead(o: Overhead): void {
    this.data.removeOverhead(o.id);
  }

  /** True when the overhead editor holds edits that Save has not written yet. */
  overheadDirty(): boolean {
    return formChanged(this.overheadForm, this.overheadSnap);
  }

  closeOverhead(): void {
    this.overheadOpen = false;
    this.overheadEditingId = null;
    this.overheadSnap = '';
  }

  /* ------------------------------- taxes -------------------------------- */

  openTax(t?: TaxSchedule): void {
    this.taxEditingCode = t ? t.code : null;
    this.taxForm = t ? { ...t } : this.emptyTax();
    this.taxSnap = snapshotForm(this.taxForm);
    this.taxOpen = true;
  }

  saveTax(): void {
    const f = this.taxForm;
    if (!f.code.trim()) return;
    const patch = {
      state: f.state,
      county: f.county,
      city: f.city,
      rate: Number(f.rate) || 0,
      note: f.note,
    };
    if (this.taxEditingCode) this.data.updateTaxSchedule(this.taxEditingCode, patch);
    else this.data.createTaxSchedule({ ...patch, code: f.code });
    this.closeTax();
  }

  removeTax(t: TaxSchedule): void {
    this.data.removeTaxSchedule(t.code);
  }

  /** True when the tax editor holds edits that Save has not written yet. */
  taxDirty(): boolean {
    return formChanged(this.taxForm, this.taxSnap);
  }

  closeTax(): void {
    this.taxOpen = false;
    this.taxEditingCode = null;
    this.taxSnap = '';
  }

  /* ----------------------------- price cards ---------------------------- */

  /**
   * The counterparty rate cards (A11). Like the two grids above it is
   * configuration, but it hangs off a *party* rather than the tenant, so the row
   * names the agreement and the partner it was negotiated with, and the rates
   * themselves are edited line by line in the modal.
   */
  cards(): PriceCard[] {
    return this.data.listPriceCards();
  }

  cardParty(c: PriceCard): string {
    return this.data.partyName(c.partyId);
  }

  cardWindow(c: PriceCard): string {
    const from = c.effectiveFrom ? this.data.fmtDate(c.effectiveFrom) : 'Open';
    const to = c.effectiveTo ? this.data.fmtDate(c.effectiveTo) : 'Open';
    return `${from} → ${to}`;
  }

  cardStatusLabel(c: PriceCard): string {
    return CARD_STATUS_LABEL[this.data.cardStatus(c)];
  }

  cardStatusClass(c: PriceCard): string {
    return CARD_STATUS_CLASS[this.data.cardStatus(c)];
  }

  /** The rates a card sets, as one cell: how many, and the first few. */
  cardRates(c: PriceCard): string {
    if (!c.lines.length) return 'None yet';
    const shown = c.lines.slice(0, 2).map((l) => this.data.itemLabel(l.type, l.refId));
    const more = c.lines.length - shown.length;
    return shown.join(', ') + (more > 0 ? ` +${more} more` : '');
  }

  openCard(c?: PriceCard): void {
    this.cardEditingId = c ? c.id : null;
    this.cardForm = c
      ? {
          id: c.id,
          partyId: c.partyId,
          name: c.name,
          active: c.active !== false,
          effectiveFrom: c.effectiveFrom ?? '',
          effectiveTo: c.effectiveTo ?? '',
          note: c.note ?? '',
          lines: c.lines.map((l) => ({ ...l })),
        }
      : this.emptyCard();
    if (!this.cardEditingId) this.cardForm.partyId = this.data.listParties()[0]?.id ?? '';
    this.cardSnap = snapshotForm(this.cardForm);
    this.cardsOpen = true;
  }

  /** Every counterparty a card can be negotiated with (customers and suppliers). */
  parties(): Party[] {
    return this.data.listParties();
  }

  saveCard(): void {
    const f = this.cardForm;
    if (!f.name.trim() || !f.partyId) return;
    const patch = {
      partyId: f.partyId,
      name: f.name,
      active: !!f.active,
      // An empty date input is an open bound, not a null date — the store keeps
      // `undefined` for "no limit", and the two mean the same thing here.
      effectiveFrom: f.effectiveFrom || undefined,
      effectiveTo: f.effectiveTo || undefined,
      note: f.note,
      lines: f.lines
        .filter((l) => l.refId)
        .map((l) => ({
          type: l.type,
          refId: l.refId,
          rateDaily: this.numOrUndef(l.rateDaily),
          baseWeekly: this.numOrUndef(l.baseWeekly),
          baseMonthly: this.numOrUndef(l.baseMonthly),
          unitPrice: this.numOrUndef(l.unitPrice),
          unitCost: this.numOrUndef(l.unitCost),
        })),
    };
    if (this.cardEditingId) this.data.updatePriceCard(this.cardEditingId, patch);
    else this.data.createPriceCard(patch);
    this.closeCard();
  }

  removeCard(c: PriceCard): void {
    this.data.removePriceCard(c.id);
  }

  /** True when the card editor holds edits that Save has not written yet. */
  cardDirty(): boolean {
    return formChanged(this.cardForm, this.cardSnap);
  }

  closeCard(): void {
    this.cardsOpen = false;
    this.cardEditingId = null;
    this.cardSnap = '';
  }

  addCardLine(): void {
    const type = this.cardForm.lines[this.cardForm.lines.length - 1]?.type ?? 'serialized';
    this.cardForm.lines = [...this.cardForm.lines, { type, refId: '' }];
  }

  removeCardLine(i: number): void {
    this.cardForm.lines = this.cardForm.lines.filter((_, n) => n !== i);
  }

  /** The catalog rows a line can name — the picker for that line's type. */
  cardItems(type: CatalogType): Item[] {
    return this.data.listItems(type);
  }

  /**
   * A line's type changed, so the row it names cannot still apply — the two are
   * one identity (`type` + `refId`), which is why the picker is rebuilt and the
   * old choice dropped with it.
   */
  onCardLineType(line: PriceCardLine, type: CatalogType): void {
    line.type = type;
    line.refId = '';
  }

  itemLabel(l: PriceCardLine): string {
    return this.data.itemLabel(l.type, l.refId) || '—';
  }

  /** `undefined` for a blank input, so the catalog's value stands (see models). */
  private numOrUndef(n: number | null | undefined): number | undefined {
    if (n == null) return undefined;
    const v = Number(n);
    return Number.isNaN(v) ? undefined : v;
  }

  private emptyCard(): CardForm {
    return {
      id: '',
      partyId: '',
      name: '',
      active: true,
      effectiveFrom: '',
      effectiveTo: '',
      note: '',
      lines: [],
    };
  }

  /* --------------------------- record viewer ---------------------------- */

  /** Overhead / service-fee row click → read-only viewer. */
  showOverheadView(e: Event, o: Overhead): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = { kind: 'overhead', id: o.id };
    this.viewer = {
      title: o.name,
      subtitle: o.id,
      icon: 'bi-receipt',
      badge: o.locked ? 'Auto-inject' : 'Optional',
      badgeClass: o.locked ? 'st-active' : 'st-closed',
      sections: [
        {
          title: 'Fee',
          fields: [
            { label: 'Fee ID', value: o.id, mono: true },
            { label: 'Name', value: o.name },
            { label: 'Category', value: o.category },
            { label: 'Charge Type', value: o.chargeType },
            { label: 'Percent Of Equipment Total', value: o.pct + '%' },
          ],
        },
        {
          title: 'Defaults',
          fields: [
            { label: 'Default Cost', value: this.data.money(o.cost) },
            { label: 'Default Retail', value: this.data.money(o.retail) },
            { label: 'Applied To New Orders', value: o.locked ? 'Automatically' : 'On request' },
          ],
        },
      ],
    };
  }

  /** Sales-tax row click → read-only viewer. */
  showTaxView(e: Event, t: TaxSchedule): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = { kind: 'tax', id: t.code };
    this.viewer = {
      title: t.code,
      subtitle: [t.city, t.county, t.state].filter(Boolean).join(', ') || 'Sales tax jurisdiction',
      icon: 'bi-percent',
      sections: [
        {
          title: 'Jurisdiction',
          fields: [
            { label: 'Code', value: t.code, mono: true },
            { label: 'State', value: t.state || '—' },
            { label: 'County', value: t.county || '—' },
            { label: 'City', value: t.city || '—' },
            { label: 'Rate', value: (t.rate * 100).toFixed(3) + '%' },
            { label: 'Note', value: t.note || '—' },
          ],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
    this.viewing = null;
  }

  /** Viewer footer Edit → reopen the matching editor for the shown record. */
  /**
   * Rate-card row click → the read-only viewer. The rates are the point, so the
   * card's own lines get a table section (one row per negotiated rate, with the
   * catalog's figure beside it) — a card that hides what it changes would be
   * asking to be trusted.
   */
  showCardView(e: Event, c: PriceCard): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = { kind: 'card', id: c.id };
    this.viewer = {
      title: c.name,
      subtitle: `${this.cardParty(c)} · ${this.cardWindow(c)}`,
      icon: 'bi-card-checklist',
      badge: this.cardStatusLabel(c),
      badgeClass: this.cardStatusClass(c),
      sections: [
        {
          title: 'Agreement',
          fields: [
            { label: 'Card ID', value: c.id, mono: true },
            { label: 'Counterparty', value: this.cardParty(c) },
            { label: 'In Force', value: this.cardWindow(c) },
            { label: 'Standing', value: this.cardStatusLabel(c) },
            { label: 'Negotiated Rates', value: `${c.lines.length} item(s)` },
            { label: 'Note', value: c.note || '—' },
          ],
        },
        // One field per negotiated rate, with the catalog's own figure beside it:
        // what the card *changes* is the only thing worth reading on it.
        {
          title: 'Rates',
          fields: c.lines.length
            ? c.lines.map((l) => ({
                label: this.itemLabel(l),
                value: `${this.cardLineRate(l)} (catalog ${this.catalogRate(l)})`,
              }))
            : [{ label: 'Rates', value: 'None yet — every item bills at the catalog rate.' }],
        },
      ],
    };
  }

  /** The catalog's own figure for a card line, as text — the thing being replaced. */
  catalogRate(l: PriceCardLine): string {
    const item = this.data.getItem(l.type, l.refId);
    if (!item) return '—';
    const one = this.data.oneTimePrice(item);
    if (one != null && (l.type === 'labor' || l.type === 'consumable' || l.type === 'part')) {
      return this.data.money(one);
    }
    return `${this.data.money(item.rateDaily)}/day`;
  }

  /** One line's negotiated figures, as text — only the slots the card sets. */
  cardLineRate(l: PriceCardLine): string {
    const parts: string[] = [];
    if (l.rateDaily != null) parts.push(`${this.data.money(l.rateDaily)}/day`);
    if (l.baseWeekly != null) parts.push(`${this.data.money(l.baseWeekly)}/wk`);
    if (l.baseMonthly != null) parts.push(`${this.data.money(l.baseMonthly)}/mo`);
    if (l.unitPrice != null) parts.push(`${this.data.money(l.unitPrice)} each`);
    if (l.unitCost != null) parts.push(`${this.data.money(l.unitCost)} cost`);
    return parts.join(' · ') || '—';
  }

  editFromViewer(): void {
    const v = this.viewing;
    this.closeViewer();
    if (!v) return;
    if (v.kind === 'tax') {
      const t = this.taxes().find((x) => x.code === v.id);
      if (t) this.openTax(t);
      return;
    }
    if (v.kind === 'card') {
      const c = this.data.getPriceCard(v.id);
      if (c) this.openCard(c);
      return;
    }
    const o = this.overheads().find((x) => x.id === v.id);
    if (o) this.openOverhead(o);
  }

  private emptyOverhead(): Omit<Overhead, 'id'> & { id: string } {
    return {
      id: 'OH-' + String(this.data.listOverheads().length + 1).padStart(3, '0'),
      name: '',
      category: 'Freight/Logistics',
      chargeType: 'Flat Fee',
      pct: 0,
      cost: 0,
      retail: 0,
      locked: false,
    };
  }

  private emptyTax(): TaxSchedule {
    return { code: '', state: '', county: '', city: '', rate: 0, note: '' };
  }
}
