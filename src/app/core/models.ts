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

export type OrderStatus = 'draft' | 'active' | 'closed';

export interface OrderLine {
  id: string;
  type: CatalogType;
  refId: string;
  qty: number;
}

export interface Order {
  orderId: string;
  partyId: string;
  party: string;
  projectName: string;
  jobSite: string;
  startDate: string;
  endDate: string;
  status: OrderStatus;
  lineItems: OrderLine[];
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
};

export type ItemStatus =
  | 'Available'
  | 'On Rent'
  | 'In Use'
  | 'In Shop'
  | 'Staged'
  | 'Active'
  | 'Inactive'
  | 'In Stock'
  | 'Low'
  | 'Committed';

/** Typed catalog item (core). Common shape across types; vertical-specific
 *  fields (meter hours, lot, …) will live in an `extended` map in a later slice. */
export interface Item {
  id: string;
  type: CatalogType;
  name: string;
  category: string;
  status: ItemStatus;
  /** on-hand / owned quantity (1 for serialized & labor) */
  qty: number;
  /** daily retail rate (rentable types) or 0 */
  rateDaily: number;
  notes?: string;
}

/** Per-type statuses offered in the Items & Stock editor. */
export const ITEM_STATUSES: Record<CatalogType, ItemStatus[]> = {
  serialized: ['Available', 'On Rent', 'In Shop', 'Staged'],
  bulk: ['Available', 'Committed'],
  consumable: ['In Stock', 'Low'],
  part: ['In Stock', 'Low'],
  labor: ['Active', 'Inactive'],
  kit: ['Available', 'On Rent', 'In Shop'],
  attachment: ['Available', 'On Rent'],
};


