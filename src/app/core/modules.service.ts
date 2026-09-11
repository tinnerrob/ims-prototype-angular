import { computed, Injectable, Signal } from '@angular/core';

import { DataService } from './data.service';
import { INDUSTRY_MODULES, ModuleKey } from './models';

/**
 * IMS — ModulesService (opt-in industry modules over the core).
 *
 * A module is a licence, not a browser preference. The flags live on the tenant
 * (`Tenant.disabledModules` — the row the API will own and the plan will gate),
 * and this service is only the reactive read/write in front of them, so the nav,
 * the route guards and the admin switches can never disagree about what's on.
 * Modules default ON; turning one off hides its nav entry and blocks its routes
 * (core never depends on a module).
 */
@Injectable({ providedIn: 'root' })
export class ModulesService {
  /** key -> enabled, materialised from the active tenant's licence flags. */
  readonly flags: Signal<Record<string, boolean>>;

  /** All module definitions (importing for convenient iteration). */
  readonly modules = INDUSTRY_MODULES;

  constructor(private readonly data: DataService) {
    this.flags = computed(() => {
      this.data.revision();
      return this.data.moduleFlags();
    });
  }

  isEnabled(key: ModuleKey): boolean {
    return this.flags()[key] !== false;
  }

  /** Licence-flag write (the admin page's switch), persisted on the tenant. */
  setEnabled(key: ModuleKey, on: boolean): void {
    this.data.setTenantModule(key, on);
  }
}

