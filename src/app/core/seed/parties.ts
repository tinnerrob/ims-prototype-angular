/* The demo fixture, in modules: 4 data factories.
   ---------------------------------------------------------------------------
   These came out of `DataService` (see angular-refactor-log.md, P6/2). Every function
   here is a *pure data factory* — literal rows, no store access — which is exactly why
   it could move. The store keeps the parts of the fixture that must run *through* it
   (`seedItems` / `seedStockItems` / `seedStockLevels` / `seedMovements` / `seedPlacement`
   / `seedReceipts`), because those post receipts and level the shelves with the same
   mutators the pages use.

   Nothing here decides anything: the rows are the fixture, and `check:store` asserts them.
   Order within a file follows the store, so a reader can compare them side by side. */

import { Order, Party, PriceCard, PurchaseOrder } from '../models';

/* -------------------------------- seeds ------------------------------- */

export function seedParties(): Party[] {
  return [
    {
      id: 'PTY-001',
      name: 'Halstead Construction',
      contact: 'M. Halstead',
      phone: '(404) 555-0134',
      email: 'projects@halstead.com',
      billingAddress: '100 Peachtree Pkwy NE, Atlanta, GA',
      billingCycle: 'weekly',
      notes: 'Boom & aerial work; weekly cadence.',
      active: true,
    },
    {
      id: 'PTY-002',
      name: 'Meridian Civil Works',
      contact: 'L. Bishop',
      phone: '(678) 555-0192',
      email: 'ops@meridiancivil.com',
      billingAddress: '88 River Rd, Atlanta, GA',
      billingCycle: 'bi-weekly',
      notes: 'Bridge / heavy civil. Net-30 terms.',
      active: true,
    },
    {
      id: 'PTY-003',
      name: 'Coastal Energy Group',
      contact: 'R. Vance',
      phone: '(404) 555-0117',
      email: 'supply@coastalenergy.com',
      billingAddress: '1 Fuel Pier, Savannah, GA',
      billingCycle: 'monthly',
      notes: 'Refinery/hazmat; risk premium applies.',
      active: true,
    },
    {
      id: 'PTY-004',
      name: 'Port Authority',
      contact: 'T. Nguyen',
      phone: '(912) 555-0165',
      email: 'facilities@portauthority.gov',
      billingAddress: 'Terminal Way, Savannah, GA',
      billingCycle: 'quarterly',
      notes: 'Public works; coastal surcharge.',
      active: true,
    },
    {
      id: 'PTY-005',
      name: 'Brightleaf General Contracting',
      contact: 'S. Rawlins',
      phone: '(770) 555-0149',
      email: 'pm@brightleafgc.com',
      billingAddress: '1200 Piedmont Ave, Atlanta, GA',
      billingCycle: 'monthly',
      notes: 'Small jobs; no active orders.',
      active: true,
    },
    /*
     * Suppliers are the same kind of row as a customer — one partner table
     * with roles on the row (`Party.kinds`) — so the buying side has a FK to
     * point at from the day it exists: a purchase order names a *party*, not
     * the vendor string the prototype's sub-rentals carried. A row seeded
     * without `kinds` is a customer (every pre-A5 row), which is why only the
     * suppliers below spell it out.
     */
    {
      id: 'PTY-006',
      name: 'United Rentals — Southeast',
      contact: 'D. Whitfield',
      phone: '(404) 555-0210',
      email: 'orders@ur-southeast.com',
      billingAddress: '4400 Buford Hwy, Norcross, GA',
      billingCycle: 'net-30',
      kinds: ['supplier'],
      notes: 'Equipment purchases; fleet pricing.',
      active: true,
    },
    {
      id: 'PTY-007',
      name: 'Fastenal Industrial Supply',
      contact: 'Inside Sales',
      phone: '(770) 555-0188',
      email: 'atlanta@fastenal.com',
      billingAddress: '2100 Industrial Blvd, Atlanta, GA',
      billingCycle: 'net-30',
      kinds: ['supplier'],
      notes: 'Filters, hoses, hardware; weekly van stock.',
      active: true,
    },
    {
      id: 'PTY-008',
      name: 'Wacker Neuson Southeast',
      contact: 'P. Adeyemi',
      phone: '(678) 555-0133',
      email: 'sales@wackerneuson-se.com',
      billingAddress: '900 Commerce Dr, McDonough, GA',
      billingCycle: 'net-45',
      kinds: ['supplier'],
      notes: 'OEM dealer: compact equipment and OEM parts.',
      active: true,
    },
    {
      id: 'PTY-009',
      name: 'SafetyMart Direct',
      contact: 'R. Ivey',
      phone: '(800) 555-0142',
      email: 'orders@safetymartdirect.com',
      billingAddress: '77 Distribution Ct, Savannah, GA',
      billingCycle: 'prepaid',
      kinds: ['supplier'],
      notes: 'PPE consumables; prepaid card on file.',
      active: true,
    },
    /*
     * The three partners the sub-rental ledger draws from (`seedRentals`): we
     * don't own their machines, we rent them to fill an order and bill the
     * customer — "in" rentals rather than "out". They carry the supplier kind
     * because that is what they are to us: a counterparty we buy from.
     */
    {
      id: 'PTY-010',
      name: 'PowerGen Rentals',
      contact: 'A. Kowalski',
      phone: '(912) 555-0173',
      email: 'dispatch@powergen-rentals.com',
      billingAddress: '19 Turbine Rd, Savannah, GA',
      billingCycle: 'net-30',
      kinds: ['supplier'],
      notes: 'Temporary power / generators; same-day delivery.',
      active: true,
    },
    {
      id: 'PTY-011',
      name: 'Forklift Fleet Co',
      contact: 'J. Marchetti',
      phone: '(770) 555-0197',
      email: 'rentals@forkliftfleet.com',
      billingAddress: '620 Industrial Park Dr, Marietta, GA',
      billingCycle: 'net-30',
      kinds: ['supplier'],
      notes: 'Material handling; sub-rentals billed weekly.',
      active: true,
    },
    {
      id: 'PTY-012',
      name: 'Meridian Tools Supply',
      contact: 'D. Osei',
      phone: '(678) 555-0151',
      email: 'hire@meridiantools.com',
      billingAddress: '410 Foundry St, Atlanta, GA',
      billingCycle: 'net-15',
      kinds: ['supplier'],
      notes: 'Compaction & small plant hire.',
      active: true,
    },
  ];
}

