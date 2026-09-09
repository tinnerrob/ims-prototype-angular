/**
 * IMS — core domain models.
 * Mirrors the vanilla-JS prototype's normalized vocabulary
 * (party / order / item / movement) with typed Angular models.
 * Port grows as features are added; keep field names aligned with the
 * prototype's `IMS` seed + the JSON `apiAdapter` contract.
 */

export type CatalogType =
  | 'serialized'
  | 'bulk'
  | 'consumable'
  | 'part'
  | 'labor'
  | 'kit'
  | 'attachment';

export interface CatalogTypeDef {
  key: CatalogType;
  label: string;
}

export const CATALOG_TYPES: CatalogTypeDef[] = [
  { key: 'serialized', label: 'Serialized Equipment' },
  { key: 'bulk', label: 'Bulk Resources' },
  { key: 'consumable', label: 'Consumables' },
  { key: 'part', label: 'Stock / Parts' },
  { key: 'labor', label: 'Labor / Employees' },
  { key: 'kit', label: 'Kits' },
  { key: 'attachment', label: 'Attachments' },
];

export const CATALOG_TYPE_KEYS: CatalogType[] = CATALOG_TYPES.map((t) => t.key);

export interface Party {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  billingAddress: string;
  billingCycle: string;
  notes: string;
  active?: boolean;
}
