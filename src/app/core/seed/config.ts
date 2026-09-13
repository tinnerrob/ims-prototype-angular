/* The demo fixture, in modules: 9 data factories.
   ---------------------------------------------------------------------------
   These came out of `DataService` (see angular-refactor-log.md, P6/2). Every function
   here is a *pure data factory* — literal rows, no store access — which is exactly why
   it could move. The store keeps the parts of the fixture that must run *through* it
   (`seedItems` / `seedStockItems` / `seedStockLevels` / `seedMovements` / `seedPlacement`
   / `seedReceipts`), because those post receipts and level the shelves with the same
   mutators the pages use.

   Nothing here decides anything: the rows are the fixture, and `check:store` asserts them.
   Order within a file follows the store, so a reader can compare them side by side. */

import { Category, Location, LocationType, Overhead, PricingSettings, ReceivingSettings, StockSchema, TaxSchedule, User, VERTICAL_KEYS, Vehicle, Vertical, Yard, behaviourOfType, verticalLabel } from '../models';
import { pct } from '../format';
import { VERTICAL_METADATA } from '../vertical-metadata';
import { ASSET_FIELD_DEFAULTS } from './fixtures';
import { pad3 } from '../format';

/**
 * User-defined location types. These are the vocabulary the location editor
 * offers and the levels a ragged hierarchy is usually built from.
 */
export function seedLocationTypes(): LocationType[] {
  return ['Site', 'Yard', 'Zone', 'Warehouse', 'Rack', 'Shelf', 'Bin', 'Dock', 'Office', 'Customer Site', 'Vehicle']
    .map((name) => ({ name, active: true }));
}

/**
 * Location hierarchy (ragged / adjacency list). Demonstrates that any node
 * may be a parent and that depth is unbounded. `parentId: null` = top level.
 */
export function seedLocations(): Location[] {
  return [
    { id: 'LOC-01', name: 'Atlanta Main Campus', type: 'Site', parentId: null, address: '1200 Logistics Dr, Atlanta GA', phone: '(404) 555-0100', tz: 'America/New_York' },
    { id: 'LOC-02', name: 'Main Yard', type: 'Yard', parentId: 'LOC-01', address: '1200 Logistics Dr, Atlanta GA', phone: '(404) 555-0101', tz: 'America/New_York' },
    { id: 'LOC-03', name: 'Yard A — Equipment Staging', type: 'Zone', parentId: 'LOC-02', address: '1200 Logistics Dr, Atlanta GA', phone: '', tz: 'America/New_York' },
    { id: 'LOC-04', name: 'Yard B — Trailer Parking', type: 'Zone', parentId: 'LOC-02', address: '1200 Logistics Dr, Atlanta GA', phone: '', tz: 'America/New_York' },
    { id: 'LOC-05', name: 'Warehouse 1', type: 'Warehouse', parentId: 'LOC-01', address: '1210 Logistics Dr, Atlanta GA', phone: '(404) 555-0120', tz: 'America/New_York' },
    { id: 'LOC-06', name: 'Aisle 1', type: 'Rack', parentId: 'LOC-05', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-07', name: 'Bay A1-01', type: 'Bin', parentId: 'LOC-06', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-08', name: 'Bay A1-02', type: 'Bin', parentId: 'LOC-06', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-09', name: 'Aisle 2', type: 'Rack', parentId: 'LOC-05', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-10', name: 'Savannah Port Depot', type: 'Site', parentId: null, address: '8 Terminal Way, Savannah GA', phone: '(912) 555-0177', tz: 'America/New_York' },
    { id: 'LOC-11', name: 'Dock 4', type: 'Dock', parentId: 'LOC-10', address: '8 Terminal Way, Savannah GA', phone: '', tz: 'America/New_York' },
    { id: 'LOC-12', name: 'Bonded Warehouse', type: 'Warehouse', parentId: 'LOC-10', address: '10 Terminal Way, Savannah GA', phone: '(912) 555-0178', tz: 'America/New_York' },
    { id: 'LOC-13', name: 'Secure Cage C', type: 'Zone', parentId: 'LOC-12', address: '', phone: '', tz: 'America/New_York' },
    /* The bins the prototype's parts carried as free text (`bin: 'A-03'`, …)
       now live in the hierarchy they always described — a part's `locationId`
       points at one of these rows instead of repeating its label. */
    { id: 'LOC-14', name: 'Bay A-03', type: 'Bin', parentId: 'LOC-06', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-15', name: 'Bay A-07', type: 'Bin', parentId: 'LOC-06', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-16', name: 'Bay B-01', type: 'Bin', parentId: 'LOC-09', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-17', name: 'Bay B-12', type: 'Bin', parentId: 'LOC-09', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-18', name: 'Aisle 3', type: 'Rack', parentId: 'LOC-05', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-19', name: 'Bay C-04', type: 'Bin', parentId: 'LOC-18', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-20', name: 'Aisle 4', type: 'Rack', parentId: 'LOC-05', address: '', phone: '', tz: 'America/New_York' },
    { id: 'LOC-21', name: 'Bay D-02', type: 'Bin', parentId: 'LOC-20', address: '', phone: '', tz: 'America/New_York' },
  ];
}

