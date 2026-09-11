/**
 * IMS — core domain models.
 * Mirrors the vanilla-JS prototype's normalized vocabulary
 * (party / order / item / movement) with typed Angular models.
 * Port grows as features are added; keep field names aligned with the
 * prototype's `IMS` seed + the JSON `apiAdapter` contract.
 */

/**
 * The tenancy + author columns every table in the store carries.
 *
 * Optional in the types only because a fixture (or a JSON payload that has not
 * been migrated yet) may omit them: the store stamps them on every write, and
 * the seed backfills what predates this. The API owns the real values — this is
 * the shape it has to have, written down where the schema designer will see it:
 *
 *   tenant_id  uuid NOT NULL REFERENCES tenants(id)   -- every query is scoped by it
 *   created_at timestamptz NOT NULL DEFAULT now()
 *   created_by uuid NOT NULL REFERENCES users(id)
 *   updated_at timestamptz NOT NULL
 *   updated_by uuid NOT NULL REFERENCES users(id)
 */
export interface AuditFields {
  /** Owning workspace. */
  tenantId?: string;
  createdAt?: string; // ISO timestamp
  createdBy?: string; // user id
  updatedAt?: string; // ISO timestamp
  updatedBy?: string; // user id
}

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

export interface Party extends AuditFields {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  billingAddress: string;
  billingCycle: string;
  notes: string;
  /**
   * Which side of a transaction this counterparty can be (a role, not a type).
   *
   * Customers and suppliers are the same kind of row — a business the tenant
   * deals with, with one address and one contact — so they share this table and
   * differ by the roles they carry. Orders pick `customer` partners, purchase
   * orders pick `supplier` partners, and a partner that is both (a dealer that
   * buys and rents) is one row with two roles rather than two rows that can
   * drift apart. Absent = treated as a customer (every pre-A5 row).
   */
  kinds?: PartyKind[];
  active?: boolean;
}

/** What a counterparty is to us (see `Party.kinds`). */
export type PartyKind = 'customer' | 'supplier';

export const PARTY_KINDS: PartyKind[] = ['customer', 'supplier'];

export const PARTY_KIND_LABEL: Record<PartyKind, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
};

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

export interface Order extends AuditFields {
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
export interface Item extends AuditFields {
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

  /* ---- labor / employees (prototype `IMS.labor`) ---- */
  role?: string;
  certs?: string[];
  hourlyCost?: number;
  hourlyBillable?: number;

  /* ---- placement (join key into the location hierarchy) ---- */

