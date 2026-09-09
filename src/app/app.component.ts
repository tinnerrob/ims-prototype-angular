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
        { label: 'Categories & Types', route: '/categories' },
      ],
    },
    {
      title: 'Planned (to port)',
      items: [
        { label: 'Parties & Orders', route: '/parties', soon: true },
        { label: 'Items & Stock', route: '/inventory', soon: true },
        { label: 'Item Hand-Off & Custody', route: '/handoff', soon: true },
        { label: 'Allocations & Scheduling', route: '/scheduler', soon: true },
        { label: 'Billing & Invoicing', route: '/invoicing', soon: true },
      ],
    },
  ];

  readonly today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
