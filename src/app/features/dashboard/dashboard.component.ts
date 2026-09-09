import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataService } from '../../core/data.service';

interface Milestone {
  route: string;
  title: string;
  done: boolean;
  note: string;
}

@Component({
  selector: 'ims-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  milestones: Milestone[] = [
    { route: '/categories', title: 'Categories & Types', done: true, note: 'Ported (list + add/rename/remove + persistence).' },
    { route: '/orders', title: 'Parties & Orders', done: true, note: 'Ported (party CRUD + order headers + detail + persistence).' },
    { route: '/items', title: 'Items & Stock', done: true, note: 'Ported (typed catalog: list + CRUD per type).' },
    { route: '/handoff', title: 'Item Hand-Off & Custody', done: true, note: 'Ported (movements: issue/return + chain-of-custody log).' },
    { route: '/locations', title: 'Locations', done: true, note: 'Ported (yard/branch/warehouse/bin CRUD).' },
    { route: '/inspections', title: 'Receiving / Inspections', done: true, note: 'Ported (check in/out with meter/fuel log).' },
    { route: '/maintenance', title: 'Field Service & Maintenance (module)', done: true, note: 'Ported (work orders on items, gated by ModulesService).' },
    { route: '/timesheet', title: 'Labor & Timesheets (module)', done: true, note: 'Ported (time records vs orders/shop, gated).' },
    { route: '/rentals', title: 'Rentals & Sub-Rentals (module)', done: true, note: 'Ported (vendor sub-rentals with spread, gated).' },
    { route: '/logistics', title: 'Logistics & Dispatch (module)', done: true, note: 'Ported (truck dispatch by status, gated).' },
    { route: '/invoicing', title: 'Billing & Invoicing (module)', done: true, note: 'Ported (invoices from priced orders, gated).' },
    { route: '/admin', title: 'Feature Modules (admin)', done: true, note: 'Ported (toggle industry modules).' },
    { route: '/scheduler', title: 'Allocations (module)', done: false, note: 'Timeline UI — remaining.' },
    { route: '/invoicing', title: 'Billing (module)', done: false, note: 'Industry module over core.' },
  ];

  constructor(readonly data: DataService) {}

  partyCount(): number {
    return this.data.listParties().length;
  }
}
