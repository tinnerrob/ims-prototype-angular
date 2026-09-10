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

/** Category option row (prototype `IMS.settings.categories[type][]`). */
export interface CategoryOption {
  name: string;
  /** Inactive categories stay in the list but drop out of item pickers. */
  active: boolean;
}

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
  /** Per-line window (JS variant stores these); falls back to the order window. */
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  /** Minutes-of-day window in Day view; falls back to the order's. */
  t0?: number;
  t1?: number;
  /** Billing weekend policy (prototype `li.weekendPolicy`). */
  weekendPolicy?: 'bill' | 'skip' | 'overtime';
  /** Risk / environment premium key (prototype `li.riskPremium`). */
  riskPremium?: RiskPremiumKey;
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
  /** Minutes-of-day window used in Day view (defaults 08:00–17:00). */
  t0?: number;
  t1?: number;
  /** Geofence radius (m) around the job site — drives telemetry breaches. */
  geofenceRadius?: number;
  /** Job-site coordinates (telemetry map). */
  siteLat?: number;
  siteLng?: number;
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

/** Typed catalog item (core). Mirrors the prototype's per-type records behind one
 *  unified `id` (the prototype calls these id/sku/partId/accId per type).
 *  The optional fields are the prototype's per-type extras (fleet telemetry,
 *  stock reorder points, labor rates); a feature only reads the ones it needs. */
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

  /* ---- serialized fleet (prototype `IMS.itemInstances`) ---- */
  serial?: string;
  make?: string;
  model?: string;
  meterHours?: number;
  fuelType?: string;
  purchaseValue?: number;
  baseWeekly?: number;
  baseMonthly?: number;
  lat?: number;
  lng?: number;
  battery?: number;
  lastReported?: string;
  /** Order the unit is currently out on (custody link, mirrors the prototype). */
  orderId?: string | null;

  /* ---- bulk resources (prototype `IMS.bulkResources`) ---- */
  totalOwned?: number;
  qtyAvailable?: number;
  qtyOut?: number;

  /* ---- consumables / parts stock (prototype `IMS.consumables` / `IMS.parts`) ---- */
  qtyOnHand?: number;
  reorderPoint?: number;
  costPrice?: number;
  retailPrice?: number;
  bin?: string;
  locationId?: string;

  /* ---- labor / employees (prototype `IMS.labor`) ---- */
  role?: string;
  certs?: string[];
  hourlyCost?: number;
  hourlyBillable?: number;

  active?: boolean;
}