  /**
   * Where the item physically sits — a FK into `settings.locations`, so a yard
   * zone, a warehouse aisle, a rack or a single bin are all one thing (a node),
   * and stock can be counted per place.
   *
   * This replaces the prototype's free-text `bin` string: a shelf label *is* a
   * location row here (`LocationType` already includes `Bin`), and keeping both
   * would be two models of one fact. Absent = not stock (labor) or not yet
   * placed — never a made-up default.
   */
  locationId?: string;

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
 *  return = back to a location. Never mutate a written movement.
 *
 *  `byUserId` is a foreign key, not a name: the ledger has to answer "who" with
 *  a person the system knows, so a rename or a departure cannot rewrite history. */
export interface Movement extends AuditFields {
  id: string;
  type: CatalogType;
  refId: string;
  orderId?: string | null;
  party?: string;
  /**
   * Where the movement happened — a FK into `settings.locations`
   * (`movements.location_id → locations.id`), the same column shape as
   * `Item.locationId`.
   *
   * The ledger is append-only, so a name stored here could never be corrected
   * when a yard is renamed, and "what left Yard A this month?" is an equality
   * test rather than a substring search. The movement's *place* is therefore the
   * same row the unit's own placement points at, and its label is resolved at
   * read time (`locationPath`).
   */
  locationId?: string;
  kind: MovementKind;
  qty: number;
  /**
   * The purchase receipt this movement came from — the buying-side counterpart
   * of `orderId`. A `receive` movement points at the receipt (which points at
   * the purchase order and its supplier), so "where did this stock come from?"
   * is a join, not a note.
   */
  receiptId?: string | null;
  at: string; // ISO timestamp
  /** User id that performed the movement (see `DataService.userName`). */
  byUserId: string;
  note?: string;
}

export const MOVEMENT_KIND_LABEL: Record<MovementKind, string> = {
  issue: 'Issue',
  return: 'Return',
  receive: 'Receive',
  transfer: 'Transfer',
  adjust: 'Adjust',
};

/* ------------------------------ purchasing ------------------------------ */
/*
 * The buying side of the spine: a supplier is a party (see `Party.kinds`), a
 * purchase order says what was ordered, and a *receipt* is the document that
 * makes stock exist. Two rules shape the types below, and both are deliberate:
 *
 * 1. `PurchaseOrder` stores no copy of what arrived. How much of a line has been
 *    received is summed from the receipts (`receipts[].lines[]`), so an order
 *    cannot claim stock the ledger doesn't have — the same "derive at read time,
 *    never store a second copy" rule the location spine follows.
 * 2. A receipt is posted, never edited. It moved quantities and placed rows, so
 *    it is append-only like a movement; a wrong receipt is corrected by a new
 *    adjustment, not by rewriting history.
 */

/** The document's own lifecycle — chosen by a person, not derived. */
export type PurchaseOrderStatus = 'draft' | 'ordered' | 'cancelled';

export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = ['draft', 'ordered', 'cancelled'];

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  cancelled: 'Cancelled',
};

/**
 * How much has turned up, summed from the receipts. Kept out of the stored row
 * on purpose (see the note above), and shown beside the lifecycle status.
 */
export type PurchaseProgress = 'none' | 'partial' | 'received';

export const PO_PROGRESS_LABEL: Record<PurchaseProgress, string> = {
  none: 'Awaiting delivery',
  partial: 'Partially received',
  received: 'Received',
};

export interface PurchaseOrderLine {
  id: string;
  type: CatalogType;
  /**
   * The catalog row this line restocks (parts, consumables, bulk, kits,
   * attachments — a receipt tops the row up). Absent for a serialized line,
   * which describes units that do not exist yet: receiving it creates one row
   * per unit (see `ReceiptLine.refId`).
   */
  refId?: string;
  /** What was ordered. Required when `refId` is absent (a new unit). */
  description: string;
  qty: number;
  unitCost: number;
  /** Billable daily rate to bill a *new* unit at (serialized lines only). */
  rateDaily?: number;
}

export interface PurchaseOrder extends AuditFields {
  id: string;
  /** FK -> `parties.id`, a partner carrying the `supplier` kind. */
  supplierId: string;
  status: PurchaseOrderStatus;
  orderedAt: string; // "YYYY-MM-DD"
  expectedAt: string; // "YYYY-MM-DD"
  /** The supplier's own number / quote, for matching their paperwork. */
  reference?: string;
  notes?: string;
  lines: PurchaseOrderLine[];
}

export interface ReceiptLine {
  id: string;
  poLineId: string;
  type: CatalogType;
  /**
   * The row the stock landed on: the restocked SKU, or the unit this line
   * created. Always a real row, so a receipt can be read back into
   * `itemsAtLocation()` — the receiving side of the item ↔ location spine.
   */
  refId: string;
  qty: number;
  unitCost: number;
}

/** A posted goods receipt: the document that makes `qtyOnHand` mean something. */
export interface Receipt extends AuditFields {
  id: string;
  /** FK -> `purchase_orders.id`. */
  poId: string;
  /** FK -> `parties.id` (copied from the order, as the document's own fact). */
  supplierId: string;
  /** FK -> `settings.locations` — where the stock was put away. */
  locationId: string;
  at: string; // ISO timestamp
  note?: string;
  lines: ReceiptLine[];
}

/** Serialized units arrive as whole rows (one machine, one row). */
export function isUnitStock(type: CatalogType): boolean {
  return type === 'serialized';
}

/** Labor is a person, not stock — nothing can be purchased into it. */
export function isPurchasable(type: CatalogType): boolean {
  return type !== 'labor';
}

export const PURCHASABLE_TYPES: CatalogType[] = CATALOG_TYPES.map((t) => t.key).filter(isPurchasable);

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
export interface Location extends AuditFields {
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
export interface Inspection extends AuditFields {
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

/* ------------------------- identity & tenancy -------------------------- */
/*
 * The SaaS boundary. Every record in the store belongs to a `Tenant`, and every
 * write is attributed to a `User`. Roles are permission bundles, so a screen
 * never asks "is this an admin?" — it asks `can(user, 'stock.adjust')`.
 *
 * This is the spec for the tables the API will own:
 *   tenants(id, name, slug, plan, vertical, created_at)
 *   tenant_modules(tenant_id, module_key, enabled)   -- the licence flags
 *   users(id, tenant_id, name, email, role, title, initials, active)
 */

export type RoleKey = 'owner' | 'admin' | 'manager' | 'warehouse' | 'field' | 'viewer';

/** A capability a role may hold. Screens gate on these, never on the role. */
export type Permission =
  | 'items.view'
  | 'items.edit'
  | 'items.delete'
  | 'stock.view'
  | 'stock.move'
  | 'stock.adjust'
  | 'locations.view'
  | 'locations.manage'
  | 'parties.view'
  | 'parties.edit'
  | 'orders.view'
  | 'orders.edit'
  | 'costs.view'
  | 'settings.manage'
  | 'modules.manage'
  | 'users.manage';

export const ALL_PERMISSIONS: Permission[] = [
  'items.view',
  'items.edit',
  'items.delete',
  'stock.view',
  'stock.move',
  'stock.adjust',
  'locations.view',
  'locations.manage',
  'parties.view',
  'parties.edit',
  'orders.view',
  'orders.edit',
  'costs.view',
  'settings.manage',
  'modules.manage',
  'users.manage',
];

/** Read-only baseline every role inherits. */
const VIEW_BASELINE: Permission[] = [
  'items.view',
  'stock.view',
  'locations.view',
  'parties.view',
  'orders.view',
];

export interface RoleDef {
  key: RoleKey;
  label: string;
  desc: string;
  permissions: Permission[];
}

export const ROLES: RoleDef[] = [
  {
    key: 'owner',
    label: 'Owner',
    desc: 'The account holder — every capability, including billing and the tenant itself.',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'admin',
    label: 'Administrator',
    desc: 'Runs the workspace: catalog, locations, modules and users.',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'manager',
    label: 'Manager',
    desc: 'Full inventory and order authority, including cost and margin visibility.',
    permissions: [
      ...VIEW_BASELINE,
      'items.edit',
      'items.delete',
      'stock.move',
      'stock.adjust',
      'locations.manage',
      'parties.edit',
      'orders.edit',
      'costs.view',
      'settings.manage',
    ],
  },
  {
    key: 'warehouse',
    label: 'Warehouse',
    desc: 'Moves and counts stock; no pricing, cost or delete rights.',
    permissions: [...VIEW_BASELINE, 'items.edit', 'stock.move', 'stock.adjust'],
  },
  {
    key: 'field',
    label: 'Field',
    desc: 'Issues and returns stock from the field, against a read-only catalog.',
    permissions: [...VIEW_BASELINE, 'stock.move'],
  },
  {
    key: 'viewer',
    label: 'Viewer',
    desc: 'Read-only — for accountants, auditors and stakeholders.',
    permissions: [...VIEW_BASELINE],
  },
];

export const ROLE_KEYS: RoleKey[] = ROLES.map((r) => r.key);

/** The role definition for a key (falls back to the least-privileged role). */
export function roleDef(key: RoleKey): RoleDef {
  return ROLES.find((r) => r.key === key) ?? ROLES[ROLES.length - 1];
}

export function roleLabel(key: RoleKey): string {
  return roleDef(key).label;
}

export type TenantPlan = 'starter' | 'professional' | 'enterprise';

export const TENANT_PLANS: TenantPlan[] = ['starter', 'professional', 'enterprise'];

export const TENANT_PLAN_LABEL: Record<TenantPlan, string> = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

/** A customer workspace — the top of the tenancy tree. */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  /** Active industry vertical (drives catalog tabs + per-vertical field sets). */
  vertical: VerticalKey;
  /** Licence flags: a module absent from this list is enabled (default on). */
  disabledModules: ModuleKey[];
  createdAt: string;
}

/** A person who may sign in. `role` is the permission bundle; `title` is their job. */
export interface User {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: RoleKey;
  title: string;
  /** Avatar initials for the shell chip. */
  initials: string;
  active: boolean;
}

/** True when the user's role holds the capability. Null/undefined → no rights. */
export function can(user: Pick<User, 'role'> | null | undefined, perm: Permission): boolean {
  return !!user && roleDef(user.role).permissions.includes(perm);
}

export type VerticalKey = 'HeavyEquipment' | 'Rental' | 'Healthcare' | 'Lumberyard' | 'Warehouse';

/** Vertical options (prototype `IMS.metadata.verticals`). */
export const VERTICALS: { key: VerticalKey; label: string }[] = [
  { key: 'HeavyEquipment', label: 'Heavy Equipment Rental' },
  { key: 'Rental', label: 'General Rental' },
  { key: 'Healthcare', label: 'Healthcare' },
  { key: 'Lumberyard', label: 'Lumberyard' },
  { key: 'Warehouse', label: 'Warehouse / 3PL' },
];

export const VERTICAL_KEYS: VerticalKey[] = VERTICALS.map((v) => v.key);

export function verticalLabel(key: string): string {
  return VERTICALS.find((v) => v.key === key)?.label ?? key;
}

export type WorkOrderStatus = 'In Progress' | 'Completed' | 'Pending' | 'Scheduled';

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = ['In Progress', 'Completed', 'Pending', 'Scheduled'];

/** A part/consumable consumed by a work order (prototype `w.parts[]`). */
export interface WorkOrderPart {
  kind: 'part' | 'consumable';
  refId: string;
  qty: number;
}

/** Service / maintenance work order (prototype `IMS.workOrders`). */
export interface WorkOrder extends AuditFields {
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
export interface Timesheet extends AuditFields {
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


export interface RentalSub extends AuditFields {
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

export interface Vehicle extends AuditFields {
  id: string;
  name: string;
  plate: string;
  status: 'Available' | 'En Route' | 'In Use' | 'Out of Service';
}

export type DispatchStatus = 'Staged' | 'En Route' | 'Delivered' | 'Pending Return';

export const DISPATCH_STATUSES: DispatchStatus[] = ['Staged', 'En Route', 'Delivered', 'Pending Return'];

/** Dispatch board row (prototype `IMS.dispatches`). */
export interface Dispatch extends AuditFields {
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
export interface Invoice extends AuditFields {
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