/**
 * Negotiated rates, one card per counterparty (see `PriceCard`).
 *
 * The fixture is a set of *cases* rather than a set of prices, because the card
 * is read rather than copied and the interesting questions are which card wins
 * and when:
 *
 *  - `PC-001` is **in force** and reprices a live order — CT-2024-001
 *    (Halstead, from 2026-08-20) now bills at the negotiated rates;
 *  - `PC-002` is in force for a second customer, so an order priced by one
 *    party's card shows whether the other's leaked into it;
 *  - `PC-003` is **expired** (2025) for Meridian, whose CT-2024-002 starts in
 *    2026: the order must keep the catalog rates. That window is the whole
 *    reason a card carries dates — a renewal is a new card, so an old contract
 *    keeps the price it was written at;
 *  - `PC-004` is a **supplier's** card. Its `unitCost` is the cost side: the PO
 *    editor's default, while PO-2026-001 still states the price it was ordered
 *    at (the document's own fact beats the default it was seeded from).
 */
export function seedPriceCards(): PriceCard[] {
  return [
    {
      id: 'PC-001',
      partyId: 'PTY-001',
      name: '2026 Master Agreement',
      active: true,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      note: 'Volume rates on the aerial fleet; agreed hourly and PPE prices.',
      lines: [
        { type: 'serialized', refId: 'BL-119', rateDaily: 465, baseWeekly: 2325, baseMonthly: 6975 },
        { type: 'serialized', refId: 'FL-401', rateDaily: 195, baseWeekly: 975, baseMonthly: 2925 },
        { type: 'consumable', refId: 'SG-LFT-001', unitPrice: 4.6 },
        { type: 'labor', refId: 'EMP-001', unitPrice: 62 },
      ],
    },
    {
      id: 'PC-002',
      partyId: 'PTY-003',
      name: 'Refinery Hazmat Rates 2026',
      active: true,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      note: 'Hazmat-rated units sit above list; the barriers are capped.',
      lines: [
        { type: 'serialized', refId: 'GN-511', rateDaily: 155, baseWeekly: 775, baseMonthly: 2325 },
        { type: 'bulk', refId: 'BR-010', rateDaily: 5.75, baseWeekly: 23, baseMonthly: 69 },
        { type: 'labor', refId: 'EMP-002', unitPrice: 78 },
      ],
    },
    {
      id: 'PC-003',
      partyId: 'PTY-002',
      name: '2025 Rates (superseded)',
      active: true,
      effectiveFrom: '2025-01-01',
      effectiveTo: '2025-12-31',
      note: 'Superseded 2025 agreement — kept for history, no longer in force.',
      lines: [
        { type: 'serialized', refId: 'SS-204', rateDaily: 199, baseWeekly: 995, baseMonthly: 2985 },
        { type: 'serialized', refId: 'TL-605', rateDaily: 355 },
      ],
    },
    {
      id: 'PC-004',
      partyId: 'PTY-007',
      name: 'FY26 Supply Agreement',
      active: true,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      note: 'Consumable/filter pricing agreed for the year.',
      lines: [
        { type: 'part', refId: 'PRT-001', unitCost: 16.1 },
        { type: 'part', refId: 'PRT-002', unitCost: 19.4 },
      ],
    },
  ];
}

