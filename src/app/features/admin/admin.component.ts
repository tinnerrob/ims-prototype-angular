import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface AdminMenu {
  /** Child-route segment under `/admin`. */
  id: string;
  label: string;
  icon: string;
}

/**
 * Administration — the admin shell page.
 *
 * The submenu moves between the administration sections; each entry is a child
 * route (so `/admin/locations`, `/admin/location-types`, `/admin/categories` and
 * `/admin/modules` are real, linkable URLs) rendered into the pane below the menu.
 */
@Component({
  selector: 'ims-admin',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent {
  readonly menus: AdminMenu[] = [
    { id: 'locations', label: 'Locations', icon: 'bi-buildings' },
    { id: 'location-types', label: 'Location Types', icon: 'bi-diagram-3' },
    { id: 'categories', label: 'Categories & Types', icon: 'bi-tags' },
    { id: 'modules', label: 'Feature Modules', icon: 'bi-toggles' },
  ];
}
