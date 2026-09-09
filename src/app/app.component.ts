import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface NavItem {
  label: string;
  route: string;
  soon?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  groups: NavGroup[] = [
    {
      title: 'Inventory · Core',
      items: [
        { label: 'Dashboard', route: '/dashboard' },
        { label: 'Items & Stock', route: '/items' },
        { label: 'Parties & Orders', route: '/orders' },
        { label: 'Item Hand-Off & Custody', route: '/handoff' },
        { label: 'Receiving / Inspections', route: '/inspections' },
        { label: 'Locations', route: '/locations' },
        { label: 'Categories & Types', route: '/categories' },
      ],
    },
    {
      title: 'Modules · Opt-in',
      items: [
        { label: 'Field Service & Maintenance', route: '/maintenance' },
        { label: 'Labor & Timesheets', route: '/timesheet' },
        { label: 'Logistics & Dispatch', route: '/logistics' },
        { label: 'Rentals & Sub-Rentals', route: '/rentals' },
        { label: 'Billing & Invoicing', route: '/invoicing' },
      ],
    },
    {
      title: 'Modules · Planned',
      items: [
        { label: 'Allocations & Scheduling', route: '/scheduler', soon: true },
        { label: 'Billing & Invoicing', route: '/invoicing', soon: true },
      ],
    },
    {
      title: 'Administration',
      items: [{ label: 'Feature Modules', route: '/admin' }],
    },
  ];

  readonly today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
