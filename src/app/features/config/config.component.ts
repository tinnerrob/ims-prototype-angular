import { Component } from '@angular/core';

import { DataService } from '../../core/data.service';
import { INDUSTRY_MODULES, ModuleKey } from '../../core/models';
import { ModulesService } from '../../core/modules.service';

/** Vertical options (prototype `IMS.metadata.verticals`). */
const VERTICALS: Record<string, string> = {
  HeavyEquipment: 'Heavy Equipment Rental',
  Rental: 'General Rental',
  Healthcare: 'Healthcare',
  Lumberyard: 'Lumberyard',
  Warehouse: 'Warehouse / 3PL',
};

/** Core (always-on) modules listed on the admin page (prototype `CORE_MODULES`). */
const CORE_MODULES = [
  'Operations Dashboard',
  'Items & Stock',
  'Categories & Types',
  'Locations',
  'Item Hand-Off & Custody',
  'Receiving / Inspections',
  'Parties & Orders',
];

/**
 * Administration: Feature Modules — port of the prototype's `renderConfig`
 * (js/pages/config.js): the industry-vertical selector plus per-module
 * on/off switches that gate navigation + routes.
 */
@Component({
  selector: 'ims-config',
  standalone: true,
  templateUrl: './config.component.html',
  styleUrl: './config.component.scss',
})
export class ConfigComponent {
  readonly modules = INDUSTRY_MODULES;
  readonly core = CORE_MODULES;
  readonly verticals = VERTICALS;
  readonly verticalKeys = Object.keys(VERTICALS);

  constructor(
    readonly data: DataService,
    readonly mods: ModulesService,
  ) {}

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
