import { ModuleKey } from './models';

/**
 * IMS — view registry (single source of truth).
 *
 * Direct port of the prototype's `VIEWS` registry in `js/router.js`: one entry
 * per view carrying its topbar title/subtitle, sidebar grouping + icon, the
 * industry-module key that gates it (absent for always-on core views), and —
 * for the views that have one — its page-search placeholder.
 *
 * Adding a feature = one entry here (plus its route in `app.routes.ts`), exactly
 * as the prototype says: "one entry here + its nav item in index.html".
 */

/** Sidebar sections, in the prototype's order (see index.html). */
export type ViewGroup = 'inventory' | 'movement' | 'admin' | 'module';

export interface ViewDef {
  /** Prototype view id; also the Angular route path segment. */
  id: string;
  /** Topbar heading (prototype `VIEWS.title`). */
  title: string;
  /** Topbar subtitle (prototype `VIEWS.desc`). */
  desc: string;
  /**
   * Page-search placeholder. Set it and the shell renders the topbar search box
   * on this view, worded as *this* page's search (see `PageSearchService`);
   * leave it off and the view has no search box at all.
   */
  search?: string;
  /** Sidebar label — omit for a view that is routable but not in the sidebar. */
  nav?: string;
  /** Bootstrap Icons class for the sidebar entry. */
  icon?: string;
  group: ViewGroup;
  /** Gating key when the view belongs to an opt-in industry module. */
  module?: ModuleKey;
  /** Render the "MOD" pill next to the sidebar entry (as index.html does). */
  modTag?: boolean;
}

export const VIEWS: ViewDef[] = [
  /* ---- Inventory · Core (always on) ---- */
  {
    id: 'dashboard',
    title: 'Operations Dashboard',
    desc: 'Aggregated operational metrics from the inventory core and enabled modules.',
    nav: 'Operations Dashboard',
    icon: 'bi-speedometer2',
    group: 'inventory',
  },
  {
    id: 'items',
    title: 'Items & Stock',
    desc: 'Core catalog: typed items, stock quantities, and on-hand levels across the inventory.',
    search: 'Search every item tab — ID, name, category, serial…',
    nav: 'Items & Stock',
    icon: 'bi-box-seam',
    group: 'inventory',
  },

  /* ---- Movement & Custody · Core ---- */
  {
    id: 'handoff',
    title: 'Item Hand-Off & Custody',
    desc: 'Core: custody & movement of items — issue out, receive/return, and chain of custody.',
    search: 'Search assets, orders, custodians, movements…',
    nav: 'Item Hand-Off & Custody',
    icon: 'bi-arrow-left-right',
    group: 'movement',
  },
  {
    id: 'inspections',
    title: 'Receiving / Inspections',
    desc: 'Core: receiving, inspection, and check-in of items to locations.',
    search: 'Search inspections, assets, orders…',
    nav: 'Receiving / Inspections',
    icon: 'bi-clipboard-check',
    group: 'movement',
  },
  {
    id: 'orders',
    title: 'Parties & Orders',
    desc: 'Counterparties (customers, vendors, sites) and the orders placed against inventory.',
    search: 'Search customers, contracts, projects…',
    nav: 'Parties & Orders',
    icon: 'bi-folder2-open',
    group: 'movement',
  },
  {
    id: 'purchasing',
    title: 'Purchasing & Receiving',
    desc: 'Core: suppliers, purchase orders, and the receipts that bring stock in and place it.',
    search: 'Search suppliers, purchase orders, receipts…',
    nav: 'Purchasing & Receiving',
    icon: 'bi-bag-check',
    group: 'movement',
  },

  /* ---- Modules · Opt-in (gated by ModulesService) ---- */
  {
    id: 'scheduler',
    title: 'Scheduling',
    desc: 'Module: planned availability and scheduling of inventory over time.',
    nav: 'Scheduling',
    icon: 'bi-calendar3',
    group: 'module',
    module: 'scheduling',
    modTag: true,
  },
  {
    id: 'logistics',
    title: 'Logistics & Dispatch',
    desc: 'Module: dispatch board for deliveries, pickups, and route assignment.',
    nav: 'Logistics & Dispatch',
    icon: 'bi-truck',
    group: 'module',
    module: 'dispatch',
    modTag: true,
  },
  {
    id: 'telemetry',
    title: 'Fleet Telemetry',
    desc: 'Module: live fleet telemetry and geofence monitoring for tracked items.',
    search: 'Search assets — ID, make, model, serial…',
    nav: 'Fleet Telemetry',
    icon: 'bi-geo-alt',
    group: 'module',
    module: 'telemetry',
  },
  {
    id: 'timesheet',
    title: 'Labor & Timesheets',
    desc: 'Module: labor time records against orders and work orders.',
    search: 'Search employees, jobs, work orders…',
    nav: 'Labor & Timesheets',
    icon: 'bi-clock-history',
    group: 'module',
    module: 'labor',
    modTag: true,
  },
  {
    id: 'maintenance',
    title: 'Field Service & Maintenance',
    desc: 'Module: field service and maintenance work orders against item instances.',
    search: 'Search work orders, assets, service types…',
    nav: 'Field Service',
    icon: 'bi-tools',
    group: 'module',
    module: 'service',
    modTag: true,
  },
  {
    id: 'rentals',
    title: 'Rentals / Sub-Rentals',
    desc: 'Module: rentals and sub-rental loans sourced from third-party vendors.',
    nav: 'Rentals / Sub-Rentals',
    icon: 'bi-arrow-repeat',
    group: 'module',
    module: 'rentals',
    modTag: true,
  },
  {
    id: 'invoicing',
    title: 'Billing & Invoicing',
    desc: 'Module: billing derived from priced orders.',
    search: 'Search invoices, contracts, customers…',
    nav: 'Billing & Invoicing',
    icon: 'bi-receipt',
    group: 'module',
    module: 'billing',
    modTag: true,
  },

  /* ---- Administration ---- */
  {
    id: 'admin',
    title: 'Administration',
    desc: 'Administration: locations & their types, item categories, and feature modules.',
    nav: 'Admin',
    icon: 'bi-gear',
    group: 'admin',
  },
  {
    id: 'pricing',
    title: 'Pricing & Policies',
    desc: 'Policies: optional pricing, tax, and overhead rules applied to orders.',
    nav: 'Pricing & Policies',
    icon: 'bi-sliders',
    group: 'admin',
  },
];

/** Sidebar sections in render order, derived from VIEWS (ignores non-nav views). */
export const NAV_GROUPS: { title: string; views: ViewDef[] }[] = (
  [
    { title: 'Inventory · Core', group: 'inventory' as ViewGroup },
    { title: 'Movement & Custody · Core', group: 'movement' as ViewGroup },
    { title: 'Modules · Opt-in', group: 'module' as ViewGroup },
    { title: 'Administration', group: 'admin' as ViewGroup },
  ] as const
).map((g) => ({
  title: g.title,
  views: VIEWS.filter((v) => v.group === g.group && !!v.nav),
}));

export function viewFor(id: string): ViewDef | undefined {
  return VIEWS.find((v) => v.id === id);
}