/** Reorder-warning threshold check for stock types (consumable / part). */
export function needsReorder(item: Item): boolean {
  const onHand = item.qtyOnHand ?? item.qty;
  const point = item.reorderPoint ?? 0;
  return point > 0 && onHand <= point;
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
  /** Yard / location the movement happened at. */
  location?: string;
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

/**
 * Location type — user-defined, e.g. Site, Yard, Building, Rack, Bin
 * (prototype `IMS.settings.branches`, extended for the hierarchy).
 */
export interface LocationType {
  name: string;
  /** Inactive types stay in the list but drop out of the location pickers. */
  active: boolean;
}

/**
 * Location in a ragged (adjacency-list) hierarchy.
 *
 * A location has at most ONE parent (`parentId`, null for a root) and any
 * number of children; any node may itself be a parent, at any depth. This
 * mirrors a DB `locations` table with a self-referencing `parent_id` column
 * and a `location_type` column.
 */
export interface Location {
  id: string;
  name: string;
  /** Location type name (see `LocationType`). */
  type: string;
  /** Parent location id, or null/undefined for a top-level location. */
  parentId?: string | null;
  address: string;
  phone: string;
  tz: string;
}

/** Sales-tax jurisdiction (prototype `IMS.settings.taxSchedules`). */
export interface TaxSchedule {
  code: string;
  state: string;
  county: string;
  city: string;
  rate: number;
  note: string;
}

/** Overhead / service-fee configuration (prototype `IMS.settings.overheads`). */
export interface Overhead {
  id: string;
  name: string;
  category: 'Facility' | 'Freight/Logistics' | 'Compliance';
  chargeType: 'Flat Fee' | 'Percent of Equipment Total' | 'Per Mile' | 'Per Day';
  pct: number;
  cost: number;
  retail: number;
  /** Auto-injected into every new order. */
  locked: boolean;
}

export const OVERHEAD_CATEGORIES: Overhead['category'][] = ['Facility', 'Freight/Logistics', 'Compliance'];
export const OVERHEAD_CHARGE_TYPES: Overhead['chargeType'][] = [
  'Flat Fee',
  'Percent of Equipment Total',
  'Per Mile',
  'Per Day',
];

export type RiskPremiumKey = 'standard' | 'coastal' | 'hazmat';

/** Pricing rules engine (prototype `IMS.settings.pricing`). */
export interface PricingSettings {
  dailyMinHours: number;
  weeklyHours: number;
  cycleDays: number;
  weekendPolicyDefault: 'bill' | 'skip' | 'overtime';
  riskPremiums: Record<RiskPremiumKey, number>;
  envFeePct: number;
  depreciationAnnual: number;
}

export const WEEKEND_POLICIES: PricingSettings['weekendPolicyDefault'][] = ['bill', 'skip', 'overtime'];

/** The operating yard (geofence centre on the telemetry map). */
export interface Yard {
  name: string;
  lat: number;
  lng: number;
}


export type InspectionDirection = 'Check-Out' | 'Check-In';

/** Condition checks captured on the yard inspection form. */
export type InspectionCheckKey = 'tires' | 'fluids' | 'guards' | 'lights' | 'engine';

export const INSPECTION_CHECKS: InspectionCheckKey[] = ['tires', 'fluids', 'guards', 'lights', 'engine'];

export const INSPECTION_CHECK_LABEL: Record<InspectionCheckKey, string> = {
  tires: 'Tires / Tracks',
  fluids: 'Fluids',
  guards: 'Safety Guards',
  lights: 'Lights',
  engine: 'Engine',
};

/** Yard in/out inspection (prototype `IMS.inspections`). */
export interface Inspection {
  id: string;
  itemId: string; // serialized asset id
  orderId?: string | null;
  direction: InspectionDirection;
  date: string; // ISO date
  meterOut?: number | null;
  meterIn?: number | null;
  fuelOut?: number | null;
  fuelIn?: number | null;
  checks: Record<InspectionCheckKey, boolean>;
  photos?: number;
  status: 'Open' | 'Closed';
  notes?: string;
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
  { key: 'scheduling', label: 'Scheduling', desc: 'Plan availability and scheduling of inventory over time.' },
  { key: 'dispatch', label: 'Logistics & Dispatch', desc: 'Dispatch board for deliveries, pickups, and routes.' },
  { key: 'telemetry', label: 'Fleet Telemetry', desc: 'Live fleet telemetry and geofence monitoring.' },
  { key: 'labor', label: 'Labor & Timesheets', desc: 'Labor time records against orders and work orders.' },
  { key: 'service', label: 'Field Service & Maintenance', desc: 'Field service and maintenance work orders on items.' },
  { key: 'rentals', label: 'Rentals & Sub-Rentals', desc: 'Rental / sub-rental loans from third-party vendors.' },
  { key: 'billing', label: 'Billing & Invoicing', desc: 'Invoice generation derived from priced orders.' },
];

export type WorkOrderStatus = 'In Progress' | 'Completed' | 'Pending' | 'Scheduled';

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = ['In Progress', 'Completed', 'Pending', 'Scheduled'];

/** A part/consumable consumed by a work order (prototype `w.parts[]`). */
export interface WorkOrderPart {
  kind: 'part' | 'consumable';
  refId: string;
  qty: number;
}

/** Service / maintenance work order (prototype `IMS.workOrders`). */
export interface WorkOrder {
  id: string;
  itemId: string; // serialized asset under service
  type: string; // service type: Preventive | Repair | Inspection
  meterReading: number;
  status: WorkOrderStatus;
  parts: WorkOrderPart[];
  laborHours: number;
  date: string; // ISO date
  notes?: string;
}

export const SERVICE_TYPES = ['Preventive', 'Repair', 'Inspection'];

/** Cost roll-up for a work order (prototype `woComputed`). */
export interface WorkOrderCost {
  partsCost: number;
  laborCost: number;
  total: number;
  laborRate: number;
}


export type TimesheetTarget = 'order' | 'workorder' | 'shop' | 'overhead' | 'idle' | 'lunch';

/** Display metadata per time-record target (prototype `TS_KIND`). */
export const TIMESHEET_KIND: Record<TimesheetTarget, { label: string; icon: string; cls: string }> = {
  order: { label: 'Job', icon: 'bi-briefcase', cls: 'ts-order' },
  workorder: { label: 'Work Order', icon: 'bi-tools', cls: 'ts-wo' },
  shop: { label: 'Shop', icon: 'bi-wrench-adjustable', cls: 'ts-shop' },
  overhead: { label: 'Overhead', icon: 'bi-diagram-3', cls: 'ts-overhead' },
  idle: { label: 'Idle', icon: 'bi-hourglass-split', cls: 'ts-idle' },
  lunch: { label: 'Lunch', icon: 'bi-cup-hot', cls: 'ts-lunch' },
};

export const TIMESHEET_TARGETS: TimesheetTarget[] = ['order', 'workorder', 'shop', 'overhead', 'idle', 'lunch'];

/** A labour clock segment (prototype `IMS.timesheets` row). */
export interface Timesheet {
  id: string;
  empId: string; // labor item id (EMP-…)
  date: string; // "YYYY-MM-DD"
  clockIn: string; // "HH:mm"
  /** null while the segment is still running (the employee is clocked in). */
  clockOut: string | null;
  targetType: TimesheetTarget;
  /** Order id / work-order id for job-backed segments, else null. */
  targetId: string | null;
  /** Hours worked; null while running (prototype stores null too). */
  hours: number | null;
  note?: string;
}


export interface RentalSub {
  id: string;
  /** Catalog item when the sub-rental maps to one (prototype `assetId`). */
  itemId?: string | null;
  assetName: string;
  /** Customer contract the sub-rental is billed against. */
  orderId?: string | null;
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

export const DISPATCH_STATUSES: DispatchStatus[] = ['Staged', 'En Route', 'Delivered', 'Pending Return'];

/** Dispatch board row (prototype `IMS.dispatches`). */
export interface Dispatch {
  id: string;
  orderId: string;
  assetId?: string | null;
  routeSeq: number;
  driverId?: string | null;
  vehicleId?: string | null;
  status: DispatchStatus;
}

export type InvoiceStatus = 'pending' | 'invoiced' | 'paid';

export const INVOICE_STATUSES: InvoiceStatus[] = ['pending', 'invoiced', 'paid'];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: 'Pending',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

/** Cycle invoice (prototype `IMS.invoices`). */
export interface Invoice {
  id: string;
  orderId: string;
  cycle: number;
  cycleStart: string;
  cycleEnd: string;
  envFeePct: number;
  damageWaiver: boolean;
  fuelCharge: number;
  taxRate: number;
  status: InvoiceStatus;
}

/** Totals breakdown for an invoice (prototype `invoiceTotals`). */
export interface InvoiceTotals {
  base: number;
  envFee: number;
  waiver: number;
  fuel: number;
  tax: number;
  total: number;
}

/* --------------------------- badge helpers ---------------------------- */

/** Status -> `badge-status st-*` suffix (prototype `STATUS_CLS`). */
const STATUS_CLS: Record<string, string> = {
  Available: 'available',
  'On Rent': 'onrent',
  'In Shop': 'inshop',
  Staged: 'staged',
  'In Use': 'inuse',
  Inactive: 'out',
  Active: 'active',
  Completed: 'closed',
  'In Progress': 'inprogress',
  Pending: 'reorder',
  Scheduled: 'inshop',
  Delivered: 'available',
  'Pending Return': 'reorder',
  'En Route': 'on',
  Open: 'on',
  Closed: 'closed',
  Low: 'out',
  'In Stock': 'available',
  Committed: 'staged',
  draft: 'closed',
  closed: 'closed',
  active: 'active',
};

/** Map any status string to its badge class. */
export function statusClass(status: string): string {
  return STATUS_CLS[status] ?? 'available';
}