/** Orders + line items + job-site geofences (prototype `IMS.orders`). */
export function seedOrders(): Order[] {
  return [
    {
      orderId: 'CT-2024-001',
      partyId: 'PTY-001',
      jobSite: 'Downtown Plaza, 245 Peachtree St',
      geofenceRadius: 300,
      projectName: 'Downtown Plaza Renovation',
      startDate: '2026-08-20',
      endDate: '2026-09-10',
      status: 'active',
      siteLat: 33.756,
      siteLng: -84.3905,
      lineItems: [
        { id: 'LI-101', type: 'serialized', refId: 'BL-119', qty: 1, weekendPolicy: 'bill', riskPremium: 'standard' },
        { id: 'LI-102', type: 'serialized', refId: 'FL-401', qty: 1, weekendPolicy: 'bill', riskPremium: 'standard' },
        { id: 'LI-103', type: 'bulk', refId: 'CN-018', qty: 50, weekendPolicy: 'bill', riskPremium: 'standard' },
        { id: 'LI-104', type: 'consumable', refId: 'SG-LFT-001', qty: 20, weekendPolicy: 'bill', riskPremium: 'standard' },
        { id: 'LI-105', type: 'labor', refId: 'EMP-001', qty: 40, weekendPolicy: 'bill', riskPremium: 'standard' },
      ],
    },
    {
      orderId: 'CT-2024-002',
      partyId: 'PTY-002',
      jobSite: 'Riverside Bridge, 88 River Rd',
      geofenceRadius: 500,
      projectName: 'Riverside Bridge Repair',
      startDate: '2026-09-01',
      endDate: '2026-09-20',
      status: 'active',
      siteLat: 33.731,
      siteLng: -84.43,
      lineItems: [
        { id: 'LI-201', type: 'serialized', refId: 'SS-204', qty: 1, weekendPolicy: 'skip', riskPremium: 'standard' },
        { id: 'LI-202', type: 'serialized', refId: 'TL-605', qty: 1, weekendPolicy: 'skip', riskPremium: 'standard' },
        { id: 'LI-203', type: 'bulk', refId: 'SCF-040', qty: 30, weekendPolicy: 'skip', riskPremium: 'standard' },
        { id: 'LI-204', type: 'labor', refId: 'EMP-003', qty: 24, weekendPolicy: 'bill', riskPremium: 'standard' },
      ],
    },
    {
      orderId: 'CT-2024-003',
      partyId: 'PTY-003',
      jobSite: 'Bayport Refinery, 1 Fuel Pier',
      geofenceRadius: 400,
      projectName: 'Refinery Catalyst Swap',
      startDate: '2026-09-02',
      endDate: '2026-09-30',
      status: 'active',
      siteLat: 33.72,
      siteLng: -84.36,
      lineItems: [
        { id: 'LI-301', type: 'serialized', refId: 'GN-511', qty: 1, weekendPolicy: 'overtime', riskPremium: 'hazmat' },
        { id: 'LI-302', type: 'bulk', refId: 'BR-010', qty: 20, weekendPolicy: 'overtime', riskPremium: 'hazmat' },
        { id: 'LI-303', type: 'consumable', refId: 'FL-DSL-005', qty: 8, weekendPolicy: 'bill', riskPremium: 'standard' },
        { id: 'LI-304', type: 'labor', refId: 'EMP-002', qty: 30, weekendPolicy: 'bill', riskPremium: 'standard' },
      ],
    },
    {
      orderId: 'CT-2024-004',
      partyId: 'PTY-004',
      jobSite: 'Pier 12 Bulkhead, Terminal Way',
      geofenceRadius: 250,
      projectName: 'Pier 12 Bulkhead Repair',
      startDate: '2026-08-01',
      endDate: '2026-08-25',
      status: 'closed',
      siteLat: 33.742,
      siteLng: -84.352,
      lineItems: [
        { id: 'LI-401', type: 'serialized', refId: 'ET-310', qty: 1, weekendPolicy: 'bill', riskPremium: 'coastal' },
      ],
    },
  ];
}

