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
    { route: '/inventory', title: 'Items & Stock', done: false, note: 'Core: typed catalog + registry.' },
    { route: '/handoff', title: 'Item Hand-Off & Custody', done: false, note: 'Core: movements / issue-return.' },
    { route: '/scheduler', title: 'Allocations (module)', done: false, note: 'Industry module over core.' },
    { route: '/invoicing', title: 'Billing (module)', done: false, note: 'Industry module over core.' },
  ];

  constructor(readonly data: DataService) {}

  partyCount(): number {
    return this.data.listParties().length;
  }
}
