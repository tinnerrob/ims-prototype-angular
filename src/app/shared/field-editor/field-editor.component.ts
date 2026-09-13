import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FormField, FORM_FIELD_KINDS, duplicateFieldKeys } from '../../core/models';

/**
 * `<ims-field-editor>` (Phase C) — edits a list of `FormField` **definitions** in
 * place, the authoring counterpart of `<ims-dynamic-form>` (which renders *values*
 * against a schema). Both speak the same `FormField` vocabulary — that is the point
 * of one field engine: a category's fields and the tenant's stock set are edited
 * here and rendered there.
 *
 * The host passes a **copy** and applies it on save, so an unsaved edit never
 * touches the stored row.
 */
@Component({
  selector: 'ims-field-editor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './field-editor.component.html',
  styleUrl: './field-editor.component.scss',
})
export class FieldEditorComponent {
  @Input() fields: FormField[] = [];
  /** Informational — the host may mark itself dirty; it applies the list on save. */
  @Output() changed = new EventEmitter<void>();

  readonly kinds = FORM_FIELD_KINDS;

  add(): void {
    this.fields.push({ key: '', label: '', kind: 'text' });
    this.changed.emit();
  }

  remove(index: number): void {
    this.fields.splice(index, 1);
    this.changed.emit();
  }

  move(index: number, delta: number): void {
    const to = index + delta;
    if (to < 0 || to >= this.fields.length) return;
    const [f] = this.fields.splice(index, 1);
    this.fields.splice(to, 0, f);
    this.changed.emit();
  }

  /** Choices are edited as one comma-separated string. */
  optionsText(f: FormField): string {
    return (f.options ?? []).join(', ');
  }

  setOptions(f: FormField, text: string): void {
    const list = String(text)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    f.options = list.length ? list : undefined;
    this.changed.emit();
  }

  hasOptions(f: FormField): boolean {
    return f.kind === 'select' || f.kind === 'multiselect';
  }

  hasUnit(f: FormField): boolean {
    return f.kind === 'measurement' || f.kind === 'number';
  }

  /* ------------------------------- the key ------------------------------- */

  /**
   * Why this row's key is not storable, or `''` when it is fine.
   *
   * A key *identifies* the field: it is what a record's `attributes` is read and
   * written by, so within one list it has to be stated once. Two categories may
   * both declare `rate` (they are different lists); one list may not.
   */
  keyError(f: FormField): string {
    const key = (f.key ?? '').trim();
    if (!key) return 'A field needs a key.';
    if (duplicateFieldKeys(this.fields).includes(key)) return `Key “${key}” is already used in this list.`;
    return '';
  }

  /** True when the list can be saved: every key named, none stated twice. */
  valid(): boolean {
    return this.fields.every((f) => !this.keyError(f));
  }
}
