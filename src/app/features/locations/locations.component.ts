import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import {
  Location,
  LOCATION_TYPE_LABEL,
  LocationType,
} from '../../core/models';

interface LocForm {
  name: string;
  type: LocationType;
  address: string;
  parentId: string;
}

const TYPE_ORDER: LocationType[] = ['yard', 'branch', 'warehouse', 'bin'];

@Component({
  selector: 'ims-locations',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './locations.component.html',
  styleUrl: './locations.component.scss',
})
export class LocationsComponent {
  readonly types = TYPE_ORDER;
  readonly typeLabel = LOCATION_TYPE_LABEL;

  formOpen = false;
  editingId: string | null = null;
  form: LocForm = this.emptyForm();

  constructor(readonly data: DataService) {}

  locations(): Location[] {
    return this.data.listLocations();
  }

  /** Yards/branches eligible to be a parent. */
  parents(): Location[] {
    return this.data.listLocations().filter((l) => l.type === 'yard' || l.type === 'branch');
  }

  parentName(l: Location): string {
    return l.parentId ? this.data.listLocations().find((p) => p.id === l.parentId)?.name ?? '—' : '—';
  }

  openForm(loc?: Location): void {
    this.editingId = loc ? loc.id : null;
    this.form = loc
      ? { name: loc.name, type: loc.type, address: loc.address, parentId: loc.parentId ?? '' }
      : { ...this.emptyForm(), type: 'yard' };
    this.formOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.name.trim()) return;
    const patch = { name: f.name, type: f.type, address: f.address, parentId: f.parentId || null };
    if (this.editingId) this.data.updateLocation(this.editingId, patch);
    else this.data.createLocation(patch);
    this.closeForm();
  }

  closeForm(): void {
    this.formOpen = false;
    this.editingId = null;
  }

  remove(loc: Location): void {
    if (confirm(`Remove location "${loc.name}"?`)) this.data.removeLocation(loc.id);
  }

  private emptyForm(): LocForm {
    return { name: '', type: 'yard', address: '', parentId: '' };
  }
}
