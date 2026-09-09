import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Inspection, InspectionDirection } from '../../core/models';

interface InspForm {
  itemId: string;
  date: string;
  direction: InspectionDirection;
  meter: number;
  fuel: number;
  notes: string;
}

@Component({
  selector: 'ims-inspections',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './inspections.component.html',
  styleUrl: './inspections.component.scss',
})
export class InspectionsComponent {
  formOpen = false;
  form: InspForm = this.emptyForm();

  constructor(readonly data: DataService) {}

  inspections(): Inspection[] {
    return this.data.listInspections();
  }

  items() {
    return this.data.listItems('serialized');
  }

  openForm(): void {
    this.form = { ...this.emptyForm(), date: new Date().toISOString().slice(0, 10) };
    this.formOpen = true;
  }

  save(): void {
    const f = this.form;
    if (!f.itemId) return;
    this.data.createInspection({
      itemId: f.itemId,
      date: f.date,
      direction: f.direction,
      meter: f.meter,
      fuel: f.fuel,
      notes: f.notes,
      status: 'Open',
    });
    this.formOpen = false;
  }

  close(r: Inspection): void {
    this.data.closeInspection(r.id);
  }

  remove(r: Inspection): void {
    if (confirm(`Remove inspection ${r.id}?`)) this.data.removeInspection(r.id);
  }

  private emptyForm(): InspForm {
    return {
      itemId: '',
      date: '',
      direction: 'in',
      meter: 0,
      fuel: 0,
      notes: '',
    };
  }
}
