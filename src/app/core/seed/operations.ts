/* The demo fixture, in modules: 8 data factories.
   ---------------------------------------------------------------------------
   These came out of `DataService` (see angular-refactor-log.md, P6/2). Every function
   here is a *pure data factory* — literal rows, no store access — which is exactly why
   it could move. The store keeps the parts of the fixture that must run *through* it
   (`seedItems` / `seedStockItems` / `seedStockLevels` / `seedMovements` / `seedPlacement`
   / `seedReceipts`), because those post receipts and level the shelves with the same
   mutators the pages use.

   Nothing here decides anything: the rows are the fixture, and `check:store` asserts them.
   Order within a file follows the store, so a reader can compare them side by side. */

import { Dispatch, Document, Inspection, InspectionResult, Invoice, RentalSub, TIMESHEET_KIND, Timesheet, Vehicle, WorkOrder, Yard } from '../models';

/** Yard in/out inspections (prototype `IMS.inspections`), template-driven (B7). */
export function seedInspections(): Inspection[] {
  const ok = (value: string): InspectionResult => ({ value, outcome: 'pass' });
  const allOk = () => ({
    tires: ok('Good'),
    fluids: ok('Full'),
    guards: ok('In place'),
    lights: ok('Working'),
    engine: ok('Normal'),
  });
  return [
    {
      id: 'INSP-001',
      itemId: 'BL-119',
      orderId: 'CT-2024-001',
      direction: 'Check-Out',
      date: '2026-08-20',
      meterOut: 2210,
      meterIn: null,
      fuelOut: 85,
      fuelIn: null,
      templateId: 'FS-inspection-default',
      results: allOk(),
      status: 'Open',
    },
    {
      id: 'INSP-002',
      itemId: 'SS-204',
      orderId: 'CT-2024-002',
      direction: 'Check-Out',
      date: '2026-09-01',
      meterOut: 4150,
      meterIn: null,
      fuelOut: 78,
      fuelIn: null,
      templateId: 'FS-inspection-default',
      results: {
        ...allOk(),
        lights: { value: 'Faulty', outcome: 'fail', severity: 'major', note: 'Right lamp out' },
      },
      status: 'Open',
    },
    {
      id: 'INSP-003',
      itemId: 'BL-120',
      orderId: null,
      direction: 'Check-In',
      date: '2026-08-28',
      meterOut: 3190,
      meterIn: 3200,
      fuelOut: 60,
      fuelIn: 40,
      templateId: 'FS-inspection-default',
      results: allOk(),
      status: 'Closed',
    },
  ];
}

/**
 * Evidence rows (B8): the photos a check-in took, a receipt's packing slip, an
 * item's certificate. `url` is left off where the port has no file to point at —
 * the rows are real and a record's count is derived from them.
 */
export function seedDocuments(): Document[] {
  return [
    { id: 'DOC-001', scope: 'inspection', refId: 'INSP-002', kind: 'photo', caption: 'Right lamp out', mime: 'image/jpeg', size: 184320 },
    { id: 'DOC-002', scope: 'inspection', refId: 'INSP-003', kind: 'photo', caption: 'Check-in — front', mime: 'image/jpeg', size: 210944 },
    { id: 'DOC-003', scope: 'inspection', refId: 'INSP-003', kind: 'photo', caption: 'Check-in — rear', mime: 'image/jpeg', size: 198656 },
    { id: 'DOC-004', scope: 'inspection', refId: 'INSP-003', kind: 'photo', caption: 'Check-in — meter', mime: 'image/jpeg', size: 176128 },
    { id: 'DOC-005', scope: 'receipt', refId: 'RC-2026-001', kind: 'packing-slip', caption: 'Supplier packing slip' },
    { id: 'DOC-006', scope: 'item', refId: 'BL-119', kind: 'certificate', caption: 'Annual inspection certificate' },
  ];
}

