import { Injectable } from '@angular/core';

import {
  CatalogType,
  CATALOG_TYPE_KEYS,
  Party,
} from './models';

/**
 * IMS — DataService (the JSON store / API seam).
 *
 * Faithful first port of the prototype's `IMS.store`: a small in-memory
 * database behind typed accessors, persisted to localStorage, versioned so a
 * stale snapshot is ignored on upgrade. A future `HttpClient` adapter can swap
 * these synchronous methods for async JSON without touching feature code.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly KEY = 'ims-web.store';
  private readonly VERSION = 1;

  private db: {
    settings: { categories: Record<string, string[]> };
    parties: Party[];
  } = {
    settings: { categories: this.seedCategories() },
    parties: this.seedParties(),
  };

  constructor() {
    this.hydrate();
  }

  /* ----------------------------- persistence ---------------------------- */

  /** Restore a previously persisted snapshot if the version matches. */
  private hydrate(): void {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (!snap || snap._v !== this.VERSION) return; // stale/incompatible -> reseed
      if (snap.settings?.categories) this.db.settings.categories = snap.settings.categories;
      if (Array.isArray(snap.parties)) this.db.parties = snap.parties;
    } catch {
      /* corrupted storage -> keep seed */
    }
  }

  /** Persist the full snapshot (writes are routed through here). */
  private save(): void {
    try {
      localStorage.setItem(
        this.KEY,
        JSON.stringify({ _v: this.VERSION, settings: this.db.settings, parties: this.db.parties }),
      );
    } catch {
      /* storage unavailable (private mode / quota) -> in-memory only */
    }
  }

  /* ------------------------------- parties ------------------------------ */

  listParties(): Party[] {
    return [...this.db.parties];
  }

  /* ------------------------------ categories ---------------------------- */

  /** Live, mutable per-type category arrays (names), seeded for every type. */
  get categories(): Record<string, string[]> {
    return this.db.settings.categories;
  }

  categoriesFor(type: CatalogType): string[] {
    return [...(this.db.settings.categories[type] ?? [])];
  }

  addCategory(type: CatalogType, name: string): void {
    const list = (this.db.settings.categories[type] ??= []);
    const clean = name.trim();
    if (!clean || list.includes(clean)) return;
    list.push(clean);
    this.save();
  }

  renameCategory(type: CatalogType, oldName: string, newName: string): void {
    const list = this.db.settings.categories[type];
    const clean = newName.trim();
    if (!list || !clean) return;
    const i = list.indexOf(oldName);
    if (i >= 0 && !list.includes(clean)) {
      list[i] = clean;
      this.save();
    }
  }

  removeCategory(type: CatalogType, name: string): void {
    const list = this.db.settings.categories[type];
    if (!list) return;
    const i = list.indexOf(name);
    if (i >= 0) {
      list.splice(i, 1);
      this.save();
    }
  }

  /** Ensure every catalog type has a (possibly empty) category array. */
  ensureCategoryTables(): void {
    for (const t of CATALOG_TYPE_KEYS) {
      this.db.settings.categories[t] ??= [];
    }
    this.save();
  }

  /* -------------------------------- seeds ------------------------------- */

  private seedCategories(): Record<string, string[]> {
    return {
      serialized: ['Boom Lifts', 'Scissor Lifts', 'Forklifts', 'Excavators', 'Cranes'],
      bulk: ['Bulk Materials', 'Concrete', 'Sand & Gravel'],
      consumable: ['Filters', 'Hoses', 'Lubricants'],
      part: ['Filters', 'Hardware', 'Hoses', 'Hydraulics'],
      labor: ['Operators', 'Technicians', 'CDL Drivers'],
      kit: ['Lift Kits', 'Pump Kits'],
      attachment: ['Buckets', 'Augers', 'Grapples'],
    };
  }

  private seedParties(): Party[] {
    return [
      { id: 'PTY-001', name: 'Halstead Construction', contact: 'M. Halstead', phone: '(404) 555-0134', email: 'projects@halstead.com', billingAddress: '100 Peachtree Pkwy NE, Atlanta, GA', billingCycle: 'weekly', notes: 'Boom & aerial work; weekly cadence.', active: true },
      { id: 'PTY-002', name: 'Meridian Civil Works', contact: 'L. Bishop', phone: '(678) 555-0192', email: 'ops@meridiancivil.com', billingAddress: '88 River Rd, Atlanta, GA', billingCycle: 'bi-weekly', notes: 'Bridge / heavy civil. Net-30 terms.', active: true },
    ];
  }
}