/** Sales-tax schedules (prototype `IMS.settings.taxSchedules`). */
export function seedTaxSchedules(): TaxSchedule[] {
  return [
    { code: 'GA', state: 'Georgia', county: 'Fulton', city: 'Atlanta', rate: 0.08, note: 'State + county combined' },
    { code: 'AL', state: 'Alabama', county: '', city: '', rate: 0.07, note: 'Standard state rate' },
    { code: 'TN', state: 'Tennessee', county: 'Davidson', city: 'Nashville', rate: 0.0925, note: 'Highest local rate' },
  ];
}

/** Overhead / service-fee configurations (prototype `IMS.settings.overheads`). */
export function seedOverheads(): Overhead[] {
  return [
    { id: 'OH-ENV', name: 'Environmental Fee Surcharge', category: 'Freight/Logistics', chargeType: 'Percent of Equipment Total', cost: 0, retail: 0, pct: 2.5, locked: true },
    { id: 'OH-MOB', name: 'Standard Mobilization / Delivery', category: 'Freight/Logistics', chargeType: 'Flat Fee', cost: 150, retail: 250, pct: 0, locked: true },
    { id: 'OH-PMT', name: 'Oversized Transport Permit', category: 'Compliance', chargeType: 'Flat Fee', cost: 75, retail: 110, pct: 0, locked: false },
    { id: 'OH-STR', name: 'Warehouse Storage Slot B', category: 'Facility', chargeType: 'Per Day', cost: 40, retail: 95, pct: 0, locked: false },
  ];
}

/** Pricing rules engine defaults (prototype `IMS.settings.pricing`). */
export function seedPricing(): PricingSettings {
  return {
    dailyMinHours: 8,
    weeklyHours: 40,
    cycleDays: 28,
    weekendPolicyDefault: 'bill',
    riskPremiums: { standard: 0, coastal: 0.15, hazmat: 0.25 },
    envFeePct: 5,
    depreciationAnnual: 0.1,
  };
}

/** Receiving desk defaults (B6): an exact receipt, no PO reference required. */
export function seedReceiving(): ReceivingSettings {
  return {
    overReceiptTolerancePct: 0,
    requirePoReference: false,
    quarantineLocationId: null,
    defaultPutAwayLocationId: null,
    requireInspection: false,
  };
}

/** The fields every asset carries (Phase C) — none against the core columns to start. */
export function seedStockSchema(): StockSchema {
  return { fields: [] };
}

/**
 * A workspace's default verticals: the compiled registry's five (Phase C). They
 * are *seed* data — the tenant edits and adds to them from Admin.
 */
export function seedVerticals(): Vertical[] {
  return VERTICAL_KEYS.map((key, i) => ({
    id: `VT-${pad3(i + 1)}`,
    name: verticalLabel(key),
    slug: key.toLowerCase(),
    active: true,
    isDefault: key === 'HeavyEquipment',
  }));
}

/**
 * A workspace's default categories: each vertical's tabs become **its** categories
 * — named by the tab, stocked by the tab's behaviour, in the tab's order — with the
 * type's default fields copied on. Seeded from the registry so the demo workspace
 * works out of the box, then owned by the tenant.
 */
export function seedAssetCategories(): Category[] {
  const out: Category[] = [];
  let n = 0;
  VERTICAL_KEYS.forEach((key, vi) => {
    const meta = VERTICAL_METADATA[key];
    const verticalId = `VT-${pad3(vi + 1)}`;
    meta.tabs.forEach((tab, sort) => {
      const type = tab.key;
      out.push({
        id: `CAT-${pad3(++n)}`,
        verticalId,
        name: tab.label,
        icon: tab.icon,
        behaviour: behaviourOfType(type),
        type,
        active: true,
        sort,
        fields: (ASSET_FIELD_DEFAULTS[type] ?? []).map((f) => ({ ...f })),
      });
    });
  });
  return out;
}
