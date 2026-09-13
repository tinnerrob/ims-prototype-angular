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

/* ------------------- the tenant's catalog (Phase C) ------------------- */
/*
 * The catalog's *shape* — which tabs a workspace shows, what each is called, what
 * it holds and what fields it carries — is the tenant's own data here, not a
 * compiled registry. The registry (`core/vertical-metadata.ts`) survives only as
 * the seed a new workspace starts from. See `docs/PLAN-C.md`.
 *
 * A **category** is the tenant's row (`asset_categories`): it is the only place a
 * category is defined. The prototype's per-type name list (`IMS.settings.
 * categories`, `CategoryOption`) is gone — its screen, store and model went with
 * it, and `items.category` is now the name *derived* from this row.
 */

/** How an asset category holds stock — the one fact the spine keys off. */
export type AssetBehaviour = 'serialized' | 'quantity' | 'labor';

export const ASSET_BEHAVIOURS: AssetBehaviour[] = ['serialized', 'quantity', 'labor'];

export const ASSET_BEHAVIOUR_LABEL: Record<AssetBehaviour, string> = {
  serialized: 'Serialized — one unique unit each',
  quantity: 'Quantity — many of the same asset',
  labor: 'Person — not stock, based in a place',
};

/** The behaviour a spine type falls under (Phase C) — the *user-facing* summary. */
export function behaviourOfType(type: CatalogType): AssetBehaviour {
  if (type === 'serialized') return 'serialized';
  if (type === 'labor') return 'labor';
  return 'quantity';
}

/**
 * The spine type a behaviour means for a *new* category. The seven `CatalogType`s
 * carry nuances a two-way choice cannot (a bulk row's owned/available split, a
 * kit's levels, a part's reorder status), so the pair is stored: `behaviour` is
 * what the user picks, `type` is what the spine reads, and a seeded category keeps
 * its exact type. A brand-new `quantity` category starts as generic counted stock.
 */
export function typeForBehaviour(behaviour: AssetBehaviour): CatalogType {
  if (behaviour === 'serialized') return 'serialized';
  if (behaviour === 'labor') return 'labor';
  return 'consumable';
}

/**
 * A tenant-authored industry grouping (Phase C). A vertical **groups categories**
 * and fixes their order — the "tabs" the Assets page shows are its categories, and
 * a category's own name is the tab's label.
 */
export interface Vertical extends AuditFields {
  id: string;
  name: string;
  /** URL-safe handle (also how the tenant's choice maps to a row). */
  slug: string;
  active: boolean;
  /** The vertical a workspace lands on. */
  isDefault: boolean;
}

/**
 * A tenant-authored asset category (Phase C): a vertical's tab, what it holds and
 * how it is stocked. Its `fields` are the category's own; the fields **every**
 * category shares live in the tenant's `StockSchema` (`FormsService.fieldsFor`
 * unions the two). `behaviour` is the only thing the stock spine reads.
 */
export interface Category extends AuditFields {
  id: string;
  /** FK -> `verticals.id`. */
  verticalId: string;
  /** The tab's label — the category's own name. */
  name: string;
  /** Bootstrap Icons class for the tab strip. */
  icon: string;
  behaviour: AssetBehaviour;
  /**
   * The spine type behind the behaviour. A seeded category keeps its exact type
   * (bulk, part, kit…), and a new one gets the behaviour's default — because the
   * seven types carry nuances a two-way choice cannot (a bulk row's owned/available
   * split, a part's reorder status). `behaviour` is the user-facing summary.
   */
  type: CatalogType;
  active: boolean;
  /** Position in its vertical's tab strip. */
  sort: number;
  fields: FormField[];
}

/**
 * What a tenant supplies when creating a category (Phase C). `type` is **not** in
 * it: the store derives it from `behaviour` (`typeForBehaviour`), so the two can
 * never disagree.
 */
export type CategoryDraft = Omit<Category, 'id' | 'verticalId' | 'sort' | 'type'>;

/**
 * The fields every asset carries, whatever its category (Phase C) — the **stock
 * set**. One row per tenant, like `pricing`; an asset's fields are this unioned
 * with its category's.
 */
export interface StockSchema extends AuditFields {
  fields: FormField[];
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

export const PARTY_KIND_LABEL: Record<PartyKind, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
};

