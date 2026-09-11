import { Component } from '@angular/core';

import { DataService } from '../../core/data.service';
import { CatalogType, INDUSTRY_MODULES, ModuleKey, TENANT_PLAN_LABEL, VERTICALS } from '../../core/models';
import { VerticalMetadata } from '../../core/vertical-metadata';
import { ModulesService } from '../../core/modules.service';
import { SessionService } from '../../core/session.service';

/** Core (always-on) modules listed on the admin page (prototype `CORE_MODULES`). */
const CORE_MODULES = [
  'Operations Dashboard',
  'Assets',
  'Categories & Types',
  'Locations',
  'Item Hand-Off & Custody',
  'Receiving / Inspections',
  'Parties & Orders',
];

/**
 * Administration → Feature Modules — port of the prototype's `renderConfig`
 * (js/pages/config.js): the industry-vertical selector plus per-module on/off
 * switches that gate navigation + routes. Rendered as an Admin submenu.
 */
@Component({
  selector: 'ims-feature-modules',
  standalone: true,
  templateUrl: './feature-modules.component.html',
  styleUrl: './feature-modules.component.scss',
})
export class FeatureModulesComponent {
  readonly modules = INDUSTRY_MODULES;
  readonly core = CORE_MODULES;
  readonly verticals = VERTICALS;

  constructor(
    readonly data: DataService,
    readonly mods: ModulesService,
    readonly session: SessionService,
  ) {}

  /** Workspace the licence flags belong to (they are tenant data, not a pref). */
  tenantName(): string {
    return this.session.tenant()?.name ?? '';
  }

  /** The active tenant's vertical metadata — what the switch above re-shapes. */
  meta(): VerticalMetadata {
    return this.data.verticalMeta();
  }

  /** Where a tab sits in the list (the panel marks the page's opening tab). */
  tabIndex(type: CatalogType): number {
    return this.meta().tabs.findIndex((t) => t.key === type);
  }

  planLabel(): string {
    const t = this.session.tenant();
    return t ? TENANT_PLAN_LABEL[t.plan] : '';
  }

  on(key: ModuleKey): boolean {
    return this.mods.isEnabled(key);
  }

  toggle(key: ModuleKey): void {
    this.mods.setEnabled(key, !this.on(key));
  }

  /** Re-enable every optional module (prototype "Enable All"). */
  enableAll(): void {
    for (const m of this.modules) this.mods.setEnabled(m.key, true);
  }

  setVertical(v: string): void {
    this.data.setVertical(v);
  }
}
