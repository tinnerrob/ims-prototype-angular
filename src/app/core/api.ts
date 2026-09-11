import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';

import { DataService } from './data.service';

/**
 * The API seam (C1): the contract, named before the transport exists.
 *
 * `DataService` is not a client of anything — it *is* the database (a snapshot in
 * memory, `localStorage`, ids it mints itself) — so it cannot talk to a server as it
 * stands. This file is the shape it needs: one **contract** that the store implements
 * today and an HTTP client will implement later, so a screen depends on *what* it can
 * ask rather than on where the answer comes from.
 *
 * Two halves, and the line between them is the question this repo has answered
 * fifty times already: does this call change the store, or only read it? A **command**
 * persists — directly, or through another command it calls — and a **query** never
 * does. That is a rule rather than a list to be trusted: `check17` re-derives the split
 * from `data.service.ts` and fails if a method is on the wrong side, and the type
 * assertions below fail the *build* if a new method is classified not at all (a type is
 * something no runtime check can see).
 *
 * The signatures are not copied here: `Pick<DataService, …>` takes them from the
 * implementation, so what this file states is *membership* and *direction* — exactly
 * the part a second implementation has to agree with, and exactly the part a
 * hand-copied signature would let drift.
 */

/** Every name a screen may *read* through the seam. */
export type ApiQueryName =
  'activeLocationTypes' | 'activeOrderCount' | 'activeOrderTotals' | 'activeOrders' |
  'activeTenant' | 'activeUser' | 'allItems' | 'allowedHours' | 'availableItems' |
  'billableDays' | 'capacity' | 'cardCovers' | 'cardLineFor' | 'cardRateFor' | 'cardStatus' |
  'categories' | 'categoriesFor' | 'categoryCount' | 'categoryRecordsFor' | 'cdlDrivers' |
  'custodyItems' | 'customerParties' | 'demoAccounts' | 'empHours' | 'empName' |
  'fleetByStatus' | 'fleetKpis' | 'fmtDT' | 'fmtDate' | 'getInspection' | 'getInvoice' |
  'getItem' | 'getLocation' | 'getOrder' | 'getParty' | 'getPriceCard' | 'getPurchaseOrder' |
  'getReceipt' | 'getTenant' | 'getTimesheet' | 'getUser' | 'getWorkOrder' | 'homePlace' |
  'inProgressWorkOrders' | 'int' | 'invoiceTotals' | 'invoicesFor' | 'isLocationAncestor' |
  'isOut' | 'itemLabel' | 'itemsAtLocation' | 'lastMeter' | 'latestMovement' |
  'lineAmountForPeriod' | 'lineDays' | 'lineEnd' | 'lineStart' | 'lineTotal' |
  'listDispatches' | 'listInspections' | 'listInvoices' | 'listItems' | 'listLocations' |
  'listMovements' | 'listOrders' | 'listOverheads' | 'listParties' | 'listPriceCards' |
  'listPurchaseOrders' | 'listReceipts' | 'listRentals' | 'listStockLevels' |
  'listTaxSchedules' | 'listTenants' | 'listTimesheets' | 'listUsers' | 'listVehicles' |
  'listWorkOrders' | 'locationChildCount' | 'locationChildren' | 'locationItemCount' |
  'locationLabel' | 'locationMovementCount' | 'locationOptions' | 'locationPath' |
  'locationRemovalBlockers' | 'locationStockQty' | 'locationSubtreeIds' |
  'locationSubtreeItemCount' | 'locationSubtreeMovementCount' | 'locationTypeCount' |
  'locationTypeRecords' | 'mkName' | 'moduleFlags' | 'money' | 'movementsAtLocation' |
  'movementsFor' | 'oneTimePrice' | 'openSegment' | 'orderAmount' | 'orderCost' |
  'orderCount' | 'orderDays' | 'orderT0' | 'orderT1' | 'outInfo' | 'parseDT' |
  'partyCycleDays' | 'partyKindLabel' | 'partyName' | 'partyRemovalBlockers' | 'pct' |
  'placeBreakdown' | 'placeLabel' | 'placements' | 'poLineCostFor' | 'poLineOutstanding' |
  'poLineReceived' | 'poProgress' | 'poReceivedValue' | 'poStatusClass' | 'poStatusLabel' |
  'poValue' | 'previewLocationId' | 'previewOrderId' | 'previewPurchaseOrderId' |
  'previewReceiptId' | 'priceCardFor' | 'priceCardsForParty' | 'pricing' |
  'purchaseOrderRemovalBlockers' | 'rateBasis' | 'receiptQty' | 'receiptValue' |
  'receiptsAtLocation' | 'receivableLines' | 'rentalSpread' | 'rentalSupplier' |
  'rentalsFromSupplier' | 'reorderCount' | 'reorders' | 'reseeded' | 'revision' |
  'segmentBill' | 'segmentCost' | 'segmentHours' | 'segmentLabel' | 'segmentShort' |
  'sessionTenantId' | 'sessionUserId' | 'stockAt' | 'stockTotal' | 'supplierCardCost' |
  'supplierOpenOrderCount' | 'supplierOrderCount' | 'supplierParties' | 'tabMeta' | 'taxRate' |
  'timesheetsFor' | 'timesheetsIn' | 'totalBilled' | 'totalHours' | 'userName' |
  'vehicleName' | 'vertical' | 'verticalMeta' | 'workOrderCost' | 'yard';