/**
 * One negotiated rate on a party's card (see `PriceCard`).
 *
 * A line names a catalog row and replaces whichever rate the *catalog* would
 * have supplied. Which slot a document reads is decided by the direction it
 * faces: an order (we bill) reads the rent/price slots, a purchase order (we
 * pay) reads `unitCost`. The fields are the item's own rate field names, so a
 * reader can say "the card's `rateDaily`, or the item's" without a translation.
 */
export interface PriceCardLine {
  type: CatalogType;
  refId: string;
  /** Negotiated daily rate for a rented type (`Item.rateDaily`). */
  rateDaily?: number;
  /** Negotiated weekly / monthly basis (`Item.baseWeekly` / `baseMonthly`). */
  baseWeekly?: number;
  baseMonthly?: number;
  /** Negotiated one-time price: labor hourly bill, consumable retail, part price. */
  unitPrice?: number;
  /** Negotiated cost we pay for it (`Item.costPrice`) — the buying side's rate. */
  unitCost?: number;
}

/**
 * A counterparty's negotiated price list — the rate card.
 *
 * Rates live on `items.rateDaily` and in `settings.pricing` (the rules engine);
 * a customer's negotiated numbers are neither, so they get their own table
 * against `parties`. The card is **read**, not copied: an order's amount is
 * derived at read time (`lineTotal()` → `cardRateFor()`), so the card line is the
 * only place its price is written down — renaming or repricing a card moves every
 * order it covers at once, the A10 argument applied to money instead of a name.
 *
 * That is also why the window exists. A renewal is a *new* card with a later
 * `effectiveFrom`, never an edit of the old one: an order prices at the card in
 * force on the day its booking starts, so last year's contracts keep last year's
 * prices. A card is not referenced by any row (nothing holds a `price_card_id`),
 * so removing one re-prices the orders it priced rather than dangling — the
 * effect is visible on those screens, and `active = false` is how a card is
 * retired while it still has to be readable.
 */
export interface PriceCard extends AuditFields {
  id: string;
  /** FK -> `parties.id`. The counterparty the rates were negotiated with. */
  partyId: string;
  /** What the agreement is called (`2026 Master Agreement`). */
  name: string;
  active: boolean;
  /** ISO date the rates apply from (absent = open-ended backwards). */
  effectiveFrom?: string;
  /** ISO date they apply through, inclusive (absent = until replaced). */
  effectiveTo?: string;
  lines: PriceCardLine[];
  note?: string;
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

export interface Order extends AuditFields {
  orderId: string;
  /**
   * The counterparty — a FK into `parties.id`. The customer's *name* is not
   * stored beside it: display strings are resolved at read time
   * (`partyName(partyId)`), so renaming a partner renames every screen at once
   * rather than leaving copies of the old name behind.
   */
  partyId: string;
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
   * would be two models of one fact. Absent = not yet placed — never a made-up
   * default. A **person** carries one too (their home base); what marks them out
   * is that their place is not a shelf of stock (see `placements`).
   *
   * For **counted stock** (`isCountedStock`) this is the row's *home* place, not
   * its whole placement: the quantities live in `stock_levels`, one row per
   * place, and this field is derived from them — the place holding the most —
   * by the same write that refreshes `qtyOnHand` (see `DataService.placements`
   * and `syncStockTotals`). It is what a grid column, a tip and a receipt's
   * default destination read; a *move* is what actually re-places stock.
   */
  locationId?: string;

  /**
   * The industry-specific facts a `FormSchema` captured (B2) — a lot number, an
   * expiry, a calibration date. A `jsonb` payload validated against the schema in
   * force for this row's `type` (`FormsService`); the schema is the contract, this
   * is the payload. A key that becomes a *searched / sorted / joined* fact is
   * promoted to a real column rather than filtered out of the blob (see
   * `docs/PLAN-B.md`, §1 and D1). Absent = none captured.
   */
  attributes?: Record<string, unknown>;

  /**
   * The unit is on **hold** (B8): held back from the pool — for QC, a customer
   * dispute, an open service job. A held unit is not *out* (custody is the
   * ledger's), it is simply not offered: `availableItems()` filters it, so the
   * scheduler and Hand-Off agree. Absent = not held.
   */
  hold?: boolean;

