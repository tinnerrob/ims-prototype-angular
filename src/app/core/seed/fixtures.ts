/* The fixture's shared facts (P6/2, see angular-refactor-log.md).
   ---------------------------------------------------------------------------
   Which locations the demo stock sits in, which tenant and person the fixture is
   attributed to, where the crew is based. Both sides of the fixture need them — the seed
   modules and `DataService` itself (a receipt lands in Yard A staging; the session opens
   as the demo user) — so they live here, below both, rather than inside the store. */

import { CatalogType, Dispatch, FormField, Yard, can } from '../models';

/** The seeded demo workspace + the person the session starts as. */
export const DEMO_TENANT_ID = 'TNT-NORTHLINE';

export const DEMO_USER_ID = 'USR-003';

/** Who the fixtures are attributed to (the workspace owner, in a real install). */
export const DEMO_OWNER_ID = 'USR-001';

/**
 * Seeded placement ids (`settings.locations`) — the fixtures' `locationId`
 * values. Named because the alternative is eight call sites repeating `'LOC-03'`
 * and a reader who can't tell a yard from a warehouse without scrolling to the
 * location seed.
 */
export const YARD_STAGING = 'LOC-03'; // Yard A — equipment staging (machines, bulk, attachments)

export const WAREHOUSE_1 = 'LOC-05'; // Warehouse 1 (kits, the shop's own stock)

/** Where a unit that is in the shop sits (vs. staged in the yard). */
export const SHOP_STATUS = 'In Shop';

/**
 * Where a crew member is **based**, by the department they work in (Phase C): a
 * person carries a place too (their home base), the same single FK a machine has.
 */
export const CREW_BASE: Record<string, string> = {
  Field: YARD_STAGING, // operators muster in the yard
  Shop: WAREHOUSE_1, // technicians work out of the shop
  Dispatch: 'LOC-04', // drivers park up in Yard B
};

/**
 * The default field set per catalog type (B2) — shared by the seeded `form_schemas`
 * **and** the seeded asset categories (Phase C), so the two cannot drift. A
 * category seeded from the registry starts with its type's fields; a tenant then
 * owns them.
 */
export const ASSET_FIELD_DEFAULTS: Record<CatalogType, FormField[]> = {
  serialized: [
    { key: 'emissionsTier', label: 'Emissions Tier', kind: 'select', options: ['Tier 4 Final', 'Tier 4', 'Tier 3'] },
    { key: 'warrantyExpiry', label: 'Warranty Expiry', kind: 'date' },
    { key: 'gpsTrackerId', label: 'GPS Tracker ID', kind: 'text' },
  ],
  bulk: [
    { key: 'grade', label: 'Grade', kind: 'text' },
    { key: 'moisturePct', label: 'Moisture', kind: 'measurement', unit: '%', min: 0, max: 100 },
  ],
  consumable: [{ key: 'manufacturerPartNo', label: 'Manufacturer Part No.', kind: 'text' }],
  part: [
    { key: 'manufacturerPartNo', label: 'Manufacturer Part No.', kind: 'text' },
    { key: 'torqueSpec', label: 'Torque Spec', kind: 'measurement', unit: 'Nm', min: 0 },
  ],
  labor: [
    { key: 'licenceNo', label: 'Licence No.', kind: 'text' },
    { key: 'certExpiry', label: 'Certification Expiry', kind: 'date' },
  ],
  attachment: [
    { key: 'couplerType', label: 'Coupler Type', kind: 'select', options: ['Pin-on', 'Quick Coupler', 'Hydraulic'] },
    { key: 'weightKg', label: 'Weight', kind: 'measurement', unit: 'kg', min: 0 },
  ],
  kit: [],
};