/**
 * Every name a screen may *write* through the seam. Each of these persists: the store
 * routes every write through its one writer (`save()`), which is where tenant/author
 * stamps and the revision signal come from — so "is this a command" and "does this
 * change the data" are the same question.
 */
export type ApiCommandName =
  'addCategory' | 'addLocationType' | 'addOrderLine' | 'adjustStock' | 'clockInto' |
  'closeInspection' | 'closeOpen' | 'createDispatch' | 'createInspection' | 'createItem' |
  'createLocation' | 'createOrder' | 'createOverhead' | 'createParty' | 'createPriceCard' |
  'createPurchaseOrder' | 'createRental' | 'createTaxSchedule' | 'createTimesheet' |
  'createWorkOrder' | 'ensureCategoryTables' | 'logMovement' | 'markInvoicePaid' |
  'moveStock' | 'punchIn' | 'punchOut' | 'raiseReorder' | 'receiveAgainst' | 'removeCategory' |
  'removeDispatch' | 'removeInspection' | 'removeInvoice' | 'removeItem' | 'removeLocation' |
  'removeLocationType' | 'removeOrderLine' | 'removeOverhead' | 'removeParty' |
  'removePriceCard' | 'removePurchaseOrder' | 'removeRental' | 'removeTaxSchedule' |
  'removeTimesheet' | 'removeWorkOrder' | 'renameCategory' | 'renameLocationType' |
  'runNextCycle' | 'setDispatchStatus' | 'setInvoiceStatus' | 'setTenantModule' |
  'setVertical' | 'setWorkOrderStatus' | 'signIn' | 'signOut' | 'togglePartyActive' |
  'touchSession' | 'updateDispatch' | 'updateInspection' | 'updateItem' | 'updateLocation' |
  'updateOrderDates' | 'updateOrderLineDates' | 'updateOrderLineQty' | 'updateOrderLineTimes' |
  'updateOrderStatus' | 'updateOrderTimes' | 'updateOverhead' | 'updateParty' |
  'updatePriceCard' | 'updatePricing' | 'updatePurchaseOrder' | 'updateTaxSchedule' |
  'updateTimesheet' | 'updateWorkOrder';
/** Reads — no `save()`, directly or transitively. */
export type ApiQueries = Pick<DataService, ApiQueryName>;

/** Writes — each one ends in the store's single writer. */
export type ApiCommands = Pick<DataService, ApiCommandName>;

/**
 * The contract as a whole: everything a client of the API may ask for. A screen takes
 * this, never the class, so which implementation answers is decided where it is
 * provided (below) rather than at each call site.
 */
export type ApiAdapter = ApiQueries & ApiCommands;

/*
 * Two compile-time assertions, because this is the half a runtime check cannot hold.
 * Adding a public method to the store without classifying it fails the first; a name in
 * either union that the store no longer has fails the second. They read as prose on
 * purpose — the failure message is the documentation.
 */
type Assert<T extends true> = T;

/** `keyof DataService` is every public member: none may sit outside the two unions. */
export type NothingOutsideTheContract = Assert<
  Exclude<keyof DataService, ApiQueryName | ApiCommandName> extends never ? true : false
>;

/** And the store satisfies the contract it is the first implementation of. */
export type TheStoreIsAnApi = Assert<DataService extends ApiAdapter ? true : false>;

/**
 * What a screen injects (C1). The contract, not the class: a caller that asks for
 * `IMS_API` cannot reach a member the contract does not have, which is what makes the
 * seam real rather than a naming convention.
 */
export const IMS_API = new InjectionToken<ApiAdapter>('ims-api');

/**
 * Wire the contract to an implementation — **the one place that decides which one**
 * (C1). It reuses the existing instance rather than naming a provider class: there is
 * one store, and a seam that minted a second copy of the workspace would be worse than
 * no seam. An HTTP implementation is this same line with another class, and no feature
 * changes — which is the only proof that a seam is one.
 *
 * The store is the first implementation: today the answer to every query *is* the
 * database it holds. The features still inject `DataService` directly and move onto
 * `IMS_API` next (C1b), which is also what keeps this file in the build: an unimported
 * module is not type-checked, and the assertions above are the point of it.
 */
export function provideImsApi(): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: IMS_API, useExisting: DataService }]);
}