  /**
   * The tenant category this row belongs to (Phase C) — the FK the screens join
   * on. `type`/`category` are the pre-Phase-C shape and retire in C5; until then
   * the store keeps them in step with this.
   */
  categoryId?: string;

  active?: boolean;
}

/** Reorder-warning threshold check for stock types (consumable / part). */
export function needsReorder(item: Item): boolean {
  const onHand = item.qtyOnHand ?? item.qty;
  const point = item.reorderPoint ?? 0;
  return point > 0 && onHand <= point;
}


/** Per-type statuses offered in the Assets editor. */
export const ITEM_STATUSES: Record<CatalogType, ItemStatus[]> = {
  serialized: ['Available', 'On Rent', 'In Shop', 'Staged'],
  bulk: ['Available', 'Committed'],
  consumable: ['In Stock', 'Low'],
  part: ['In Stock', 'Low'],
  labor: ['Active', 'Inactive'],
  kit: ['Available', 'On Rent', 'In Shop'],
  attachment: ['Available', 'On Rent'],
};

export type MovementKind = 'issue' | 'return' | 'receive' | 'transfer' | 'adjust' | 'return-to-vendor';

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
  'return-to-vendor': 'Return to Vendor',
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
  /**
   * The line is closed short: the outstanding quantity is not coming (B6). A
   * chosen fact, not derived — and the PO reads `received` without inventing
   * stock, because `poLineOutstanding()` treats a short-closed line as complete.
   */
  shortClosed?: boolean;
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
  /**
   * FK -> `settings.locations` — the place *this* landing went to. One receipt
   * line per place a quantity landed (a line may split across bins, B6), so a
   * receipt reads back place by place rather than only to its header destination.
   */
  locationId: string;
  /** How it arrived (B6): a `damaged` landing goes to the quarantine place. */
  condition?: ReceivingCondition;
  /** The quantity that arrived damaged (equal to `qty` for a damaged landing). */
  damagedQty?: number;
  /** A supplier's reason code for the damage / discrepancy. */
  reasonCode?: string;
  /** The receipt-line schema payload (lot / expiry) — B2. */
  attributes?: Record<string, unknown>;
}

/** A posted goods receipt: the document that makes `qtyOnHand` mean something. */
export interface Receipt extends AuditFields {
  id: string;
  /** FK -> `purchase_orders.id`. */
  poId: string;
  /** FK -> `parties.id` (copied from the order, as the document's own fact). */
  supplierId: string;
  /**
   * FK -> `settings.locations` — the receipt's header (default) put-away. Each
   * landed quantity's *actual* place is on its own line (`ReceiptLine.locationId`),
   * and a landing that names none uses this. A receipt that does not split has
   * this place and every line's place identical.
   */
  locationId: string;
  at: string; // ISO timestamp
  note?: string;
  lines: ReceiptLine[];
}

/** Serialized units arrive as whole rows (one machine, one row). */
export function isUnitStock(type: CatalogType): boolean {
  return type === 'serialized';
}

/**
 * Stock held *at a place* — one row per (item, location) pair, with the
 * quantity of that item sitting there.
 *
 * This is the answer to "one SKU, one place", which a single
 * `Item.locationId` could not give: a part can be stocked in two bins with two
 * counts, and the bins are *rows* rather than a string beside the item. It is
 * the shape a real backend needs, spelled out where the schema designer looks:
 *
 *   stock_levels(
 *     tenant_id  uuid NOT NULL,
 *     item_id    uuid NOT NULL REFERENCES items(id),
 *     location_id uuid NOT NULL REFERENCES locations(id),
 *     qty        numeric NOT NULL CHECK (qty > 0),
 *     PRIMARY KEY (item_id, location_id)
 *   )
 *
 * Two rules make it the *truth* rather than a second copy of one:
 *
 * 1. **A row exists only while it holds something** (`qty > 0`). An emptied
 *    place loses its row, so "where is this stock?" is `SELECT … WHERE
 *    item_id = …` with no zero rows to filter, and the composite key above can
 *    be the primary key.
 * 2. **`qtyOnHand` (and a bulk row's `qtyAvailable` / `totalOwned`) is this
 *    table's sum.** Nothing writes those fields directly: the store recomputes
 *    them — and the row's *home* place (`Item.locationId`, the place holding the
 *    most) — every time a level row moves (see `DataService.syncStockTotals`).
 *
 * Only **level-tracked** stock (see `isLevelTracked`) is held in levels — counted
 * stock, and since B4 kits and attachments. A serialized unit is a
 * thing rather than a quantity: a machine sits in exactly one place, so its
 * `Item.locationId` *is* its placement and it needs no table. A person's is the
 * same shape — one home base, not a shelf — because a person is not a quantity
 * either.
 */
