import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import {
  OVERHEAD_CATEGORIES,
  OVERHEAD_CHARGE_TYPES,
  Overhead,
  PricingSettings,
  RiskPremiumKey,
  TaxSchedule,
  WEEKEND_POLICIES,
} from '../../core/models';

/**
 * Pricing & Policies (administration) — port of the prototype's `renderPricing`
 * (js/pages/pricing.js): the pricing rules engine form, the overhead / service
 * fee configuration grid and the sales-tax schedule grid.
 */
@Component({
  selector: 'ims-pricing',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './pricing.component.html',
  styleUrl: './pricing.component.scss',
})
export class PricingComponent {
  readonly weekendPolicies = WEEKEND_POLICIES;
  readonly overheadCategories = OVERHEAD_CATEGORIES;
  readonly overheadChargeTypes = OVERHEAD_CHARGE_TYPES;

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

  taxOpen = false;
  taxEditingCode: string | null = null;
  taxForm: TaxSchedule = this.emptyTax();

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

  closeOverhead(): void {
    this.overheadOpen = false;
    this.overheadEditingId = null;
  }

  /* ------------------------------- taxes -------------------------------- */

  openTax(t?: TaxSchedule): void {
    this.taxEditingCode = t ? t.code : null;
    this.taxForm = t ? { ...t } : this.emptyTax();
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

  closeTax(): void {
    this.taxOpen = false;
    this.taxEditingCode = null;
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
