import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Branch } from '../../core/models';

/**
 * Locations (core) — port of the prototype's `renderBranches`
 * (js/pages/branches.js): "Branch / Yard Profiles" cards with an
 * edit / remove action each and a New Branch modal.
 */
@Component({
  selector: 'ims-locations',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './locations.component.html',
  styleUrl: './locations.component.scss',
})
export class LocationsComponent {
  modalOpen = false;
  editingId: string | null = null;
  /**
   * Blank editor form. Field initializers run before the constructor assigns
   * `data`, so this must not read it — `openForm()` applies the data-derived
   * id default via `emptyForm()`.
   */
  form: Omit<Branch, 'id'> & { id: string } = {
    id: '',
    name: '',
    address: '',
    phone: '',
    tz: 'America/New_York',
  };

  constructor(private readonly data: DataService) {}

  branches(): Branch[] {
    return this.data.listBranches();
  }

  openForm(b?: Branch): void {
    this.editingId = b ? b.id : null;
    this.form = b
      ? { id: b.id, name: b.name, address: b.address, phone: b.phone, tz: b.tz }
      : this.emptyForm();
    this.modalOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.id.trim() || !f.name.trim()) return;
    const patch = { name: f.name, address: f.address, phone: f.phone, tz: f.tz };
    if (this.editingId) this.data.updateBranch(this.editingId, patch);
    else this.data.createBranch({ ...patch, id: f.id });
    this.close();
  }

  remove(b: Branch): void {
    this.data.removeBranch(b.id);
  }

  close(): void {
    this.modalOpen = false;
    this.editingId = null;
  }

  private emptyForm() {
    return {
      id: 'BR-' + String(this.data.listBranches().length + 1),
      name: '',
      address: '',
      phone: '',
      tz: 'America/New_York',
    };
  }
}