export interface StockLevel extends AuditFields {
  /** Composite key, written out: `<item id>@<location id>` (e.g. `PRT-001@LOC-14`). */
  id: string;
  type: CatalogType;
  /** FK -> `items.id` (the row whose stock this is). */
  refId: string;
  /** FK -> `settings.locations` (the place holding it). */
  locationId: string;
  qty: number;
  /**
   * The per-place facts a stock-level `FormSchema` captures (B5) — a `lot`, an
   * `expiry`, a `hold`. A `jsonb` payload like `Item.attributes`; the schema is the
   * contract. A level that carries attributes can only be moved **whole** (half a
   * lot is not a fact the model can state), and a key that becomes a predicate is
   * promoted to a column (see `docs/PLAN-B.md`, §1).
   */
  attributes?: Record<string, unknown>;
}

/** Whether a count session is still being worked or has been posted (B5). */
export type CountSessionStatus = 'draft' | 'posted';

/** One row of a count sheet: what the place should hold, and what was found (B5). */
export interface CountLine {
  /** `<item id>@<location id>` — the level it counts (unique within a session). */
  id: string;
  itemType: CatalogType;
  itemId: string;
  locationId: string;
  /** What the level held when the sheet was opened. */
  expected: number;
  /** What the counter entered (defaults to `expected`). */
  counted?: number;
}

/**
 * A cycle-count sheet (B5): one place's levels frozen for review, then posted as
 * one `adjust` movement per difference. The document the A6/A8 notes called "not
 * modelled yet" — a count that is a *batch* rather than one row at a time.
 */
export interface CountSession extends AuditFields {
  id: string;
  /** FK -> `settings.locations` — the place counted. */
  locationId: string;
  /** Count the node's whole subtree (a zone) or just the node (a bin). */
  subtree: boolean;
  status: CountSessionStatus;
  openedAt: string; // ISO timestamp
  postedAt?: string;
  lines: CountLine[];
}

/* ------------------------ documents / evidence (B8) ------------------- */

/** What a document is attached to. */
export type DocumentScope = 'item' | 'inspection' | 'receipt';

/** What kind of evidence a document is. */
export type DocumentKind = 'photo' | 'signature' | 'packing-slip' | 'certificate' | 'coa';

export const DOCUMENT_KINDS: DocumentKind[] = ['photo', 'signature', 'packing-slip', 'certificate', 'coa'];

/**
 * A piece of evidence attached to a record (B8): a photo, a packing slip, a
 * certificate, a signature.
 *
 * The port has **no file store** — `url` is where the file will live (an object
 * URL or a path) and a document with no `url` is a *placeholder* row the UI still
 * shows. That is the deliberate local stand-in for the API's blob store: the rows,
 * the scoping and the counts are real, so swapping in real storage changes only
 * what `url` holds. A record's photo *count* is **derived** from these rows, never
 * a stored column (`DataService.photoCount()`).
 */
export interface Document extends AuditFields {
  id: string;
  scope: DocumentScope;
  /** The record it belongs to (`items.id` / `inspections.id` / `receipts.id`). */
  refId: string;
  kind: DocumentKind;
  /** Where the file lives (a URL / path); absent = a placeholder row. */
  url?: string;
  mime?: string;
  size?: number;
  caption?: string;
}

/**
 * Stock whose quantity is a *count* rather than a set of rows: a physical count
 * corrects these in place (`DataService.adjustStock`), because nothing
 * distinguishes one bag of sand from another. A serialized unit is the opposite —
 * it arrives, leaves and is corrected as whole rows — and a kit / attachment is
 * an owned count the prototype never counted either.
 */
export function isCountedStock(type: CatalogType): boolean {
  return type === 'bulk' || type === 'consumable' || type === 'part';
}

