import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataService } from '../../core/data.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';

/**
 * Administration → Sample data.
 *
 * Every page in this prototype reads the same store, so "the demo's worth of rows"
 * is one switch. Two buttons for the two states a workspace moves between:
 * **Load sample data** lays the fixture back down exactly as a first load has it,
 * **Remove all sample data** empties the workspace so it can be shown holding
 * nothing. Both replace the store outright, so both ask first — and the tally under
 * them is the effect, read off the store rather than remembered.
 *
 * A third, narrower operation lives where it always has: **Start clean** on Business
 * type & Categories drops the catalog and the records that name it, but keeps the
 * workspace's partners, locations and settings.
 */
@Component({
  selector: 'ims-sample-data',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './sample-data.component.html',
  styleUrl: './sample-data.component.scss',
})
export class SampleDataComponent {
  /** What the last action did, said where its button is. */
  notice = '';

  constructor(
    readonly data: DataService,
    private readonly confirm: ConfirmService,
  ) {}

  /**
   * What the workspace is holding, table by table — the tally under the buttons, and
   * the plainest way to *see* what either one did.
   *
   * The wording lives here, with the markup that shows it, rather than in the store:
   * the store's job is to answer (`listParties()`, `allItems()`, …), and a tally is how
   * this page chooses to say the answer. It also keeps the labels — twenty-odd strings
   * nobody else reads — out of the bundle every page pays for.
   */
  counts(): { label: string; count: number }[] {
    return [
      { label: 'Business types', count: this.data.listVerticals().length },
      { label: 'Categories', count: this.data.listCategories().length },
      { label: 'Parties & suppliers', count: this.data.listParties().length },
      { label: 'Price cards', count: this.data.listPriceCards().length },
      { label: 'Assets', count: this.data.allItems().length },
      { label: 'Stock levels', count: this.data.listStockLevels().length },
      { label: 'Movements', count: this.data.listMovements().length },
      { label: 'Orders', count: this.data.listOrders().length },
      { label: 'Purchase orders', count: this.data.listPurchaseOrders().length },
      { label: 'Receipts', count: this.data.listReceipts().length },
      { label: 'Inspections', count: this.data.listInspections().length },
      { label: 'Work orders', count: this.data.listWorkOrders().length },
      { label: 'Timesheets', count: this.data.listTimesheets().length },
      { label: 'Sub-rentals', count: this.data.listRentals().length },
      { label: 'Fleet', count: this.data.listVehicles().length },
      { label: 'Dispatches', count: this.data.listDispatches().length },
      { label: 'Invoices', count: this.data.listInvoices().length },
      { label: 'Documents', count: this.data.listDocuments().length },
      { label: 'Count sheets', count: this.data.listCountSessions().length },
      { label: 'Locations', count: this.data.listLocations().length },
      { label: 'Form schemas', count: this.data.listFormSchemas().length },
    ];
  }

  /** Every row in the workspace, summed — the one number that answers "is it empty?". */
  total(): number {
    return this.counts().reduce((n, r) => n + r.count, 0);
  }

  /**
   * Put the demo fixture back. Confirmed, because it replaces whatever the workspace
   * holds now — including everything added since the last load.
   */
  async load(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Load the sample data?',
      message:
        'Replaces everything in this workspace with the demo fixture — parties and suppliers, the catalog and its shelves, the ledger, orders, purchase orders and receipts, inspections, work orders, timesheets, sub-rentals, the fleet, dispatches, invoices, documents, and the business types with their categories. Anything added since the last load goes.',
      confirmLabel: 'Load sample data',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    this.data.loadSampleData();
    this.notice = `Sample data loaded — ${this.total()} rows in the workspace.`;
  }

  /**
   * Empty the workspace. Confirmed, because it is the destructive one: every row the
   * demo supplied goes. The line it draws — what stays, and why — is documented on
   * `DataService.clearAllData()`.
   */
  async remove(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Remove all sample data?',
      message:
        'Deletes every row the demo supplied — parties and suppliers, the catalog and its shelves, orders, purchase orders and receipts, inspections, work orders, timesheets, sub-rentals, the fleet, dispatches, invoices, documents, and the business types with their categories. The workspace itself, its people and its settings stay, so you can start from nothing.',
      confirmLabel: 'Remove everything',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    this.data.clearAllData();
    this.notice = 'Workspace emptied — every sample row is gone. Load the sample data to put the demo back.';
  }
}
