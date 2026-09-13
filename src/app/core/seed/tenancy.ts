/* The demo fixture, in modules: 3 data factories.
   ---------------------------------------------------------------------------
   These came out of `DataService` (see angular-refactor-log.md, P6/2). Every function
   here is a *pure data factory* — literal rows, no store access — which is exactly why
   it could move. The store keeps the parts of the fixture that must run *through* it
   (`seedItems` / `seedStockItems` / `seedStockLevels` / `seedMovements` / `seedPlacement`
   / `seedReceipts`), because those post receipts and level the shelves with the same
   mutators the pages use.

   Nothing here decides anything: the rows are the fixture, and `check:store` asserts them.
   Order within a file follows the store, so a reader can compare them side by side. */

import { CatalogType, Dispatch, FormField, FormSchema, Tenant, User, VerticalKey, Yard, can } from '../models';
import { ASSET_FIELD_DEFAULTS, DEMO_TENANT_ID } from './fixtures';

/**
 * The default form schemas: one per catalog type, naming the extra facts that
 * industry records carry beyond the fixed columns. A tenant may edit or extend
 * these — the *fields* are the flexible layer; a fact that has to be queried
 * still becomes a column (see `docs/PLAN-B.md`, §1).
 */
export function seedFormSchemas(): FormSchema[] {
  const item = (type: CatalogType, name: string, seededFrom: VerticalKey, fields: FormField[]): FormSchema => ({
    id: `FS-item-${type}`,
    name,
    scope: 'item',
    type,
    seededFrom,
    active: true,
    version: 1,
    fields,
  });
  return [
    item('serialized', 'Equipment details', 'HeavyEquipment', ASSET_FIELD_DEFAULTS.serialized),
    item('bulk', 'Material details', 'Lumberyard', ASSET_FIELD_DEFAULTS.bulk),
    item('consumable', 'Supply details', 'Warehouse', ASSET_FIELD_DEFAULTS.consumable),
    // The clinic's supply schema (B3): the same catalog type, a different set of
    // fields — a vertical's tab names it explicitly (`formSchema`).
    {
      id: 'FS-item-consumable-clinic',
      name: 'Clinical supply details',
      scope: 'item',
      type: 'consumable',
      seededFrom: 'Healthcare',
      active: true,
      version: 1,
      fields: [
        { key: 'manufacturerPartNo', label: 'Manufacturer Part No.', kind: 'text' },
        { key: 'lot', label: 'Lot', kind: 'text' },
        { key: 'expiry', label: 'Expiry', kind: 'date' },
        { key: 'storageTemp', label: 'Storage Temp', kind: 'measurement', unit: '°C', min: -50, max: 60 },
      ],
    },
    item('part', 'Part details', 'HeavyEquipment', ASSET_FIELD_DEFAULTS.part),
    item('labor', 'Personnel details', 'HeavyEquipment', ASSET_FIELD_DEFAULTS.labor),
    item('attachment', 'Attachment details', 'HeavyEquipment', ASSET_FIELD_DEFAULTS.attachment),
    item('kit', 'Kit details', 'HeavyEquipment', ASSET_FIELD_DEFAULTS.kit),
    // The default inspection checklist (B7): the five condition checks that used
    // to be a fixed union, now data a tenant can edit or replace.
    {
      id: 'FS-inspection-default',
      name: 'Yard in/out inspection',
      scope: 'inspection',
      seededFrom: 'HeavyEquipment',
      active: true,
      version: 1,
      fields: [
        { key: 'tires', label: 'Tires / Tracks', kind: 'select', options: ['Good', 'Worn', 'Damaged'] },
        { key: 'fluids', label: 'Fluids', kind: 'select', options: ['Full', 'Low', 'Leaking'] },
        { key: 'guards', label: 'Safety Guards', kind: 'select', options: ['In place', 'Loose', 'Missing'] },
        { key: 'lights', label: 'Lights', kind: 'select', options: ['Working', 'Faulty'] },
        { key: 'engine', label: 'Engine', kind: 'select', options: ['Normal', 'Noisy', 'Fault'] },
      ],
    },
  ];
}

/* ----------------------- identity & tenancy seeds ---------------------- */

/**
 * The customer workspaces. One is seeded because the UI runs against a single
 * browser today; the shape is what matters — the API resolves a tenant from
 * the signed-in user and every query is scoped to it.
 */
export function seedTenants(): Tenant[] {
  return [
    {
      id: DEMO_TENANT_ID,
      name: 'Northline Equipment Co.',
      slug: 'northline',
      plan: 'professional',
      // The business type this workspace is — `VT-001` is the first seeded type
      // (Heavy Equipment), which is also the default the fallback lands on.
      verticalId: 'VT-001',
      disabledModules: [],
      createdAt: '2024-01-08',
    },
  ];
}

/**
 * Seeded people — one per role, so the shell's user switcher can demonstrate
 * exactly what each permission set can and cannot do.
 */
export function seedUsers(): User[] {
  return [
    { id: 'USR-001', tenantId: DEMO_TENANT_ID, name: 'Marcus Alvarez', email: 'marcus@northline.example', role: 'owner', title: 'Managing Director', initials: 'MA', active: true },
    { id: 'USR-002', tenantId: DEMO_TENANT_ID, name: 'Priya Raman', email: 'priya@northline.example', role: 'admin', title: 'Operations Administrator', initials: 'PR', active: true },
    { id: 'USR-003', tenantId: DEMO_TENANT_ID, name: 'Dana Reynolds', email: 'dana@northline.example', role: 'manager', title: 'Dispatch Manager', initials: 'DR', active: true },
    { id: 'USR-004', tenantId: DEMO_TENANT_ID, name: 'Ray Chen', email: 'ray@northline.example', role: 'warehouse', title: 'Warehouse Lead', initials: 'RC', active: true },
    { id: 'USR-005', tenantId: DEMO_TENANT_ID, name: 'Tunde Okafor', email: 'tunde@northline.example', role: 'field', title: 'Field Technician', initials: 'TO', active: true },
    { id: 'USR-006', tenantId: DEMO_TENANT_ID, name: 'Sandra Patel', email: 'sandra@northline.example', role: 'viewer', title: 'Accountant', initials: 'SP', active: true },
  ];
}