/**
 * Purchase-order seed — one PO per state the page has to render: an order still
 * waiting, one delivered in full, and one part-delivered. The last two become
 * delivered/partial by *posting* the receipts below, not by being written that
 * way: there is no stored "received" column to seed (see `poProgress`).
 */
export function seedPurchaseOrders(): PurchaseOrder[] {
  return [
    {
      id: 'PO-2026-001',
      supplierId: 'PTY-007',
      status: 'ordered',
      orderedAt: '2026-09-04',
      expectedAt: '2026-09-12',
      reference: 'FAS-88214',
      notes: 'Monthly filter and hose restock.',
      lines: [
        { id: 'PO-2026-001-1', type: 'part', refId: 'PRT-001', description: 'Hydraulic Filter 40um', qty: 12, unitCost: 17.25 },
        { id: 'PO-2026-001-2', type: 'part', refId: 'PRT-002', description: 'Air Filter Element', qty: 6, unitCost: 20.4 },
      ],
    },
    {
      id: 'PO-2026-002',
      supplierId: 'PTY-006',
      status: 'ordered',
      orderedAt: '2026-08-18',
      expectedAt: '2026-08-28',
      reference: 'UR-PO-55901',
      notes: 'Two compact loaders for the Riverside Bridge job.',
      lines: [
        {
          id: 'PO-2026-002-1',
          type: 'serialized',
          description: 'CAT 259D3 Compact Track Loader',
          qty: 2,
          unitCost: 78500,
          rateDaily: 385,
        },
        { id: 'PO-2026-002-2', type: 'attachment', refId: 'ACC-002', description: '36" Ditch Bucket', qty: 2, unitCost: 41 },
      ],
    },
    {
      id: 'PO-2026-003',
      supplierId: 'PTY-008',
      status: 'ordered',
      orderedAt: '2026-09-02',
      expectedAt: '2026-09-15',
      reference: 'WN-Q-33120',
      notes: 'Excavator plus OEM hose stock.',
      lines: [
        {
          id: 'PO-2026-003-1',
          type: 'serialized',
          description: 'Wacker Neuson ET42 Mini Excavator',
          qty: 1,
          unitCost: 62000,
          rateDaily: 320,
        },
        { id: 'PO-2026-003-2', type: 'part', refId: 'PRT-005', description: 'Hydraulic Hose 1in x 6ft', qty: 12, unitCost: 33.5 },
      ],
    },
  ];
}
