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

export type MovementKind = 'issue' | 'return' | 'receive' | 'transfer' | 'adjust';

/** Immutable chain-of-custody record (core). Issue = out to an order/party;
 *  return = back to a location. Never mutate a written movement. */
export interface Movement {
  id: string;
  type: CatalogType;
  refId: string;
  orderId?: string | null;
  party?: string;
  kind: MovementKind;
  qty: number;
  at: string; // ISO timestamp
  by: string;
  note?: string;
}

export const MOVEMENT_KIND_LABEL: Record<MovementKind, string> = {
  issue: 'Issue',
  return: 'Return',
  receive: 'Receive',
  transfer: 'Transfer',
  adjust: 'Adjust',
};

export type LocationType = 'yard' | 'branch' | 'warehouse' | 'bin';

export interface Location {
  id: string;
  name: string;
  type: LocationType;
  address: string;
  parentId?: string | null;
}

export const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  yard: 'Yard',
  branch: 'Branch',
  warehouse: 'Warehouse',
  bin: 'Bin',
};

export type InspectionDirection = 'out' | 'in';

export interface Inspection {
  id: string;
  itemId: string; // serialized item
  date: string; // ISO date
  direction: InspectionDirection;
  meter: number;
  fuel: number;
  notes?: string;
  status: 'Open' | 'Closed';
}

/* ------------------------- industry modules --------------------------- */

export type ModuleKey =
  | 'scheduling'
  | 'dispatch'
  | 'telemetry'
  | 'labor'
  | 'service'
  | 'rentals'
  | 'billing';

export interface IndustryModuleDef {
  key: ModuleKey;
  label: string;
  desc: string;
}

/** Industry modules layered on the IMS core (all core-only deps today). */
export const INDUSTRY_MODULES: IndustryModuleDef[] = [
  { key: 'scheduling', label: 'Allocations & Scheduling', desc: 'Plan availability and allocation of inventory over time.' },
  { key: 'dispatch', label: 'Logistics & Dispatch', desc: 'Dispatch board for deliveries, pickups, and routes.' },
  { key: 'telemetry', label: 'Fleet Telemetry', desc: 'Live fleet telemetry and geofence monitoring.' },
  { key: 'labor', label: 'Labor & Timesheets', desc: 'Labor time records against orders and work orders.' },
  { key: 'service', label: 'Field Service & Maintenance', desc: 'Field service and maintenance work orders on items.' },
  { key: 'rentals', label: 'Rentals & Sub-Rentals', desc: 'Rental / sub-rental loans from third-party vendors.' },
  { key: 'billing', label: 'Billing & Invoicing', desc: 'Invoice generation derived from priced orders.' },
];

export type WorkOrderStatus = 'Open' | 'In Progress' | 'Completed';
export type WorkOrderPriority = 'low' | 'normal' | 'high';

export interface WorkOrder {
  id: string;
  itemId: string; // serialized item under service
  title: string;
  serviceType: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  openedAt: string; // ISO date
  notes?: string;
}

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = ['Open', 'In Progress', 'Completed'];

export interface Timesheet {
  id: string;
  empId: string; // labor item id (EMP-…)
  date: string; // ISO date
  hours: number;
  orderId?: string | null;
  targetLabel: string; // display target (order id, shop, etc.)
  note?: string;
}

export interface RentalSub {
  id: string;
  itemId?: string | null; // catalog item when it maps to one
  assetName: string;
  vendor: string;
  vendorCost: number; // daily cost to us
  retailRate: number; // daily billable
  qty: number;
  note?: string;
}

export interface Vehicle {
  id: string;
  name: string;
  plate: string;
  status: 'Available' | 'En Route' | 'In Use' | 'Out of Service';
}

export type DispatchStatus = 'Staged' | 'En Route' | 'Delivered' | 'Pending Return';

export interface Dispatch {
  id: string;
  orderId: string;
  orderLabel: string;
  itemId?: string | null;
  vehicleId: string;
  driverId?: string | null;
  status: DispatchStatus;
}

export const DISPATCH_STATUSES: DispatchStatus[] = ['Staged', 'En Route', 'Delivered', 'Pending Return'];









