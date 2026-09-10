import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { LocationType } from '../../core/models';

/**
 * Administration → Location Types — the user-defined location-type vocabulary
 * (Site, Yard, Rack, Bin, …). Split out of the Locations page so the type list
 * is managed here, next to the other catalog/config sections; a location still
 * picks its type in the Locations editor.
 */
@Component({
  selector: 'ims-location-types',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './location-types.component.html',
  styleUrl: './location-types.component.scss',
})
export class LocationTypesComponent {
  modalOpen = false;
  renameFrom: string | null = null;
  formName = '';
  formActive = true;

  constructor(readonly data: DataService) {}

  records(): LocationType[] {
    return this.data.locationTypeRecords();
  }

  /** How many locations use a type (blocks removal while > 0). */
  count(name: string): number {
    return this.data.locationTypeCount(name);
  }

  openAdd(): void {
    this.renameFrom = null;
    this.formName = '';
    this.formActive = true;
    this.modalOpen = true;
  }

  openRename(t: LocationType): void {
    this.renameFrom = t.name;
    this.formName = t.name;
    this.formActive = t.active !== false;
    this.modalOpen = true;
  }

  save(): void {
    const name = this.formName.trim();
    if (!name) return;
    if (this.renameFrom) this.data.renameLocationType(this.renameFrom, name, this.formActive);
    else this.data.addLocationType(name, this.formActive);
    this.close();
  }

  remove(t: LocationType): void {
    this.data.removeLocationType(t.name);
  }

  close(): void {
    this.modalOpen = false;
    this.renameFrom = null;
    this.formName = '';
    this.formActive = true;
  }
}
