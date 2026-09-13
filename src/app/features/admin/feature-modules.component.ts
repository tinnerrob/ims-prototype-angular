import { Component } from '@angular/core';

import { INDUSTRY_MODULES, ModuleKey, TENANT_PLAN_LABEL } from '../../core/models';
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
 * (js/pages/config.js) as it stands now: the per-module on/off switches that gate
 * navigation + routes, rendered as an Admin submenu.
 *
 * The prototype's **Industry / Vertical** selector is gone: the workspace's
 * business type — and with it the catalog's shape — is chosen on **Business type &
 * Categories** (`/admin/verticals`), which owns the industry outright
 * (`tenants.vertical_id`; the compiled registry's key is derived from it). Two
 * screens setting the same thing is what made that switch redundant, so this page
 * keeps only the licence flags.
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

  constructor(
    readonly mods: ModulesService,
    readonly session: SessionService,
  ) {}

  /** Workspace the licence flags belong to (they are tenant data, not a pref). */
  tenantName(): string {
    return this.session.tenant()?.name ?? '';
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
}