/** Service work orders (prototype `IMS.workOrders`). */
export function seedWorkOrders(): WorkOrder[] {
  return [
    { id: 'WO-401', itemId: 'SS-205', type: 'Repair', meterReading: 8400, status: 'In Progress', parts: [{ kind: 'consumable', refId: 'FL-HYD-010', qty: 2 }], laborHours: 3, date: '2026-08-30' },
    { id: 'WO-402', itemId: 'GN-510', type: 'Preventive', meterReading: 1220, status: 'Completed', parts: [{ kind: 'consumable', refId: 'BP-ENG-020', qty: 2 }, { kind: 'consumable', refId: 'GN-GRL-001', qty: 2 }], laborHours: 1.5, date: '2026-08-28' },
    { id: 'WO-403', itemId: 'BL-120', type: 'Inspection', meterReading: 3200, status: 'Completed', parts: [], laborHours: 1, date: '2026-08-25' },
    { id: 'WO-404', itemId: 'FL-402', type: 'Repair', meterReading: 2980, status: 'Scheduled', parts: [{ kind: 'consumable', refId: 'BP-ENG-020', qty: 1 }], laborHours: 2, date: '2026-09-01' },
  ];
}

/**
 * Labour clock segments (prototype `IMS.timesheets`): two days of punches
 * across the six employees, with the shop / overhead / idle buckets.
 */
export function seedTimesheets(): Timesheet[] {
  const rows: [string, string, string, string, string, number, Timesheet['targetType'], string | null][] = [
    /* 2026-08-31 (Monday) */
    ['TS-0001', 'EMP-001', '2026-08-31', '07:00', '11:30', 4.5, 'order', 'CT-2024-001'],
    ['TS-0002', 'EMP-001', '2026-08-31', '11:30', '12:30', 1, 'overhead', null],
    ['TS-0003', 'EMP-001', '2026-08-31', '12:30', '16:00', 3.5, 'order', 'CT-2024-001'],
    ['TS-0004', 'EMP-002', '2026-08-31', '08:00', '12:00', 4, 'workorder', 'WO-402'],
    ['TS-0005', 'EMP-002', '2026-08-31', '12:30', '16:30', 4, 'workorder', 'WO-402'],
    ['TS-0006', 'EMP-005', '2026-08-31', '09:00', '12:00', 3, 'workorder', 'WO-401'],
    ['TS-0007', 'EMP-005', '2026-08-31', '13:00', '15:00', 2, 'idle', null],
    /* 2026-09-01 (Tuesday) */
    ['TS-0008', 'EMP-001', '2026-09-01', '07:00', '12:00', 5, 'order', 'CT-2024-001'],
    ['TS-0009', 'EMP-001', '2026-09-01', '12:00', '13:00', 1, 'idle', null],
    ['TS-0010', 'EMP-001', '2026-09-01', '13:00', '17:00', 4, 'order', 'CT-2024-001'],
    ['TS-0011', 'EMP-002', '2026-09-01', '08:00', '12:00', 4, 'workorder', 'WO-401'],
    ['TS-0012', 'EMP-002', '2026-09-01', '13:00', '17:00', 4, 'shop', null],
    ['TS-0013', 'EMP-003', '2026-09-01', '06:30', '10:30', 4, 'order', 'CT-2024-002'],
    ['TS-0014', 'EMP-003', '2026-09-01', '10:30', '11:30', 1, 'overhead', null],
    ['TS-0015', 'EMP-003', '2026-09-01', '11:30', '14:30', 3, 'order', 'CT-2024-002'],
    ['TS-0016', 'EMP-004', '2026-09-01', '07:00', '12:00', 5, 'order', 'CT-2024-001'],
    ['TS-0017', 'EMP-004', '2026-09-01', '12:00', '13:00', 1, 'idle', null],
    ['TS-0018', 'EMP-004', '2026-09-01', '13:00', '16:00', 3, 'order', 'CT-2024-001'],
    ['TS-0019', 'EMP-005', '2026-09-01', '08:00', '12:00', 4, 'workorder', 'WO-404'],
    ['TS-0020', 'EMP-005', '2026-09-01', '13:00', '17:00', 4, 'shop', null],
    ['TS-0021', 'EMP-006', '2026-09-01', '08:00', '12:00', 4, 'order', 'CT-2024-001'],
    ['TS-0022', 'EMP-006', '2026-09-01', '12:00', '13:00', 1, 'idle', null],
    ['TS-0023', 'EMP-006', '2026-09-01', '13:00', '16:00', 3, 'order', 'CT-2024-001'],
  ];
  return rows.map(([id, empId, date, clockIn, clockOut, hours, targetType, targetId]) => ({
    id,
    empId,
    date,
    clockIn,
    clockOut,
    targetType,
    targetId,
    hours,
    note: TIMESHEET_KIND[targetType].label,
  }));
}

