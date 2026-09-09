import { Injectable } from '@angular/core';

import { INDUSTRY_MODULES, ModuleKey } from './models';

/**
 * IMS — ModulesService (opt-in industry modules over the core).
 * Mirrors the prototype's module manifest + persisted flags. Modules default
 * ON; turning one off hides its nav entry and blocks its routes (core never
 * depends on a module). Persisted to localStorage (`ims-web.modules`).
 */
@Injectable({ providedIn: 'root' })
export class ModulesService {
  private readonly KEY = 'ims-web.modules';
  /** key -> false when explicitly disabled; absence = enabled (default). */
  private flags: Record<string, boolean> = {};

  constructor() {
    this.hydrate();
  }

  private hydrate(): void {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) this.flags = JSON.parse(raw);
    } catch {
      this.flags = {};
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.flags));
    } catch {
      /* ignore */
    }
  }

  isEnabled(key: ModuleKey): boolean {
    return this.flags[key] !== false;
  }

  setEnabled(key: ModuleKey, on: boolean): void {
    if (on) delete this.flags[key];
    else this.flags[key] = false;
    this.save();
  }

  /** All module definitions (importing for convenient iteration). */
  readonly modules = INDUSTRY_MODULES;
}
