import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { CatalogType, CATALOG_TYPES, CATALOG_TYPE_KEYS } from '../../core/models';

/**
 * Categories & Types (core) — first ported vertical slice.
 * Demonstrates the shared pattern for every future feature:
 *   DataService (typed store) -> component state -> list + CRUD UI.
 */
@Component({
  selector: 'ims-categories',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss',
})
export class CategoriesComponent {
  readonly types = CATALOG_TYPES;

  type: CatalogType = 'serialized';

  /** Live view of names for the selected type (kept in sync after each op). */
  get names(): string[] {
    return this.data.categoriesFor(this.type);
  }

  draft = '';
  /** Inline-edit state: index currently editing, plus its working value. */
  editIndex: number | null = null;
  editValue = '';

  constructor(private readonly data: DataService) {}

  selectType(t: CatalogType): void {
    this.type = t;
    this.cancelEdit();
  }

  add(): void {
    this.data.addCategory(this.type, this.draft);
    this.draft = '';
  }

  beginEdit(i: number, name: string): void {
    this.editIndex = i;
    this.editValue = name;
  }

  saveEdit(i: number, name: string): void {
    this.data.renameCategory(this.type, name, this.editValue);
    this.cancelEdit();
  }

  cancelEdit(): void {
    this.editIndex = null;
    this.editValue = '';
  }

  remove(i: number, name: string): void {
    if (confirm(`Remove category "${name}" from ${this.type}?`)) {
      this.data.removeCategory(this.type, name);
    }
  }

  protected readonly CATALOG_TYPE_KEYS = CATALOG_TYPE_KEYS;
}