/**
 * Sub-rentals from third-party suppliers (prototype `IMS.rentals`). The prototype
 * stored each source as a free-text string; here it is a supplier *party*
 * (`PTY-010`…`PTY-012`), so the wholesale side of the business points at the
 * same partner table the purchase orders do.
 *
 * Each carries the window we hold it for (`rentFrom` → `rentTo`), sized to cover
 * the customer order it is re-let on. `RR-002` is back already, so the ledger
 * shows both a live and a returned row out of the box.
 */
export function seedRentals(): RentalSub[] {
  return [
    { id: 'RR-001', itemId: 'GN-510', assetName: 'Generac 100 kW Generator', orderId: 'CT-2024-003', supplierId: 'PTY-010', vendorCost: 110, retailRate: 175, qty: 1, rentFrom: '2026-08-28', rentTo: '2026-10-02' },
    { id: 'RR-002', itemId: 'FL-402', assetName: 'Toyota Forklift 8FGU25', orderId: 'CT-2024-004', supplierId: 'PTY-011', vendorCost: 95, retailRate: 205, qty: 1, rentFrom: '2026-07-28', rentTo: '2026-08-28', returnedAt: '2026-08-27' },
    { id: 'RR-003', itemId: null, assetName: 'Compaction Roller 5T', orderId: 'CT-2024-002', supplierId: 'PTY-012', vendorCost: 140, retailRate: 260, qty: 1, rentFrom: '2026-08-28', rentTo: '2026-09-22' },
  ];
}

/** Transport fleet (prototype `IMS.vehicles`). */
export function seedVehicles(): Vehicle[] {
  return [
    { id: 'TRK-01', name: 'Freightliner M2 26 ft', plate: 'ABC-4521', status: 'Available' },
    { id: 'TRK-02', name: 'F-550 Flatbed', plate: 'XYZ-7789', status: 'En Route' },
    { id: 'TRK-03', name: 'Isuzu NPR Box', plate: 'QRS-9912', status: 'Available' },
  ];
}

/** Dispatch board (prototype `IMS.dispatches`). */
export function seedDispatches(): Dispatch[] {
  return [
    { id: 'DSP-001', orderId: 'CT-2024-001', assetId: 'BL-119', routeSeq: 1, driverId: 'EMP-003', vehicleId: 'TRK-01', status: 'En Route' },
    { id: 'DSP-002', orderId: 'CT-2024-001', assetId: 'FL-401', routeSeq: 2, driverId: null, vehicleId: null, status: 'Staged' },
    { id: 'DSP-003', orderId: 'CT-2024-002', assetId: 'SS-204', routeSeq: 3, driverId: 'EMP-001', vehicleId: 'TRK-02', status: 'Delivered' },
    { id: 'DSP-004', orderId: 'CT-2024-002', assetId: 'TL-605', routeSeq: 4, driverId: null, vehicleId: null, status: 'Staged' },
    { id: 'DSP-005', orderId: 'CT-2024-003', assetId: 'GN-511', routeSeq: 5, driverId: 'EMP-003', vehicleId: 'TRK-01', status: 'Pending Return' },
  ];
}

/** Cycle invoices (prototype `IMS.invoices`). */
export function seedInvoices(): Invoice[] {
  return [
    { id: 'INV-001', orderId: 'CT-2024-001', cycle: 1, cycleStart: '2026-08-20', cycleEnd: '2026-08-27', envFeePct: 5, damageWaiver: false, fuelCharge: 120, taxRate: 0.08, status: 'invoiced' },
    { id: 'INV-002', orderId: 'CT-2024-002', cycle: 1, cycleStart: '2026-09-01', cycleEnd: '2026-09-15', envFeePct: 5, damageWaiver: true, fuelCharge: 0, taxRate: 0.07, status: 'pending' },
    { id: 'INV-003', orderId: 'CT-2024-003', cycle: 1, cycleStart: '2026-09-02', cycleEnd: '2026-09-30', envFeePct: 7, damageWaiver: true, fuelCharge: 210, taxRate: 0.07, status: 'paid' },
  ];
}
