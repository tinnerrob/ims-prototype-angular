import { Injectable } from '@angular/core';

import {
  CatalogType,
  CATALOG_TYPE_KEYS,
  Item,
  Movement,
  MovementKind,
  Order,
  OrderLine,
  OrderStatus,
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
    orders: Order[];
    items: Record<string, Item[]>;
    movements: Movement[];
  } = {
    settings: { categories: this.seedCategories() },
    parties: this.seedParties(),
    orders: this.seedOrders(),
    items: this.seedItems(),
    movements: this.seedMovements(),
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
      if (Array.isArray(snap.orders)) this.db.orders = snap.orders;
      if (snap.items && typeof snap.items === 'object') this.db.items = snap.items;
      if (Array.isArray(snap.movements)) this.db.movements = snap.movements;
    } catch {
      /* corrupted storage -> keep seed */
    }
  }

  /** Persist the full snapshot (writes are routed through here). */
  private save(): void {
    try {
      localStorage.setItem(
        this.KEY,
        JSON.stringify({
          _v: this.VERSION,
          settings: this.db.settings,
          parties: this.db.parties,
          orders: this.db.orders,
          items: this.db.items,
          movements: this.db.movements,
        }),
      );
    } catch {
      /* storage unavailable (private mode / quota) -> in-memory only */
    }
  }

  /* ------------------------------- parties ------------------------------ */

  listParties(): Party[] {
    return [...this.db.parties];
  }

  getParty(id: string): Party | undefined {
    return this.db.parties.find((p) => p.id === id);
  }

  createParty(data: Omit<Party, 'id' | 'active'>): Party {
    const rec: Party = { ...data, id: this.nextPartyId(), active: true };
    this.db.parties.push(rec);
    this.save();
    return rec;
  }

  updateParty(id: string, patch: Partial<Party>): void {
    const p = this.db.parties.find((x) => x.id === id);
    if (p) {
      Object.assign(p, patch);
      this.save();
    }
  }

  togglePartyActive(id: string): void {
    const p = this.db.parties.find((x) => x.id === id);
    if (p) {
      p.active = p.active === false;
      this.save();
    }
  }

  removeParty(id: string): void {
    const i = this.db.parties.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.parties.splice(i, 1);
      this.save();
    }
  }

  private nextPartyId(): string {
    let max = 0;
    for (const p of this.db.parties) {
      const n = Number(p.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'PTY-' + String(max + 1).padStart(3, '0');
  }

  /* ------------------------------- orders ------------------------------- */

  listOrders(): Order[] {
    return [...this.db.orders];
  }

  getOrder(orderId: string): Order | undefined {
    return this.db.orders.find((o) => o.orderId === orderId);
  }

  createOrder(data: Omit<Order, 'orderId' | 'status' | 'lineItems'>): Order {
    const rec: Order = {
      ...data,
      orderId: this.nextOrderId(),
      status: 'active',
      lineItems: [],
    };
    this.db.orders.push(rec);
    this.save();
    return rec;
  }

  private nextOrderId(): string {
    const year = new Date().getFullYear();
    const prefix = `CT-${year}-`;
    let max = 0;
    for (const o of this.db.orders) {
      const m = o.orderId.match(/-(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
    return prefix + String(max + 1).padStart(3, '0');
  }

  /* ------------------------------- items -------------------------------- */

  private static readonly ID_PREFIX: Record<string, string> = {
    serialized: 'EQ-',
    bulk: 'BLK-',
    consumable: 'CN-',
    part: 'PRT-',
    labor: 'EMP-',
    kit: 'KIT-',
    attachment: 'ACC-',
  };

  listItems(type: CatalogType): Item[] {
    return [...(this.db.items[type] ?? [])];
  }

  getItem(type: CatalogType, id: string): Item | undefined {
    return (this.db.items[type] ?? []).find((i) => i.id === id);
  }

  createItem(type: CatalogType, data: Omit<Item, 'type' | 'id'>): Item {
    const rec: Item = { ...data, type, id: this.nextItemId(type) };
    (this.db.items[type] ??= []).push(rec);
    this.save();
    return rec;
  }

  updateItem(type: CatalogType, id: string, patch: Partial<Item>): void {
    const it = this.getItem(type, id);
    if (it) {
      Object.assign(it, patch, { type });
      this.save();
    }
  }

  removeItem(type: CatalogType, id: string): void {
    const list = this.db.items[type];
    if (!list) return;
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) {
      list.splice(i, 1);
      this.save();
    }
  }

  private nextItemId(type: CatalogType): string {
    const prefix = DataService.ID_PREFIX[type] ?? 'IT-';
    const list = this.db.items[type] ?? [];
    let max = 0;
    for (const it of list) {
      const m = it.id.match(/-(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
    return prefix + String(max + 1).padStart(3, '0');
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

  /* ----------------------------- movements ------------------------------ */

  listMovements(): Movement[] {
    return [...this.db.movements].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  /** Append an immutable movement + (for serialized items) flip custody status. */
  logMovement(input: {
    type: CatalogType;
    refId: string;
    kind: MovementKind;
    qty: number;
    orderId?: string | null;
    party?: string;
    note?: string;
  }): Movement {
    const rec: Movement = {
      id: this.nextMovementId(),
      type: input.type,
      refId: input.refId,
      kind: input.kind,
      qty: input.qty,
      orderId: input.orderId ?? null,
      party: input.party ?? '',
      at: new Date().toISOString(),
      by: 'D. Reynolds',
      note: input.note ?? '',
    };
    this.db.movements.push(rec);
    // Serialized items are whole-unit custody: an issue rents it out, a return frees it.
    if (input.type === 'serialized') {
      const it = this.getItem('serialized', input.refId);
      if (it) it.status = input.kind === 'issue' ? 'On Rent' : 'Available';
    }
    this.save();
    return rec;
  }

  /** Serialized items currently out (On Rent) — active custody. */
  custodyItems(): Item[] {
    return this.listItems('serialized').filter((i) => i.status === 'On Rent');
  }

  /** Serialized items free to issue. */
  availableItems(): Item[] {
    return this.listItems('serialized').filter((i) => i.status === 'Available');
  }

  itemLabel(type: CatalogType, id: string): string {
    const it = this.getItem(type, id);
    return it ? `${it.id} · ${it.name}` : id;
  }

  private nextMovementId(): string {
    let max = 0;
    for (const m of this.db.movements) {
      const n = Number(m.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'MV-' + String(max + 1).padStart(4, '0');
  }

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
      { id: 'PTY-003', name: 'Coastal Energy Group', contact: 'R. Vance', phone: '(404) 555-0117', email: 'supply@coastalenergy.com', billingAddress: '1 Fuel Pier, Savannah, GA', billingCycle: 'monthly', notes: 'Refinery/hazmat; risk premium applies.', active: true },
    ];
  }

  private seedOrders(): Order[] {
    return [
      {
        orderId: 'CT-2026-001',
        partyId: 'PTY-001',
        party: 'Halstead Construction',
        projectName: 'Downtown Plaza Renovation',
        jobSite: '245 Peachtree St, Atlanta, GA',
        startDate: '2026-08-20',
        endDate: '2026-09-10',
        status: 'active',
        lineItems: [
          { id: 'LI-101', type: 'serialized', refId: 'BL-119', qty: 1 },
          { id: 'LI-102', type: 'serialized', refId: 'FL-401', qty: 1 },
          { id: 'LI-103', type: 'bulk', refId: 'CN-018', qty: 50 },
        ],
      },
      {
        orderId: 'CT-2026-002',
        partyId: 'PTY-002',
        party: 'Meridian Civil Works',
        projectName: 'River Crossing — Phase 1',
        jobSite: '88 River Rd, Atlanta, GA',
        startDate: '2026-09-01',
        endDate: '2026-10-05',
        status: 'active',
        lineItems: [{ id: 'LI-201', type: 'serialized', refId: 'SS-204', qty: 1 }],
      },
    ];
  }

  private seedItems(): Record<string, Item[]> {
    return {
      serialized: [
        { id: 'EQ-101', type: 'serialized', name: 'JLG 340AJ Boom Lift 40ft', category: 'Boom Lifts', status: 'Available', qty: 1, rateDaily: 320 },
        { id: 'EQ-102', type: 'serialized', name: 'JLG 1930ES Scissor Lift', category: 'Scissor Lifts', status: 'On Rent', qty: 1, rateDaily: 180 },
        { id: 'EQ-103', type: 'serialized', name: 'CAT 315 Excavator', category: 'Excavators', status: 'In Shop', qty: 1, rateDaily: 640 },
      ],
      bulk: [
        { id: 'BLK-011', type: 'bulk', name: 'Crusher Run Stone', category: 'Bulk Materials', status: 'Available', qty: 200, rateDaily: 4 },
      ],
      consumable: [
        { id: 'CN-020', type: 'consumable', name: 'Hydraulic Filter 40um', category: 'Filters', status: 'In Stock', qty: 24, rateDaily: 0 },
      ],
      part: [
        { id: 'PRT-006', type: 'part', name: 'Track Pin & Bushing Set', category: 'Hydraulics', status: 'In Stock', qty: 8, rateDaily: 0 },
      ],
      labor: [
        { id: 'EMP-001', type: 'labor', name: 'Daniel Reynolds', category: 'Operators', status: 'Active', qty: 1, rateDaily: 320, notes: 'Equipment operator' },
        { id: 'EMP-002', type: 'labor', name: 'S. Mercer', category: 'Technicians', status: 'Active', qty: 1, rateDaily: 0 },
      ],
      kit: [],
      attachment: [
        { id: 'ACC-050', type: 'attachment', name: '48" Bucket', category: 'Buckets', status: 'Available', qty: 1, rateDaily: 60 },
      ],
    };
  }

  private seedMovements(): Movement[] {
    return [
      { id: 'MV-0001', type: 'serialized', refId: 'EQ-102', orderId: 'CT-2026-001', party: 'Halstead Construction', kind: 'issue', qty: 1, at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), by: 'D. Reynolds', note: 'Issued to order CT-2026-001' },
    ];
  }
}