/**
 * Types whose quantity lives in `stock_levels` (A6, extended by B4): counted
 * stock, plus **kits and attachments** — anything with a quantity above one that
 * can sit in more than one place. A serialized unit is one thing in one place, and
 * a person is not a quantity at all (their one place is a home base), so neither
 * is level-tracked.
 */
export function isLevelTracked(type: CatalogType): boolean {
  return isCountedStock(type) || type === 'kit' || type === 'attachment';
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
export interface LocationType extends AuditFields {
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
export interface TaxSchedule extends AuditFields {
  code: string;
  state: string;
  county: string;
  city: string;
  rate: number;
  note: string;
}

/** Overhead / service-fee configuration (prototype `IMS.settings.overheads`). */
export interface Overhead extends AuditFields {
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
export interface PricingSettings extends AuditFields {
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
export interface Yard extends AuditFields {
  name: string;
  lat: number;
  lng: number;
}

/** How a landed quantity arrived (a damaged one goes to the quarantine place). */
export type ReceivingCondition = 'good' | 'damaged';

/**
 * The receiving desk's rules, as tenant configuration (B6, see `docs/PLAN-B.md`).
 * One row per tenant, audited like `pricing` (`DataService.receivingSettings()`).
 */
export interface ReceivingSettings extends AuditFields {
  /** How far over an ordered line a receipt may go, as a percent (0 = exact). */
  overReceiptTolerancePct: number;
  /** Refuse a receipt against a purchase order that names no supplier reference. */
  requirePoReference: boolean;
  /** Where a `damaged` landing is put away; absent = the receipt's own place. */
  quarantineLocationId?: string | null;
  /** The receiving editor's opening put-away; absent = the first line's own place. */
  defaultPutAwayLocationId?: string | null;
  /** A landed serialized unit must carry an `Open` inspection before put-away (B7). */
  requireInspection: boolean;
}


export type InspectionDirection = 'Check-Out' | 'Check-In';

/** How one item on an inspection's checklist came out (B7). */
export type InspectionOutcome = 'pass' | 'fail' | 'na';

export const INSPECTION_OUTCOMES: InspectionOutcome[] = ['pass', 'fail', 'na'];

/** How serious a failure is — what the desk offers next (a hold, a work order). */
export type InspectionSeverity = 'minor' | 'major' | 'critical';

export const INSPECTION_SEVERITIES: InspectionSeverity[] = ['minor', 'major', 'critical'];

/**
 * One checklist result (B7). The checklist itself is a **template** — the fields
 * of an `inspection`-scope `FormSchema` — so `results` is keyed by the template's
 * field `key` and each entry carries the value captured plus how it came out.
 * `jsonb` because the template is tenant data and the map is read whole by one
 * editor (the same argument as `items.attributes`).
 */
export interface InspectionResult {
  /** The value the template's field captured (a choice, a measurement, a flag). */
  value?: unknown;
  outcome: InspectionOutcome;
  /** Set when the outcome is a failure. */
  severity?: InspectionSeverity;
  note?: string;
}

/** Yard in/out inspection (prototype `IMS.inspections`), now template-driven (B7). */
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
  /** The `inspection`-scope `FormSchema` the checklist came from (B7). */
  templateId: string;
  /** One entry per template field: the value captured and how it came out. */
  results: Record<string, InspectionResult>;
  status: 'Open' | 'Closed';
  /** The receipt this check-in inspected, when it came off a delivery (B6/B7). */
  receiptId?: string | null;
  /** The movement this inspection was logged against, when there is one. */
  movementId?: string | null;
  /** The work order a failure raised (B7). */
  workOrderId?: string | null;
  signedBy?: string;
  signatureAt?: string;
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

/** The role definition for a key (falls back to the least-privileged role). */
export function roleDef(key: RoleKey): RoleDef {
  return ROLES.find((r) => r.key === key) ?? ROLES[ROLES.length - 1];
}

export function roleLabel(key: RoleKey): string {
  return roleDef(key).label;
}

export type TenantPlan = 'starter' | 'professional' | 'enterprise';

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
  /**
   * The business type the workspace **is** (Phase C) — the `verticals` row whose
   * categories are its catalog (`activeVertical()`).
   *
   * This is the only place the workspace's industry is recorded. The compiled
   * registry's key (`VerticalKey`, used for the grid columns and statuses until C6)
   * is **derived** from this row's slug (`DataService.vertical`), so there is no
   * second setting to keep in step — and no "Industry / Vertical" switch on
   * Admin → Feature Modules, which is what `Tenant.vertical` used to be.
   */
  verticalId?: string;
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
  /**
   * Who we sub-rent it from — a FK into `parties.id`, a partner carrying the
   * `supplier` kind.
   *
   * This replaces the prototype's free-text `vendor` name for the same reason
   * A3 deleted `item.bin` and A4 de-named a movement's place: the buying side is
   * a partner table (A5), so "who did we rent this from, and what else have we
   * bought from them?" has to be a join, not a string that a rename or a typo
   * splits in two.
   */
  supplierId: string;
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

/* --------------------- form schemas (B2, see PLAN-B) ------------------ */

/**
 * The kind a `FormField` is — what `<ims-dynamic-form>` renders and what the API
 * validates. `measurement` is a number that carries a `unit` (a tread depth, a
 * pressure); `multiselect` is an array drawn from `options`.
 */
export type FormFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'measurement';

export const FORM_FIELD_KINDS: FormFieldKind[] = [
  'text',
  'textarea',
  'number',
  'integer',
  'boolean',
  'date',
  'select',
  'multiselect',
  'measurement',
];

/** What a form schema can be attached to. */
export type FormScope = 'item' | 'inspection' | 'receipt-line' | 'stock-level';

/**
 * One field a schema declares. The `key` is resolved against a record's
 * `attributes` jsonb — the schema is the contract, the jsonb is the payload.
 * `showIf` is display-only (it never becomes a query, by the same rule that keeps
 * predicates on columns).
 */
export interface FormField {
  key: string;
  label: string;
  kind: FormFieldKind;
  /** The editor's section heading (fields are grouped by it). */
  group?: string;
  /** Helper text rendered beneath the input. */
  help?: string;
  required?: boolean;
  /** The choices `select` / `multiselect` offer. */
  options?: string[];
  /** The suffix a number / measurement carries ("hrs", "mm", "°C"). */
  unit?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
  defaultValue?: string | number | boolean;
  /** Render only while `attributes[key]` equals `equals`. */
  showIf?: { key: string; equals: string | number | boolean };
}

/**
 * The keys a field list states **more than once** (Phase C) — empty when each key
 * names one field.
 *
 * A key identifies a field **within its own list**: two categories may both
 * declare `rate`, but one list may not declare it twice, because a record's
 * `attributes` has room for one value per key and a schema with two definitions of
 * one key is a contract that contradicts itself. A *blank* key is not a duplicate
 * (that is "not yet named"; the editor asks for a name separately) — two fields
 * waiting for a key are two unnamed fields, not one field twice.
 */
export function duplicateFieldKeys(fields: FormField[] | undefined): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const f of fields ?? []) {
    const key = (f.key ?? '').trim();
    if (!key) continue;
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return [...dupes];
}

/** The same list with repeated keys dropped — the **first** definition wins. */
export function uniqueFields(fields: FormField[] | undefined): FormField[] {
  const seen = new Set<string>();
  return (fields ?? []).filter((f) => {
    const key = (f.key ?? '').trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A tenant-owned definition of the extra fields a record type captures.
 *
 * A vertical's *default* templates are seeded (`DataService.seedFormSchemas()`),
 * but a schema row is tenant data: it is audited like `categories` and
 * `location_types`, and a workspace may clone and edit its own. The values a
 * schema captures live in the record's `attributes` jsonb. **A column before a
 * key**: a fact that is filtered, sorted, joined or read by a guard is promoted
 * to a real column, never left to a `jsonb` predicate (see `docs/PLAN-B.md` D1).
 */
export interface FormSchema extends AuditFields {
  id: string;
  name: string;
  scope: FormScope;
  /** The catalog type it shapes (an item schema); `'*'`/absent = any type. */
  type?: CatalogType | '*';
  /** The vertical it was seeded from — provenance, not a runtime gate. */
  seededFrom?: VerticalKey;
  active: boolean;
  /** Bumped when a field is added or changed, so an old record can name its schema. */
  version: number;
  fields: FormField[];
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











